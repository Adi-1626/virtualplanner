/**
 * p9-calibration (docs/urbanos/TRAFFIC_CALIBRATION_P9.md): calibrated window edge flows, the motor-vehicle basis
 * of counts, the hour match of the screen-line check, the calibration / hold-out split, and why a road with no
 * traffic gets none (its joins).
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import type { RoadObject } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { calibratedLinkFlow, compileAreaDemand, cordonOf, EDGE_FLOW_PER_LANE_VPH, type CalibratedEdgeFlows } from '../simulation/AreaDemand';
import { roadSection } from '../simulation/roadSection';
import { joinsExplanation, sectionJoins } from '../simulation/RoadAnalysis';
import { screenlineChecks, type ScreenlineFile } from '../calibration/screenlines';
import type { RoadAnalysisResult } from '../simulation/RoadAnalysis';

const pt = (x: number, y = 0, z = 0): [number, number, number] => [73.8 + x / (111320 * Math.cos(18.5 * Math.PI / 180)), 18.5 + y / 111320, z];
const road = (id: string, a: [number, number], b: [number, number], extra: Partial<RoadObject> = {}) =>
  ({ id, type: 'road', coordinates: [pt(...a), pt(...b)], roadClass: 'arterial', laneCount: 2, laneWidth: 3.5, speedLimit: 50, connectedJunctions: [], scenarioId: 'base', ...extra } as RoadObject);

const roads = [
  road('w2', [-1500, 0], [-800, 0], { name: 'Main Road' }), road('w1', [-800, 0], [0, 0], { name: 'Main Road' }),
  road('m1', [0, 0], [400, 0], { name: 'Main Road' }), road('m2', [400, 0], [800, 0], { name: 'Main Road' }),
  road('e1', [800, 0], [1600, 0], { name: 'Main Road' }), road('e2', [1600, 0], [2300, 0], { name: 'Main Road' }),
];
const roadMap = new Map(roads.map(r => [r.id, r]));
const area = () => new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['m1'], rangeMeters: 600, direction: 'both' });
const BOUNDS = { minLng: 73.7, maxLng: 73.9, minLat: 18.4, maxLat: 18.6 };

describe('calibrated window edge flows', () => {
  it('a link in the file gives its value; a link of a window road with no entry gives 0; a link outside the window gives null', () => {
    const flows: CalibratedEdgeFlows = { id: 't', bounds: BOUNDS, periods: { AM_Peak: { refHour: 9, links: { osm_1_seg_1_fwd: 640 }, calibrationSites: ['x'] } } };
    expect(calibratedLinkFlow(flows, 'AM_Peak', 'osm_1_seg_1_fwd', pt(0))).toBe(640);
    // same road, other direction: in the window network, carried under 5 veh/h (entries below 5 are not stored)
    expect(calibratedLinkFlow(flows, 'AM_Peak', 'osm_1_seg_1_bwd', pt(0))).toBe(0);
    // a road the window never had, or a point outside its bounds, or a period it has no flows for: not covered
    expect(calibratedLinkFlow(flows, 'AM_Peak', 'osm_2_seg_1_fwd', pt(0))).toBeNull();
    expect(calibratedLinkFlow(flows, 'AM_Peak', 'osm_1_seg_1_bwd', [74.5, 18.5, 0])).toBeNull();
    expect(calibratedLinkFlow(flows, 'PM_Peak', 'osm_1_seg_1_fwd', pt(0))).toBeNull();
    expect(calibratedLinkFlow(null, 'AM_Peak', 'osm_1_seg_1_fwd', pt(0))).toBeNull();
  });

  it('the cordon takes the calibrated flow of each crossing link where the window covers it, the class flow elsewhere, and says which', () => {
    const a = area();
    const base = cordonOf(a, roadMap);
    expect(base.map(c => c.roadId).sort()).toEqual(['e2', 'w2']);
    expect(base.every(c => c.flowSource === 'class')).toBe(true);
    // Calibrate the west crossing only: its incoming and outgoing links (outside the area) get window values
    const west = base.find(c => c.roadId === 'w2')!;
    const node = a.network.nodes.get(west.nodeId)!;
    const inId = node.incomingSegments.find(id => a.network.edges.get(id)!.roadId === 'w2')!;
    const outId = node.outgoingSegments.find(id => a.network.edges.get(id)!.roadId === 'w2')!;
    const flows: CalibratedEdgeFlows = { id: 't', bounds: BOUNDS, periods: { AM_Peak: { refHour: 9, links: { [inId]: 1234, [outId]: 321 }, calibrationSites: ['x'] } } };
    const cal = cordonOf(a, roadMap, { flows, period: 'AM_Peak' });
    const w = cal.find(c => c.roadId === 'w2')!, e = cal.find(c => c.roadId === 'e2')!;
    expect([w.inVph, w.outVph, w.flowSource]).toEqual([1234, 321, 'calibrated']);
    expect([e.inVph, e.flowSource]).toEqual([e.inLanes * EDGE_FLOW_PER_LANE_VPH.arterial, 'class']);
    // The plan records how many edge roads came from the window, and its label says so
    const plan = compileAreaDemand({ period: 'AM_Peak' }, a, roadMap, { calibratedEdgeFlows: flows })!;
    expect(plan.provenance.components!.calibratedCordonPoints).toBe(1);
    expect(plan.provenance.label).toMatch(/calibrated to 1 2008 counts \(1 of 2 edge roads/);
    const plain = compileAreaDemand({ period: 'AM_Peak' }, a, roadMap)!;
    expect(plain.provenance.components!.calibratedCordonPoints).toBe(0);
    expect(plain.provenance.vehiclesPerHour).not.toBeCloseTo(plan.provenance.vehiclesPerHour, 0);
  });

  it('the shipped file, if present, is an estimate fitted only to calibration sites and never to a hold-out site', () => {
    const p = '../backend/data/calibrated_flows/pune_central_window_v1.json';
    if (!fs.existsSync(p)) return;
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    const obs = JSON.parse(fs.readFileSync('../backend/data/observed_validation/pune_network_validation_v1.json', 'utf8'));
    const role = new Map<string, string>(obs.counts.map((c: { id: string; role: string }) => [c.id, c.role]));
    expect(doc.status).toBe('estimated');
    for (const per of Object.values(doc.periods) as { calibrationSites: string[]; holdoutSites: string[] }[]) {
      for (const s of per.calibrationSites) expect(role.get(s)).toBe('calibration');
      for (const s of per.holdoutSites) expect(role.get(s)).not.toBe('calibration');
    }
  });
});

describe('count basis and split (pune_network_validation_v1.json)', () => {
  const obs = JSON.parse(fs.readFileSync('../backend/data/observed_validation/pune_network_validation_v1.json', 'utf8'));
  it('every scored count has a motor-vehicle value no larger than the published one, with its basis stated', () => {
    for (const c of obs.counts) {
      expect(c.veh_motorised).toBeGreaterThan(0);
      expect(c.veh_motorised).toBeLessThanOrEqual(c.veh);
      expect(c.motorised_basis).toBeTruthy();
    }
    // CMP 2008 counts include cycles and carts (Table 4.1): Shivaji 61,385 vehicles of which 1,847 non-motorised
    expect(obs.counts.find((c: { id: string }) => c.id === 'cmp08_shivaji').veh_motorised).toBe(Math.round(7470 * (61385 - 1823 - 24) / 61385));
  });
  it('the split was fixed in the file: calibration and hold-out are disjoint and match each count\'s role', () => {
    const cal = new Set(obs.split.calibration), hold = new Set(obs.split.holdout);
    expect([...cal].filter(x => hold.has(x))).toEqual([]);
    for (const c of obs.counts) expect(c.role === 'calibration' ? cal.has(c.id) : c.role === 'holdout' ? hold.has(c.id) : c.role === 'not_scored').toBe(true);
    expect(cal.size).toBe(7); expect(hold.size).toBe(8);
    // Gunjan Chowk is held out at every hour (no hour of one location leaks into the fit)
    expect(obs.counts.filter((c: { id: string }) => c.id.startsWith('gunjan')).every((c: { role: string }) => c.role === 'holdout')).toBe(true);
  });
});

describe('screen-line check', () => {
  const file: ScreenlineFile = { id: 'f', name: 'f', source: { title: 't', tables: 't', url: 'u', surveyYear: 2008, note: '' },
    stations: [{ id: 's', name: 'S', osmWays: [5], peakHour: '18:00-19:00', peakStartHour: 18, peakVehicles: 1000, peakMotorVehicles: 950, peakPcu: 1000, day12hVehicles: 1, comparable: true }] };
  const r = { areaLinkVph: new Map([['osm_5_seg_1_fwd', 500], ['osm_5_seg_1_bwd', 450]]), linkVph: new Map() } as unknown as RoadAnalysisResult;
  it('compares motor vehicles (the model has no cycles) and only the counted hour is the same hour', () => {
    const [c] = screenlineChecks(file, r, 18);
    expect(c.geh).toBeCloseTo(0, 6);
    expect(c.sameHour).toBe(true);
    // 19:00-20:00 is not the 18:00-19:00 count's hour (it was accepted before)
    expect(screenlineChecks(file, r, 19)[0].sameHour).toBe(false);
  });
});

describe('why a road with no traffic gets none: its joins', () => {
  it('names an end that joins only a private road, and a join part-way along', () => {
    const rs = [
      road('fly', [0, 0], [800, 0], { name: 'New flyover' }),
      road('priv', [0, 0], [0, 300], { name: 'Campus road', roadClass: 'local', osmProvenance: { originalTags: { highway: 'service', access: 'private' } } } as Partial<RoadObject>),
      road('main', [800, 0], [800, 600], { name: 'Main Road' }), road('main2', [800, 0], [800, -600], { name: 'Main Road' }),
      road('side', [400, 0], [400, 300], { name: 'Side Lane', roadClass: 'local' }),
    ];
    const m = new Map(rs.map(r => [r.id, r]));
    const a = new StudyAreaExplorer().explore(rs, 1, { seedRoadIds: ['fly'], rangeMeters: 1200, direction: 'both' });
    const j = sectionJoins(a, m, roadSection(a, m, ['fly']));
    expect(j.ends).toHaveLength(2);
    expect(j.ends.some(e => e.roads.length === 1 && e.roads[0].restricted)).toBe(true);
    expect(j.mid.map(x => x.roads.map(r => r.id))).toEqual([['side']]);
    const text = joinsExplanation(j)!;
    expect(text).toMatch(/end joins only Campus road, a road with restricted access/);
    expect(text).toMatch(/joined part-way along, to Side Lane 400 m from an end/);
  });
  it('says nothing when both ends meet public main roads', () => {
    const rs = [road('a', [0, 0], [800, 0]), road('b', [-500, 0], [0, 0]), road('c', [800, 0], [1300, 0])];
    const m = new Map(rs.map(r => [r.id, r]));
    const a = new StudyAreaExplorer().explore(rs, 1, { seedRoadIds: ['a'], rangeMeters: 300, direction: 'both' });
    expect(joinsExplanation(sectionJoins(a, m, { segmentKeys: a.segments.filter(s => s.roadId === 'a').map(s => s.key), roadIds: ['a'], name: 'a', lengthM: 800, endsAt: [], carriageways: 1 }))).toBeNull();
  });
});
