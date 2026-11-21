// Shape editor after drawing (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §4.2, phase 2 agent C).
import { describe, expect, it } from 'vitest';
import {
  AlignmentEditSession, commitGeometry, regenerateLocal, deletePI, editableOf, handlesFor, insertPI, makeCurve, makeSharp, movePI, radiusFromDrag,
  setRadius, summarise, type EditState,
} from '../editing/AlignmentEditor';
import { destination, type Pt3 } from '../editing/drawConstraints';
import { densifyAlignment, filletAlignment } from '../geometry/alignment/index';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import type { CityObject, RoadObject } from '../objects/types';

const O: Pt3 = [73.85, 18.5, 0];
const at = (b: number, m: number, from: Pt3 = O) => destination(from, b, m);

function setup() {
  const om = new ObjectManager();
  const history = new HistoryManager(om);
  const editing = new EditingEngine(om, history);
  const session = new AlignmentEditSession({
    getObject: id => om.getById(id),
    commit: (obj, a) => commitGeometry(obj, a, { objects: { getById: id => om.getById(id), update: (id, u) => om.update(id, u, true) }, history, editing, scenarioId: 'base' }),
  });
  return { om, history, editing, session };
}

function drawRoad(editing: EditingEngine, om: ObjectManager, pts: Pt3[], sharp = false): RoadObject {
  editing.setMode('draw_road');
  pts.forEach((p, i) => editing.addDrawingPoint(p, { sharp: sharp && i > 0 && i < pts.length - 1 }));
  editing.finalizeDrawing('base');
  return om.getAll().filter(o => o.type === 'road').pop() as RoadObject;
}

const P1 = at(0, 300), P2 = at(90, 300, P1);

describe('pure edit operations', () => {
  const s0 = (): EditState => {
    const { editing, om } = setup();
    const r = drawRoad(editing, om, [O, P1, P2]);
    return { alignment: structuredClone(r.alignment!) };
  };

  it('move / insert / delete keep radii and ends at 0', () => {
    const s = s0();
    const m = movePI(s, 1, P1[0] + 0.0005, P1[1])!;
    expect(m.alignment.pis[1].radiusM).toBe(s.alignment.pis[1].radiusM);
    const ins = insertPI(s, 0, (O[0] + P1[0]) / 2 + 0.0003, (O[1] + P1[1]) / 2, { autoCurve: true })!;
    expect(ins.alignment.pis).toHaveLength(4);
    expect(ins.alignment.pis[1].radiusSource).toBe('auto');
    const insSharp = insertPI(s, 0, (O[0] + P1[0]) / 2 + 0.0003, (O[1] + P1[1]) / 2, { autoCurve: false })!;
    expect(insSharp.alignment.pis[1].radiusM).toBe(0);
    const del = deletePI(ins, 1)!;
    expect(del.alignment.pis).toHaveLength(3);
    expect(deletePI(deletePI(del, 1)!, 0)).toBeNull(); // never fewer than 2 PIs
  });

  it('sharp / curve / typed radius; ends refuse a radius', () => {
    const s = s0();
    expect(makeSharp(s, 1)!.alignment.pis[1].radiusM).toBe(0);
    const c = makeCurve(makeSharp(s, 1)!, 1)!;
    expect(c.alignment.pis[1].radiusM).toBeGreaterThan(0);
    expect(c.alignment.pis[1].radiusSource).toBe('auto');
    expect(setRadius(s, 1, 123.4)!.alignment.pis[1]).toMatchObject({ radiusM: 123.4, radiusSource: 'user' });
    expect(setRadius(s, 0, 50)).toBeNull();
    expect(setRadius(s, 1, -1)).toBeNull();
  });

  it('radius grip: dragging to the arc midpoint reproduces the radius; Shift snaps to 5 m', () => {
    const s = setRadius(s0(), 1, 120)!;
    const h = handlesFor(s.alignment).find(x => x.kind === 'radius')!;
    expect(h).toBeTruthy();
    expect(radiusFromDrag(s.alignment, 1, h.lon, h.lat)!).toBeCloseTo(120, 0);
    expect(radiusFromDrag(s.alignment, 1, h.lon, h.lat, true)! % 5).toBe(0);
    // Dragging past what fits is clamped to the fit rule
    const far = radiusFromDrag(s.alignment, 1, O[0], O[1])!;
    expect(far).toBeLessThanOrEqual(300.01);
  });

  it('handles: one per PI, one midpoint per tangent, a radius grip per curve, ⚠ on a warned curve', () => {
    const s = setRadius(s0(), 1, 10)!; // far below the local-road minimum
    const sum = summarise(s);
    const hs = handlesFor(s.alignment, sum.flags);
    expect(hs.filter(h => h.kind === 'end')).toHaveLength(2);
    expect(hs.filter(h => h.kind === 'pi')).toHaveLength(1);
    expect(hs.filter(h => h.kind === 'mid')).toHaveLength(2);
    expect(hs.filter(h => h.kind === 'radius')).toHaveLength(1);
    expect(hs.filter(h => h.kind === 'warn')).toHaveLength(1);
    expect(sum.rows[1].turnDeg).toBeCloseTo(-90, 0);
    expect(sum.flags.every(f => f.screening)).toBe(true);
  });
});

