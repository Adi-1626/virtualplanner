import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import type { CityObject, JunctionObject, RoadObject, StreetElementObject, UtilityObject } from '../objects/types';
import { objectFromRow, objectToRow } from '../objects/objectRows';
import { StudyAreaExplorer, type StudyArea } from '../simulation/StudyAreaExplorer';
import { applyNetworkCorrections } from '../simulation/networkCorrections';
import { applyUrbanSpeeds } from '../simulation/roadParameters';
import { buildAssignmentNetwork } from '../simulation/staticAssignment';
import { networkContentKey } from '../simulation/StudyDemand';
import { splitJunctionObjects, validateEdit } from '../simulation/junctionControl';
import { junctionAt, applyJunctionEdit } from '../editing/junctionEdits';
import { simulationRoads } from '../streetDesign/network';
import { brushSpec, brushOf, junctionMarkings, markingCounts, signalWarrantChecks } from '../streetDesign/junctionTool';
import { crossingChecks, midblockSignal } from '../streetDesign/crossings';
import { busPriorityBlockReason, busPriorityChecks, commitBusPriority, DEFAULT_BUS_PRIORITY } from '../streetDesign/busLane';
import { busStopChecks } from '../streetDesign/busStops';
import { roadsideChecks } from '../streetDesign/roadside';
import { entryCapacityPcu, roundaboutChecks, roundaboutSizes, roundaboutSpec } from '../streetDesign/roundabout';
import { pathChecks } from '../streetDesign/paths';
import { DEFAULT_STREET_SETTINGS, placeStreetElement, type StreetToolSettings } from '../streetDesign/placement';
import { distM } from '../streetDesign/geom';
import { TrafficMicroSim } from '../simulation/TrafficMicroSim';

/**
 * Street design tools (docs/urbanos/DESIGN_TOOLS_P7.md): #1 junction control, #2 crossings, #3 bus lane / stops,
 * #4 streetlights / trees, #7 roundabouts, #8 paths. Per tool: its screening checks, then downstream — placed in a
 * proposal through the same engine calls Design makes, read the way Simulate reads the roads (simulationRoads →
 * corrections → urban speeds → assignment network), with the base untouched, Undo, and a save → reload round trip
 * (objectToRow → JSON → objectFromRow, as the backend stores rows).
 */

const LAT0 = 18.53;
const kx = 111320 * Math.cos(LAT0 * Math.PI / 180);
type P3 = [number, number, number];
const pt = (x: number, y: number, z = 0): P3 => [73.85 + x / kx, LAT0 + y / 111320, z];
const T = 'Sun 2026-11-22 5:30 AM IST (UTC+05:30)';
const road = (id: string, coords: P3[], extra: Partial<RoadObject> = {}): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: coords, roadClass: 'arterial', width: 7, laneCount: 2, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [],
  createdAt: T, updatedAt: T, ...extra,
} as RoadObject);

/** A 4-lane east–west main road crossed by a 2-lane north–south road at x = 400 m, a parallel street to the north. */
const baseCity = (): CityObject[] => [
  road('ew', [pt(-400, 0), pt(0, 0), pt(400, 0), pt(800, 0), pt(1200, 0)], { laneCount: 4, width: 14, trafficCapacity: 4000 }),
  road('ns', [pt(400, -400), pt(400, 0), pt(400, 400)]),
  road('north', [pt(-400, 300), pt(400, 300), pt(1200, 300)], { roadClass: 'collector', speedLimit: 40 }),
  road('w1', [pt(-400, 0), pt(-400, 300)], { roadClass: 'local', speedLimit: 30 }),
  road('e1', [pt(1200, 0), pt(1200, 300)], { roadClass: 'local', speedLimit: 30 }),
];
const JX = pt(400, 0);
const P = 'prop_SD';

function setup() {
  vi.spyOn(EditingEngine.prototype, 'fetchSavedAreas').mockResolvedValue();
  const om = new ObjectManager();
  for (const k of Object.getOwnPropertyNames(ObjectManager.prototype).filter(n => /^sync(Post|Delete|Changes)/.test(n))) {
    if (typeof (om as any)[k] === 'function') vi.spyOn(om as any, k).mockResolvedValue(undefined);
  }
  (om as any).deletedOsm = new Set<string>();
  om.addMultiple(baseCity(), true);
  const history = new HistoryManager(om);
  const editing = new EditingEngine(om, history, undefined, {} as any);
  editing.junctionFinder = at => junctionAt(om.viewOf(om.getActiveScenarioId()), at);
  om.setActiveScenario(P);
  return { om, history, editing };
}
afterEach(() => vi.restoreAllMocks());

