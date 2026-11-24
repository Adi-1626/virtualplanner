import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject } from '../objects/types';
import { ObjectManager } from '../objects/ObjectManager';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode } from '../simulation/SimulationMode';
import { pickRerouting, compareAnalyses } from '../simulation/ScenarioComparison';

/**
 * A closure proposal deletes the studied road itself (p11 user test, Baba Bhide Bridge): before, Simulate said "The
 * selected road is not part of the active scenario any more" and nothing could be compared. Now the study stays on the
 * closed road, its area is mapped from the roads that joined it, and Compare reports the closure and where the traffic
 * went. Real OSM roads around Sangamwadi Bridge (fixtures/sangamwadi.json).
 */
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sangamwadi.json'), 'utf8')) as { roads: RoadObject[]; signalPoints: [number, number][] };
const DECK = 'osm_208004768';

describe('Simulate: the studied road deleted in the proposal', () => {
  it('keeps the study and its baseline, maps the area from the joining roads, and Compare reports the closure', async () => {
    const om = new ObjectManager();
    om.addMultiple(structuredClone(fx.roads), true);
    const name = om.getById(DECK)!.name;
    const mode = new SimulationMode(() => om.getAll().filter(o => o.type === 'road') as DrivableObject[], null, null, () => ({ buildings: [] }),
      () => Promise.reject(new Error('no counts')), null, null);
    mode.analysisSeeds = [42];
    mode.enter();
    mode.setRange(700);
    mode.selectRoad(DECK, false);
    await mode.runAnalysis();
    const base = await mode.captureBaseline(60);
    expect(base).toBeTruthy();
    const baseArea = new Set(mode.getState().area!.segments.map(x => x.roadId));

    om.delete(DECK, true);
    mode.networkChanged();
    await new Promise(r => setTimeout(r, 400));
    const st = mode.getState();
    expect(st.error).toBeNull();
    expect(st.area).toBeTruthy();
    expect(st.seedRoadIds).toEqual([DECK]);
    expect(st.closedRoads).toEqual([{ id: DECK, name }]);
    expect(st.area!.seedRoadIds).not.toContain(DECK);
    expect(st.area!.seedRoadIds.length).toBeGreaterThan(0);
    expect(st.comparison.staleReason).toBeNull();
    // The same area as the baseline's less the closed road: measured from the whole of the roads that joined it, the
    // area grew by their length and the closure was compared on other roads and trips (Baba Bhide Bridge: 416 more
    // links, Dandekar Bridge beside it lost 638 veh/h)
    // (by road: a road the closed one split in two is one stretch now, under another key)
    const nowArea = new Set(st.area!.segments.map(x => x.roadId));
    expect([...nowArea].filter(k => !baseArea.has(k))).toEqual([]);
    expect([...baseArea].filter(k => !nowArea.has(k))).toEqual([DECK]);

    await mode.runComparison();
    const c = mode.getState().comparison.result!;
    expect(c).toBeTruthy();
    expect(c.section[0]).toMatchObject({ label: 'Traffic through the road', after: 0, change: -1 });
    expect(c.section[2].after).toBeNull();
    expect(c.section.every(d => d.good === null)).toBe(true);
    expect(c.verdict.summary).toContain(`${name} is closed in this proposal`);
    expect(c.laneInsights).toEqual([]);
    // Roads that gain are roads of the proposal (here the bridge's other carriageway, which keeps the name, may be one)
    const proposalNames = new Set(om.getAll().filter(o => o.type === 'road').map(o => o.name));
    for (const w of c.winners) expect(proposalNames.has(w.roadName), w.roadName).toBe(true);
    // Its traffic shows up on other roads
    if (process.env.CLOSED_LOG) console.log(JSON.stringify({ rer: c.rerouting, summary: c.verdict.summary, area: c.area, net: c.network }));
    // Where its traffic went: in this 700 m fixture the bridge is the only crossing, so part of it has no route at all.
    // That is a loss, not "less time driving in the area": the verdict cannot be "better" and the summary says so
    expect(c.rerouting.length).toBeGreaterThan(0);
    const lost = c.area.find(d => d.label === 'Trips that cannot reach their destination')!;
    expect(lost.before).toBe(0);
    expect(lost.after!).toBeGreaterThan(1000);
    expect(lost.good).toBe(false);
    expect(c.verdict.area).not.toBe('better');
    expect(c.verdict.overall).not.toBe('better');
    expect(c.verdict.summary).toMatch(/can no longer reach their destination/);

    // Undo the deletion: the road is studied as usual again
    om.add(structuredClone(fx.roads.find(r => r.id === DECK)!), true);
    mode.networkChanged();
    await new Promise(r => setTimeout(r, 400));
    expect(mode.getState().closedRoads).toEqual([]);
    expect(mode.getState().area!.seedRoadIds).toEqual([DECK]);
    mode.dispose();
  }, 180000);
});

