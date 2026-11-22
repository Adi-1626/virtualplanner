import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager, deleteWithHistory } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import { commitRoadFieldEdit } from '../editing/roadEdits';
import { commitGeometry } from '../editing/geometryCommit';
import { commitCrossSectionTemplate } from '../crossSection/apply';
import { templateById } from '../crossSection/templates';
import { defaultAlignmentSettings } from '../geometry/alignment/defaults';
import type { HorizontalAlignment } from '../geometry/alignment/types';
import type { CityObject, RoadObject, FlyoverObject } from '../objects/types';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';
import { StudyAreaExplorer, isDrivable, type DrivableObject, type StudyArea } from '../simulation/StudyAreaExplorer';
import { applyNetworkCorrections } from '../simulation/networkCorrections';
import { applyUrbanSpeeds, midblockCapacityPcu, IRC106_DSV, IRC106_DSV_TO_CAPACITY } from '../simulation/roadParameters';
import { buildAssignmentNetwork } from '../simulation/staticAssignment';
import { networkContentKey } from '../simulation/StudyDemand';
import { isSampleObject } from '../objects/sampleObjects';
import { SimulationMode } from '../simulation/SimulationMode';
import { isStale, screenedAsProposed } from '../../components/underground/conflictClasses';

/**
 * Build → everything downstream (docs/urbanos/BUILD_PROPAGATION.md). Every buildable thing is drawn or edited INSIDE a
 * proposal through the same engine calls the Design UI makes (EditingEngine.finalizeDrawing, commitGeometry,
 * commitCrossSectionTemplate, commitRoadFieldEdit, deleteWithHistory), then the roads are read the way Simulate reads
 * them (TwinCityEngine: active-scenario view → drivable → SimulationMode.getRoads: corrections + urban speeds) and
 * compiled by the study-area explorer and the assignment network builder. Each test is one cell of the matrix.
 */

const LAT0 = 18.53;
const kx = 111320 * Math.cos(LAT0 * Math.PI / 180);
type P3 = [number, number, number];
const pt = (x: number, y: number, z = 0): P3 => [73.85 + x / kx, LAT0 + y / 111320, z];
const T = 'Mon 2026-11-09 5:30 AM IST (UTC+05:30)';
const road = (id: string, coords: P3[], extra: Partial<RoadObject> = {}): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: coords, roadClass: 'arterial', width: 7, laneCount: 2, laneWidth: 3.5,
  hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [],
  createdAt: T, updatedAt: T, ...extra,
} as RoadObject);

/** Base city: an east–west main road crossed by a north–south road at x = 400 m, and a parallel street to the north. */
const baseCity = (): CityObject[] => [
  road('ew', [pt(-400, 0), pt(0, 0), pt(400, 0), pt(800, 0), pt(1200, 0)]),
  road('ns', [pt(400, -400), pt(400, 0), pt(400, 400)]),
  road('north', [pt(-400, 300), pt(400, 300), pt(1200, 300)], { roadClass: 'collector', speedLimit: 40 }),
  road('w1', [pt(-400, 0), pt(-400, 300)], { roadClass: 'local', speedLimit: 30 }),
  road('e1', [pt(1200, 0), pt(1200, 300)], { roadClass: 'local', speedLimit: 30 }),
];

const P = 'prop_A';

function setup() {
  vi.spyOn(EditingEngine.prototype, 'fetchSavedAreas').mockResolvedValue();
  const om = new ObjectManager();
  for (const k of ['syncPost', 'syncPostMultiple', 'syncDelete', 'syncDeleteMultiple'] as const) vi.spyOn(om, k).mockResolvedValue();
  // proposal change writes (copy-on-write overrides / tombstones) go to the backend too: no network in tests
  for (const k of Object.getOwnPropertyNames(ObjectManager.prototype).filter(n => /^sync(Post|Delete|Changes)/.test(n))) {
    if (typeof (om as any)[k] === 'function') vi.spyOn(om as any, k).mockResolvedValue(undefined);
  }
  (om as any).deletedOsm = new Set<string>();
  om.addMultiple(baseCity(), true);
  const history = new HistoryManager(om);
  const editing = new EditingEngine(om, history, undefined, {} as any);
  return { om, history, editing };
}
afterEach(() => vi.restoreAllMocks());

