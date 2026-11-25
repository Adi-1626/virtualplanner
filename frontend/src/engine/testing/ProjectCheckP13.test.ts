import { describe, it, expect } from 'vitest';
import type { RoadObject, RoadClassification } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { buildAssignmentNetwork, assignTraffic } from '../simulation/staticAssignment';
import { DEFAULT_SUPPLY, SUPPLY_BOUNDS, isDefaultSupply, supplyToVector, vectorToSupply } from '../simulation/supplyParams';
import { geh, jtOk, scoreProjectCheck, scoreGroup, projectLoss, PROJECT_CRITERIA, sectionCount, sectionCountGrouped, sectionDirections, wayBearing, type ProjectObs } from '../calibration/projectCheck';
import { decideTunedDefault, officialNotWorse } from '../calibration/tunedSupply';
import { bannerState, bannerText, projectRows, projectValidationCheck, PROJECT_CHECK, PROJECT_CHECK_TITLE } from '../../components/ui/badges/projectValidation';
import { TRAFFIC_VALIDATION } from '../../components/ui/badges/trafficValidation';

/** p13 (docs/urbanos/VALIDATION_P13.md): the project check against estimated data, kept apart from the official-count check. */

const jt = (id: string, split: 'calibration' | 'holdout', observed: number, model: number | null, hour = 9): ProjectObs =>
  ({ id: `${id}@${hour}`, record: id, kind: 'jt', split, roadClass: 'primary', area: 'x', hour, observed, model });
const cnt = (id: string, split: 'calibration' | 'holdout', observed: number, model: number | null, area = 'arterial'): ProjectObs =>
  ({ id, record: id, kind: 'count', split, roadClass: 'primary', area, hour: 9, observed, model });

describe('project check scoring (fixed TAG criteria, hold-out decides)', () => {
  it('journey times: within 15 % or 1 minute, whichever is larger', () => {
    expect(jtOk(10, 11.5)).toBe(true);   // 13 % off
    expect(jtOk(10, 12)).toBe(false);    // 17 % off, 2 min
    expect(jtOk(3, 3.9)).toBe(true);     // 23 % off but under 1 min
    expect(jtOk(3, 4.2)).toBe(false);    // 1.2 min off
  });
  it('GEH is the TAG formula', () => {
    expect(geh(100, 100)).toBe(0);
    expect(geh(1000, 1200)).toBeCloseTo(Math.sqrt(2 * 200 ** 2 / 2200), 9);
  });
  it('a missing model value is a failure, never dropped from the share', () => {
    const g = scoreGroup([cnt('a', 'holdout', 1000, 1000), cnt('b', 'holdout', 1000, null)]);
    expect(g.counts.n).toBe(2);
    expect(g.counts.gehOk).toBe(1);
    expect(g.counts.share).toBe(0.5);
    expect(g.counts.missing).toBe(1);
  });
  it('passes only when the hold-out meets all three criteria; calibration results never change the verdict', () => {
    const good: ProjectObs[] = [];
    for (let i = 0; i < 10; i++) good.push(jt(`j${i}`, 'holdout', 10, 10.5), cnt(`c${i}`, 'holdout', 2000, 2050, i < 4 ? 'river' : 'arterial'));
    const badCal = [...Array(10)].map((_, i) => cnt(`k${i}`, 'calibration', 2000, 200));
    const s = scoreProjectCheck([...good, ...badCal]);
    expect(s.pass).toBe(true);
    expect(s.calibration.counts.gehOk).toBe(0);
    // One criterion short on the hold-out fails the check: 2 of 10 journey times off -> 80 % < 85 %
    const worse = good.map((o, i) => (o.kind === 'jt' && i < 4 ? { ...o, model: 20 } : o));
    const w = scoreProjectCheck(worse);
    expect(w.checks.jt).toBe(false);
    expect(w.pass).toBe(false);
    // The river total must be within 5 %
    const river = good.map(o => (o.area === 'river' ? { ...o, model: 2300 } : o));
    expect(scoreProjectCheck(river).checks.screenline).toBe(false);
  });
  it('the criteria are the TAG numbers', () => {
    expect(PROJECT_CRITERIA).toEqual({ gehMax: 5, gehShare: 0.85, jtRel: 0.15, jtAbsMin: 1, jtShare: 0.85, screenlineRel: 0.05 });
  });
  it('the tuning loss falls as the model approaches the observations', () => {
    const far = projectLoss([jt('a', 'calibration', 10, 5), cnt('b', 'calibration', 2000, 500)]);
    const near = projectLoss([jt('a', 'calibration', 10, 9.5), cnt('b', 'calibration', 2000, 1950)]);
    expect(near).toBeLessThan(far);
  });
});

