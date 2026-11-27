/**
 * p14 supply model for Indian urban roads (supplyConfig.ts, indianSupply.ts, docs/urbanos/SUPPLY_P14.md): every
 * parameter labelled with a source, the Indo-HCM volume-delay fit, free-flow speed and capacity by class / typology /
 * lane width / side friction, the unsignalised gap-acceptance capacity and control delay against published worked
 * examples, side-friction inference, and the area assignment and micro-simulation using them (p13 unchanged).
 */
import { describe, it, expect } from 'vitest';
import type { RoadObject, RoadClassification } from '../objects/types';
import { StudyAreaExplorer } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan, type DemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, buildAssignmentNetwork, PCU, PCU_P14 } from '../simulation/staticAssignment';
import { TrafficMicroSim } from '../simulation/TrafficMicroSim';
import { P14, p14ParameterTable } from '../simulation/supplyConfig';
import {
  p14TimeRatio, p14LinkSupply, baseLaneCapacityPcu, operatingSpeedOfLaneCapacity, laneWidthFactor, capacityFromGaps, controlDelayS,
  gapCapacityPcu, gaps, decelAccelS, STOP_LOSS_S_PER_MS, SIGNAL_TO_MIDBLOCK_PCU, HEAVY_PCT, frictionByRoad, buildingPointsFromOsm, roundaboutEntryPcu, inferredSignalPoints, approachRank, type BuildingPoint,
} from '../simulation/indianSupply';

const LAT0 = 18.53;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [73.85 + x * M_LNG, LAT0 + y * M_LAT, 0];
const road = (id: string, pts: [number, number][], tags: Record<string, string>, cls: RoadClassification = 'arterial', lanes = 2, oneWay = false): RoadObject => ({
  id, type: 'road', name: tags.name ?? id, layerId: 'roads', scenarioId: 'base', coordinates: pts.map(p => pt(...p)),
  roadClass: cls, width: 3.5 * lanes, laneCount: lanes, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: Number(tags.maxspeed ?? 50), isOneWay: oneWay, trafficCapacity: 1000,
  connectedJunctions: [], createdAt: '', updatedAt: '',
  osmProvenance: { osmId: Number(id.replace(/\D/g, '')) || 1, osmElementType: 'way', osmSourceId: `way/${id}`, originalTags: tags, layer: 0, bridge: false, tunnel: false, roundabout: false },
} as RoadObject);

/** A 1.2 km primary road (west-east) with side streets every 100 m on the north side, and one secondary minor road crossing at x = 600. */
function network() {
  const roads: RoadObject[] = [];
  for (let k = 0; k < 12; k++) roads.push(road(`m${k}`, [[k * 100, 0], [(k + 1) * 100, 0]], { highway: 'primary', name: 'Main Road', maxspeed: '60' }, 'arterial', 2));
  for (let k = 1; k < 12; k++) if (k !== 6) roads.push(road(`s${k}`, [[k * 100, 0], [k * 100, 150]], { highway: 'residential', name: `Lane ${k}` }, 'local', 2));
  roads.push(road('n1', [[600, 0], [600, 600]], { highway: 'tertiary', name: 'North Road' }, 'collector', 2));
  roads.push(road('n2', [[600, -600], [600, 0]], { highway: 'tertiary', name: 'South Road' }, 'collector', 2));
  const map = new Map(roads.map(r => [r.id, r]));
  const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['m0'], rangeMeters: 5000, direction: 'both' });
  return { roads, map, area };
}
const plan = (trips: { from: [number, number]; to: [number, number]; vph: number }[]): DemandPlan => ({
  trips: trips.map(t => ({ from: pt(...t.from), to: pt(...t.to), vehiclesPerHour: t.vph, kind: 'car' as const })),
  provenance: { source: 'synthetic', label: 'test', period: 'AM_Peak', vehiclesPerHour: trips.reduce((n, t) => n + t.vph, 0), pairCount: trips.length },
});