/** What Simulate compiles for a scenario view: TwinCityEngine → simulationRoads, SimulationMode → corrections + urban speeds. */
function compile(view: readonly CityObject[], sid: string, signalPoints: [number, number][] = []) {
  const roads = applyUrbanSpeeds(applyNetworkCorrections(simulationRoads(view, sid), null, true).roads).roads;
  const map = new Map(roads.map(r => [r.id, r]));
  const area: StudyArea = new StudyAreaExplorer().explore(roads, 0.5, { seedRoadIds: ['ns'], rangeMeters: 3000, direction: 'both' });
  const junctions = view.filter((o): o is JunctionObject => o.type === 'junction');
  const net = buildAssignmentNetwork(area, map, signalPoints, splitJunctionObjects(junctions).edits);
  return { roads, area, net, key: networkContentKey(roads, junctions, signalPoints) };
}
const sim = (om: ObjectManager, sid: string, sp: [number, number][] = []) => compile(om.viewOf(sid), sid, sp);
const canonBase = (om: ObjectManager) => JSON.stringify(om.viewOf('base').map(o => { const { updatedAt: _u, ...r } = o as any; void _u; return r; }).sort((a, b) => a.id < b.id ? -1 : 1));
/** Save → reload: every object of the view through the stored row shape and JSON, as the backend keeps it. */
const reloaded = (view: readonly CityObject[]) => view.map(o => objectFromRow(JSON.parse(JSON.stringify(objectToRow(o)))));
const linksOf = (net: ReturnType<typeof buildAssignmentNetwork>, id: string) => net.links.filter(l => l.roadId === id);
const linksInto = (c: ReturnType<typeof compile>, at: P3) => {
  const nodes = [...c.area.network.nodes.values()].filter(n => distM(n.coordinates, at) < 3).map(n => n.id);
  const idx = new Set(nodes.map(id => c.net.nodeIndex.get(id)).filter((i): i is number => i != null));
  // Approach links: ending at the junction, not starting there (not an internal piece)
  return { nodes, links: c.net.links.filter(l => idx.has(l.to) && !idx.has(l.from)) };
};
const place = (editing: EditingEngine, mode: any, pts: P3[], s: Partial<StreetToolSettings> = {}) => {
  editing.streetSettings = { ...DEFAULT_STREET_SETTINGS, ...s };
  editing.setMode(mode);
  for (const p of pts) editing.addDrawingPoint(p);
  // As TwinCityEngine's click handler: a failed placement clears the drawing for the next attempt
  try { editing.finalizeDrawing(P); } catch (e) { editing.clearDrawing(); editing.setMode('select'); throw e; }
  editing.setMode('select');
  const id = editing.lastAddedId;
  return id ? (editing as any).objectManager.getById(id) as StreetElementObject : undefined;
};
const st = (checks: { id: string; status: string }[], id: string) => checks.find(c => c.id === id)?.status;
const ctxOf = (objs: CityObject[]) => ({ objects: objs });
const meta = (id: string) => ({ id, name: `New ${id}`, scenarioId: P, createdAt: T });

