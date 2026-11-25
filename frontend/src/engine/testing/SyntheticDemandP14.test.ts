import { describe, expect, it } from 'vitest';
import fs from 'fs';
import type { RoadObject } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan } from '../simulation/StudyDemand';
import { decodeSyntheticDemand, odCell, rebalance, syntheticAreaPlan, cityHourTotals, modeProbs, type SyntheticDemandDoc, type SyntheticTripEnd } from '../demand/syntheticDemand';
import { SyntheticDemandSource } from '../demand/syntheticDemandSource';
import { decideSyntheticDefault, PROJECT_SCORE_SYNTHETIC } from '../calibration/syntheticDemandDecision';
import { scoreProjectCheck } from '../calibration/projectCheck';
import { P14_SYNTHETIC_RECORD } from '../calibration/syntheticDemandRecord';
import { P13_RECORD } from '../calibration/projectValidationRecord';
import { officialNotWorse } from '../calibration/tunedSupply';
import { syntheticDemandBannerLine } from '../../components/ui/badges/syntheticDemandCheck';

/** p14: the synthetic land-use demand (demand/syntheticDemand.ts, docs/urbanos/DEMAND_P14.md). */

const K = 111320 * Math.cos(18.5 * Math.PI / 180);
const pt = (x: number, y = 0, z = 0): [number, number, number] => [73.8 + x / K, 18.5 + y / 111320, z];
const road = (id: string, a: [number, number], b: [number, number], extra: Partial<RoadObject> = {}) =>
  ({ id, type: 'road', coordinates: [pt(...a), pt(...b)], roadClass: 'arterial', laneCount: 2, laneWidth: 3.5, speedLimit: 50, connectedJunctions: [], scenarioId: 'base', ...extra } as RoadObject);
const roads = [
  road('w2', [-1500, 0], [-800, 0], { name: 'Main Road' }), road('w1', [-800, 0], [0, 0], { name: 'Main Road' }),
  road('m1', [0, 0], [400, 0], { name: 'Main Road' }), road('m2', [400, 0], [800, 0], { name: 'Main Road' }),
  road('e1', [800, 0], [1600, 0], { name: 'Main Road' }), road('e2', [1600, 0], [2300, 0], { name: 'Main Road' }),
  road('cross', [400, -800], [400, 0], { name: 'Cross Road', roadClass: 'collector' }), road('cross2', [400, 0], [400, 800], { name: 'Cross Road', roadClass: 'collector' }),
];
const roadMap = new Map(roads.map(r => [r.id, r]));
const area = () => new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['m1'], rangeMeters: 600, direction: 'both' });

const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const zero24 = () => Array(24).fill(0);
const at = (h: number) => { const v = zero24(); v[h] = 1; return v; };

/**
 * Three zones: one inside the area (homes at x=10, jobs at x=790) and one far west and one far east of it, on a main-road
 * skeleton along y=0. Only HBW trips, two-wheelers with occupancy 1, every cell 10,000 trips a day; outbound all at 09:00,
 * return all at 18:00.
 */