describe('p14 parameters (supplyConfig.ts)', () => {
  it('every parameter carries a label and a source', () => {
    const rows = p14ParameterTable();
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(['standard', 'derived', 'fitted', 'international', 'assumed']).toContain(r.label);
      expect(r.source.length).toBeGreaterThan(5);
    }
    // the numbers the docs quote
    expect(P14.laneCapacityPcu.value).toEqual({ undivided2: 1200, divided4: 1350, divided6: 1400, divided8: 1700, divided10: 2000 });
    expect(P14.designSpeedKmh.value.arterial).toBe(60);
    expect(P14.frictionFactor.value).toEqual({ none: 1, low: 0.9, medium: 0.8, high: 0.7 });
  });
});

describe('p14 volume-delay function (Indo-HCM 2017 Table 5.7 fit)', () => {
  it('reproduces the LOS boundary speeds within 4 points of free-flow speed', () => {
    const table: [number, number][] = [[0.15, 0.84], [0.45, 0.76], [0.75, 0.59], [0.85, 0.41], [1.0, 0.22]];
    for (const [x, share] of table) expect(Math.abs(1 / p14TimeRatio(x) - share)).toBeLessThan(0.04);
  });
  it('is continuous and increasing, and linear (tangent) above capacity', () => {
    let prev = 0;
    for (let x = 0; x <= 3; x += 0.05) { const r = p14TimeRatio(x); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
    expect(p14TimeRatio(1 + 1e-9)).toBeCloseTo(p14TimeRatio(1), 4);
    const d1 = p14TimeRatio(1.5) - p14TimeRatio(1.25), d2 = p14TimeRatio(2) - p14TimeRatio(1.75);
    expect(d1).toBeCloseTo(d2, 6);
    expect(p14TimeRatio(0)).toBeCloseTo(1 / P14.vdf.value.s0, 6);
  });
});

describe('p14 free-flow speed and capacity', () => {
  it('lane capacity by typology (Table 5.4) and the operating speed it implies (Eq. 5.4)', () => {
    expect(baseLaneCapacityPcu(1, true, 'arterial')).toBe(1200);
    expect(baseLaneCapacityPcu(2, false, 'arterial')).toBe(1350);
    expect(baseLaneCapacityPcu(3, false, 'arterial')).toBe(1400);
    expect(baseLaneCapacityPcu(4, false, 'arterial')).toBe(1400); // 8-lane values only for expressways
    expect(baseLaneCapacityPcu(4, false, 'expressway')).toBe(1700);
    expect(baseLaneCapacityPcu(2, true, 'arterial')).toBeCloseTo(1350 * 3000 / 3600, 6);
    expect(operatingSpeedOfLaneCapacity(1350)).toBeCloseTo((1350 - 210.8) / 20.11, 6); // 56.6 km/h
    expect(operatingSpeedOfLaneCapacity(1200)).toBeCloseTo(49.19, 1);
  });
  it('a divided arterial tagged maxspeed 60: the posted limit is a cap, not the free-flow speed', () => {
    const r = road('a1', [[0, 0], [100, 0]], { highway: 'primary', maxspeed: '60' }, 'arterial', 2, true);
    const low = p14LinkSupply(r, 2, false, 60, 'low');
    const operating = (1350 - 210.8) / 20.11;
    expect(low.operatingKmh).toBeCloseTo(operating, 6);
    expect(low.carFfsKmh).toBeCloseTo(operating * 0.865 * 0.9, 6);
    expect(low.streamKmh).toBeCloseTo(low.carFfsKmh * 0.81, 6);
    expect(low.capacityPcu).toBeCloseTo(1350 * 2 * 0.9, 6);
    const high = p14LinkSupply(r, 2, false, 60, 'high');
    expect(high.carFfsKmh / low.carFfsKmh).toBeCloseTo(0.7 / 0.9, 6);
    // a posted 30 km/h binds
    expect(p14LinkSupply(r, 2, false, 30, 'none').carFfsKmh).toBeCloseTo(30, 6);
  });
  it('class design speed caps the typology speed; residential access roads take 3.0 m lanes', () => {
    const res = road('r1', [[0, 0], [100, 0]], { highway: 'residential' }, 'local', 1);
    const s = p14LinkSupply(res, 1, true, 30, 'none');
    expect(s.operatingKmh).toBe(30);
    expect(s.laneWidthM).toBe(3.0);
    expect(laneWidthFactor(3.0)).toBeCloseTo(1 - (10.6 - 1.0) / 100, 6);
    expect(laneWidthFactor(3.5)).toBe(1);
    expect(laneWidthFactor(4.0)).toBe(1);
    expect(s.carFfsKmh).toBeCloseTo(30 * 0.865 * laneWidthFactor(3.0), 6);
    // an OSM width tag is shared by the lanes
    const wide = road('r2', [[0, 0], [100, 0]], { highway: 'residential', width: '7' }, 'local', 1);
    expect(p14LinkSupply(wide, 1, true, 30, 'none').laneWidthM).toBe(3.5);
  });
});

describe('p14 unsignalised junctions and roundabouts', () => {
  it('movement capacity matches the Indo-HCM worked T-junction (IJRESM 4(11) 2021 Table 5)', () => {
    expect(capacityFromGaps(659.02, 3.48, 2.09, 0.8, 1.3)).toBeCloseTo(1116.66, -1);
    expect(capacityFromGaps(1493.26, 5.19, 3.11, 1.0, 2.16)).toBeCloseTo(585.99, -1);
    // with no conflicting flow, the follow-up headway alone
    const { tf } = gaps(P14.unsigMinor.value);
    expect(gapCapacityPcu(0, P14.unsigMinor.value)).toBeCloseTo(3600 / tf, 6);
    expect(gapCapacityPcu(800, P14.unsigMinor.value)).toBeLessThan(gapCapacityPcu(200, P14.unsigMinor.value));
  });
  it('critical gap from the heavy-vehicle share of the mix', () => {
    expect(HEAVY_PCT).toBeCloseTo(5.6, 6);
    expect(gaps(P14.unsigMinor.value).tc).toBeCloseTo(3.80 + 0.885 * Math.log(5.6), 6);
    expect(gaps(P14.unsigMinor.value).tf).toBeCloseTo(0.6 * gaps(P14.unsigMinor.value).tc, 6);
  });
  it('control delay matches the IIT Bombay worked example (HCM 2000 Eq. 17-38: 75 veh/h at 347 veh/h, T = 0.25 h -> 18.2 s)', () => {
    expect(controlDelayS(75, 347, 0.25)).toBeCloseTo(18.213, 2);
    expect(controlDelayS(400, 347, 1)).toBeGreaterThan(controlDelayS(300, 347, 1));
  });
  it('p17: the deceleration-acceleration term is the stop loss at the approach speed (fleet kinematics), never above HCM\'s 5 s', () => {
    // two-wheelers 52 % at 2 m/s2, the rest at 1 m/s2: 0.52 x 0.5 + 0.48 x 1.0 = 0.74 s per m/s
    expect(STOP_LOSS_S_PER_MS).toBeCloseTo(0.74, 6);
    expect(decelAccelS(13.3)).toBeCloseTo(13.3 / 3.6 * 0.74, 6); // an old-city lane: 2.7 s
    expect(decelAccelS(50)).toBe(5);
    expect(controlDelayS(75, 347, 0.25, decelAccelS(13.3)) - controlDelayS(75, 347, 0.25)).toBeCloseTo(decelAccelS(13.3) - 5, 6);
  });
  it('roundabout entry capacity from IRC:65 Table 9.1 by ICD, falling with the circulating flow', () => {
    expect(roundaboutEntryPcu(32, 0)).toBe(2567);
    expect(roundaboutEntryPcu(32, 600)).toBe(Math.round(2567 * Math.exp(-0.00032 * 600)));
    expect(roundaboutEntryPcu(10, 0)).toBe(2388); // a small ring is read as the smallest row
  });
  it('signal saturation flow (Table 6.3 PCUs) expressed in mid-block PCUs (Table 5.2) for the Pune mix', () => {
    // two-wheelers count less in mid-block PCUs (0.22 vs 0.4) and buses more (4.6 vs 1.6)
    expect(SIGNAL_TO_MIDBLOCK_PCU).toBeGreaterThan(1.0);
    expect(SIGNAL_TO_MIDBLOCK_PCU).toBeLessThan(1.3);
    expect(PCU_P14.two_wheeler).toBe(0.22);
    expect(PCU.two_wheeler).toBe(0.75); // p13 keeps IRC:106
  });
});

describe('p14 junction control inference', () => {
  it('two different arterial / sub-arterial roads crossing with no mapped signal are taken as signalised; a main road meeting lanes is not', () => {
    const roads = [
      road('a1', [[-300, 0], [0, 0]], { highway: 'primary', name: 'East West Road' }), road('a2', [[0, 0], [300, 0]], { highway: 'primary', name: 'East West Road' }),
      road('b1', [[0, -300], [0, 0]], { highway: 'secondary', name: 'North South Road' }), road('b2', [[0, 0], [0, 300]], { highway: 'secondary', name: 'North South Road' }),
      road('c1', [[200, 0], [200, 150]], { highway: 'residential', name: 'Lane 1' }),
    ];
    const map = new Map(roads.map(r => [r.id, r]));
    const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['a1'], rangeMeters: 3000, direction: 'both' });
    const inferred = inferredSignalPoints(area, map, []);
    expect(inferred.length).toBe(1);
    expect(inferred[0][0]).toBeCloseTo(pt(0, 0)[0], 6);
    // a mapped signal there: nothing inferred
    expect(inferredSignalPoints(area, map, [[pt(5, 5)[0], pt(5, 5)[1]]]).length).toBe(0);
    // ramps rank below their class
    expect(approachRank(road('r', [[0, 0], [1, 0]], { highway: 'trunk_link' }))).toBe(approachRank(road('t', [[0, 0], [1, 0]], { highway: 'trunk' })) + 1);
  });
  it('in the assignment the inferred signal replaces give-way control and is reported for the micro-simulation', () => {
    const roads = [
      road('a1', [[-300, 0], [0, 0]], { highway: 'primary', name: 'East West Road' }), road('a2', [[0, 0], [300, 0]], { highway: 'primary', name: 'East West Road' }),
      road('b1', [[0, -300], [0, 0]], { highway: 'secondary', name: 'North South Road' }), road('b2', [[0, 0], [0, 300]], { highway: 'secondary', name: 'North South Road' }),
    ];
    const map = new Map(roads.map(r => [r.id, r]));
    const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['a1'], rangeMeters: 3000, direction: 'both' });
    const snapped = snapDemandPlan(plan([{ from: [-300, 0], to: [300, 0], vph: 300 }]), area.network, 60, new Set(area.segments.map(s => s.key)));
    const r = assignTraffic(area, map, snapped, { supplyModel: 'p14', signalPoints: [] });
    expect(r.inferredSignalPoints!.length).toBe(1);
    const into = r.links.filter(l => l.roadId === 'a1' && l.id.endsWith('_fwd'));
    expect(into.some(l => l.gC !== null)).toBe(true);
    expect(into.every(l => !l.junction)).toBe(true);
  });
});

