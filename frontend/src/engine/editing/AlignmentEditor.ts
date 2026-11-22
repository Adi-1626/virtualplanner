/**
 * Shape editor for line objects after drawing (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §4.2, phase 2 agent C).
 *
 * Select a road / flyover / metro / tunnel / utility → its PIs appear as grips:
 *  - PI grip (square): drag; curves follow, radii kept (the fit rule reduces them when needed).
 *  - Midpoint grip (circle on each tangent): drag inserts a PI there.
 *  - Radius grip (diamond at the arc midpoint): drag along the PI's bisector to change R (Shift: 5 m steps).
 *  - End grips: drag; re-snap to the network on release (surface objects only).
 *  - Right-click a PI: delete / make sharp corner / make curve (auto radius).
 * Each finished change is ONE undo step ("Reshape <name>"); Esc during a drag puts the shape back. A drag previews a light
 * polyline only (no object write, no network rebuild) until release.
 *
 * Objects without `alignment` are migrated on their first edit with alignmentFromPolyline (radius 0 everywhere → the
 * identical shape). Imported / records geometry stays locked (decision D6) and shows why.
 *
 * Everything here except the session's dependencies is pure (no Cesium): AlignmentEditorView.ts draws the grips.
 */
import {
  alignmentFromPolyline, checkAlignment, defaultAlignmentSettings, densifyAlignment, filletAlignment, geometryLockReason,
  interpolateDepths, maxFittingRadius, projectOntoLine, remapSectionsByChainage, requiredTransitionLength, alignmentProjector,
  GEOMETRY_DEFAULTS, METRO_PUNE_SK_DPR,
} from '../geometry/alignment/index';
import type {
  AlignableObjectType, AlignmentFlag, AlignmentPI, AlignmentSettings, DepthEntryLike, DepthValueKey, GeometryLockReason,
  HorizontalAlignment,
} from '../geometry/alignment/index';
import { chainages, toLonLat, toXY } from '../underground/alignmentGeometry';
import { autoRadiusM, densifyWithZ } from './drawConstraints';
import type { CityObject } from '../objects/types';

// ---- what can be reshaped ------------------------------------------------------------------------------------------------

export const RESHAPE_TYPES: ReadonlySet<string> = new Set<AlignableObjectType>(['road', 'flyover', 'metro_flyover', 'metro_line', 'underground_alignment', 'utility']);

export const LOCK_MESSAGES: Record<GeometryLockReason, string> = {
  'osm-import': 'Imported from OpenStreetMap: its shape is mapped survey-like geometry and stays locked. Only its properties can be edited.',
  'imported-metro': 'Imported metro line: its shape stays locked. Only its properties can be edited.',
  'from-records': 'Entered from existing records: its shape stays as recorded. Only its properties can be edited.',
};

type AnyObj = CityObject & Record<string, any>;

export const isReshapeType = (obj: { type: string } | null | undefined): boolean => !!obj && RESHAPE_TYPES.has(obj.type);

/** The editable geometry: the alignment plus (underground, utilities) one depth control per PI. */
export interface EditState {
  alignment: HorizontalAlignment;
  depthControls?: DepthEntryLike[];
}

export const depthKeyOf = (obj: { type: string }): DepthValueKey | null =>
  obj.type === 'underground_alignment' ? 'crownDepthM' : obj.type === 'utility' ? 'depthM' : null;

/** Plan source line of the object (a flyover's ground line, not its ramped deck). */
const sourceLine = (obj: AnyObj): [number, number, number][] => {
  if ((obj.type === 'flyover' || obj.type === 'metro_flyover') && Array.isArray(obj.groundCoordinates) && obj.groundCoordinates.length >= 2)
    return obj.groundCoordinates;
  return obj.coordinates as [number, number, number][];
};

export const settingsFor = (obj: AnyObj): AlignmentSettings =>
  defaultAlignmentSettings({ type: obj.type as AlignableObjectType, roadClass: obj.roadClass, alignmentKind: obj.alignmentKind });

export const tbmOf = (obj: AnyObj) => obj.type === 'underground_alignment' && obj.alignmentKind === 'bored_tunnel';