// ── #1 Junction control ─────────────────────────────────────────────────────
describe('#1 junction control brush', () => {
  const objs = baseCity();
  const hit = junctionAt(objs, JX)!;
  it('finds the junction at the click and every brush gives a valid whole-junction edit that keeps what was set', () => {
    expect(hit).toBeTruthy();
    const j = hit.junction;
    expect(j.approaches.length).toBe(4);
    for (const b of ['signal', 'stop', 'give_way', 'uncontrolled'] as const) {
      const s = brushSpec(j, null, b);
      expect(validateEdit(s)).toEqual([]);
      expect(brushOf(s)).toBe(b);
      expect(s.asRun).toBeUndefined();
    }
    const sig = brushSpec(j, null, 'signal');
    for (const a of j.approaches) expect(sig.signal!.phases.some(p => p.arms.includes(a.id))).toBe(true);
    // A ban set earlier survives a brush stroke
    const banned = { ...sig, bannedMovements: ['x>y'] };
    expect(brushSpec(j, banned, 'give_way').bannedMovements).toEqual(['x>y']);
    // Stop / give way: a major road is chosen (every arm is one class here → the widest and the one opposite it)
    const stop = brushSpec(j, null, 'stop');
    expect(stop.control).toBe('priority');
    expect(stop.minorSign).toBe('stop');
    expect(stop.majorArms!.length).toBeGreaterThan(0);
    expect(stop.majorArms!.length).toBeLessThan(j.approaches.length);
  });

  it('IRC:35 markings follow the control: signal → zebras + stop lines + arrows; stop → double stop lines on the minor arms; give way → give-way lines; uncontrolled → none, said so', () => {
    const j = hit.junction, net = hit.local.network, roads = hit.local.roads;
    const n = j.approaches.length;
    const sig = markingCounts(junctionMarkings(j, net, roads, brushSpec(j, null, 'signal')).items);
    expect(sig.zebra).toBe(n);
    expect(sig.stop_line).toBe(n);
    expect(sig.arrow).toBeGreaterThanOrEqual(n);
    const stop = brushSpec(j, null, 'stop');
    const minors = j.approaches.filter(a => !stop.majorArms!.includes(a.id)).length;
    const sm = markingCounts(junctionMarkings(j, net, roads, stop).items);
    expect(sm.double_stop_line).toBe(minors);
    expect(sm.stop_word).toBe(minors);
    expect(sm.stop_line ?? 0).toBe(0);
    const gw = markingCounts(junctionMarkings(j, net, roads, brushSpec(j, null, 'give_way')).items);
    expect(gw.give_way_line).toBe(minors);
    const un = junctionMarkings(j, net, roads, brushSpec(j, null, 'uncontrolled'));
    expect(un.items).toEqual([]);
    expect(un.notes.join(' ')).toMatch(/uncontrolled/i);
    // Every placed line has its source values
    for (const m of junctionMarkings(j, net, roads, brushSpec(j, null, 'signal')).items) if (m.kind !== 'stop_word') expect(m.line.length).toBe(2);
  });

  it('signal warrant: unknown without volumes; a modelled peak below Warrant 1 and 2 under a signal is a warning, never a pass', () => {
    const j = hit.junction;
    const spec = brushSpec(j, null, 'signal');
    expect(signalWarrantChecks(j, spec, null)[0].status).toBe('unknown');
    const majors = new Set(brushSpec(j, null, 'stop').majorArms);
    const low = j.approaches.map(a => ({ armId: a.id, vehPerHour: majors.has(a.id) ? 100 : 20 }));
    expect(signalWarrantChecks(j, { ...spec, majorArms: [...majors] }, low)[0].status).toBe('warn');
    const high = j.approaches.map(a => ({ armId: a.id, vehPerHour: majors.has(a.id) ? 900 : 400 }));
    const w = signalWarrantChecks(j, { ...spec, majorArms: [...majors] }, high)[0];
    expect(w.status).toBe('info');
    expect(w.message).toMatch(/8 hours/);
  });

  it('downstream: the brush edit in a proposal signals the junction in the assignment; base untouched; Undo; save → reload', () => {
    const { om, history } = setup();
    const base0 = canonBase(om), b = sim(om, 'base');
    const h = junctionAt(om.viewOf(P), JX)!;
    const spec = brushSpec(h.junction, null, 'signal');
    applyJunctionEdit(om, history, spec, P, h.junction.centre);
    const p = sim(om, P);
    expect(p.key).not.toBe(b.key);
    const into = linksInto(p, JX).links, intoB = linksInto(b, JX).links;
    expect(into.length).toBeGreaterThan(0);
    // Edited signal: every approach link has a stop-line capacity and g/C; the base has none (no mapped signal)
    expect(into.every(l => l.stopLinePcu != null && (l.gC ?? 1) < 1)).toBe(true);
    expect(intoB.every(l => l.stopLinePcu == null)).toBe(true);
    // ...and says what sets it and where: the edited signal at the link's end (P12: a suggestion opens this junction)
    expect(into.every(l => l.stopLine?.kind === 'signal')).toBe(true);
    expect(intoB.every(l => !l.stopLine)).toBe(true);
    expect(canonBase(om)).toBe(base0);
    // Save → reload gives the same network
    expect(compile(reloaded(om.viewOf(P)), P).key).toBe(p.key);
    history.undo();
    expect(sim(om, P).key).toBe(b.key);
  });
});

