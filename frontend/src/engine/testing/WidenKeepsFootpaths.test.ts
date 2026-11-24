import { describe, it, expect } from 'vitest';
import { roadFieldUpdates } from '../editing/roadEdits';

/**
 * Widening keeps the footpaths the road has (p11 user test, S3 Sinhagad Road 3 → 4 lanes): the one-way carriageway
 * osm_199637816 has a 1.5 m footpath on its left only (cross-section 1.5 + 10.5 m). The lane edit rebuilt both
 * roadsides from the top-level hasFootpath flag and gave it a new right footpath: 1.5 + 14 + 1.5 m.
 */
const side = (fp: number) => ({ footpathWidth: fp, cycleTrackWidth: 0, vergeWidth: 0, parkingWidth: 0, drainageWidth: 0 });
const sinhagad = () => ({ id: 'osm_199637816', type: 'road', name: 'Sinhagad Road', isOneWay: true, laneCount: 3, laneWidth: 3.5, width: 12,
  hasFootpath: true, footpathWidth: 1.5, hasDivider: false, dividerWidth: 0, coordinates: [[73.8433, 18.4994, 0], [73.8284, 18.4863, 0]],
  sections: [{ startNodeIndex: 0, endNodeIndex: 1, totalRowWidth: 13.5, wideningPossible: true, hasMedian: false, medianWidth: 0,
    carriagewayA: { direction: 'forward', lanes: 3, laneWidth: 3.5, leftRoadside: side(1.5), rightRoadside: side(0) }, reservedSpaces: [] }] }) as any;
const twoWay = () => ({ ...sinhagad(), id: 'r2', isOneWay: false, laneCount: 2, width: 8.5,
  sections: [{ ...sinhagad().sections[0], carriagewayA: { direction: 'both', lanes: 1, laneWidth: 3.5, leftRoadside: side(1.5), rightRoadside: side(0) },
    carriagewayB: { direction: 'backward', lanes: 1, laneWidth: 3.5, leftRoadside: side(0), rightRoadside: side(0) } }] }) as any;

describe('a lane edit keeps the existing footpaths only', () => {
  it('one-way, footpath on the left only: 3 → 4 lanes is 1.5 + 14 m, no new right footpath', () => {
    const u = roadFieldUpdates(sinhagad(), 'lanesForward', 4, () => []) as any;
    const a = u.sections[0].carriagewayA;
    expect(a.lanes).toBe(4);
    expect(a.leftRoadside.footpathWidth).toBe(1.5);
    expect(a.rightRoadside.footpathWidth).toBe(0);
    expect(u.width).toBe(15.5);
    expect(u.laneCount).toBe(4);
  });

  it('two-way with a footpath on one side: adding a lane each way keeps one footpath', () => {
    let r = twoWay();
    r = { ...r, ...roadFieldUpdates(r, 'lanesForward', 2, () => []) };
    r = { ...r, ...roadFieldUpdates(r, 'lanesBackward', 2, () => []) };
    const s = r.sections[0];
    expect([s.carriagewayA.leftRoadside.footpathWidth, s.carriagewayA.rightRoadside.footpathWidth, s.carriagewayB.rightRoadside.footpathWidth]).toEqual([1.5, 0, 0]);
    expect(r.width).toBe(15.5);
  });

  it('lane width, divider and direction edits keep them too; a two-way road made one-way keeps its outer footpath', () => {
    const lw = roadFieldUpdates(sinhagad(), 'laneWidth', 3.25, () => []) as any;
    expect([lw.sections[0].carriagewayA.leftRoadside.footpathWidth, lw.sections[0].carriagewayA.rightRoadside.footpathWidth]).toEqual([1.5, 0]);
    const both = { ...twoWay(), sections: [{ ...twoWay().sections[0], carriagewayB: { ...twoWay().sections[0].carriagewayB, rightRoadside: side(2) } }] };
    const ow = roadFieldUpdates(both, 'isOneWay', true, () => []) as any;
    expect([ow.sections[0].carriagewayA.leftRoadside.footpathWidth, ow.sections[0].carriagewayA.rightRoadside.footpathWidth]).toEqual([1.5, 2]);
    const back = roadFieldUpdates(sinhagad(), 'isOneWay', false, () => []) as any;
    expect([back.sections[0].carriagewayA.leftRoadside.footpathWidth, back.sections[0].carriagewayB.rightRoadside.footpathWidth]).toEqual([1.5, 0]);
  });

  it('a footpath edit still changes them: off clears both, on adds the missing side, width applies to the sides that have one', () => {
    const off = roadFieldUpdates(sinhagad(), 'hasFootpath', false, () => []) as any;
    expect([off.sections[0].carriagewayA.leftRoadside.footpathWidth, off.sections[0].carriagewayA.rightRoadside.footpathWidth]).toEqual([0, 0]);
    const on = roadFieldUpdates({ ...sinhagad(), hasFootpath: false }, 'hasFootpath', true, () => []) as any;
    expect([on.sections[0].carriagewayA.leftRoadside.footpathWidth, on.sections[0].carriagewayA.rightRoadside.footpathWidth]).toEqual([1.5, 1.5]);
    const w = roadFieldUpdates(sinhagad(), 'footpathWidth', 2.5, () => []) as any;
    expect([w.sections[0].carriagewayA.leftRoadside.footpathWidth, w.sections[0].carriagewayA.rightRoadside.footpathWidth]).toEqual([2.5, 0]);
  });
});