export type Editable =
  | { kind: 'editable'; state: EditState; migrated: boolean }
  | { kind: 'locked'; reason: GeometryLockReason; message: string }
  | { kind: 'none' };

/**
 * The editable state of an object: its own alignment, or (first edit) one made from its polyline with every radius 0.
 * Nothing is written here: a migrated object is stored only when the first change is committed.
 */
export function editableOf(obj: CityObject | null | undefined): Editable {
  if (!obj || !isReshapeType(obj)) return { kind: 'none' };
  const o = obj as AnyObj;
  const lock = geometryLockReason(o as any);
  if (lock) return { kind: 'locked', reason: lock, message: LOCK_MESSAGES[lock] };
  const coords = sourceLine(o);
  if (!Array.isArray(coords) || coords.length < 2) return { kind: 'none' };
  const key = depthKeyOf(o);
  const depths: DepthEntryLike[] | null = key && Array.isArray(o.depths) && o.depths.length === o.coordinates.length ? o.depths : null;

  if (o.alignment && Array.isArray(o.alignment.pis) && o.alignment.pis.length >= 2) {
    const alignment = structuredClone(o.alignment) as HorizontalAlignment;
    let depthControls: DepthEntryLike[] | undefined;
    if (key) {
      if (Array.isArray(o.depthControls) && o.depthControls.length === alignment.pis.length) depthControls = structuredClone(o.depthControls);
      else if (depths) {
        const d = densifyAlignment(alignment);
        // Controls at the PIs from the per-vertex depths (exact entries where a PI is a vertex)
        depthControls = d.ok ? interpolateDepths(depths, chainages(o.coordinates as [number, number, number][]), d.piChainagesM, key) : undefined;
      }
    }
    return { kind: 'editable', state: { alignment, depthControls }, migrated: false };
  }

  const settings = settingsFor(o);
  const res = alignmentFromPolyline(coords, {
    settings,
    typedDepthAt: depths && key ? (i: number) => { const e = depths[i] as any; return e && !e.derived && typeof e[key] === 'number' ? e[key] : null; } : undefined,
  });
  const depthControls = depths ? res.keptIndices.map(i => structuredClone(depths[i])) : undefined;
  return { kind: 'editable', state: { alignment: res.alignment, depthControls }, migrated: true };
}

// ---- pure edit operations (each returns a new state, or null when not possible) -------------------------------------------

const clone = (s: EditState): EditState => structuredClone(s);
const isEnd = (a: HorizontalAlignment, i: number) => i <= 0 || i >= a.pis.length - 1;

/** Valid geometry (no U-turn / coincident points)? */
export const isValid = (s: EditState) => filletAlignment(s.alignment).ok;

export function movePI(s: EditState, i: number, lon: number, lat: number): EditState | null {
  if (i < 0 || i >= s.alignment.pis.length) return null;
  const n = clone(s);
  n.alignment.pis[i] = { ...n.alignment.pis[i], lon, lat };
  return n;
}

/** Radius for a new interior PI: auto (the class minimum, clamped by the fit rule at densify) or 0 when angled / auto off. */
export function newPIRadius(a: HorizontalAlignment, tbm = false, autoCurve: boolean = GEOMETRY_DEFAULTS.autoFillet): AlignmentPI {
  if (a.behaviour === 'angled' || !autoCurve) return { lon: 0, lat: 0, radiusM: 0 };
  return { lon: 0, lat: 0, radiusM: autoRadiusM(a, { tbm }), radiusSource: 'auto' };
}