function doc(): SyntheticDemandDoc {
  const xs = [-6000, -3000, -1000, 0, 400, 1200, 3000, 6000];
  const from: number[] = [], to: number[] = [];
  for (let i = 0; i + 1 < xs.length; i++) { from.push(i, i + 1); to.push(i + 1, i); }
  const n = 3;
  const zeros = new Float64Array(n), full = new Float64Array(n).fill(100);
  const gravity = Object.fromEntries((['HBW', 'HBE', 'HBO', 'NHB', 'FRT'] as const).map(p => [p, { alpha: 0, beta: 0, trips: 0, a: b64(p === 'HBW' ? full : zeros), b: b64(p === 'HBW' ? full : zeros) }]));
  const hourly = Object.fromEntries((['HBW', 'HBE', 'HBO', 'NHB', 'FRT'] as const).map(p => [p, { out: at(9), ret: at(18) }]));
  const ends = (P: Record<string, number>, A: Record<string, number>) => ({ P, A });
  const weight = { walk: 0, cycle: 0, two_wheeler: 1, auto: 0, car: 0, bus: 0, metro: 0 }, lenKm = { walk: 5, cycle: 5, two_wheeler: 5, auto: 5, car: 5, bus: 5, metro: 5 };
  const zone = (id: string, x: number) => ({ id, name: id, kind: 'internal' as const, lon: pt(x)[0], lat: pt(x)[1], juris: 'PMC', res: 1000, jobs: 1000, svc: 0, seats: 0, ind: 0 });
  return {
    schema: 'twincity.synthetic_demand/v1', id: 'test_synthetic', label: 'synthetic', status: 'synthetic', labelText: 'synthetic test', built: '', baseYear: 2024,
    zones: [zone('in', 400), zone('west', -6000), zone('east', 6000)],
    endWeights: { HBW: ends({ res: 1 }, { jobs: 1 }), HBE: ends({ res: 1 }, { seats: 1 }), HBO: ends({ res: 1 }, { svc: 1 }), NHB: ends({ jobs: 1 }, { jobs: 1 }), FRT: ends({ ind: 1 }, { ind: 1 }) },
    impedance: { n, timeS: b64(new Uint16Array([60, 600, 600, 600, 60, 1200, 600, 1200, 60])), distDam: b64(new Uint16Array(9).fill(500)) },
    gravity: gravity as SyntheticDemandDoc['gravity'],
    productions: Object.fromEntries((['HBW', 'HBE', 'HBO', 'NHB', 'FRT'] as const).map(p => [p, b64(p === 'HBW' ? new Float64Array(n).fill(30000) : zeros)])) as SyntheticDemandDoc['productions'],
    attractions: Object.fromEntries((['HBW', 'HBE', 'HBO', 'NHB', 'FRT'] as const).map(p => [p, b64(p === 'HBW' ? new Float64Array(n).fill(30000) : zeros)])) as SyntheticDemandDoc['attractions'],
    modeSplit: { params: { PMC: { weight, lenKm }, PMR: { weight, lenKm } } },
    occupancy: { two_wheeler: 1, car: 1, auto: 1, bus: 1 }, pcu: { two_wheeler: 0.75 },
    hourly: hourly as SyntheticDemandDoc['hourly'],
    skeleton: {
      n: xs.length, lon: b64(Int32Array.from(xs, x => Math.round(pt(x)[0] * 1e6))), lat: b64(Int32Array.from(xs, x => Math.round(pt(x)[1] * 1e6))),
      from: b64(Uint16Array.from(from)), to: b64(Uint16Array.from(to)), timeDs: b64(Uint16Array.from(from, () => 600)), cls: b64(Uint8Array.from(from, () => 0)), classes: ['primary'],
      connectors: [[[3, 10]], [[0, 10]], [[7, 10]]],
    },
  };
}
const ends: SyntheticTripEnd[] = [
  { ...{ lon: pt(10, 5)[0], lat: pt(10, 5)[1] }, zone: 0, res: 1000, jobs: 0, svc: 0, seats: 0, ind: 0 },
  { ...{ lon: pt(790, 5)[0], lat: pt(790, 5)[1] }, zone: 0, res: 0, jobs: 1000, svc: 0, seats: 0, ind: 0 },
];
const near = (a: readonly number[], x: number, tol = 30) => Math.abs((a[0] - 73.8) * K - x) < tol;

describe('synthetic demand: city model', () => {
  it('refuses an asset that is not labelled synthetic', () => {
    expect(() => decodeSyntheticDemand({ ...doc(), status: 'measured' })).toThrow(/synthetic/);
    expect(() => decodeSyntheticDemand({ ...doc(), label: 'estimated' })).toThrow(/synthetic/);
  });
  it('reproduces the factored gravity OD, the mode split and the hourly directional flows', () => {
    const c = decodeSyntheticDemand(doc());
    expect(odCell(c, 'HBW', 0, 1)).toBeCloseTo(10000, 6);
    expect(modeProbs(c, 0, 1).two_wheeler).toBeCloseTo(1, 9);
    // 09:00: half of each cell's trips leave home (outbound); 18:00 the other half return
    expect(cityHourTotals(c, 9, {}).veh).toBeCloseTo(9 * 5000, 3);
    expect(cityHourTotals(c, 18, {}).veh).toBeCloseTo(9 * 5000, 3);
    expect(cityHourTotals(c, 23, {}).veh).toBe(0);
  });
  it('rebalancing with another beta keeps productions and attractions', () => {
    const c = rebalance(decodeSyntheticDemand(doc()), 1.3);
    for (let i = 0; i < 3; i++) {
      let row = 0, col = 0;
      for (let j = 0; j < 3; j++) { row += odCell(c, 'HBW', i, j); col += odCell(c, 'HBW', j, i); }
      expect(row).toBeCloseTo(30000, 3); expect(col).toBeCloseTo(30000, 3);
    }
  });
});

