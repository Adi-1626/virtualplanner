// Drawing constraints for line tools (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §2.3, §4.1) + the EditingEngine drawing flow.
import { describe, expect, it } from 'vitest';
import {
  angleDiff, applyTypedKey, autoRadiusM, bearingDeg, buildDrawAlignment, deflectionDeg, densifyWithZ, destination, distanceM,
  drawAlignmentSettings, emptyTypedInput, guideFromRoadEnd, isNearDuplicate, pxToMetres, resolveCursor, snapBearingAbsolute,
  snapBearingRelative, snapRadiiDeg, typedValues, SNAP_MAX_M, SNAP_MIN_M, type Pt3, type TypedInput,
} from '../editing/drawConstraints';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import { touchingRoadHeight } from '../editing/autoConnect';
import type { RoadObject, UndergroundAlignmentObject } from '../objects/types';
import { editableOf } from '../editing/AlignmentEditor';

const O: Pt3 = [73.85, 18.5, 0];
const at = (b: number, m: number, from: Pt3 = O) => destination(from, b, m);
const typed = (over: Partial<TypedInput> = {}): TypedInput => ({ ...emptyTypedInput(), ...over });
const base = { networkSnapped: false, angleSnap: 'none' as const, typed: typed(), guide: null, metresPerPixel: 1 };

describe('bearing helpers', () => {
  it('destination / bearing / distance round-trip', () => {
    for (const b of [0, 37, 90, 181, 300]) {
      const p = at(b, 250);
      expect(distanceM(O, p)).toBeCloseTo(250, 3);
      expect(Math.abs(angleDiff(bearingDeg(O, p), b))).toBeLessThan(1e-6);
    }
  });
  it('deflection is signed + left', () => {
    const b = at(0, 100), cl = at(270, 100, b), cr = at(90, 100, b);
    expect(deflectionDeg(O, b, cl)).toBeCloseTo(90, 4);
    expect(deflectionDeg(O, b, cr)).toBeCloseTo(-90, 4);
  });
});

describe('angle snap', () => {
  it('absolute 15° steps include 0, 45, 90 and wrap at 360', () => {
    expect(snapBearingAbsolute(7)).toBe(0);
    expect(snapBearingAbsolute(8)).toBe(15);
    expect(snapBearingAbsolute(44)).toBe(45);
    expect(snapBearingAbsolute(91)).toBe(90);
    expect(snapBearingAbsolute(355)).toBe(0);
  });
  it('relative snaps the deflection from the previous bearing (0 = straight on)', () => {
    expect(snapBearingRelative(33, 30)).toBe(30);
    expect(snapBearingRelative(50, 30)).toBe(45);
    expect(snapBearingRelative(10, 350)).toBe(5);
  });
  it('Shift: the resolved point keeps the cursor distance on a 15° bearing', () => {
    const cursor = at(52, 120);
    const r = resolveCursor({ ...base, points: [O], cursor, angleSnap: 'absolute' });
    expect(r.constraint).toBe('angle-absolute');
    expect(r.bearingDeg!).toBeCloseTo(45, 6);
    expect(r.lengthM!).toBeCloseTo(120, 3);
  });
  it('Alt+Shift: relative to the previous segment', () => {
    const p1 = at(20, 200);
    const cursor = at(20 + 33, 100, p1);
    const r = resolveCursor({ ...base, points: [O, p1], cursor, angleSnap: 'relative' });
    expect(r.constraint).toBe('angle-relative');
    expect(angleDiff(r.bearingDeg!, 20)).toBeCloseTo(30, 4);
    expect(r.deflectionDeg!).toBeCloseTo(-30, 4); // turned right (clockwise)
  });
  it('a network snap wins over the angle snap', () => {
    const cursor = at(52, 120);
    const r = resolveCursor({ ...base, points: [O], cursor, networkSnapped: true, angleSnap: 'absolute' });
    expect(r.constraint).toBe('network');
    expect(r.point).toEqual(cursor);
  });
});