/** Insert a PI on segment `seg` (between PI seg and seg+1). */
export function insertPI(s: EditState, seg: number, lon: number, lat: number, opts: { tbm?: boolean; autoCurve?: boolean } = {}): EditState | null {
  const pis = s.alignment.pis;
  if (seg < 0 || seg >= pis.length - 1) return null;
  const n = clone(s);
  const pi = { ...newPIRadius(s.alignment, opts.tbm, opts.autoCurve), lon, lat };
  n.alignment.pis.splice(seg + 1, 0, pi);
  if (n.depthControls && s.depthControls && s.depthControls.length === pis.length) {
    const a = pis[seg], b = pis[seg + 1];
    const proj = alignmentProjector([a, b, pi]);
    const pa = toXY(proj, [a.lon, a.lat]), pb = toXY(proj, [b.lon, b.lat]), pp = toXY(proj, [lon, lat]);
    const da = Math.hypot(pp[0] - pa[0], pp[1] - pa[1]), db = Math.hypot(pp[0] - pb[0], pp[1] - pb[1]);
    const w = da + db > 0 ? da / (da + db) : 0.5;
    const [ctl] = interpolateDepths([s.depthControls[seg], s.depthControls[seg + 1]], [0, 1], [w === 0 || w === 1 ? 0.5 : w], 'crownDepthM' in s.depthControls[seg] ? 'crownDepthM' : 'depthM');
    n.depthControls.splice(seg + 1, 0, ctl);
  }
  return n;
}

export function deletePI(s: EditState, i: number): EditState | null {
  if (s.alignment.pis.length <= 2 || i < 0 || i >= s.alignment.pis.length) return null;
  const n = clone(s);
  n.alignment.pis.splice(i, 1);
  if (n.depthControls && n.depthControls.length === s.alignment.pis.length) n.depthControls.splice(i, 1);
  // A new end PI carries no radius
  n.alignment.pis[0].radiusM = 0;
  n.alignment.pis[n.alignment.pis.length - 1].radiusM = 0;
  return n;
}

export function setRadius(s: EditState, i: number, radiusM: number, source: 'auto' | 'user' = 'user'): EditState | null {
  if (isEnd(s.alignment, i) || s.alignment.behaviour === 'angled' || !Number.isFinite(radiusM) || radiusM < 0) return null;
  const n = clone(s);
  n.alignment.pis[i] = { ...n.alignment.pis[i], radiusM, radiusSource: source };
  return n;
}

export const makeSharp = (s: EditState, i: number) => setRadius(s, i, 0, 'user');
export const makeCurve = (s: EditState, i: number, tbm = false) => setRadius(s, i, autoRadiusM(s.alignment, { tbm }), 'auto');

export function setDesignSpeed(s: EditState, kmh: number | null): EditState | null {
  if (kmh !== null && (!Number.isFinite(kmh) || kmh <= 0 || kmh > 200)) return null;
  const n = clone(s);
  n.alignment.designSpeedKmh = kmh;
  n.alignment.designSpeedSource = 'user';
  return n;
}

export function setEMax(s: EditState, eMax: 0.04 | 0.07): EditState {
  const n = clone(s);
  n.alignment.eMax = eMax;
  return n;
}

/**
 * Radius from a drag of the radius grip: the arc midpoint lies on the bisector at E = R(sec(Δ/2) − 1) from the PI, so
 * R = E / (sec(Δ/2) − 1), E = the cursor's distance from the PI measured along the bisector (towards the curve).
 * Clamped to the largest radius that fits; Shift snaps to 5 m. null when the PI has no turn.
 */
export function radiusFromDrag(a: HorizontalAlignment, i: number, lon: number, lat: number, snap5 = false): number | null {
  if (isEnd(a, i)) return null;
  const pis = a.pis;
  const proj = alignmentProjector(pis);
  const P = toXY(proj, [pis[i].lon, pis[i].lat]), A = toXY(proj, [pis[i - 1].lon, pis[i - 1].lat]), B = toXY(proj, [pis[i + 1].lon, pis[i + 1].lat]);
  const ua = norm([A[0] - P[0], A[1] - P[1]]), ub = norm([B[0] - P[0], B[1] - P[1]]);
  if (!ua || !ub) return null;
  const bis = norm([ua[0] + ub[0], ua[1] + ub[1]]);
  if (!bis) return null;
  const dot = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]));
  const delta = Math.PI - Math.acos(dot); // deflection
  if (delta < (0.5 * Math.PI) / 180) return null;
  const C = toXY(proj, [lon, lat]);
  const E = Math.max(0, (C[0] - P[0]) * bis[0] + (C[1] - P[1]) * bis[1]);
  const k = 1 / Math.cos(delta / 2) - 1;
  let r = k > 1e-9 ? E / k : 0;
  const fit = maxFittingRadius(a, i);
  if (Number.isFinite(fit)) r = Math.min(r, fit);
  r = snap5 ? Math.round(r / 5) * 5 : Math.round(r * 10) / 10;
  return Math.max(0, r);
}