describe('migration and locks', () => {
  it('a legacy polyline migrates with radius 0 and an identical shape', () => {
    const { om, editing } = setup();
    const r = drawRoad(editing, om, [O, P1, P2], true);
    const legacy = { ...r, alignment: undefined, id: 'legacy_1' } as unknown as CityObject;
    const e = editableOf(legacy);
    expect(e.kind).toBe('editable');
    if (e.kind !== 'editable') return;
    expect(e.migrated).toBe(true);
    expect(e.state.alignment.pis.every(p => p.radiusM === 0)).toBe(true);
    const d = densifyAlignment(e.state.alignment);
    expect(d.coordinates).toHaveLength(r.coordinates.length);
    d.coordinates.forEach((c, i) => { expect(c[0]).toBeCloseTo(r.coordinates[i][0], 9); expect(c[1]).toBeCloseTo(r.coordinates[i][1], 9); });
  });

  it('OSM-imported roads are locked with a reason', () => {
    const e = editableOf({ id: 'osm_123', type: 'road', coordinates: [O, P1] } as any);
    expect(e.kind).toBe('locked');
    if (e.kind === 'locked') expect(e.message).toMatch(/OpenStreetMap/);
  });

  it('underground depth controls migrate from typed per-vertex depths and regenerate one depth per vertex', () => {
    const coords = [O, P1, P2];
    const obj = {
      id: 'ug1', type: 'underground_alignment', alignmentKind: 'bored_tunnel', coordinates: coords, lifecycle: 'proposed',
      depths: [{ crownDepthM: 10, certainty: 'assumed' }, { crownDepthM: 14, certainty: 'assumed' }, { crownDepthM: 12, certainty: 'assumed' }],
    } as any;
    const e = editableOf(obj);
    if (e.kind !== 'editable') throw new Error('not editable');
    expect(e.state.depthControls).toHaveLength(3);
    const curved = makeCurve(e.state, 1, true)!;
    const u = regenerateLocal(obj, curved.alignment, curved.depthControls) as any;
    expect(u.depths.length).toBe(u.coordinates.length);
    expect(u.depths[0].crownDepthM).toBe(10);
    expect(u.depths[u.depths.length - 1].crownDepthM).toBe(12);
    // The typed control at the curved PI stays typed at most at the arc-midpoint vertex; every other vertex is derived
    const typedMid = u.depths.slice(1, -1).filter((d: any) => !d.derived);
    expect(typedMid.length).toBeLessThanOrEqual(1);
    typedMid.forEach((d: any) => expect(d.crownDepthM).toBe(14));
    expect(Math.max(...u.depths.map((d: any) => d.crownDepthM))).toBeLessThanOrEqual(14);
  });
});