/** The roads Simulate gets for a scenario (TwinCityEngine's getRoads + SimulationMode.getRoads, no correction layer). */
function simRoads(om: ObjectManager, sid: string): DrivableObject[] {
  const raw = filterObjectsForScenario(om.viewOf(sid), sid).filter(isDrivable).filter(o => !isSampleObject(o));
  return applyUrbanSpeeds(applyNetworkCorrections(raw, null, true).roads).roads;
}
function compile(om: ObjectManager, sid: string, seed = 'ns', rangeMeters = 2000) {
  const roads = simRoads(om, sid);
  const map = new Map(roads.map(r => [r.id, r]));
  const area: StudyArea = new StudyAreaExplorer().explore(roads, Math.random(), { seedRoadIds: [seed], rangeMeters, direction: 'both' });
  const net = buildAssignmentNetwork(area, map);
  return { roads, map, area, net, key: networkContentKey(roads, [], []) };
}
const edgesOf = (area: StudyArea, id: string) => [...area.network.edges.values()].filter(e => e.roadId === id);
const linksOf = (net: ReturnType<typeof buildAssignmentNetwork>, id: string) => net.links.filter(l => l.roadId === id);
/** Network nodes the road's edges touch that another road's edges also touch (where it is connected). */
function joinsOf(area: StudyArea, id: string): Set<string> {
  const mine = new Set(edgesOf(area, id).flatMap(e => [e.fromNodeId, e.toNodeId]));
  const out = new Set<string>();
  for (const e of area.network.edges.values()) if (e.roadId !== id) for (const n of [e.fromNodeId, e.toNodeId]) if (mine.has(n)) out.add(e.roadId);
  return out;
}
const draw = (editing: EditingEngine, mode: any, pts: P3[], sid = P, cls: any = 'arterial') => {
  editing.roadClass = cls;
  editing.setMode(mode);
  for (const p of pts) editing.addDrawingPoint(p);
  editing.finalizeDrawing(sid);
  editing.setMode('select');
};
const newIds = (before: Set<string>, om: ObjectManager, sid: string) => om.viewOf(sid).filter(o => !before.has(o.id)).map(o => o.id);
const ids = (om: ObjectManager, sid: string) => new Set(om.viewOf(sid).map(o => o.id));
const canonBase = (om: ObjectManager) => JSON.stringify(om.viewOf('base').map(o => { const { updatedAt: _u, ...r } = o as any; void _u; return r; }).sort((a, b) => a.id < b.id ? -1 : 1));

describe('new road drawn in a proposal', () => {
  it('a) is in the proposal network with its lanes, speed and IRC:106 capacity, joined at both ends; b) base untouched', () => {
    const { om, editing } = setup();
    om.setActiveScenario(P);
    const base0 = canonBase(om), b0 = ids(om, 'base'), key0 = compile(om, 'base').key;
    // A new arterial from the east–west road (x 0) up to the north street (x 0, y 300)
    draw(editing, 'draw_road', [pt(0, 0), pt(0, 300)]);
    const [nid] = newIds(b0, om, P).filter(id => om.getById(id)?.type === 'road');
    expect(nid).toBeTruthy();
    const n = om.viewOf(P).find(o => o.id === nid) as RoadObject;
    // arterial defaults: 4 lanes, 2 m divider, 60 km/h
    expect(n.laneCount).toBe(4);
    expect(n.hasDivider).toBe(true);
    const { area, net } = compile(om, P);
    const edges = edgesOf(area, nid);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every(e => e.lanes === 2 && e.speedLimit === 60)).toBe(true);
    expect([...joinsOf(area, nid)].sort()).toEqual(expect.arrayContaining(['north']));
    expect([...joinsOf(area, nid)].some(r => r === 'ew' || r.startsWith('ew'))).toBe(true);
    // IRC:106 Table 2, 4-lane DIVIDED sub-arterial (drawn class arterial → IRC sub-arterial column): 2900 / 0.7 / 2 per direction
    const links = linksOf(net, nid);
    expect(links.length).toBe(edges.length);
    const want = Math.round(IRC106_DSV['4-divided'][1] * IRC106_DSV_TO_CAPACITY * 0.5);
    for (const l of links) expect(Math.round(l.midblockPcu)).toBe(want);
    for (const l of links) expect(l.freeSpeedKmh).toBe(60);
    // e) the base view and its network are as they were
    expect(canonBase(om)).toBe(base0);
    expect(compile(om, 'base').key).toBe(key0);
    expect(om.viewOf('base').some(o => o.id === nid)).toBe(false);
  });
});