// ── #2 Crossings ────────────────────────────────────────────────────────────
describe('#2 pedestrian crossings', () => {
  const objs = baseCity();
  const cross = (id: string, x: number, s: Partial<StreetToolSettings> = {}) => placeStreetElement('place_crossing', [pt(x, 2)], { ...DEFAULT_STREET_SETTINGS, ...s }, ctxOf(objs), meta(id));
  it('snaps to the road with its chainage and side; a raised crossing is widened to 3 m', () => {
    const c = cross('c1', 200);
    expect(c.anchor!.roadId).toBe('ew');
    expect(c.anchor!.chainageM).toBeCloseTo(600, 0);
    expect(c.anchor!.side).toBe('left');
    expect(cross('c2', 200, { crossingType: 'raised', crossingWidthM: 2.5 }).crossing!.widthM).toBe(3);
    expect(() => placeStreetElement('place_crossing', [pt(200, 100)], DEFAULT_STREET_SETTINGS, ctxOf(objs), meta('x'))).toThrow(/no road within/);
  });
  it('checks: width, refuge over 10.5 m, refuge width, spacing, signal spacing and pedestrian warrant (unknown without a count)', () => {
    const c = cross('c1', 200, { crossingWidthM: 1.5 });
    const k = crossingChecks(c, objs);
    expect(st(k, 'crossing-width')).toBe('fail');
    // 4 lanes × 3.5 m = 14 m in one go
    expect(st(k, 'crossing-refuge')).toBe('fail');
    const r = cross('c1', 200, { crossingRefuge: true, crossingRefugeWidthM: 1.5 });
    const kr = crossingChecks(r, objs);
    expect(st(kr, 'crossing-refuge')).toBe('pass'); // 7 m per direction
    expect(st(kr, 'crossing-refuge-width')).toBe('warn'); // ≥ 1.2 but < 3 m (USDG wheelchair / IRC:86 4-lane)
    const a = cross('a', 100), b120 = cross('b', 220), b300 = cross('c', 400 - 10);
    expect(st(crossingChecks(a, [...objs, b120]), 'crossing-spacing')).toBe('pass');
    expect(st(crossingChecks(a, [...objs, b300]), 'crossing-spacing')).toBe('warn');
    const sig = cross('s', 100, { crossingType: 'signalised' });
    const ks = crossingChecks(sig, [...objs, b120]);
    expect(st(ks, 'crossing-signal-spacing')).toBe('warn');
    expect(st(ks, 'crossing-ped-warrant')).toBe('unknown');
    for (const x of ks) { expect(x.screening).toBe(true); expect(x.message.toLowerCase()).not.toMatch(/\bsafe\b|complian/); }
  });
  it('mid-block signal timing: IRC:93 pedestrian green = length / 1.2 + 7 s, assumed 60 s cycle', () => {
    const c = cross('s', 100, { crossingType: 'signalised' });
    const t = midblockSignal(c.crossing!, objs[0] as RoadObject)!;
    expect(t.cycleAssumed).toBe(true);
    expect(t.pedGreenS).toBeCloseTo(14 / 1.2 + 7, 2);
    expect(t.vehGreenS).toBeCloseTo(60 - (14 / 1.2 + 7) - 10, 2);
    expect(t.gC).toBeCloseTo((t.vehGreenS + 3 - 2) / 60, 2);
    expect(midblockSignal({ ...c.crossing!, crossingType: 'zebra' }, objs[0] as RoadObject)).toBeNull();
  });
  it('downstream: a signalised crossing caps the road links through it in the proposal only; a zebra leaves the model as it is; Undo; save → reload', () => {
    const { om, history, editing } = setup();
    const base0 = canonBase(om), b = sim(om, 'base');
    const z = place(editing, 'place_crossing', [pt(200, 1)]);
    expect(z?.kind).toBe('crossing');
    expect(sim(om, P).key).toBe(b.key); // zebra: no model change
    const s = place(editing, 'place_crossing', [pt(600, 1)], { crossingType: 'signalised' })!;
    const p = sim(om, P);
    expect(p.key).not.toBe(b.key);
    const t = midblockSignal(s.crossing!, om.getById('ew') as RoadObject)!;
    const capped = linksOf(p.net, 'ew').filter(l => l.gC != null);
    expect(capped.length).toBeGreaterThanOrEqual(1);
    for (const l of capped) expect(l.gC!).toBeCloseTo(t.gC, 2);
    expect(linksOf(b.net, 'ew').every(l => l.gC == null)).toBe(true);
    // Links of the road away from the crossing are untouched
    expect(linksOf(p.net, 'ew').some(l => l.gC == null)).toBe(true);
    expect(canonBase(om)).toBe(base0);
    expect(om.viewOf('base').some(o => o.type === 'street_element')).toBe(false);
    expect(compile(reloaded(om.viewOf(P)), P).key).toBe(p.key);
    history.undo();
    expect(om.getById(s.id)).toBeUndefined();
    expect(sim(om, P).key).toBe(b.key);
  });
});