describe('typed input', () => {
  it('digits set the length; Tab switches to bearing and keeps the length; R starts a radius', () => {
    let t = emptyTypedInput();
    for (const k of ['1', '2', '5']) t = applyTypedKey(t, k)!;
    expect(typedValues(t).lengthM).toBe(125);
    t = applyTypedKey(t, 'Tab')!;
    expect(t.field).toBe('bearing');
    for (const k of ['9', '0']) t = applyTypedKey(t, k)!;
    expect(typedValues(t)).toMatchObject({ lengthM: 125, bearingDeg: 90 });
    expect(applyTypedKey(t, 'x')).toBeNull();
    t = applyTypedKey(t, 'R')!;
    t = applyTypedKey(t, '3')!; t = applyTypedKey(t, '0')!;
    expect(typedValues(t).radiusM).toBe(30);
  });
  it('a typed length places the point on the cursor bearing; a typed bearing fixes the direction', () => {
    const r = resolveCursor({ ...base, points: [O], cursor: at(70, 33), typed: typed({ text: '200' }) });
    expect(r.constraint).toBe('typed');
    expect(r.lengthM!).toBeCloseTo(200, 3);
    expect(r.bearingDeg!).toBeCloseTo(70, 4);
    const r2 = resolveCursor({ ...base, points: [O], cursor: at(70, 33), typed: typed({ field: 'bearing', lengthM: 150, text: '90' }) });
    expect(r2.bearingDeg!).toBeCloseTo(90, 4);
    expect(r2.lengthM!).toBeCloseTo(150, 3);
  });
});

describe('tangent guide and pixel tolerances', () => {
  it('the guide continues a road end; a point within 8 px lands exactly on it', () => {
    const road: Pt3[] = [at(180, 300), O]; // road heading north, ending at O
    const g = guideFromRoadEnd(road, false, 'r1')!;
    expect(g.bearingDeg).toBeCloseTo(0, 4);
    const near = at(3, 100); // ~5 m off the ray at 100 m
    const r = resolveCursor({ ...base, points: [O], cursor: near, guide: g, metresPerPixel: 1 });
    expect(r.constraint).toBe('guide');
    expect(r.bearingDeg!).toBeCloseTo(0, 4);
    const far = resolveCursor({ ...base, points: [O], cursor: at(20, 100), guide: g, metresPerPixel: 1 });
    expect(far.constraint).toBe('none');
    // the start of a road: the guide goes against its first segment
    expect(guideFromRoadEnd([O, at(0, 300)], true, 'r1')!.bearingDeg).toBeCloseTo(180, 4);
  });
  it('snap tolerance scales with zoom, bounded', () => {
    expect(pxToMetres(10, 0.5)).toBe(5);
    expect(pxToMetres(10, 0.001)).toBe(SNAP_MIN_M);
    expect(pxToMetres(10, 100)).toBe(SNAP_MAX_M);
    const close = snapRadiiDeg(0.2), far = snapRadiiDeg(3);
    expect(far.vertexDeg).toBeGreaterThan(close.vertexDeg * 10);
    expect(close.edgeDeg).toBeLessThan(close.vertexDeg);
  });
  it('a near-duplicate click is within a few pixels, so it depends on zoom', () => {
    expect(isNearDuplicate(O, at(0, 1.5), 0.5)).toBe(true);
    expect(isNearDuplicate(O, at(0, 1.5), 0.1)).toBe(false);
  });
});

describe('the alignment being drawn', () => {
  it('auto radius = the minimum for the design speed (local road 30 km/h, 4 %); utilities are angled', () => {
    const road = drawAlignmentSettings({ mode: 'draw_road', roadClass: 'local' })!;
    expect(road.behaviour).toBe('curved');
    expect(autoRadiusM(road)).toBeGreaterThan(0);
    const util = drawAlignmentSettings({ mode: 'draw_utility' })!;
    expect(util.behaviour).toBe('angled');
    expect(autoRadiusM(util)).toBe(0);
    expect(drawAlignmentSettings({ mode: 'draw_building' })).toBeNull();
    const metro = drawAlignmentSettings({ mode: 'draw_underground', undergroundKind: 'bored_tunnel' })!;
    expect(autoRadiusM(metro, { tbm: true })).toBe(200);
  });
  it('interior PIs get the auto radius, a sharp (0) or typed radius is kept; ends are 0', () => {
    const s = drawAlignmentSettings({ mode: 'draw_road', roadClass: 'arterial' })!;
    const pts = [O, at(0, 500), at(90, 500, at(0, 500)), at(0, 500, at(90, 500, at(0, 500)))];
    const a = buildDrawAlignment(pts, [null, null, 0, null], s);
    expect(a.pis.map(p => p.radiusM)).toEqual([0, autoRadiusM(s), 0, 0]);
    expect(a.pis[1].radiusSource).toBe('auto');
    const b = buildDrawAlignment(pts, [null, 120, null, null], s);
    expect(b.pis[1]).toMatchObject({ radiusM: 120, radiusSource: 'user' });
  });
  it('densified preview curves the corner and keeps the end points exactly', () => {
    const s = drawAlignmentSettings({ mode: 'draw_road', roadClass: 'local' })!;
    const p1 = at(0, 300), p2 = at(90, 300, p1);
    const pts: Pt3[] = [[O[0], O[1], 1], p1, [p2[0], p2[1], 3]];
    const d = densifyWithZ(buildDrawAlignment(pts, [null, null, null], s), pts)!;
    expect(d.coordinates.length).toBeGreaterThan(5);
    expect(d.coordinates[0]).toEqual([O[0], O[1], 1]);
    expect(d.coordinates[d.coordinates.length - 1]).toEqual([p2[0], p2[1], 3]);
    // the corner itself is cut by the curve
    expect(Math.min(...d.coordinates.map(c => distanceM(c, p1)))).toBeGreaterThan(1);
  });
});