describe('p17 one junction per signal', () => {
  it('a mapped signal controls its crossing (both carriageways), not a lane joining 25 m away', () => {
    // East West Road divided: carriageways at y = 0 and y = 12 (12 m apart: one folded junction), North South Road crossing at x = 0,
    // Lane 1 joining the north carriageway 25 m east of the crossing; the signal mapped at the crossing's south-west corner
    const roads = [
      road('a1', [[-300, 0], [0, 0]], { highway: 'primary', name: 'East West Road' }, 'arterial', 2, true), road('a2', [[0, 0], [300, 0]], { highway: 'primary', name: 'East West Road' }, 'arterial', 2, true),
      road('a3', [[300, 12], [25, 12]], { highway: 'primary', name: 'East West Road' }, 'arterial', 2, true), road('a4', [[25, 12], [0, 12]], { highway: 'primary', name: 'East West Road' }, 'arterial', 2, true),
      road('a5', [[0, 12], [-300, 12]], { highway: 'primary', name: 'East West Road' }, 'arterial', 2, true),
      road('b1', [[0, -300], [0, 0]], { highway: 'secondary', name: 'North South Road' }), road('b2', [[0, 0], [0, 12]], { highway: 'secondary', name: 'North South Road' }),
      road('b3', [[0, 12], [0, 300]], { highway: 'secondary', name: 'North South Road' }),
      road('c1', [[25, 12], [25, 150]], { highway: 'residential', name: 'Lane 1' }, 'local', 1),
    ];
    const map = new Map(roads.map(r => [r.id, r]));
    const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['a1'], rangeMeters: 3000, direction: 'both' });
    const sig: [number, number][] = [[pt(-4, -4)[0], pt(-4, -4)[1]]];
    const near = (x: number, y: number) => (id: string) => { const c = area.network.nodes.get(id)!.coordinates; return Math.abs(c[0] - pt(x, y)[0]) < 1e-7 && Math.abs(c[1] - pt(x, y)[1]) < 1e-7; };
    const p14 = buildAssignmentNetwork(area, map, sig, undefined, undefined, { buildings: null });
    expect([...p14.signalised].some(near(0, 0))).toBe(true);
    expect([...p14.signalised].some(near(0, 12))).toBe(true);
    expect([...p14.signalised].some(near(25, 12))).toBe(false);
    // p13 keeps every 3+-stretch node within 35 m
    const p13 = buildAssignmentNetwork(area, map, sig);
    expect([...p13.signalised].some(near(25, 12))).toBe(true);
  });
});