describe('count matching: one cross-section per direction, never the sum over the counted ways', () => {
  const N: [number, number][] = [[73.85, 18.50], [73.85, 18.51]]; // drawn northward
  const S: [number, number][] = [[73.8502, 18.51], [73.8502, 18.50]]; // other carriageway, drawn southward
  it('many consecutive two-way pieces of one road: busiest piece each way, both added (not 2 x pieces added)', () => {
    const flows = [1000, 1200, 900, 1100].flatMap((v, k) => [{ bearing: wayBearing(N, false), vph: v }, { bearing: wayBearing(N, true), vph: 800 + k * 10 }]);
    expect(sectionCount(flows)).toBe(1200 + 830);
  });
  it('a divided road: the two one-way carriageways (both forward links) are the two directions', () => {
    const flows = [{ bearing: wayBearing(N, false), vph: 1500 }, { bearing: wayBearing(N, false), vph: 1400 }, { bearing: wayBearing(S, false), vph: 1300 }, { bearing: wayBearing(S, false), vph: 1250 }];
    const d = sectionDirections(flows.map(f => f.bearing));
    expect(d.along).toEqual([0, 1]);
    expect(d.against).toEqual([2, 3]);
    expect(sectionCount(flows)).toBe(1500 + 1300);
  });
  it('a gently curving stretch stays on its side; one way only counts one direction', () => {
    const bend: [number, number][] = [[73.85, 18.51], [73.855, 18.515]]; // north-east, 45 degrees off
    expect(sectionCount([{ bearing: wayBearing(N, false), vph: 700 }, { bearing: wayBearing(bend, false), vph: 900 }])).toBe(900);
    expect(sectionCount([])).toBe(0);
  });
  it('twin bridges (validation-v1 2026-11-25): each carriageway group is one cross-section per direction, the groups added', () => {
    const f = [{ way: 1, bearing: wayBearing(N, false), vph: 1500 }, { way: 2, bearing: wayBearing(S, false), vph: 1300 },
      { way: 3, bearing: wayBearing(N, false), vph: 900 }, { way: 4, bearing: wayBearing(S, false), vph: 700 }];
    expect(sectionCountGrouped(f)).toBe(1500 + 1300);
    expect(sectionCountGrouped(f, [[1, 2], [3, 4]])).toBe(1500 + 1300 + 900 + 700);
    expect(sectionCountGrouped(f, [[1, 2]])).toBe(2800);
  });
});