// ── #3 Bus lane and bus stops ───────────────────────────────────────────────
describe('#3 bus lane / BRT and bus stops', () => {
  const objs = baseCity();
  const ew = objs[0] as RoadObject;
  it('bus lane checks; a road with one lane each way cannot take one', () => {
    expect(busPriorityBlockReason(objs[1] as RoadObject, DEFAULT_BUS_PRIORITY('bus_lane'))).toMatch(/no lane for general traffic/);
    expect(busPriorityBlockReason(ew, DEFAULT_BUS_PRIORITY('bus_lane'))).toBeNull();
    const k = busPriorityChecks(ew, { ...DEFAULT_BUS_PRIORITY('brt'), laneWidthM: 3, dividerM: null });
    expect(st(k, 'bus-lane-width')).toBe('fail');
    expect(st(k, 'bus-lane-divider')).toBe('unknown');
    expect(st(k, 'bus-lane-row')).toBe('unknown');
    expect(st(busPriorityChecks({ ...ew, availableRowM: 24 } as RoadObject, DEFAULT_BUS_PRIORITY('bus_lane')), 'bus-lane-row')).toBe('warn');
    expect(st(busPriorityChecks(ew, { ...DEFAULT_BUS_PRIORITY('brt'), dividerM: 0.6 }), 'bus-lane-divider')).toBe('warn');
  });
  it('downstream: the proposal road loses one general lane per direction and its capacity drops; base untouched; Undo; save → reload', () => {
    const { om, history } = setup();
    const base0 = canonBase(om), b = sim(om, 'base');
    const r = commitBusPriority(om as any, history, om.getById('ew') as RoadObject, DEFAULT_BUS_PRIORITY('bus_lane'));
    expect(r.ok).toBe(true);
    expect((om.getById('ew') as RoadObject).laneCount).toBe(4); // the stored road keeps its lanes
    const p = sim(om, P);
    expect(p.key).not.toBe(b.key);
    const eP = [...p.area.network.edges.values()].filter(e => e.roadId === 'ew'), eB = [...b.area.network.edges.values()].filter(e => e.roadId === 'ew');
    expect(eB.every(e => e.lanes === 2)).toBe(true);
    expect(eP.every(e => e.lanes === 1)).toBe(true);
    const cap = (c: typeof p) => Math.max(...linksOf(c.net, 'ew').map(l => l.midblockPcu));
    expect(cap(p)).toBeLessThan(cap(b));
    expect(canonBase(om)).toBe(base0);
    expect((om.viewOf('base').find(o => o.id === 'ew') as RoadObject).busPriority).toBeUndefined();
    const rl = reloaded(om.viewOf(P));
    expect((rl.find(o => o.id === 'ew') as RoadObject).busPriority?.kind).toBe('bus_lane');
    expect(compile(rl, P).key).toBe(p.key);
    history.undo();
    expect(sim(om, P).key).toBe(b.key);
  });
  it('bus stop checks: junction distance, spacing, clear walkway, BRT station; no model change', () => {
    const fpRoad = { ...ew, hasFootpath: true, footpathWidth: 3 } as RoadObject;
    const city = [fpRoad, ...objs.slice(1)];
    const stop = (id: string, x: number, s: Partial<StreetToolSettings> = {}) => placeStreetElement('place_bus_stop', [pt(x, 3)], { ...DEFAULT_STREET_SETTINGS, ...s }, ctxOf(city), meta(id));
    const near = stop('s1', 380);
    expect(st(busStopChecks(near, city), 'bus-stop-junction')).toBe('warn');
    const far = stop('s2', 150);
    expect(st(busStopChecks(far, city), 'bus-stop-junction')).toBe('pass');
    expect(st(busStopChecks(far, [...city, stop('s3', 450)]), 'bus-stop-spacing')).toBe('warn'); // 300 m
    expect(st(busStopChecks(far, [...city, stop('s3', 850)]), 'bus-stop-spacing')).toBe('pass'); // 700 m
    expect(st(busStopChecks(far, city), 'bus-stop-clear-walk')).toBe('fail'); // 3 − 1.5 = 1.5 m < 2 m
    expect(st(busStopChecks(stop('s4', 150), objs), 'bus-stop-clear-walk')).toBe('unknown'); // no footpath recorded
    const brt = stop('s5', 150, { busStopPlacement: 'median_brt' });
    expect(st(busStopChecks(brt, city), 'bus-stop-brt-station')).toBe('pass');
    expect(st(busStopChecks(brt, city), 'bus-stop-brt-lane')).toBe('warn');
    const { om, editing } = setup();
    const b = sim(om, 'base');
    expect(place(editing, 'place_bus_stop', [pt(150, 3)])?.kind).toBe('bus_stop');
    expect(sim(om, P).key).toBe(b.key);
  });
});