describe('cross-section template applied to an existing road in a proposal', () => {
  it('the proposal network gets the template lanes and divided capacity; the base road keeps its own', () => {
    const { om, history } = setup();
    om.setActiveScenario(P);
    const base0 = canonBase(om);
    const ew = om.getById('ew') as RoadObject;
    const r = commitCrossSectionTemplate(om as any, history, ew, templateById('usdg-24a')!, 'base');
    expect(r.ok).toBe(true);
    const { area, net } = compile(om, P);
    const e = edgesOf(area, 'ew');
    expect(e.every(x => x.lanes === 2)).toBe(true);
    const want = Math.round(IRC106_DSV['4-divided'][1] * IRC106_DSV_TO_CAPACITY * 0.5);
    for (const l of linksOf(net, 'ew')) expect(Math.round(l.midblockPcu)).toBe(want);
    // base: 2-lane two-way undivided
    const b = compile(om, 'base');
    expect(edgesOf(b.area, 'ew').every(x => x.lanes === 1)).toBe(true);
    for (const l of linksOf(b.net, 'ew')) expect(Math.round(l.midblockPcu)).toBe(Math.round(IRC106_DSV['2-twoway'][1] * IRC106_DSV_TO_CAPACITY * 0.5));
    expect(canonBase(om)).toBe(base0);
    history.undo();
    expect(compile(om, P).key).toBe(compile(om, 'base').key);
  });
});

describe('flyover drawn in a proposal', () => {
  it('ramps from grade join the roads at its ends only; it passes over the cross road (grade-separated); speed and capacity are its own', () => {
    const { om, history, editing } = setup();
    om.setActiveScenario(P);
    const base0 = canonBase(om), b0 = ids(om, 'base');
    // Along the east–west road, from x 0 to x 800, over the north–south road at x 400
    draw(editing, 'draw_flyover', [pt(0, 0), pt(800, 0)]);
    const [fid] = newIds(b0, om, P).filter(id => om.getById(id)?.type === 'flyover');
    expect(fid).toBeTruthy();
    const f = om.getById(fid) as FlyoverObject;
    const top = Math.max(...f.coordinates.map(c => c[2]));
    expect(top).toBeGreaterThan(5);
    const { area, net } = compile(om, P);
    const edges = edgesOf(area, fid);
    expect(edges.length).toBeGreaterThan(0);
    const joins = joinsOf(area, fid);
    // not joined to the north–south road it passes over
    expect([...joins].some(r => r === 'ns' || r.startsWith('ns'))).toBe(false);
    // joined to the road at both ends
    const nodes = new Set(edges.flatMap(e => [e.fromNodeId, e.toNodeId]));
    const joinedNodes = [...nodes].filter(n => [...area.network.edges.values()].some(e => e.roadId !== fid && (e.fromNodeId === n || e.toNodeId === n)));
    expect(joinedNodes.length).toBe(2);
    for (const e of edges) expect(e.speedLimit).toBe(f.speedLimit);
    // a two-way divided deck: each direction is one carriageway of a divided road (IRC:106), not a one-way street
    const lanesEach = Math.max(1, Math.ceil(f.laneCount / 2));
    const divided = f.hasDivider && f.dividerWidth > 0;
    for (const l of linksOf(net, fid)) expect(Math.round(l.midblockPcu)).toBe(Math.round(midblockCapacityPcu(f, lanesEach, !divided, divided)));
    // never the one-way-street value it had before (IRC:106 '2-oneway')
    for (const l of linksOf(net, fid)) expect(Math.round(l.midblockPcu)).toBeLessThan(Math.round(midblockCapacityPcu(f, lanesEach, false, false)));
    expect(canonBase(om)).toBe(base0);
    history.undo();
    expect(om.viewOf(P).some(o => o.id === fid)).toBe(false);
    expect(compile(om, P).key).toBe(compile(om, 'base').key);
  });
});

describe('double-deck (road + metro) drawn in a proposal', () => {
  it('its road deck is in the network grade-separated from the cross road; the base is untouched', () => {
    const { om, editing } = setup();
    om.setActiveScenario(P);
    const base0 = canonBase(om), b0 = ids(om, 'base');
    draw(editing, 'draw_metro_flyover', [pt(0, 0), pt(800, 0)]);
    const [did] = newIds(b0, om, P).filter(id => om.getById(id)?.type === 'metro_flyover');
    expect(did).toBeTruthy();
    const { area } = compile(om, P);
    expect(edgesOf(area, did).length).toBeGreaterThan(0);
    expect([...joinsOf(area, did)].some(r => r === 'ns' || r.startsWith('ns'))).toBe(false);
    expect(canonBase(om)).toBe(base0);
  });
});

