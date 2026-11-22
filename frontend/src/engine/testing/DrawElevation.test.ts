/**
 * Elevation while drawing (PLANNING_DEFAULTS_DECISIONS.md D10 item 7, GEOMETRY_EDITOR_DESIGN.md §4.1): PageUp / PageDown
 * raise or lower the next road point (0.5 / 1 m steps) or the flyover deck height; the readout shows the height and the
 * grade, and a grade over the D5 limit (4 % urban / 3.3 % highway) is flagged as screening.
 */
import { describe, expect, it } from 'vitest';
import {
  deckVerticalReadout, destination, roadVerticalReadout, steppedHeight, DRAW_HEIGHT_FINE_STEP_M, DRAW_HEIGHT_STEP_M, type Pt3,
} from '../editing/drawConstraints';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import type { FlyoverObject, MetroFlyoverObject, RoadObject } from '../objects/types';

const O: Pt3 = [73.85, 18.5, 0];
const at = (b: number, m: number, from: Pt3 = O) => destination(from, b, m);

const setup = () => {
  const om = new ObjectManager();
  const history = new HistoryManager(om);
  const editing = new EditingEngine(om, history);
  return { om, history, editing };
};

describe('pure helpers', () => {
  it('steps snap to 0.5 m and stay in range', () => {
    expect(steppedHeight(0, DRAW_HEIGHT_STEP_M, 0, 30)).toBe(1);
    expect(steppedHeight(1, DRAW_HEIGHT_FINE_STEP_M, 0, 30)).toBe(1.5);
    expect(steppedHeight(0.3, -DRAW_HEIGHT_STEP_M, 0, 30)).toBe(0);
    expect(steppedHeight(29.5, 1, 0, 30)).toBe(30);
  });

  it('road: height and signed grade to the cursor; over 4 % (urban) is flagged, 3.3 % on a highway', () => {
    const p1: Pt3 = [...at(0, 100)] as Pt3;
    const up3: Pt3 = [p1[0], p1[1], 3];
    let r = roadVerticalReadout([O], up3, 'arterial');
    expect(r.heightM).toBe(3);
    expect(r.gradePct).toBeCloseTo(3, 6);
    expect(r.limitPct).toBe(4);
    expect(r.source).toContain('IRC:SP:90-2023 §4.13');
    expect(r.over).toBe(false);
    r = roadVerticalReadout([O], [p1[0], p1[1], 5], 'arterial');
    expect(r.over).toBe(true);
    r = roadVerticalReadout([O], up3, 'highway');
    expect(r.limitPct).toBeCloseTo(3.3, 9);
    expect(r.over).toBe(false);
    r = roadVerticalReadout([O], [p1[0], p1[1], 3.5], 'highway');
    expect(r.over).toBe(true);
    // downhill is signed, judged on its size
    r = roadVerticalReadout([[O[0], O[1], 6]], [p1[0], p1[1], 0], 'local');
    expect(r.gradePct).toBeCloseTo(-6, 6);
    expect(r.over).toBe(true);
  });

  it('road: a steep segment already placed stays flagged', () => {
    const p1 = at(0, 50), p2 = at(0, 100, p1);
    const r = roadVerticalReadout([O, [p1[0], p1[1], 4]], [p2[0], p2[1], 4], 'local');
    expect(r.gradePct).toBeCloseTo(0, 6);
    expect(r.steepestPlacedPct).toBeCloseTo(8, 6);
    expect(r.over).toBe(true);
  });

  it('deck: ramp needed per end and the modelled grade on the line so far (same profile as the 3D model)', () => {
    const short = deckVerticalReadout(6, 200, 'arterial', 60);
    expect(short.rampNeededM).toBeCloseTo(190, 6);
    expect(short.over).toBe(true);
    expect(short.gradePct!).toBeGreaterThan(4);
    const long = deckVerticalReadout(6, 500, 'arterial', 60);
    expect(long.over).toBe(false);
    expect(long.gradePct!).toBeCloseTo(4, 6);
  });
});