describe('synthetic demand: study-area cut', () => {
  const c = decodeSyntheticDemand(doc());
  it('starts and ends the area\'s trips at its buildings, and loads the rest at the boundary road its city path crosses', () => {
    const a = area();
    const plan = syntheticAreaPlan(c, a, roadMap, ends, { hour: 9 })!;
    expect(plan.provenance.source).toBe('synthetic');
    expect(plan.provenance.synthetic?.label).toBe('synthetic');
    expect(plan.provenance.label).toMatch(/SYNTHETIC/);
    expect(plan.provenance.label).toMatch(/not measured/);
    const comp = plan.provenance.components!;
    // in->in 5000 (home -> work), in->west and in->east 5000 each (out), west->in and east->in 5000 each (in), west<->east through
    expect(comp.internal).toBeCloseTo(5000, 3);
    expect(comp.outbound).toBeCloseTo(10000, 3);
    expect(comp.inbound).toBeCloseTo(10000, 3);
    expect(comp.through).toBeCloseTo(10000, 3);
    const internal = plan.trips.filter(t => t.part === 'internal');
    expect(internal.every(t => near(t.from, 10) && near(t.to, 790))).toBe(true);
    // Morning: outbound trips leave from the homes, inbound trips arrive at the jobs
    expect(plan.trips.filter(t => t.part === 'outbound').every(t => near(t.from, 10))).toBe(true);
    expect(plan.trips.filter(t => t.part === 'inbound').every(t => near(t.to, 790))).toBe(true);
    // Through traffic enters and leaves on the main road (west and east ends of the area), never on the collector
    const xOf = (p: readonly number[]) => (p[0] - 73.8) * K;
    for (const t of plan.trips.filter(t => t.part === 'through')) { expect(Math.abs(t.from[1] - 18.5) * 111320).toBeLessThan(5); expect(Math.sign(xOf(t.from))).toBe(-Math.sign(xOf(t.to))); }
    // Every trip snaps to the area's roads
    const snapped = snapDemandPlan(plan, a.network, 250, new Set(a.segments.map(s => s.key)));
    expect(snapped.every(t => t.fromNodeId && t.toNodeId)).toBe(true);
  });
  it('reverses in the evening (jobs -> homes) and leaves out through traffic when switched off', () => {
    const plan = syntheticAreaPlan(c, area(), roadMap, ends, { hour: 18, through: false })!;
    expect(plan.trips.filter(t => t.part === 'internal').every(t => near(t.from, 790) && near(t.to, 10))).toBe(true);
    expect(plan.provenance.components!.through).toBe(0);
    expect(plan.provenance.label).toMatch(/through traffic switched off/);
  });
  it('scales every part with the calibration scale', () => {
    const p1 = syntheticAreaPlan(c, area(), roadMap, ends, { hour: 9 })!, p2 = syntheticAreaPlan(c, area(), roadMap, ends, { hour: 9, scale: 0.5 })!;
    expect(p2.provenance.vehiclesPerHour).toBeCloseTo(p1.provenance.vehiclesPerHour * 0.5, 6);
  });
  it('the source answers only once the model and the area\'s trip ends are loaded', async () => {
    const a = area();
    const s = new SyntheticDemandSource('test_synthetic', async () => doc(), async () => ends);
    expect(s.plan(a, roadMap, 9, true, 'k')).toBeNull();
    await s.load();
    expect(s.status).toBe('ready');
    expect(s.plan(a, roadMap, 9, true, 'k')).toBeNull();
    await s.loadEnds(a.bounds);
    expect(s.plan(a, roadMap, 9, true, 'k')?.provenance.source).toBe('synthetic');
    const bad = new SyntheticDemandSource('x', async () => { throw new Error('not installed'); });
    await bad.load();
    expect(bad.status).toBe('none');
  });
});

describe('synthetic demand: default decision and banner', () => {
  const obs = (ok: boolean) => scoreProjectCheck([
    { id: 'j@9', record: 'j', kind: 'jt', split: 'holdout', roadClass: 'primary', area: 'x', hour: 9, observed: 10, model: ok ? 10 : 20 },
    { id: 'c@9', record: 'c', kind: 'count', split: 'holdout', roadClass: 'primary', area: 'river', hour: 9, observed: 1000, model: ok ? 1000 : 3000 },
  ]);
  it('is on by default only when the hold-out passes and the official check is not worse', () => {
    expect(decideSyntheticDefault(null, null, null).on).toBe(false);
    expect(decideSyntheticDefault(obs(false), null, null).on).toBe(false);
    expect(decideSyntheticDefault(obs(true), null, null).on).toBe(true);
    const base = { gehAll: 2, gehHoldout: 1, n: 15, nHoldout: 8, riverPct: -0.26 };
    expect(decideSyntheticDefault(obs(true), base, { ...base, gehHoldout: 0 }).on).toBe(false);
  });
  it('the banner says synthetic, not measured, when it runs', () => {
    expect(syntheticDemandBannerLine(false, 'default')).toBeNull();
    expect(syntheticDemandBannerLine(true, 'tuned')).toMatch(/synthetic.*not measured.*Not checked/);
  });
  it('with a recorded run the banner gives the hold-out result and says in plain words what it means', () => {
    const line = syntheticDemandBannerLine(true, 'default')!;
    if (!PROJECT_SCORE_SYNTHETIC) { expect(line).toMatch(/Not checked/); return; }
    expect(line).toContain(`journey times ${PROJECT_SCORE_SYNTHETIC.holdout.jt.ok}/${PROJECT_SCORE_SYNTHETIC.holdout.jt.n}`);
    expect(line).toMatch(PROJECT_SCORE_SYNTHETIC.pass ? /passes\..*In plain words/ : /fails\..*In plain words: it does not match/);
    const o = P14_SYNTHETIC_RECORD?.official, b = P13_RECORD.officialDefault;
    if (o && b) {
      expect(line).toContain(`Official-count check with it: ${o.gehAll}/${o.n} sites within GEH 5`);
      expect(line).toMatch(officialNotWorse(b, o) ? /; not worse\)/ : /; worse\)/);
    }
  });
});