describe('tuned (estimated) parameters: on by default only if they pass the hold-out AND do not worsen the official check', () => {
  const base = { gehAll: 2, gehHoldout: 1, n: 15, nHoldout: 8, riverPct: -0.265 };
  const passing = scoreProjectCheck([...Array(10)].flatMap((_, i) => [jt(`j${i}`, 'holdout', 10, 10), cnt(`c${i}`, 'holdout', 2000, 2000, 'river')]));
  const failing = scoreProjectCheck([jt('j', 'holdout', 10, 30), cnt('c', 'holdout', 2000, 100, 'river')]);
  it('official not worse: no fewer sites within GEH 5 (all, hold-out) and no larger river error', () => {
    expect(officialNotWorse(base, { ...base })).toBe(true);
    expect(officialNotWorse(base, { ...base, gehHoldout: 0 })).toBe(false);
    expect(officialNotWorse(base, { ...base, gehAll: 1 })).toBe(false);
    expect(officialNotWorse(base, { ...base, riverPct: 0.30 })).toBe(false);
    expect(officialNotWorse(base, { ...base, riverPct: -0.10, gehAll: 3 })).toBe(true);
  });
  it('decision', () => {
    expect(decideTunedDefault(passing, base, { ...base, riverPct: -0.2 }).on).toBe(true);
    expect(decideTunedDefault(failing, base, { ...base, riverPct: -0.2 }).on).toBe(false);
    expect(decideTunedDefault(passing, base, { ...base, gehHoldout: 0 }).on).toBe(false);
    expect(decideTunedDefault(null, base, base).on).toBe(false);
  });
});

describe('banner states: which check is which and what it means for use', () => {
  const pass = scoreProjectCheck([...Array(10)].flatMap((_, i) => [jt(`j${i}`, 'holdout', 10, 10), cnt(`c${i}`, 'holdout', 2000, 2000, 'river')]));
  const fail = scoreProjectCheck([jt('j', 'holdout', 10, 30), cnt('c', 'holdout', 2000, 100, 'river')]);
  it('four states', () => {
    expect(bannerState(false, false)).toBe('both_fail');
    expect(bannerState(false, true)).toBe('project_pass_official_fail');
    expect(bannerState(true, false)).toBe('official_pass_project_fail');
    expect(bannerState(true, true)).toBe('both_pass');
  });
  it('both fail: names both checks, direction and trade-offs only', () => {
    const t = bannerText(false, fail, 'default');
    expect(t.headline).toContain('fails the official-count check');
    expect(t.headline).toContain('project check against estimated data');
    expect(t.project).toContain('default parameters');
    expect(t.project).toContain('fails');
    expect(t.meaning).toMatch(/direction/);
    expect(t.meaning).toMatch(/do not quote/);
  });
  it('project passes, official fails: never called validated, not for design or approval numbers', () => {
    const t = bannerText(false, pass, 'tuned');
    expect(t.state).toBe('project_pass_official_fail');
    expect(t.headline).toContain('but fails the official-count check');
    expect(t.project).toContain('tuned parameters (estimated)');
    expect(t.meaning).toContain('Not validated against official counts');
    expect(`${t.headline} ${t.project} ${t.meaning}`).not.toMatch(/\bis validated\b/i);
  });
  it('popover rows: hold-out decides, calibration is for reference only', () => {
    const rows = projectRows(fail);
    expect(rows[0].test).toContain('hold-out');
    expect(rows.at(-1)!.status).toBe('NOT EVALUATED');
    expect(PROJECT_CHECK_TITLE).toBe('Project check against estimated data (journey times from Google/TomTom, counts from published studies)');
  });
  it('the official-count check is unchanged and still fails', () => {
    expect(TRAFFIC_VALIDATION.verdict).toBe('fails_validation');
  });
});

describe('the project check as one entry of a list-of-checks banner (p12-flow ValidationCheck shape)', () => {
  it('has the ValidationCheck fields, follows the recorded hold-out verdict, and names the estimated data', () => {
    const c = projectValidationCheck('default');
    expect(Object.keys(c).sort()).toEqual(['checked', 'id', 'label', 'outcome', 'result', 'why']);
    expect(c.outcome).toBe(PROJECT_CHECK.default.pass ? 'passes' : 'fails');
    expect(c.checked).toMatch(/hold-out/);
    expect(c.why).toMatch(/not official counts/);
    expect(`${c.label} ${c.checked} ${c.result} ${c.why}`).not.toMatch(/\bvalidated\b/i);
  });
});

