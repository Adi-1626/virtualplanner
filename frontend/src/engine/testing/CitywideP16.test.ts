/**
 * p16 (docs/urbanos/CITYWIDE_P16.md): the model fixes found by the city-wide robustness harness, and the harness's own
 * pieces that run in every test pass (bands, the area test set).
 *  - a divided road becoming one two-way road (same road on every arm) has no junction control;
 *  - a heavy one-way stream merging into a carriageway gets its share of the downstream capacity (limited priority);
 *  - IRC:93-1985 volume-warranted signals (signalWarrantScale), reported as inferred signals for the micro-simulation;
 *  - eighthHourScale from the city's hourly vehicle trips;
 *  - the bands are scored as written, and the test set is the fixed one.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject, RoadClassification } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan, type DemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, warrantedJunctions } from '../simulation/staticAssignment';
import { P14 } from '../simulation/supplyConfig';
import { eighthHourScale, type SyntheticCity } from '../demand/syntheticDemand';
import { evaluateBands, BANDS, type AreaHourMetrics } from './citywide/citywideBands';

const LAT0 = 18.53;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [73.85 + x * M_LNG, LAT0 + y * M_LAT, 0];
const road = (id: string, pts: [number, number][], tags: Record<string, string>, cls: RoadClassification = 'arterial', lanes = 2, oneWay = false): RoadObject => ({
  id, type: 'road', name: tags.name ?? '', layerId: 'roads', scenarioId: 'base', coordinates: pts.map(p => pt(...p)),
  roadClass: cls, width: 3.5 * lanes, laneCount: lanes, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: Number(tags.maxspeed ?? 50), isOneWay: oneWay, trafficCapacity: 1000,
  connectedJunctions: [], createdAt: '', updatedAt: '',
  osmProvenance: { osmId: Number(id.replace(/\D/g, '')) || 1, osmElementType: 'way', osmSourceId: `way/${id}`, originalTags: tags, layer: 0, bridge: false, tunnel: false, roundabout: false },
} as RoadObject);
const plan = (trips: { from: [number, number]; to: [number, number]; vph: number }[]): DemandPlan => ({
  trips: trips.map(t => ({ from: pt(...t.from), to: pt(...t.to), vehiclesPerHour: t.vph, kind: 'car' as const })),
  provenance: { source: 'synthetic', label: 'test', period: 'AM_Peak', vehiclesPerHour: trips.reduce((n, t) => n + t.vph, 0), pairCount: trips.length },
});
const areaOf = (roads: RoadObject[], seed: string) => new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: [seed], rangeMeters: 5000, direction: 'both' });
const run = (roads: RoadObject[], seed: string, trips: Parameters<typeof plan>[0], extra: Record<string, unknown> = {}) => {
  const map = new Map(roads.map(r => [r.id, r]));
  const area = areaOf(roads, seed);
  const snapped = snapDemandPlan(plan(trips), area.network, 60, new Set(area.segments.map(s => s.key)));
  return assignTraffic(area, map, snapped, { supplyModel: 'p14', signalPoints: [], maxIterations: 30, ...extra });
};

describe('p16: a divided road becoming one two-way road is not a junction', () => {
  // A named road: two one-way carriageways (in from the west, out to the west) meeting one two-way road going east
  const named = () => [
    road('w_in', [[-300, 5], [0, 0]], { highway: 'secondary', name: 'Mula Road', oneway: 'yes' }, 'arterial', 2, true),
    road('w_out', [[0, 0], [-300, -5]], { highway: 'secondary', name: 'Mula Road', oneway: 'yes' }, 'arterial', 2, true),
    road('e', [[0, 0], [400, 0]], { highway: 'secondary', name: 'Mula Road' }, 'arterial', 2),
  ];
  it('named: no give-way at the transition (before p16 each approach yielded to the other)', () => {
    const r = run(named(), 'e', [{ from: [-300, 5], to: [400, 0], vph: 1500 }, { from: [400, 0], to: [-300, -5], vph: 1500 }]);
    const at = r.links.filter(l => l.junction);
    expect(at).toEqual([]);
    expect(Math.max(...r.junctionDelayS!)).toBe(0);
  });
  it('unnamed: the same shape (two one-way pieces and one two-way piece of one class) is recognised too', () => {
    const roads = named().map(r => ({ ...r, name: '', osmProvenance: { ...r.osmProvenance!, originalTags: { ...r.osmProvenance!.originalTags, name: '' } } }) as RoadObject);
    const r = run(roads, 'e', [{ from: [-300, 5], to: [400, 0], vph: 1500 }]);
    expect(r.links.filter(l => l.junction)).toEqual([]);
  });
  it('a real crossing of two different roads keeps its control', () => {
    const roads = [
      road('a1', [[-300, 0], [0, 0]], { highway: 'tertiary', name: 'A Road' }, 'collector'), road('a2', [[0, 0], [300, 0]], { highway: 'tertiary', name: 'A Road' }, 'collector'),
      road('b1', [[0, -300], [0, 0]], { highway: 'residential', name: 'B Lane' }, 'local'),
    ];
    const r = run(roads, 'a1', [{ from: [-300, 0], to: [300, 0], vph: 300 }, { from: [0, -300], to: [300, 0], vph: 100 }]);
    expect(r.links.some(l => l.junction === 'minor' && l.roadId === 'b1')).toBe(true);
  });
});

describe('p16: merging into one carriageway shares its capacity', () => {
  const roads = () => [
    road('m1', [[-400, 0], [0, 0]], { highway: 'primary', name: 'Main', oneway: 'yes' }, 'arterial', 2, true),
    road('m2', [[0, 0], [400, 0]], { highway: 'primary', name: 'Main', oneway: 'yes' }, 'arterial', 3, true),
    road('s', [[-300, -200], [0, 0]], { highway: 'tertiary', name: 'Slip', oneway: 'yes' }, 'collector', 2, true),
  ];
  it('a heavy merging stream waits seconds, not many minutes, when the carriageway it joins has room', () => {
    const r = run(roads(), 'm1', [{ from: [-400, 0], to: [400, 0], vph: 2000 }, { from: [-300, -200], to: [400, 0], vph: 1500 }]);
    const slip = r.links.find(l => l.roadId === 's' && l.junction === 'minor')!;
    expect(slip.junctionMerge).toBe(true);
    expect(P14.mergeSharing.value).toBe(true);
    // with gap acceptance alone the merge capacity against 2,000 PCU/h of main flow is far below the slip's flow
    expect(r.junctionCapacityPcu![slip.index]).toBeGreaterThan(r.volPcu[slip.index]);
    expect(r.junctionDelayS![slip.index]).toBeLessThan(60);
  });
});

describe('p16: IRC:93-1985 volume-warranted signals', () => {
  const roads = () => [
    road('a1', [[-400, 0], [0, 0]], { highway: 'tertiary', name: 'A Road' }, 'collector'), road('a2', [[0, 0], [400, 0]], { highway: 'tertiary', name: 'A Road' }, 'collector'),
    road('b1', [[0, -400], [0, 0]], { highway: 'tertiary', name: 'B Road' }, 'collector'), road('b2', [[0, 0], [0, 400]], { highway: 'tertiary', name: 'B Road' }, 'collector'),
  ];
  const heavy = [{ from: [-400, 0] as [number, number], to: [400, 0] as [number, number], vph: 700 }, { from: [400, 0] as [number, number], to: [-400, 0] as [number, number], vph: 400 },
    { from: [0, -400] as [number, number], to: [0, 400] as [number, number], vph: 400 }];
  it('the warrant values are IRC:93 Tables 2 and 3', () => {
    expect(P14.signalWarrant.value).toMatchObject({ w1Major: [650, 800], w1Minor: [200, 250], w2Major: [1000, 1200], w2Minor: [100, 150] });
    expect(P14.signalWarrant.label).toBe('standard');
  });
  it('a junction meeting Warrant 1 is signalised (and reported for the micro-simulation); below it, it stays a priority junction', () => {
    const off = run(roads(), 'a1', heavy);
    expect(off.links.some(l => l.junction)).toBe(true);
    expect(off.warrantedSignalPoints).toBeUndefined();
    const on = run(roads(), 'a1', heavy, { signalWarrantScale: 1 });
    expect(on.warrantedSignalPoints!.length).toBe(1);
    expect(on.inferredSignalPoints!.length).toBeGreaterThanOrEqual(1);
    expect(on.links.filter(l => l.gC !== null).length).toBeGreaterThanOrEqual(3);
    expect(on.links.some(l => l.junction === 'minor')).toBe(false);
    // night flows scaled to the 8th busiest hour: a tenth of the flows x 10 reads the same
    const night = run(roads(), 'a1', heavy.map(t => ({ ...t, vph: t.vph / 10 })), { signalWarrantScale: 10 });
    expect(night.warrantedSignalPoints!.length).toBe(1);
    const light = run(roads(), 'a1', heavy.map(t => ({ ...t, vph: t.vph / 10 })), { signalWarrantScale: 1 });
    expect(light.warrantedSignalPoints ?? []).toEqual([]);
    expect(warrantedJunctions(off, 0.1)).toEqual([]);
  });
});

describe('p16: the 8th busiest hour', () => {
  it('scales an hour to the 8th busiest hour of the city profile', () => {
    const h = Array.from({ length: 24 }, (_, i) => i + 1); // 24 is busiest; the 8th busiest is 17
    const city = { hourlyVeh: h } as unknown as SyntheticCity;
    expect(eighthHourScale(city, 23)).toBeCloseTo(17 / 24, 9);
    expect(eighthHourScale(city, 0)).toBeCloseTo(17, 9);
    expect(eighthHourScale({} as SyntheticCity, 9)).toBeNull();
  });
});

describe('p16 harness: bands and the test set', () => {
  it('every band has a label and a source; day and night bands apply at their hours only', () => {
    for (const b of BANDS) { expect(['sourced', 'derived', 'assumed']).toContain(b.label); expect(b.source.length).toBeGreaterThan(5); }
    const day: AreaHourMetrics = { ok: true, hour: 9, demandVph: 1000, unroutedVph: 0, noEdgeRouteVph: 0, speedRatioMedian: 0.7, speedRatioP10: 0.3, speedKmhP10: 9, overLenShare: 0.05, buildingEnds: { share: 0.95, vph: 100 } };
    const r = evaluateBands(day);
    expect(r.pass).toBe(true);
    expect(Object.keys(r.results)).not.toContain('N1');
    expect(evaluateBands({ ...day, speedRatioMedian: 0.6 }).failed).toEqual(['D1']);
    expect(evaluateBands({ ...day, speedKmhP10: 8.7 }).failed).toEqual(['D2']);
    const night = evaluateBands({ ...day, hour: 23, speedRatioMedian: 0.95, speedRatioP10: 0.74, overLenShare: 0.005 });
    expect(night.pass).toBe(true);
    expect(Object.keys(night.results)).not.toContain('D1');
    expect(evaluateBands({ ...day, ok: false }).pass).toBe(false);
  });
  it('the city-wide test set is the fixed one: 41 areas, every stratum, a reason for each', () => {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'citywideAreas.json'), 'utf8')) as { seed: number; areas: { id: string; stratum: string; why: string; seedRoadIds: string[]; hours: number[] }[] };
    expect(doc.seed).toBe(16);
    expect(doc.areas.length).toBe(41);
    expect(new Set(doc.areas.map(a => a.stratum))).toEqual(new Set(['arterial', 'subarterial', 'collector', 'local', 'bridge', 'flyover', 'oldcity', 'itpark', 'midc', 'fringe']));
    for (const a of doc.areas) { expect(a.why.length).toBeGreaterThan(5); expect(a.seedRoadIds[0]).toMatch(/^osm_\d+$/); expect(a.hours).toEqual([9, 14, 19, 23]); }
  });
});