type V2 = [number, number];
function norm(v: V2): V2 | null { const l = Math.hypot(v[0], v[1]); return l > 1e-9 ? [v[0] / l, v[1] / l] : null; }

// ---- grips -------------------------------------------------------------------------------------------------------------------

export type HandleKind = 'pi' | 'end' | 'mid' | 'radius' | 'warn';
export interface Handle { id: string; kind: HandleKind; index: number; lon: number; lat: number; title?: string }

export const HANDLE_PREFIX = 'align_';
export const parseHandleId = (id: string): { kind: HandleKind; index: number } | null => {
  const m = /^align_(pi|end|mid|radius|warn)_(\d+)$/.exec(id);
  return m ? { kind: m[1] as HandleKind, index: Number(m[2]) } : null;
};

/** Grips for the alignment: PIs/ends, a midpoint on each tangent, a radius grip at each arc midpoint, ⚠ at flagged curves. */
export function handlesFor(a: HorizontalAlignment, flags: readonly AlignmentFlag[] = []): Handle[] {
  const out: Handle[] = [];
  const pis = a.pis, last = pis.length - 1;
  const f = filletAlignment(a);
  const proj = alignmentProjector(pis);
  const radiusAt = new Map<number, [number, number]>();
  if (f.ok) {
    for (const p of f.pis) {
      if (p.radiusM > 0 && p.centre) {
        const c = toXY(proj, p.centre), P = toXY(proj, [pis[p.index].lon, pis[p.index].lat]);
        const u = norm([P[0] - c[0], P[1] - c[1]]);
        if (u) radiusAt.set(p.index, toLonLat(proj, c[0] + u[0] * p.radiusM, c[1] + u[1] * p.radiusM));
      }
    }
    for (let j = 0; j < last; j++) {
      const s = j === 0 ? [pis[0].lon, pis[0].lat] : (f.pis[j].ct ?? [pis[j].lon, pis[j].lat]);
      const e = j + 1 === last ? [pis[last].lon, pis[last].lat] : (f.pis[j + 1].tc ?? [pis[j + 1].lon, pis[j + 1].lat]);
      out.push({ id: `align_mid_${j}`, kind: 'mid', index: j, lon: (s[0] + e[0]) / 2, lat: (s[1] + e[1]) / 2, title: 'Drag to add a point' });
    }
  }
  pis.forEach((p, i) => {
    const kind: HandleKind = i === 0 || i === last ? 'end' : 'pi';
    out.push({ id: `align_${kind}_${i}`, kind, index: i, lon: p.lon, lat: p.lat });
  });
  for (const [i, ll] of radiusAt) out.push({ id: `align_radius_${i}`, kind: 'radius', index: i, lon: ll[0], lat: ll[1], title: 'Drag to change the radius' });
  const warned = new Set<number>();
  for (const fl of flags) {
    if (fl.severity !== 'warn' || fl.piIndex === undefined || warned.has(fl.piIndex) || !pis[fl.piIndex]) continue;
    warned.add(fl.piIndex);
    const ll = radiusAt.get(fl.piIndex) ?? [pis[fl.piIndex].lon, pis[fl.piIndex].lat];
    out.push({ id: `align_warn_${fl.piIndex}`, kind: 'warn', index: fl.piIndex, lon: ll[0], lat: ll[1], title: fl.message });
  }
  return out;
}

// ---- panel rows -------------------------------------------------------------------------------------------------------------

export interface PIRow {
  index: number;
  isEnd: boolean;
  chainageM: number;
  /** Signed turn (degrees, + left). */
  turnDeg: number;
  requestedRadiusM: number;
  radiusM: number;
  radiusSource: 'auto' | 'user' | null;
  clamped: boolean;
  tangentM: number;
  arcM: number;
  /** Transition length the curve would need (IRC:86-2018 §8.5), shown because spirals are not modelled yet. */
  transitionNeededM: number | null;
  flags: AlignmentFlag[];
}