describe('EditingEngine line drawing', () => {
  const setup = () => {
    const om = new ObjectManager();
    const history = new HistoryManager(om);
    const editing = new EditingEngine(om, history);
    return { om, history, editing };
  };

  it('finishing stores the alignment (PIs + radii) and a densified coordinates line', () => {
    const { om, editing } = setup();
    editing.setMode('draw_road');
    const p1 = at(0, 300), p2 = at(90, 300, p1);
    editing.addDrawingPoint(O);
    editing.addDrawingPoint(p1);
    editing.addDrawingPoint(p2);
    editing.finalizeDrawing('base');
    const road = om.getAll().find(o => o.type === 'road') as RoadObject;
    expect(road.alignment?.pis).toHaveLength(3);
    expect(road.alignment!.pis[1].radiusM).toBeGreaterThan(0);
    expect(road.coordinates.length).toBeGreaterThan(3);
    expect(road.coordinates[0][0]).toBeCloseTo(O[0], 9);
  });

  it('a newly drawn tunnel stores typed depth controls at its PIs (not only derived ones)', () => {
    const { om, editing } = setup();
    editing.setMode('draw_underground');
    const p1 = at(0, 400), p2 = at(90, 400, p1);
    editing.addDrawingPoint(O);
    editing.addDrawingPoint(p1);
    editing.addDrawingPoint(p2);
    editing.finalizeDrawing('base');
    const t = om.getAll().find(o => o.type === 'underground_alignment') as UndergroundAlignmentObject;
    expect(t.alignment?.pis).toHaveLength(3);
    expect(t.depthControls).toHaveLength(3);
    for (const c of t.depthControls!) {
      expect(c.crownDepthM).toBe(15); // DRAWING_DEFAULTS.bored_tunnel, hypothetical
      expect(c.certainty).toBe('hypothetical');
      expect((c as { derived?: boolean }).derived).toBeUndefined();
    }
    // per-vertex depths are derived from the controls along the densified line
    expect(t.depths).toHaveLength(t.coordinates.length);
    expect(t.depths!.every(d => d.crownDepthM === 15)).toBe(true);
    // the shape editor takes them as stored
    const ed = editableOf(t);
    expect(ed.kind === 'editable' && ed.state.depthControls).toEqual(t.depthControls);
  });

  it('Ctrl+click gives a sharp corner: coordinates are the clicked points', () => {
    const { om, editing } = setup();
    editing.setMode('draw_road');
    const p1 = at(0, 300), p2 = at(90, 300, p1);
    editing.addDrawingPoint(O);
    editing.addDrawingPoint(p1, { sharp: true });
    editing.addDrawingPoint(p2);
    editing.finalizeDrawing('base');
    const road = om.getAll().find(o => o.type === 'road') as RoadObject;
    expect(road.alignment!.pis[1].radiusM).toBe(0);
    expect(road.coordinates).toHaveLength(3);
  });

  it('Backspace / Ctrl+Z remove the last point without touching the global history', () => {
    const { history, editing } = setup();
    editing.setMode('draw_road');
    editing.addDrawingPoint(O);
    editing.addDrawingPoint(at(0, 100));
    expect(editing.removeLastDrawingPoint()).toBe(true);
    expect(editing.getDrawingPoints()).toHaveLength(1);
    expect(history.canUndo()).toBe(false);
  });

  it('double-click: the near-duplicate second click is ignored and the road is added', () => {
    const { om, editing } = setup();
    editing.setMode('draw_road');
    editing.setMetresPerPixel(0.5);
    editing.addDrawingPoint(O);
    const p1 = at(45, 200);
    editing.addDrawingPoint(p1);
    editing.addDrawingPoint(at(10, 0.8, p1)); // second click of the double-click, a pixel or two away
    expect(editing.getDrawingPoints()).toHaveLength(2);
    editing.finalizeDrawing('base');
    expect(om.getAll().filter(o => o.type === 'road')).toHaveLength(1);
  });

  it('typed length + Enter places the next point; R + number sets the radius at the last point', () => {
    const { editing } = setup();
    editing.setMode('draw_road');
    editing.addDrawingPoint(O);
    editing.resolveDrawCursor(at(30, 50), null);
    for (const k of ['2', '0', '0']) editing.typeKey(k);
    expect(editing.commitTypedInput()).toBe(true);
    const pts = editing.getDrawingPoints();
    expect(pts).toHaveLength(2);
    expect(distanceM(O, pts[1])).toBeCloseTo(200, 2);
    editing.typeKey('R'); editing.typeKey('8'); editing.typeKey('0');
    editing.commitTypedInput();
    expect(editing.getDrawingRadii()[1]).toBe(80);
  });

  // Regression (merge of design-geometry, 2026-11-22): the click picks the ground (z 0) on a ramp vertex 2.9 m up. The
  // level-aware snap (2.5 m) misses it and, with the pixel snap radii, so does the next ramp vertex; the network builder
  // still joins the end (3 m). The end must take the ramp's height, and the line rise to it smoothly.
  it('an end clicked on the ground on a ramp vertex 2.5-3 m up takes the ramp height', () => {
    const { om, editing } = setup();
    const R = (id: string, coords: Pt3[]): RoadObject => ({
      id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: coords, roadClass: 'local', width: 10,
      laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0, speedLimit: 40,
      isOneWay: false, trafficCapacity: 1000, connectedJunctions: [], createdAt: 't', updatedAt: 't',
    });
    const end = at(90, 200);
    // A ramp through `end` at 2.9 m, rising north, its other vertices 40 m away (beyond any vertex snap)
    om.add(R('ramp', [[...at(180, 40, end).slice(0, 2), 0] as Pt3, [end[0], end[1], 2.9], [...at(0, 40, end).slice(0, 2), 5.8] as Pt3]), true);
    editing.setMode('draw_road');
    editing.setMetresPerPixel(0.5);
    editing.addDrawingPoint(O);
    editing.addDrawingPoint(end);
    expect(editing.getDrawingPoints()[1][2]).toBe(0); // no snap: the click is 2.9 m below the ramp
    editing.finalizeDrawing('base');
    const road = om.getAll().find(o => o.type === 'road' && o.id !== 'ramp') as RoadObject;
    const c = road.coordinates;
    expect(c[0][2]).toBe(0);
    expect(distanceM(c[c.length - 1], end)).toBeLessThan(0.01);
    expect(c[c.length - 1][2]).toBeCloseTo(2.9, 9);
    // Heights rise steadily to the end (interpolated from the end PIs, no jump on the last step)
    for (let i = 1; i < c.length; i++) expect(c[i][2]).toBeGreaterThanOrEqual(c[i - 1][2] - 1e-9);
    if (c.length > 2) expect(c[c.length - 2][2]).toBeGreaterThan(0);
  });

  it('touchingRoadHeight: the touching road closest in height wins; a road more than 3 m away in height is not joined', () => {
    const p: Pt3 = [O[0], O[1], 0];
    const line = (z: number) => ({ id: `z${z}`, coordinates: [[...at(180, 20).slice(0, 2), z], [...at(0, 20).slice(0, 2), z]] });
    expect(touchingRoadHeight(p, [line(2.9)])).toBeCloseTo(2.9, 9);
    expect(touchingRoadHeight(p, [line(2.9), line(0.2)])).toBeCloseTo(0.2, 9);
    expect(touchingRoadHeight(p, [line(3.5)])).toBeNull();
    expect(touchingRoadHeight(at(90, 5), [line(2.9)])).toBeNull();
  });

  it('utility drawing stores an angled alignment and keeps the clicked points', () => {
    const { om, editing } = setup();
    editing.setMode('draw_utility');
    const p1 = at(0, 100), p2 = at(90, 100, p1);
    editing.addDrawingPoint(O); editing.addDrawingPoint(p1); editing.addDrawingPoint(p2);
    editing.finalizeDrawing('base');
    const u = om.getAll().find(o => o.type === 'utility') as any;
    expect(u.alignment.behaviour).toBe('angled');
    expect(u.coordinates).toHaveLength(3);
  });
});