// ── #4 Streetlights and street trees ────────────────────────────────────────
describe('#4 streetlights and street trees', () => {
  const objs = baseCity();
  const run = (s: Partial<StreetToolSettings>, city: CityObject[] = objs) => placeStreetElement('place_roadside', [pt(0, 3)], { ...DEFAULT_STREET_SETTINGS, ...s }, ctxOf(city), meta('r'));
  it('a run of N items at the spacing along one side (IRC:86 Table 5.6 spacing by street width when not entered)', () => {
    const l = run({ roadsideCount: 5 });
    expect(l.kind).toBe('streetlight');
    expect(l.roadside!.points.length).toBe(5);
    expect(l.roadside!.spacingM).toBe(30); // drawn 14 m > 9 m → 30–33 m row, low end
    for (let i = 1; i < 5; i++) expect(distM(l.roadside!.points[i - 1], l.roadside!.points[i])).toBeCloseTo(30, 0);
    expect(l.valueCertainty).toEqual({ spacingM: 'hypothetical' });
  });
  it('checks: pole height, spacing, rows on a wide street, tree pit / canopy, clear walkway, utilities', () => {
    expect(st(roadsideChecks(run({ roadsidePoleHeightM: 11 }), objs), 'light-height')).toBe('pass');
    expect(st(roadsideChecks(run({ roadsidePoleHeightM: 13 }), objs), 'light-height')).toBe('fail');
    expect(st(roadsideChecks(run({ roadsidePoleHeightM: 7 }), objs), 'light-height')).toBe('warn');
    expect(st(roadsideChecks(run({ roadsideSpacingM: 40 }), objs), 'light-spacing')).toBe('warn');
    expect(st(roadsideChecks(run({}), objs), 'light-rows')).toBe('info');
    const tree = run({ roadsideKind: 'street_tree' });
    expect(tree.valueCertainty).toEqual({ spacingM: 'unknown' });
    const kt = roadsideChecks(tree, objs);
    expect(st(kt, 'tree-pit')).toBe('pass');
    expect(st(kt, 'tree-canopy')).toBe('pass');
    expect(st(kt, 'tree-spacing')).toBe('info');
    expect(st(roadsideChecks({ ...tree, roadside: { ...tree.roadside!, pitM: 0.8 } }, objs), 'tree-pit')).toBe('fail');
    // In a 2 m footpath a 1 m pit leaves 1 m of walkway
    const fpCity = [{ ...objs[0], hasFootpath: true, footpathWidth: 2 } as RoadObject, ...objs.slice(1)];
    const inFp = run({ roadsideKind: 'street_tree', roadsideZone: 'footpath' }, fpCity);
    expect(st(roadsideChecks(inFp, fpCity), 'roadside-clear-walk')).toBe('fail');
    // Utilities: none loaded → unknown (never a pass); one under the run → requires investigation
    expect(st(kt, 'roadside-utility')).toBe('unknown');
    const p0 = tree.roadside!.points[0];
    const pipe = { id: 'u1', type: 'utility', name: 'Water main', layerId: 'water_util', scenarioId: 'base', createdAt: T, updatedAt: T, utilityType: 'water',
      coordinates: [[p0[0] - 0.0005, p0[1], -1.5], [p0[0] + 0.0005, p0[1], -1.5]], diameterMm: 300 } as unknown as UtilityObject;
    expect(st(roadsideChecks(tree, [...objs, pipe]), 'roadside-utility')).toBe('warn');
  });
  it('downstream: no model change; Undo removes the run; save → reload keeps every point', () => {
    const { om, history, editing } = setup();
    const base0 = canonBase(om), b = sim(om, 'base');
    const el = place(editing, 'place_roadside', [pt(0, 3)], { roadsideCount: 4 })!;
    expect(el.roadside!.points.length).toBe(4);
    expect(el.name).toMatch(/streetlights/i);
    expect(sim(om, P).key).toBe(b.key);
    expect(canonBase(om)).toBe(base0);
    const back = reloaded(om.viewOf(P)).find(o => o.id === el.id) as StreetElementObject;
    expect(back.roadside!.points).toEqual(el.roadside!.points);
    history.undo();
    expect(om.getById(el.id)).toBeUndefined();
  });
});