export interface AlignmentSummary {
  ok: boolean;
  lengthM: number;
  rows: PIRow[];
  flags: AlignmentFlag[];
  minRadiusUsedM: number | null;
}

export function summarise(s: EditState, opts: { tbm?: boolean } = {}): AlignmentSummary {
  const a = s.alignment;
  const d = densifyAlignment(a);
  const flags = checkAlignment(a, { tbm: opts.tbm });
  if (!d.ok) return { ok: false, lengthM: 0, rows: [], flags, minRadiusUsedM: null };
  const last = a.pis.length - 1;
  const rows: PIRow[] = d.fillet.pis.map((p, i) => {
    const V = a.designSpeedKmh;
    const tr = p.radiusM > 0 && V ? requiredTransitionLength(V, p.radiusM) : null;
    return {
      index: i, isEnd: i === 0 || i === last, chainageM: d.piChainagesM[i] ?? 0,
      turnDeg: (p.deflectionRad * 180) / Math.PI,
      requestedRadiusM: a.pis[i].radiusM, radiusM: p.radiusM,
      radiusSource: i === 0 || i === last ? null : a.pis[i].radiusSource ?? (a.pis[i].radiusM > 0 ? 'user' : null),
      clamped: p.clamped, tangentM: p.tangentLengthM, arcM: p.arcLengthM,
      transitionNeededM: tr ? tr.valueM : null,
      flags: flags.filter(f => f.piIndex === i),
    };
  });
  const used = rows.filter(r => r.radiusM > 0).map(r => r.radiusM);
  return { ok: true, lengthM: d.fillet.lengthM, rows, flags, minRadiusUsedM: used.length ? Math.min(...used) : null };
}

// ---- commit (regenerate coordinates) -----------------------------------------------------------------------------------------

/**
 * LOCAL STAND-IN — field updates for an object whose alignment changed: `alignment` + the densified `coordinates` (z interpolated from the
 * old line at each PI), and the per-vertex arrays that index those coordinates. null when the geometry is invalid.
 *
 * TODO(merge with agent D, branch geom-d cad05fa): D's engine/editing/geometryCommit.ts `regenerateGeometry` /
 * `commitGeometry(obj, alignment, ctx)` own the full pipeline (end re-join → T-splits → crossings with decisions carried →
 * flyover ground reset + ramp merges → sections by chainage → depth controls → ONE batch "Reshape <name>"). On merge,
 * delete `regenerateLocal` and `commitGeometry` here and import D's `commitGeometry` instead (same signature and result).
 */
export function regenerateLocal(obj: CityObject, alignment: HorizontalAlignment, depthControls?: DepthEntryLike[]): Partial<CityObject> | null {
  const o = obj as AnyObj;
  const old = sourceLine(o);
  const zAt = (p: AlignmentPI) => projectOntoLine(old, [p.lon, p.lat])?.z ?? 0;
  const d = densifyWithZ(alignment, alignment.pis.map(p => [p.lon, p.lat, zAt(p)]));
  if (!d) return null;
  const coordinates = d.coordinates;
  const updates: Record<string, unknown> = { alignment: structuredClone(alignment), coordinates };
  if (o.type === 'road' && Array.isArray(o.sections)) updates.sections = remapSectionsByChainage(o.sections, o.coordinates as [number, number, number][], coordinates);
  // Ground line of a flyover = the new plan line; ObjectManager.update re-applies the ramp profile on it
  if (o.type === 'flyover' || o.type === 'metro_flyover') updates.groundCoordinates = coordinates.map(c => [c[0], c[1], c[2]]);
  const key = depthKeyOf(o);
  if (key && depthControls && depthControls.length === alignment.pis.length) {
    updates.depthControls = structuredClone(depthControls);
    updates.depths = interpolateDepths(depthControls, d.piChainagesM, d.chainagesM, key);
  } else if (key && Array.isArray(o.depths) && o.depths.length === o.coordinates.length) {
    // No controls: keep one depth per vertex, mapped by relative chainage (derived entries are marked)
    const oc = chainages(o.coordinates as [number, number, number][]), L0 = oc[oc.length - 1] || 1, L1 = d.chainagesM[d.chainagesM.length - 1] || 1;
    updates.depths = interpolateDepths(o.depths, oc, d.chainagesM.map(c => (c / L1) * L0), key);
  }
  return updates as Partial<CityObject>;
}