describe('session: drag, Esc, context actions, undo', () => {
  it('migrates on first edit, one undo step per change, Esc restores', () => {
    const { om, editing, session, history } = setup();
    const r = drawRoad(editing, om, [O, P1, P2], true);
    om.update(r.id, { alignment: undefined } as any, true);
    const legacyCoords = structuredClone(om.getById(r.id)!.coordinates);
    session.setTarget(r.id);
    const snap = session.getSnapshot();
    expect(snap.editable.kind).toBe('editable');
    expect(snap.handles.filter(h => h.kind === 'pi')).toHaveLength(1);
    // Nothing is written by selecting
    expect((om.getById(r.id) as any).alignment).toBeUndefined();

    // Esc during a drag: object untouched
    const undo0 = history.getUndoStackCount();
    expect(session.pointerDown('align_pi_1')).toBe(true);
    session.pointerMove(P1[0] + 0.001, P1[1]);
    expect(session.getSnapshot().preview).not.toBeNull();
    expect(session.cancelDrag()).toBe(true);
    expect(om.getById(r.id)!.coordinates).toEqual(legacyCoords);
    expect(history.getUndoStackCount()).toBe(undo0);

    // Make curve via the menu action → migrated + one undo step
    expect(session.makeCurve(1)).toBe(true);
    const after = om.getById(r.id) as RoadObject;
    expect(after.alignment?.pis[1].radiusM).toBeGreaterThan(0);
    expect(after.coordinates.length).toBeGreaterThan(3);
    expect(history.getUndoStackCount()).toBe(undo0 + 1);

    // Drag the PI → one more step
    session.pointerDown('align_pi_1');
    session.pointerMove(P1[0] + 0.0008, P1[1] + 0.0002);
    session.pointerMove(P1[0] + 0.001, P1[1] + 0.0003);
    expect(session.pointerUp()).toBe(true);
    expect(history.getUndoStackCount()).toBe(undo0 + 2);
    expect((om.getById(r.id) as RoadObject).alignment!.pis[1].lon).toBeCloseTo(P1[0] + 0.001, 9);

    // Midpoint drag inserts a PI
    session.pointerDown('align_mid_0');
    session.pointerMove((O[0] + P1[0]) / 2 - 0.0004, (O[1] + P1[1]) / 2);
    session.pointerUp();
    expect((om.getById(r.id) as RoadObject).alignment!.pis).toHaveLength(4);

    // Undo restores alignment + coordinates together
    history.undo();
    expect((om.getById(r.id) as RoadObject).alignment!.pis).toHaveLength(3);
    session.refresh();
    expect(session.getSnapshot().state!.alignment.pis).toHaveLength(3);
    history.undo();
    history.undo();
    expect((om.getById(r.id) as any).alignment).toBeUndefined();
    expect(om.getById(r.id)!.coordinates).toEqual(legacyCoords);
  });

  it('commit refuses a locked object and pushes exactly one undo step otherwise', () => {
    const { om, editing, history } = setup();
    const r = drawRoad(editing, om, [O, P1, P2]);
    const ctx = { objects: om, history, editing, scenarioId: 'base' };
    const n0 = history.getUndoStackCount();
    const res = commitGeometry(r, { ...r.alignment!, pis: r.alignment!.pis.map((p, i) => i === 1 ? { ...p, radiusM: 0 } : p) }, ctx as any);
    expect(res.ok).toBe(true);
    expect(history.getUndoStackCount()).toBe(n0 + 1);
    const locked = commitGeometry({ ...r, id: 'osm_9' } as any, r.alignment!, ctx as any);
    expect(locked).toMatchObject({ ok: false, error: 'locked' });
  });

  it('a U-turn drag is not taken; delete and typed radius commit', () => {
    const { om, editing, session } = setup();
    const r = drawRoad(editing, om, [O, P1, P2]);
    session.setTarget(r.id);
    session.pointerDown('align_pi_1');
    session.pointerMove(P2[0], P2[1]); // onto the next PI: coincident → refused, last valid stays
    expect(filletAlignment(session.getSnapshot().state!.alignment).ok).toBe(true);
    session.cancelDrag();
    expect(session.setRadius(1, 150)).toBe(true);
    expect((om.getById(r.id) as RoadObject).alignment!.pis[1]).toMatchObject({ radiusM: 150, radiusSource: 'user' });
    expect(session.deletePoint(1)).toBe(true);
    expect((om.getById(r.id) as RoadObject).alignment!.pis).toHaveLength(2);
    expect(om.getById(r.id)!.coordinates).toHaveLength(2);
  });
});
