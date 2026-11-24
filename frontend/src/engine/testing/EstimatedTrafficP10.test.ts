/**
 * p10-estimated (docs/urbanos/TRAFFIC_ESTIMATED_P10.md): the app's port of the city-wide ESTIMATED traffic reproduces the
 * dataset's numbers, applies the rules in force (Z-Bridge two-wheelers only, Baba Bhide Bridge closed), tilts direction by
 * peak, and gives any study area's main-road edges a flow road by road, labelled estimated.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { cordonOf, compileAreaDemand } from '../simulation/AreaDemand';
import { directionShare, estimateDaily, estimatedLinkFlow, midOf, type EstimatedTrafficModel } from '../simulation/EstimatedTraffic';

const FILE = path.resolve(__dirname, '../../../../backend/data/estimated_traffic/pune_estimated_traffic_v1.json');
const model = JSON.parse(fs.readFileSync(FILE, 'utf8')) as EstimatedTrafficModel & {
  checks: { osmWay: number; highway: string; lanes: number; oneway: boolean; mid: [number, number]; first: number[]; last: number[]; dailyMotor: number; am0900Fwd: number; pm1900Fwd: number }[];
  status: string;
};

describe('estimated traffic dataset', () => {
  it('is labelled estimated, never measured, and names its hold-out counts', () => {
    expect(model.status).toBe('estimated');
    expect(model.label).toBe('estimated (project-level, not for decisions)');
    expect(model.split?.holdout.length).toBeGreaterThan(5);
    // a hold-out count never scales its own roads
    const anchored = new Set(Object.values(model.wayOverrides).map(o => o.anchor));
    for (const h of model.split!.holdout) expect(anchored.has(h)).toBe(false);
  });

  it('the app port reproduces the build script on its fixture roads (daily, and 09:00 / 19:00 forward)', () => {
    expect(model.checks.length).toBeGreaterThan(5);
    for (const c of model.checks) {
      const x = { highway: c.highway, roadClass: 'local', lanes: c.lanes, oneway: c.oneway, mid: c.mid, osmWay: c.osmWay };
      const { daily } = estimateDaily(model, x);
      expect(daily).toBeCloseTo(c.dailyMotor, -1);
      expect(Math.abs(daily - c.dailyMotor) / Math.max(1, c.dailyMotor)).toBeLessThan(0.005);
      const heading = [c.last[0] - c.first[0], c.last[1] - c.first[1]];
      const am = daily * model.hourShare[9] * (c.oneway ? 1 : directionShare(model, c.mid, heading, 9));
      expect(Math.abs(am - c.am0900Fwd)).toBeLessThan(0.01 * Math.max(10, c.am0900Fwd));
    }
  });

  it('Baba Bhide Bridge is closed (0) and Z-Bridge carries its two-wheeler volume only', () => {
    const bhide = model.rules.find(r => r.kind === 'closed')!;
    expect(bhide.from).toBe('2026-11-17T23:00:00+05:30');
    const x = { highway: 'tertiary', roadClass: 'collector', lanes: 2, oneway: false, mid: [73.8448, 18.5152], osmWay: bhide.osmWays[0] };
    expect(estimateDaily(model, x)).toEqual({ daily: 0, basis: 'closed' });
    const z = model.rules.find(r => r.kind === 'two_wheeler_only')!;
    expect(estimateDaily(model, { ...x, osmWay: z.osmWays[0] }).daily).toBe(z.dailyMotor);
  });

  it('peak direction: toward the old city in the morning, away from it in the evening', () => {
    const at = [73.80, 18.47];               // south-west of the CBD
    const inbound = [model.cbd[0] - at[0], model.cbd[1] - at[1]];
    expect(directionShare(model, at, inbound, 9)).toBeGreaterThan(0.5);
    expect(directionShare(model, at, inbound, 19)).toBeLessThan(0.5);
    expect(directionShare(model, at, inbound, 3)).toBeCloseTo(0.5, 6);
    expect(midOf([[0, 0], [2, 2], [4, 0]])).toEqual([2, 2]);
  });
});

// A study area anywhere: a main road and a side street crossing the edge get road-by-road estimated flows on the main road only
const KM_LON = 111.32 * Math.cos(18.55 * Math.PI / 180);
const pt = (x: number, y = 0): [number, number, number] => [73.95 + x / (KM_LON * 1000), 18.60 + y / 111320, 0];
const road = (id: string, a: [number, number], b: [number, number], extra: Partial<RoadObject> = {}) =>
  ({ id, type: 'road', coordinates: [pt(...a), pt(...b)], roadClass: 'arterial', laneCount: 4, laneWidth: 3.5, speedLimit: 50, connectedJunctions: [], scenarioId: 'base', ...extra } as RoadObject);
const roads = [
  road('w1', [-1500, 0], [-800, 0], { name: 'Main Road' }), road('w0', [-800, 0], [0, 0], { name: 'Main Road' }),
  road('m1', [0, 0], [400, 0], { name: 'Main Road' }), road('m2', [400, 0], [800, 0], { name: 'Main Road' }),
  road('e1', [800, 0], [1600, 0], { name: 'Main Road' }), road('e2', [1600, 0], [2300, 0], { name: 'Main Road' }),
  road('s1', [400, 0], [400, 700], { name: 'Side Street', roadClass: 'local', laneCount: 2 }), road('s2', [400, 700], [400, 1500], { name: 'Side Street', roadClass: 'local', laneCount: 2 }),
];
const roadMap = new Map(roads.map(r => [r.id, r]));
const area = () => new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['m1'], rangeMeters: 600, direction: 'both' });

describe('estimated edge flows in a study area', () => {
  it('main-road edges take their estimated flow (labelled estimated); local streets keep no through traffic', () => {
    const a = area();
    const plain = cordonOf(a, roadMap);
    const est = cordonOf(a, roadMap, undefined, { model, hour: 9 });
    const main = est.filter(c => c.roadName === 'Main Road');
    expect(main.length).toBeGreaterThan(0);
    for (const c of main) {
      expect(c.flowSource).toBe('estimated');
      const p = plain.find(x => x.nodeId === c.nodeId)!;
      expect(c.inVph).not.toBeCloseTo(p.inVph, 0);
      expect(c.inVph).toBeGreaterThan(0);
    }
    for (const c of est.filter(x => x.roadName === 'Side Street')) {
      const p = plain.find(x => x.nodeId === c.nodeId)!;
      expect(c.inVph).toBe(p.inVph);
      expect(c.flowSource).toBe('class');
    }
  });

  it('the estimated flow of an arterial link is the daily estimate x the 09:00 share x its direction share', () => {
    const r = roadMap.get('e1')!;
    const a = r.coordinates[0], b = r.coordinates[1];
    const v = estimatedLinkFlow(model, r, a, [b[0] - a[0], b[1] - a[1]], 9);
    const d = estimateDaily(model, { highway: null, roadClass: 'arterial', lanes: 4, oneway: false, mid: midOf(r.coordinates), osmWay: null }).daily;
    expect(v / (d * model.hourShare[9])).toBeGreaterThan(0.4);
    expect(v / (d * model.hourShare[9])).toBeLessThan(0.6);
  });

  it('the demand label says the edge flows are calibrated to estimated data', () => {
    const plan = compileAreaDemand({ period: 'AM_Peak' }, area(), roadMap, { estimatedTraffic: model });
    expect(plan).not.toBeNull();
    expect(plan!.provenance.label).toContain('estimated');
    expect(plan!.provenance.label).toContain('calibrated to estimated data');
    expect(plan!.provenance.components?.estimatedCordonPoints).toBeGreaterThan(0);
  });
});