/** Same shape as D's GeometryCommitContext (engine/editing/geometryCommit.ts). */
export interface GeometryCommitContext {
  objects: { getById(id: string): CityObject | undefined; update(id: string, updates: Partial<CityObject>): void };
  history: { pushDiff(diff: any): void } | null;
  /** The crossing / T-junction steps of the drawing (unused by this stand-in; D's pipeline runs them). */
  editing?: unknown;
  scenarioId: string;
}
/** Same shape as D's GeometryCommitResult. */
export interface GeometryCommitResult {
  ok: boolean;
  error?: 'not-alignable' | 'locked' | 'invalid-geometry' | 'too-few-pis';
  message?: string;
  object?: CityObject;
  diff: unknown | null;
  uncertainCrossings: number;
}

/**
 * Lightweight commit used by the editor's unit tests only; the app uses geometryCommit.ts `commitGeometry` (full
 * pipeline: re-join, crossings, flyover ramps, depth controls). Regenerates, updates the object and pushes ONE batch diff
 * "Reshape <name>"; refuses locked / invalid shapes. No network steps (crossings, T-splits, end re-join) here.
 */
export function commitGeometry(obj: CityObject, alignment: HorizontalAlignment, ctx: GeometryCommitContext): GeometryCommitResult {
  if (!isReshapeType(obj)) return { ok: false, error: 'not-alignable', message: `A ${obj.type} has no editable line geometry.`, diff: null, uncertainCrossings: 0 };
  const lock = geometryLockReason(obj as any);
  if (lock) return { ok: false, error: 'locked', message: LOCK_MESSAGES[lock], diff: null, uncertainCrossings: 0 };
  if (alignment.pis.length < 2) return { ok: false, error: 'too-few-pis', message: 'A line needs at least 2 points.', diff: null, uncertainCrossings: 0 };
  const o = obj as AnyObj;
  const controls = Array.isArray(o.depthControls) && o.depthControls.length === alignment.pis.length ? o.depthControls : undefined;
  const updates = regenerateLocal(obj, alignment, controls);
  if (!updates) return { ok: false, error: 'invalid-geometry', message: 'The line turns back on itself or two points are in the same place.', diff: null, uncertainCrossings: 0 };
  const before = ctx.objects.getById(obj.id) ?? obj;
  ctx.objects.update(obj.id, updates);
  const after = ctx.objects.getById(obj.id)!;
  const diff = { type: 'batch', description: `Reshape ${obj.name || obj.type}`, diffs: [{ type: 'update', id: obj.id, before, after, description: `Reshape ${obj.name || obj.id}` }] };
  ctx.history?.pushDiff(diff);
  return { ok: true, object: after, diff, uncertainCrossings: 0 };
}

// ---- the editing session --------------------------------------------------------------------------------------------------

export interface AlignmentEditorDeps {
  getObject(id: string): CityObject | undefined;
  /** Commit pipeline: commitGeometry(obj, alignment, ctx) — it writes the object and pushes the ONE undo step itself. */
  commit(obj: CityObject, alignment: HorizontalAlignment): GeometryCommitResult;
  /** False while editing is locked (Simulation mode): nothing is committed. */
  canEdit?(): boolean;
  /** Network snap for a dragged end grip on release (surface objects); null = no snap. */
  snapEnd?(lon: number, lat: number, objId: string): [number, number] | null;
  toast?(msg: string, kind: 'info' | 'error' | 'warning'): void;
  /** Auto-curve for inserted PIs (the drawing toggle). */
  autoCurve?(): boolean;
}

type DragKind = 'pi' | 'end' | 'radius';
interface Drag { kind: DragKind; index: number; start: EditState; current: EditState; moved: boolean; inserted: boolean }

export interface ContextMenuState { index: number; x: number; y: number; isEnd: boolean; radiusM: number; behaviour: 'curved' | 'angled'; canDelete: boolean }

