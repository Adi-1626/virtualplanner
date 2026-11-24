import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { RoadObject } from '../objects/types';
import { ObjectManager } from '../objects/ObjectManager';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode } from '../simulation/SimulationMode';

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

    await mode.runComparison();
    const c = mode.getState().comparison.result!;
    expect(c).toBeTruthy();
    expect(c.section[0]).toMatchObject({ label: 'Traffic through the road', after: 0, change: -1 });
    expect(c.section[2].after).toBeNull();
    expect(c.section.every(d => d.good === null)).toBe(true);
    expect(c.verdict.summary).toContain(`${name} is closed in this proposal`);
    expect(c.laneInsights).toEqual([]);
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