// ── #7 Roundabouts ──────────────────────────────────────────────────────────
describe('#7 roundabouts (IRC:65-2017)', () => {
  it('sizes from Table 6.2 (exact and interpolated), double-lane CCW rule, Table 9.1 entry capacity', () => {
    expect(roundaboutSizes('urban_single', 32)).toMatchObject({ islandM: 12, circulatoryM: 10, how: 'IRC:65 Table 6.2' });
    const mid = roundaboutSizes('urban_single', 34);
    expect(mid.islandM).toBe(15);
    expect(mid.circulatoryM).toBe(9.5);
    expect(mid.how).toMatch(/interpolated/);
    expect(roundaboutSizes('double', 50).circulatoryM).toBeCloseTo(7.7, 6);
    expect(entryCapacityPcu(32, 600)).toBe(Math.round(2567 * Math.exp(-0.00032 * 600)));
    expect(entryCapacityPcu(15, 600)).toBeNull();
  });
  it('checks: ICD against the category, arms, fit unknown without the space, splitters unknown, effect stated', () => {
    const el = (icd: number, cat: 'urban_single' | 'double' | 'mini' = 'urban_single', avail: number | null = null): StreetElementObject => ({
      id: 'se_rb', type: 'street_element', kind: 'roundabout', name: 'rb', layerId: 'street_elements', scenarioId: P, createdAt: T, updatedAt: T, coordinates: [JX],
      roundabout: roundaboutSpec(cat, icd, { armRoadIds: ['ew', 'ns'], nodeKeys: [], armCount: 4 }, avail) });
    const objs = baseCity();
    expect(st(roundaboutChecks(el(32), objs), 'rb-icd')).toBe('pass');
    expect(st(roundaboutChecks(el(45), objs), 'rb-icd')).toBe('fail');
    expect(st(roundaboutChecks(el(32), objs), 'rb-arms')).toBe('pass');
    expect(st(roundaboutChecks(el(32), objs), 'rb-fit')).toBe('unknown');
    expect(st(roundaboutChecks(el(32, 'urban_single', 30), objs), 'rb-fit')).toBe('fail');
    expect(st(roundaboutChecks(el(32), objs), 'rb-splitter')).toBe('unknown');
    expect(roundaboutChecks(el(32), objs).find(c => c.id === 'rb-model')!.message).toMatch(/micro-simulation the junction has no signal and each entry gives way to traffic from its right/);
  });
  it('downstream: the signalised junction becomes a roundabout in the proposal assignment (no signal, IRC:65 entry capacity); base keeps its signal; Undo; save → reload', () => {
    const { om, history, editing } = setup();
    const SP: [number, number][] = [[JX[0], JX[1]]];
    const base0 = canonBase(om), b = sim(om, 'base', SP);
    const intoB = linksInto(b, JX).links;
    expect(intoB.length).toBeGreaterThan(0);
    expect(intoB.every(l => l.gC != null && l.gC < 1)).toBe(true); // mapped signal
    expect(() => place(editing, 'place_roundabout', [pt(100, 150)])).toThrow(/no junction/);
    const rb = place(editing, 'place_roundabout', [pt(402, 1)])!;
    expect(rb.kind).toBe('roundabout');
    expect(rb.roundabout!.icdM).toBe(32);
    expect(rb.roundabout!.armRoadIds.sort()).toEqual(['ew', 'ns']);
    expect(rb.roundabout!.nodeKeys.length).toBeGreaterThan(0);
    const p = sim(om, P, SP);
    expect(p.key).not.toBe(b.key);
    const into = linksInto(p, JX).links;
    const perLane = entryCapacityPcu(32, 600)!;
    expect(into.length).toBe(intoB.length);
    for (const l of into) {
      expect(l.gC).toBeNull();
      expect(l.stopLinePcu).toBeCloseTo(perLane * Math.max(1, Math.min(l.lanes, 1)), 6);
      expect(l.stopLine?.kind).toBe('roundabout');
    }
    expect(canonBase(om)).toBe(base0);
    expect(compile(reloaded(om.viewOf(P)), P, SP).key).toBe(p.key);
    history.undo();
    expect(sim(om, P, SP).key).toBe(b.key);
  });
  it('micro-simulation: the junction runs as a roundabout (no signal, entries give way to the right), traffic flows on every arm, base keeps its signal', () => {
    const { om, editing } = setup();
    const SP: [number, number][] = [[JX[0], JX[1]]];
    place(editing, 'place_roundabout', [pt(402, 1)]);
    const run = (sid: string) => {
      const c = sim(om, sid, SP);
      const map = new Map(c.roads.map(r => [r.id, r]));
      const node = (x: number, y: number) => [...c.area.network.nodes.values()].sort((a, q) => distM(a.coordinates, pt(x, y)) - distM(q.coordinates, pt(x, y)))[0].id;
      const ends = [node(-400, 0), node(1200, 0), node(400, -400), node(400, 400)];
      // 300 veh/h from every arm to every other arm (2,400 veh/h through the junction)
      const trips = ends.flatMap(f => ends.filter(t => t !== f).map(t => ({ fromNodeId: f, toNodeId: t, vehiclesPerHour: 200, kind: 'car' as const })));
      const ms = new TrafficMicroSim(c.area, map, { demandLevel: 1, seed: 3, signalPoints: SP, demandTrips: trips });
      for (let i = 0; i < 3600; i++) ms.step();
      return { ms, m: ms.getMetrics(), into: ms.linkEnds().filter(l => distM(l.to, JX) < 3 && distM(l.from, JX) >= 3).map(l => l.id) };
    };
    const p = run(P), b = run('base');
    expect(p.ms.roundaboutJunctions.size).toBe(1);
    expect(b.ms.roundaboutJunctions.size).toBe(0);
    expect(p.into.length).toBeGreaterThan(0);
    expect(p.into.every(id => p.ms.signalStateOf(id) === null)).toBe(true);
    expect(b.into.some(id => b.ms.signalStateOf(id) !== null)).toBe(true);
    // 15 simulated minutes: trips complete from the roundabout and nothing is left gridlocked there
    expect(p.m.completedTrips).toBeGreaterThan(300);
    expect(p.m.accounting.gridlockedNow).toBe(0);
  });
});