describe('p14 side friction', () => {
  it('a road with a side street every 100 m reads medium friction from access points (9 per km); a road without, low; a flyover none', () => {
    const { map, area } = network();
    const f = frictionByRoad(area, map, null);
    expect(f.get('m3')!.accessPerKm).toBeCloseTo(11 / 1.2, 6); // 10 side streets + the crossing on 1.2 km
    expect(f.get('m3')!.cls).toBe('medium');
    expect(f.get('m3')!.basis).toBe('access points');
    expect(f.get('n1')!.cls).toBe('low');
    const fly = road('f1', [[0, 0], [100, 0]], { highway: 'primary', bridge: 'yes', name: 'Main Road' });
    const m2 = new Map(map); m2.set('m0', { ...fly, id: 'm0', coordinates: map.get('m0')!.coordinates });
    expect(frictionByRoad(area, m2, null).get('m0')!.cls).toBe('none');
  });
  it('building frontage raises the level: commercial buildings along a road make it a market frontage', () => {
    const { map, area } = network();
    const shops: BuildingPoint[] = [];
    for (let x = 0; x <= 600; x += 40) { const p = pt(x, -700); shops.push([p[0], p[1], 1]); } // 100 m beyond South Road's end
    for (let y = 50; y <= 550; y += 50) { const p = pt(620, y); shops.push([p[0], p[1], 1]); } // along North Road
    const f = frictionByRoad(area, map, shops);
    expect(f.get('n1')!.cls).toBe('high');
    expect(f.get('n1')!.commercialPer100m).toBeGreaterThanOrEqual(1);
    expect(f.get('n2')!.buildingsPer100m).toBe(0);
    expect(f.get('n2')!.cls).toBe('low');
  });
  it('OSM building elements become centroids with a commercial flag', () => {
    const pts = buildingPointsFromOsm([
      { tags: { building: 'yes' }, geometry: [{ lon: 0, lat: 0 }, { lon: 2, lat: 0 }, { lon: 2, lat: 2 }, { lon: 0, lat: 2 }] },
      { tags: { building: 'yes', shop: 'clothes' }, geometry: [{ lon: 1, lat: 1 }] },
      { tags: { building: 'retail' }, geometry: [{ lon: 1, lat: 1 }] },
      { tags: { building: 'yes' } },
    ]);
    expect(pts).toEqual([[1, 1, 0], [1, 1, 1], [1, 1, 1]]);
  });
});