// With the built asset installed (dev machine): the TypeScript port reproduces the build script's hourly city totals
const ASSET = '/workspace/work/urbanos-data/synthetic/demand-v1/out/';
describe.skipIf(!fs.existsSync(ASSET + 'parity_fixture.json'))('synthetic demand: parity with the build script', () => {
  it('city vehicles and PCU at 09:00 and 23:00 equal the build report', () => {
    const c = decodeSyntheticDemand(JSON.parse(fs.readFileSync(ASSET + 'pune_synthetic_demand_v1.json', 'utf8')));
    const fx = JSON.parse(fs.readFileSync(ASSET + 'parity_fixture.json', 'utf8')) as { cells: { i: number; j: number; HBW: number; probs: Record<string, number> }[]; hourlyVehicleTrips: number[]; hourlyPcu: number[] };
    const pcu = { two_wheeler: 0.75, car: 1, auto: 2, bus: 2.2, truck: 2.2 };
    for (const h of [9, 23]) {
      const t = cityHourTotals(c, h, pcu);
      expect(t.veh / fx.hourlyVehicleTrips[h]).toBeCloseTo(1, 4); // hourly shares are stored to 6 decimals
      expect(t.pcu / fx.hourlyPcu[h]).toBeCloseTo(1, 4);
    }
    // The TypeScript re-balancing (used for tuning beta) reproduces the build script's balancing factors
    const r = rebalance(c, 1 + 1e-12, 400);
    for (const cell of fx.cells.slice(0, 10)) {
      expect(odCell(c, 'HBW', cell.i, cell.j)).toBeCloseTo(cell.HBW, 6);
      for (const p of ['HBW', 'HBE'] as const) expect(odCell(r, p, cell.i, cell.j)).toBeCloseTo(odCell(c, p, cell.i, cell.j), 3);
      expect(modeProbs(c, cell.i, cell.j).two_wheeler).toBeCloseTo(cell.probs.two_wheeler, 6);
    }
  }, 60000);
});

// v2 (p14 structural fixes): beta by production jurisdiction and the outer-cordon traffic (EXT factored, THR fixed matrix)
describe.skipIf(!fs.existsSync(ASSET + 'parity_fixture_v2.json'))('synthetic demand v2: parity with the build script', () => {
  it('zone-segmented beta, cordon cells and hourly city totals equal the build', () => {
    const c = decodeSyntheticDemand(JSON.parse(fs.readFileSync(ASSET + 'pune_synthetic_demand_v2.json', 'utf8')));
    const fx = JSON.parse(fs.readFileSync(ASSET + 'parity_fixture_v2.json', 'utf8')) as { cells: Record<string, number>[]; hourlyVehicleTrips: number[]; hourlyPcu: number[] };
    expect(c.zones.some(z => z.kind === 'cordon')).toBe(true);
    for (const cell of fx.cells) for (const p of ['HBW', 'HBE', 'HBO', 'NHB', 'FRT', 'EXT'] as const) expect(odCell(c, p, cell.i, cell.j)).toBeCloseTo(cell[p], 5);
    const pcu = { two_wheeler: 0.75, car: 1, auto: 2, bus: 2.2, truck: 2.2 };
    for (const h of [9, 23]) {
      const t = cityHourTotals(c, h, pcu);
      expect(t.veh / fx.hourlyVehicleTrips[h]).toBeCloseTo(1, 4);
      expect(t.pcu / fx.hourlyPcu[h]).toBeCloseTo(1, 4);
    }
    // Re-balancing keeps the cordon traffic and the zone-segmented betas (identity at multiplier ~1)
    const r = rebalance(c, 1 + 1e-12, 400);
    for (const cell of fx.cells.slice(0, 10)) for (const p of ['HBW', 'EXT'] as const) expect(odCell(r, p, cell.i, cell.j)).toBeCloseTo(odCell(c, p, cell.i, cell.j), 3);
  }, 120000);
});