describe('curved reshape of a drawn road in a proposal', () => {
  it('the network follows the new line (longer, still joined), and undo gives the first network back', () => {
    const { om, history, editing } = setup();
    om.setActiveScenario(P);
    const b0 = ids(om, 'base');
    draw(editing, 'draw_road', [pt(0, 0), pt(0, 300)], P, 'collector');
    const [nid] = newIds(b0, om, P).filter(id => om.getById(id)?.type === 'road');
    const k1 = compile(om, P).key;
    const len1 = edgesOf(compile(om, P).area, nid).reduce((s, e) => s + e.length, 0) / 2;
    const s = defaultAlignmentSettings({ type: 'road', roadClass: 'collector' });
    const n = om.getById(nid) as RoadObject;
    const a0 = n.coordinates[0], a1 = n.coordinates[n.coordinates.length - 1];
    const mid = pt(120, 150);
    const al: HorizontalAlignment = { v: 1, ...s, pis: [{ lon: a0[0], lat: a0[1], radiusM: 0 }, { lon: mid[0], lat: mid[1], radiusM: 80 }, { lon: a1[0], lat: a1[1], radiusM: 0 }] } as HorizontalAlignment;
    const res = commitGeometry(n, al, { objects: om, history, editing, scenarioId: P });
    expect(res.ok).toBe(true);
    const c = compile(om, P);
    expect(c.key).not.toBe(k1);
    const len2 = edgesOf(c.area, nid).reduce((s2, e) => s2 + e.length, 0) / 2;
    expect(len2).toBeGreaterThan(len1 + 20);
    expect([...joinsOf(c.area, nid)]).toEqual(expect.arrayContaining(['north']));
    history.undo();
    expect(compile(om, P).key).toBe(k1);
  });
});

describe('deleting (closing) an existing road in a proposal', () => {
  it('the road is gone from the proposal network only; undo puts it back exactly', () => {
    const { om, history } = setup();
    om.setActiveScenario(P);
    const base0 = canonBase(om);
    const k0 = compile(om, P).key;
    deleteWithHistory(om, history, 'north');
    const c = compile(om, P, 'ns');
    expect(edgesOf(c.area, 'north')).toHaveLength(0);
    expect(c.roads.some(r => r.id === 'north')).toBe(false);
    expect(edgesOf(compile(om, 'base').area, 'north').length).toBeGreaterThan(0);
    expect(canonBase(om)).toBe(base0);
    history.undo();
    expect(compile(om, P).key).toBe(k0);
  });
});

describe('lane edit on an existing road in a proposal', () => {
  it('more lanes → more capacity in the proposal; the base keeps its lanes', () => {
    const { om, history } = setup();
    om.setActiveScenario(P);
    const base0 = canonBase(om);
    const before = linksOf(compile(om, P).net, 'ns').map(l => l.midblockPcu);
    commitRoadFieldEdit(om, history, om.getById('ns') as RoadObject, 'lanesForward', 2, 'segment');
    const after = linksOf(compile(om, P).net, 'ns').map(l => l.midblockPcu);
    expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
    expect(canonBase(om)).toBe(base0);
  });
});

describe('objects that do not carry road traffic', () => {
  it('a metro line, a station, a utility and a tunnel drawn in a proposal leave the traffic network as it was (not modelled)', () => {
    const { om, editing } = setup();
    om.setActiveScenario(P);
    const k0 = compile(om, P).key;
    draw(editing, 'draw_metro', [pt(-300, 150), pt(1100, 150)]);
    draw(editing, 'draw_utility', [pt(-300, 100), pt(1100, 100)]);
    draw(editing, 'draw_underground', [pt(-300, -100), pt(1100, -100)]);
    expect(compile(om, P).key).toBe(k0);
  });
});