describe('EditingEngine: PageUp / PageDown while drawing', () => {
  it('road: the next points are raised; the stored road keeps those heights; a new road starts on the ground again', () => {
    const { om, editing } = setup();
    editing.setMode('draw_road');
    editing.addDrawingPoint(O);
    expect(editing.stepDrawHeight(DRAW_HEIGHT_STEP_M)).toEqual({ kind: 'road', heightM: 1 });
    editing.stepDrawHeight(DRAW_HEIGHT_STEP_M);
    editing.stepDrawHeight(DRAW_HEIGHT_FINE_STEP_M);
    const p1 = at(0, 100);
    editing.resolveDrawCursor(p1);
    const ro = editing.getDrawReadout()!;
    expect(ro.vertical!.kind).toBe('road');
    expect(ro.vertical!.heightM).toBe(2.5);
    expect(ro.vertical!.gradePct).toBeCloseTo(2.5, 3);
    expect(ro.vertical!.over).toBe(false);
    editing.addDrawingPoint(p1);
    expect(editing.getDrawingPoints()[1][2]).toBe(2.5);
    const p2 = at(0, 100, p1);
    editing.addDrawingPoint(p2);
    editing.finalizeDrawing('base');
    const road = om.getAll().find(o => o.type === 'road') as RoadObject;
    expect(road.coordinates[0][2]).toBe(0);
    expect(road.coordinates.at(-1)![2]).toBe(2.5);
    expect(editing.drawHeightM).toBe(0);
  });

  it('road: a grade over the limit shows in the readout as a screening flag', () => {
    const { editing } = setup();
    editing.setMode('draw_road');
    editing.roadClass = 'arterial';
    editing.addDrawingPoint(O);
    for (let i = 0; i < 6; i++) editing.stepDrawHeight(DRAW_HEIGHT_STEP_M);
    editing.resolveDrawCursor(at(0, 100));
    const v = editing.getDrawReadout()!.vertical!;
    expect(v.heightM).toBe(6);
    expect(v.gradePct).toBeCloseTo(6, 3);
    expect(v.over).toBe(true);
  });

  it('road: never below the ground', () => {
    const { editing } = setup();
    editing.setMode('draw_road');
    expect(editing.stepDrawHeight(-DRAW_HEIGHT_STEP_M)!.heightM).toBe(0);
  });

  it('flyover: PageUp sets the deck height of the new flyover, and its ramps follow from it', () => {
    const { om, editing } = setup();
    editing.setMode('draw_flyover');
    editing.roadClass = 'arterial';
    expect(editing.stepDrawHeight(DRAW_HEIGHT_STEP_M)).toEqual({ kind: 'deck', heightM: 7 });
    editing.addDrawingPoint(O);
    editing.resolveDrawCursor(at(0, 600));
    const v = editing.getDrawReadout()!.vertical!;
    expect(v.kind).toBe('deck');
    expect(v.heightM).toBe(7);
    expect(v.rampNeededM).toBeCloseTo(7 / 0.04 + 40, 6);
    expect(v.over).toBe(false);
    editing.addDrawingPoint(at(0, 600));
    editing.finalizeDrawing('base');
    const f = om.getAll().find(o => o.type === 'flyover') as FlyoverObject;
    expect(f.elevation).toBe(7);
    expect(f.rampProfile!.rampLengthM).toBeCloseTo(7 / 0.04 + 40, 6);
    expect(Math.max(...f.coordinates.map(c => c[2]))).toBeCloseTo(7, 6);
  });

  it('double-deck: the metro deck stays at least 6 m above the road deck', () => {
    const { om, editing } = setup();
    editing.setMode('draw_metro_flyover');
    for (let i = 0; i < 4; i++) editing.stepDrawHeight(DRAW_HEIGHT_STEP_M);
    editing.addDrawingPoint(O);
    editing.addDrawingPoint(at(0, 700));
    editing.finalizeDrawing('base');
    const m = om.getAll().find(o => o.type === 'metro_flyover') as MetroFlyoverObject;
    expect(m.elevation).toBe(10);
    expect(m.metroElevation).toBe(16);
  });

  it('other tools have no drawing height', () => {
    const { editing } = setup();
    editing.setMode('draw_metro');
    expect(editing.drawHeightKind()).toBeNull();
    expect(editing.stepDrawHeight(1)).toBeNull();
    editing.setMode('draw_underground');
    expect(editing.stepDrawHeight(1)).toBeNull();
  });
});