describe('supply parameters', () => {
  const LAT0 = 18.53, M_LAT = 1 / 111320, M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
  const pt = (x: number, y: number): [number, number, number] => [73.85 + x * M_LNG, LAT0 + y * M_LAT, 0];
  const road = (id: string, pts: [number, number][], hw: string, cls: RoadClassification = 'arterial'): RoadObject => ({
    id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: pts.map(p => pt(...p)), roadClass: cls, width: 7, laneCount: 2, laneWidth: 3.5,
    hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 50, isOneWay: false, trafficCapacity: 1000, connectedJunctions: [], createdAt: '', updatedAt: '',
    osmProvenance: { osmId: 1, osmElementType: 'way', osmSourceId: `way/${id}`, originalTags: { highway: hw }, layer: 0, bridge: false, tunnel: false, roundabout: false },
  } as RoadObject);
  const roads = [road('a', [[0, 0], [1000, 0]], 'primary'), road('b', [[1000, 0], [2000, 0]], 'primary'), road('c', [[1000, 0], [1000, 800]], 'tertiary', 'collector')];
  const map = new Map(roads.map(r => [r.id, r]));
  const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['a'], rangeMeters: 3000, direction: 'both' });
  it('the defaults reproduce the pre-p13 network exactly', () => {
    const plain = buildAssignmentNetwork(area, map);
    const withDefault = buildAssignmentNetwork(area, map, undefined, undefined, DEFAULT_SUPPLY);
    expect(withDefault.links.map(l => [l.t0, l.capacityPcu])).toEqual(plain.links.map(l => [l.t0, l.capacityPcu]));
    expect(isDefaultSupply(DEFAULT_SUPPLY)).toBe(true);
    expect(isDefaultSupply(null)).toBe(true);
  });
  it('speed factor by IRC category and capacity factor change only what they name', () => {
    const plain = buildAssignmentNetwork(area, map);
    const tuned = buildAssignmentNetwork(area, map, undefined, undefined, { ...DEFAULT_SUPPLY, speedFactor: [0.5, 1, 1], capacityFactor: 1.2 });
    plain.links.forEach((l, i) => {
      const t = tuned.links[i];
      expect(t.capacityPcu).toBeCloseTo(l.capacityPcu * 1.2, 6);
      if (l.roadId === 'c') expect(t.t0).toBeCloseTo(l.t0, 9); else expect(t.t0).toBeCloseTo(l.t0 * 2, 6);
    });
  });
  it('BPR alpha / beta reach the link costs; assignment with the defaults is identical to none', () => {
    const nodes = [...area.network.nodes.keys()];
    const trips = [{ fromNodeId: nodes[0], toNodeId: nodes[1], vehiclesPerHour: 3000, kind: 'car' as const }];
    const a = assignTraffic(area, map, trips), b = assignTraffic(area, map, trips, { supply: DEFAULT_SUPPLY });
    expect(Array.from(b.timeS)).toEqual(Array.from(a.timeS));
    const c = assignTraffic(area, map, trips, { supply: { ...DEFAULT_SUPPLY, bprAlpha: 1 } });
    expect(Math.max(...Array.from(c.timeS))).toBeGreaterThan(Math.max(...Array.from(a.timeS)));
  });
  it('vectors clamp to the published bounds', () => {
    const p = vectorToSupply([0.1, 2, 1, 5, 0, 9, 1, 400, 3]);
    expect(p.speedFactor).toEqual([SUPPLY_BOUNDS.speedArterial[0], SUPPLY_BOUNDS.speedSubArterial[1], 1]);
    expect(p.capacityFactor).toBe(SUPPLY_BOUNDS.capacityFactor[1]);
    expect(p.cycleS).toBe(180);
    expect(supplyToVector(vectorToSupply(supplyToVector(DEFAULT_SUPPLY)))).toEqual(supplyToVector(DEFAULT_SUPPLY));
  });
});