describe('Where traffic moved', () => {
  it('lists where traffic went as well as where it left (Baba Bhide Bridge closure, p11 browser run)', () => {
    const ch = (roadName: string, before: number, after: number) => ({ roadName, before, after, change: after - before, segmentKeys: [], vcBefore: 0, vcAfter: 0 });
    const changes = [ch('Baba Bhide Bridge', 1031, 0), ch('Jagannath Kaniram Kasat Path', 1031, 22), ch('Dandekar Bridge', 3272, 2634), ch('Barrister Nath Pai Chowk', 3946, 3356),
      ch('Guru Nanak Path', 2204, 1632), ch('Narubhau Limaye Path', 1407, 903), ch('Jagtap Road', 0, 575), ch('Ganesh Path', 900, 1433),
      ch('Dagadi Pool Road', 0, 433), ch('Maharshi Vitthal Ramji Shinde Bridge', 1507, 1871), ch('Sambhaji Bridge', 3663, 3978), ch('Dengle Bridge', 1000, 1000)];
    const r = pickRerouting(changes);
    expect(r.map(x => x.roadName)).toEqual(['Baba Bhide Bridge', 'Jagannath Kaniram Kasat Path', 'Dandekar Bridge', 'Barrister Nath Pai Chowk', 'Jagtap Road', 'Ganesh Path', 'Dagadi Pool Road', 'Maharshi Vitthal Ramji Shinde Bridge']);
    // Before: the eight largest changes, two of them gains, none of them another bridge
    expect(r.filter(x => x.change > 0)).toHaveLength(4);
  });
});

describe('Where traffic moved: the closed road', () => {
  it('is marked closed, so its routed figure is not read as a second "traffic through it" (Baba Bhide Bridge −1,031 next to 561 veh/h)', () => {
    const out = (links: [string, number][]) => ({ result: {
      perSeed: [{ seed: 42, sectionVph: 561, sectionTimeS: 60, endDelayS: 10, servedShare: 0.9, completedTrips: 100, meanTravelTimeS: 200, meanDelayS: 50, gridlockRemovals: 0 }], totalVph: 561,
      directions: [{ label: 'north', demandVph: 1000, vph: 561, meanSpeedKmh: 20 }], load: { servedShare: 0.9, overloaded: false },
      network: { completedTrips: 100, meanTravelTimeS: 200, meanDelayS: 50, gridlockRemovals: 0 }, assignment: { totalVehHours: 100, overCapacityLinks: 0, unroutedVph: 0 },
      areaLinkVph: new Map(links), areaVc: new Map(links.map(([k, v]) => [k.replace(/_(fwd|bwd)$/, ''), v / 1000])), areaBottlenecks: [] } }) as any;
    const road = (id: string, name: string) => ({ id, name }) as any;
    const before = new Map([['b1', road('b1', 'Baba Bhide Bridge')], ['d1', road('d1', 'Dandekar Bridge')]]);
    const after = new Map([['d1', road('d1', 'Dandekar Bridge')]]);
    const c = compareAnalyses(out([['b1_seg_1_fwd', 1031], ['d1_seg_1_fwd', 2000]]), out([['d1_seg_1_fwd', 2600]]), { before, after }, { before: 1000, after: 1000 }, undefined, undefined, { closedRoadNames: ['Baba Bhide Bridge'] });
    expect(c.rerouting.find(x => x.roadName === 'Baba Bhide Bridge')).toMatchObject({ change: -1031, closed: true });
    expect(c.rerouting.find(x => x.roadName === 'Dandekar Bridge')!.closed).toBeUndefined();
  });
});