export interface EditorSnapshot {
  objectId: string | null;
  editable: Editable;
  /** The state shown (during a drag: the dragged state). */
  state: EditState | null;
  handles: Handle[];
  /** Densified preview while dragging (null otherwise; the object itself is drawn by the renderer). */
  preview: [number, number, number][] | null;
  dragging: boolean;
  summary: AlignmentSummary | null;
  menu: ContextMenuState | null;
}

const NO_SNAPSHOT: EditorSnapshot = { objectId: null, editable: { kind: 'none' }, state: null, handles: [], preview: null, dragging: false, summary: null, menu: null };

export class AlignmentEditSession {
  private objectId: string | null = null;
  private editable: Editable = { kind: 'none' };
  private drag: Drag | null = null;
  private menu: ContextMenuState | null = null;
  private listeners = new Set<() => void>();
  private snap: EditorSnapshot = NO_SNAPSHOT;

  private deps: AlignmentEditorDeps;
  constructor(deps: AlignmentEditorDeps) { this.deps = deps; }

  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  getSnapshot(): EditorSnapshot { return this.snap; }
  getObjectId() { return this.objectId; }
  isDragging() { return !!this.drag; }

  /** Select (or clear) the object being edited. */
  setTarget(id: string | null) {
    if (id === this.objectId) return;
    this.drag = null;
    this.menu = null;
    this.objectId = id;
    this.reload();
  }

  /** The object changed outside the editor (undo, panel edit, another tool): re-read it unless a drag is running. */
  refresh() {
    if (this.drag || !this.objectId) return;
    this.reload();
  }

  private reload() {
    const obj = this.objectId ? this.deps.getObject(this.objectId) : undefined;
    if (this.objectId && !obj) this.objectId = null;
    this.editable = editableOf(obj);
    this.emit();
  }

  private tbm() { const o = this.objectId ? this.deps.getObject(this.objectId) : undefined; return o ? tbmOf(o as AnyObj) : false; }

  private current(): EditState | null {
    if (this.drag) return this.drag.current;
    return this.editable.kind === 'editable' ? this.editable.state : null;
  }

  private emit() {
    const state = this.current();
    if (!this.objectId || !state) {
      this.snap = { ...NO_SNAPSHOT, objectId: this.objectId, editable: this.editable, menu: null };
    } else {
      const summary = summarise(state, { tbm: this.tbm() });
      let preview: [number, number, number][] | null = null;
      if (this.drag) { const d = densifyAlignment(state.alignment); preview = d.ok ? d.coordinates : null; }
      this.snap = { objectId: this.objectId, editable: this.editable, state, handles: handlesFor(state.alignment, summary.flags), preview, dragging: !!this.drag, summary, menu: this.menu };
    }
    this.listeners.forEach(l => l());
  }

  /** Mouse down on a grip. Returns true when the editor took the gesture. */
  pointerDown(handleId: string): boolean {
    const h = parseHandleId(handleId);
    const state = this.current();
    if (!h || !state || this.editable.kind !== 'editable' || h.kind === 'warn') return false;
    if (this.deps.canEdit && !this.deps.canEdit()) return false;
    this.menu = null;
    if (h.kind === 'mid') {
      const hd = this.snap.handles.find(x => x.id === handleId);
      if (!hd) return false;
      const ins = insertPI(state, h.index, hd.lon, hd.lat, { tbm: this.tbm(), autoCurve: this.deps.autoCurve?.() });
      if (!ins) return false;
      this.drag = { kind: 'pi', index: h.index + 1, start: state, current: ins, moved: false, inserted: true };
    } else {
      this.drag = { kind: h.kind === 'radius' ? 'radius' : h.kind === 'end' ? 'end' : 'pi', index: h.index, start: state, current: state, moved: false, inserted: false };
    }
    this.emit();
    return true;
  }