describe('p14 in the area assignment and the micro-simulation', () => {
  const trips = [{ from: [0, 0] as [number, number], to: [1200, 0] as [number, number], vph: 300 }, { from: [600, 600] as [number, number], to: [600, -600] as [number, number], vph: 200 }];
  const run = (model?: 'p14') => {
    const { map, area } = network();
    const snapped = snapDemandPlan(plan(trips), area.network, 60, new Set(area.segments.map(s => s.key)));
    return assignTraffic(area, map, snapped, { maxIterations: 40, ...(model ? { supplyModel: model } : {}) });
  };
  it('p13 (no model given) runs as before: OSM maxspeed is the free-flow speed, no junction delay', () => {
    const r = run();
    expect(r.supplyModel).toBe('p13');
    expect(r.junctionDelayS).toBeUndefined();
    const main = r.links.find(l => l.roadId === 'm3')!;
    expect(main.freeSpeedKmh).toBe(60);
  });
  it('p14: slower free flow on the main road, give-way delay on the minor approach, right-turn share delay on the major', () => {
    const r = run('p14');
    expect(r.supplyModel).toBe('p14');
    const main = r.links.find(l => l.roadId === 'm3')!;
    expect(main.friction).toBe('medium');
    expect(main.freeSpeedKmh).toBeLessThan(35);
    expect(main.carFfsKmh! * P14.vdf.value.s0).toBeCloseTo(main.freeSpeedKmh, 6);
    // the crossing at x = 600: North / South Road give way to Main Road
    const minor = r.links.filter(l => l.junction === 'minor' && (l.roadId === 'n1' || l.roadId === 'n2'));
    expect(minor.length).toBe(2);
    for (const l of minor) expect(r.junctionDelayS![l.index]).toBeGreaterThan(5);
    const major = r.links.filter(l => l.junction === 'majorRight');
    expect(major.length).toBeGreaterThan(0);
    for (const l of major) expect(r.junctionDelayS![l.index]).toBeLessThan(r.junctionDelayS![minor[0].index]);
    // times include the junction delay
    for (const l of minor) expect(r.timeS[l.index]).toBeGreaterThan(l.t0 + r.junctionDelayS![l.index] - 1e-6);
    // the corridor trip takes longer than under p13
    const p13 = run();
    const t = (res: ReturnType<typeof run>, ids: string[]) => res.links.filter(l => ids.includes(l.roadId) && l.id.endsWith('_fwd')).reduce((n, l) => n + res.timeS[l.index], 0);
    const ids = Array.from({ length: 12 }, (_, k) => `m${k}`);
    expect(t(r, ids)).toBeGreaterThan(1.5 * t(p13, ids));
  });
  it('the micro-simulation takes the p14 desired speed per edge', () => {
    const { map, area } = network();
    const base = new TrafficMicroSim(area, map, { demandLevel: 0, seed: 1 });
    const edge = [...area.network.edges.values()].find(e => e.roadId === 'm3')!;
    const sim = new TrafficMicroSim(area, map, { demandLevel: 0, seed: 1, desiredSpeedKmh: { [edge.id]: 27 } });
    const speedOf = (s: TrafficMicroSim) => (s as unknown as { links: { id: string; speed: number }[] }).links.find(l => l.id === edge.id)!.speed * 3.6;
    expect(speedOf(base)).toBeCloseTo(60, 6);
    expect(speedOf(sim)).toBeCloseTo(27, 6);
  });
});