describe('design speed set in the shape editor', () => {
  it('caps the simulated free-flow speed of a drawn road (never above what its curves were checked for)', () => {
    const { om, editing } = setup();
    om.setActiveScenario(P);
    const b0 = ids(om, 'base');
    draw(editing, 'draw_road', [pt(0, 0), pt(0, 300)]);
    const [nid] = newIds(b0, om, P).filter(id => om.getById(id)?.type === 'road');
    const n = om.getById(nid) as RoadObject;
    const s = defaultAlignmentSettings({ type: 'road', roadClass: 'arterial' });
    expect(s.designSpeedKmh).toBe(n.speedLimit); // defaults agree: speed limit = design speed (60)
    const a0 = n.coordinates[0], a1 = n.coordinates[n.coordinates.length - 1];
    om.update(nid, { alignment: { v: 1, ...s, designSpeedKmh: 40, designSpeedSource: 'user', pis: [{ lon: a0[0], lat: a0[1], radiusM: 0 }, { lon: a1[0], lat: a1[1], radiusM: 0 }] } as HorizontalAlignment }, true);
    for (const l of linksOf(compile(om, P).net, nid)) expect(l.freeSpeedKmh).toBe(40);
  });
});

describe('Simulate follows the proposal it is shown on (a: study rebuilt, never a stale result reused)', () => {
  // Real OpenStreetMap roads round Sangamwadi Bridge (fixtures/sangamwadi.json): a closed synthetic grid has no traffic
  // crossing its edge, so the area analysis needs a real network here
  it('a build in the proposal outdates the shown analysis; switching to the existing city shows the base result; back to the proposal shows its own', async () => {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sangamwadi.json'), 'utf8')) as { roads: RoadObject[] };
    const DECK = 'osm_208004768', CLOSED = 'osm_661187162';
    const om = new ObjectManager();
    for (const k of ['syncPost', 'syncPostMultiple', 'syncDelete', 'syncDeleteMultiple', 'syncChanges'] as const) if (typeof (om as any)[k] === 'function') vi.spyOn(om as any, k).mockResolvedValue(undefined);
    (om as any).deletedOsm = new Set<string>();
    om.addMultiple(structuredClone(fx.roads), true);
    const history = new HistoryManager(om);
    let sid = P;
    om.setActiveScenario(P);
    // as TwinCityEngine builds Simulate's roads: the active scenario's view, drivable only
    const mode = new SimulationMode(() => filterObjectsForScenario(om.viewOf(sid), sid).filter(isDrivable) as DrivableObject[], null, null, () => ({ buildings: [] }),
      () => Promise.reject(new Error('no counts')), null, null);
    mode.analysisSeeds = [42];
    mode.enter();
    mode.setRange(400);
    mode.selectRoad(DECK, false);
    await mode.runAnalysis();
    const keyBase = mode.getState().analysis.key;
    expect(mode.getState().analysis.error ?? mode.getState().analysis.status).toBe('ready');

    // Close the west approach of the bridge in the proposal (a build: delete an existing road)
    deleteWithHistory(om, history, CLOSED);
    mode.networkChanged();                                   // TwinCityEngine objects.onChange → networkChanged
    await new Promise(r => setTimeout(r, 400));
    expect(mode.getState().analysis.outdated).toBe(true);   // the shown (pre-build) result is flagged, not reused
    await mode.runAnalysis();
    const keyProp = mode.getState().analysis.key;
    expect(keyProp).not.toBe(keyBase);
    expect(mode.getState().analysis.outdated).toBeFalsy();

    sid = 'base'; om.setActiveScenario('base'); mode.networkChanged();   // scenarios.onChange → networkChanged
    await new Promise(r => setTimeout(r, 400));
    expect(om.getById(CLOSED)).toBeTruthy();                // the base still has the road
    expect(mode.getState().analysis.key).toBe(keyBase);     // the kept base result, for the base network
    expect(mode.getState().analysis.outdated).toBeFalsy();
    sid = P; om.setActiveScenario(P); mode.networkChanged();
    await new Promise(r => setTimeout(r, 400));
    expect(mode.getState().analysis.key).toBe(keyProp);
    mode.dispose();
  }, 110000);
});

describe('Underground check stays honest about builds made after it ran (c)', () => {
  it('a flyover drawn in the proposal is screened as proposed; deleting an object after a check marks the check stale', () => {
    expect(screenedAsProposed({ type: 'flyover', scenarioId: P }, P)).toBe(true);
    expect(screenedAsProposed({ type: 'metro_flyover', scenarioId: 'base' }, P)).toBe(false);   // an existing deck: an obstacle
    const at = '2026-11-22T10:00:00Z';
    const objs = [{ updatedAt: '2026-11-22T09:00:00Z' }, { updatedAt: '2026-11-22T09:30:00Z' }];
    expect(isStale(at, objs, 2)).toBe(false);
    expect(isStale(at, objs.slice(0, 1), 2)).toBe(true);    // one deleted since: no newer timestamp, but stale
  });
});