  /** Cursor moved while dragging (ground position). Returns true while a drag is running. */
  pointerMove(lon: number, lat: number, mods: { shift?: boolean } = {}): boolean {
    const d = this.drag;
    if (!d) return false;
    let next: EditState | null;
    if (d.kind === 'radius') {
      const r = radiusFromDrag(d.current.alignment, d.index, lon, lat, !!mods.shift);
      next = r === null ? null : setRadius(d.current, d.index, r, 'user');
    } else {
      next = movePI(d.current, d.index, lon, lat);
    }
    // An invalid shape (U-turn, two points on top of each other) is not shown: the last valid one stays
    if (next && isValid(next)) { d.current = next; d.moved = true; this.emit(); }
    return true;
  }

  /** Mouse up: commit the drag as one undo step. Returns true when a drag ended. */
  pointerUp(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    if (!d.moved && !d.inserted) { this.emit(); return true; }
    let state = d.current;
    if (d.kind === 'end' && this.objectId && this.deps.snapEnd) {
      const p = state.alignment.pis[d.index];
      const s = this.deps.snapEnd(p.lon, p.lat, this.objectId);
      if (s) { const n = movePI(state, d.index, s[0], s[1]); if (n && isValid(n)) state = n; }
    }
    const what = d.inserted ? 'add point' : d.kind === 'radius' ? `radius at point ${d.index + 1}` : `move point ${d.index + 1}`;
    this.commit(state, what);
    return true;
  }

  /** Esc during a drag: the shape goes back to where it was. */
  cancelDrag(): boolean {
    if (!this.drag) return false;
    this.drag = null;
    this.emit();
    return true;
  }

  openMenu(handleId: string, x: number, y: number): boolean {
    const h = parseHandleId(handleId);
    const state = this.current();
    if (!h || !state || (h.kind !== 'pi' && h.kind !== 'end' && h.kind !== 'radius')) return false;
    const a = state.alignment;
    this.menu = {
      index: h.index, x, y, isEnd: h.index === 0 || h.index === a.pis.length - 1, radiusM: a.pis[h.index].radiusM,
      behaviour: a.behaviour, canDelete: a.pis.length > 2,
    };
    this.emit();
    return true;
  }

  closeMenu() { if (this.menu) { this.menu = null; this.emit(); } }

  /** Apply a discrete change (context menu, panel cell) as one undo step. Returns false when it could not be applied. */
  apply(op: (s: EditState) => EditState | null, what: string): boolean {
    const state = this.current();
    this.menu = null;
    if (!state || this.drag) { this.emit(); return false; }
    const next = op(state);
    if (!next) { this.emit(); return false; }
    return this.commit(next, what);
  }

  deletePoint(i: number) { return this.apply(s => deletePI(s, i), `delete point ${i + 1}`); }
  makeSharp(i: number) { return this.apply(s => makeSharp(s, i), `sharp corner at point ${i + 1}`); }
  makeCurve(i: number) { return this.apply(s => makeCurve(s, i, this.tbm()), `curve at point ${i + 1}`); }
  setRadius(i: number, r: number) { return this.apply(s => setRadius(s, i, r, 'user'), `radius at point ${i + 1}`); }
  setDesignSpeed(v: number | null) { return this.apply(s => setDesignSpeed(s, v), 'design speed'); }
  setEMax(e: 0.04 | 0.07) { return this.apply(s => setEMax(s, e), 'superelevation cap'); }

  private commit(state: EditState, what: string): boolean {
    const id = this.objectId;
    const before = id ? this.deps.getObject(id) : undefined;
    if (!id || !before) { this.emit(); return false; }
    if (!isValid(state)) {
      this.deps.toast?.('That shape is not possible (a U-turn needs two points, or two points are on top of each other).', 'warning');
      this.emit();
      return false;
    }
    if (this.deps.canEdit && !this.deps.canEdit()) { this.emit(); return false; }
    void what;
    const res = this.deps.commit(before, state.alignment);
    if (!res.ok) {
      this.deps.toast?.(res.message || 'The shape could not be changed.', 'warning');
      this.emit();
      return false;
    }
    if (res.uncertainCrossings > 0) this.deps.toast?.(`${res.uncertainCrossings} crossing(s) need a level decision (see Crossings to check).`, 'info');
    this.reload();
    return true;
  }
}

/** Metro DPR minimum (used by the panel's hint for a TBM tunnel). */
export const TBM_MIN_RADIUS_M = METRO_PUNE_SK_DPR.minRadiusTbmM;