// ── #8 Paths ────────────────────────────────────────────────────────────────
describe('#8 standalone paths, FOB and subway', () => {
  const objs = baseCity();
  const path = (pts: P3[], s: Partial<StreetToolSettings>, extra: Partial<NonNullable<StreetElementObject['path']>> = {}) => {
    const el = placeStreetElement('draw_path', pts, { ...DEFAULT_STREET_SETTINGS, ...s }, ctxOf(objs), meta('p'));
    el.path = { ...el.path!, ...extra };
    return el;
  };
  const along: P3[] = [pt(0, 100), pt(100, 100)];
  const across: P3[] = [pt(200, -30), pt(200, 30)];
  it('widths: footpath 1.8 / 2 m, shared ≤ 40 m, cycle track one- / two-way', () => {
    expect(st(pathChecks(path(along, { pathWidthM: 1.5 }), objs), 'path-width')).toBe('fail');
    expect(st(pathChecks(path(along, { pathWidthM: 1.9 }), objs), 'path-width')).toBe('warn');
    expect(st(pathChecks(path(along, { pathWidthM: 2 }), objs), 'path-width')).toBe('pass');
    expect(st(pathChecks(path(along, { pathType: 'shared', pathWidthM: 3 }), objs), 'path-width')).toBe('warn'); // 100 m > 40 m
    expect(st(pathChecks(path(along, { pathType: 'cycle_two_way', pathWidthM: 2 }), objs), 'path-width')).toBe('fail');
    expect(st(pathChecks(path(along, { pathType: 'cycle_one_way', pathWidthM: 2 }), objs), 'path-buffer')).toBe('unknown');
    expect(() => placeStreetElement('draw_path', [pt(0, 0)], DEFAULT_STREET_SETTINGS, ctxOf(objs), meta('p'))).toThrow(/at least 2 points/);
  });
  it('FOB: discouraged flag, clearance over the road (IRC:54 5.5 m), roads crossed; subway: size and utilities crossed', () => {
    const fob = path(across, { pathLevel: 'fob', pathWidthM: 3 });
    const k = pathChecks(fob, objs);
    expect(st(k, 'path-grade-separated')).toBe('warn');
    expect(st(k, 'path-fob-clearance')).toBe('unknown');
    expect(st(k, 'path-fob-roads')).toBe('info');
    expect(st(pathChecks(path(across, { pathLevel: 'fob' }, { clearHeightM: 5 }), objs), 'path-fob-clearance')).toBe('fail');
    expect(st(pathChecks(path(across, { pathLevel: 'fob' }, { clearHeightM: 6, hasLift: true }), objs), 'path-ramp')).toBe('pass');
    const sub = path(across, { pathLevel: 'subway', pathWidthM: 2 }, { clearHeightM: 3 });
    expect(st(pathChecks(sub, objs), 'path-subway-size')).toBe('fail');
    expect(st(pathChecks(sub, objs), 'path-subway-utilities')).toBe('unknown');
    const pipe = { id: 'u1', type: 'utility', name: 'Sewer', layerId: 'sewage_util', scenarioId: 'base', createdAt: T, updatedAt: T, utilityType: 'sewage',
      coordinates: [pt(150, 0, -3), pt(250, 0, -3)] } as unknown as UtilityObject;
    expect(st(pathChecks(sub, [...objs, pipe]), 'path-subway-utilities')).toBe('warn');
  });
  it('downstream: no model change; Undo; save → reload', () => {
    const { om, history, editing } = setup();
    const b = sim(om, 'base');
    const el = place(editing, 'draw_path', [pt(0, 100), pt(100, 120), pt(200, 100)], { pathType: 'cycle_two_way', pathWidthM: 3 })!;
    expect(el.kind).toBe('path');
    expect(el.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(sim(om, P).key).toBe(b.key);
    const back = reloaded(om.viewOf(P)).find(o => o.id === el.id) as StreetElementObject;
    expect(back.path).toEqual(el.path);
    expect(back.coordinates).toEqual(el.coordinates);
    history.undo();
    expect(om.getById(el.id)).toBeUndefined();
  });
});
