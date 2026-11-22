/**
 * Drawing constraints for line tools (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §2.3, §4.1). Pure functions, no Cesium.
 *
 *  - angle snap: Shift = absolute bearing in 15° steps; Alt+Shift = deflection from the previous segment in 15° steps
 *  - typed length / bearing / radius ("dynamic input")
 *  - tangent-continuation guide from an existing road end
 *  - snap tolerances in screen pixels, converted with the camera's metres-per-pixel
 *  - the alignment being drawn: PIs + automatic radius (GEOMETRY_DEFAULTS / minRadius), densified for the preview
 *
 * Bearings are degrees clockwise from north in [0, 360). Deflections are signed, + = left (anticlockwise), as in the
 * alignment core.
 */
import {
  defaultAlignmentSettings, densifyAlignment, filletAlignment, minRadius, checkAlignment, METRO_PUNE_SK_DPR,
  type AlignableObjectType, type AlignmentFlag, type AlignmentPI, type AlignmentSettings, type HorizontalAlignment, type DensifyResult,
} from '../geometry/alignment/index';
import type { RoadClassification, UndergroundAlignmentKind } from '../objects/types';

export type Pt3 = [number, number, number];

/** Angle snap step (degrees). */
export const ANGLE_SNAP_STEP_DEG = 15;
/** Network snap tolerance at a vertex / an edge (screen pixels). */
export const SNAP_VERTEX_PX = 10;
export const SNAP_EDGE_PX = 7;
/** A PI within this distance of the tangent guide sits exactly on it (screen pixels). */
export const GUIDE_SNAP_PX = 8;
/** A click within this distance of the last point is the same point (double-click, jitter) (screen pixels). */
export const DUPLICATE_PX = 4;
/** Bounds on the pixel tolerance, in metres, so it never vanishes nor grabs a whole block. */
export const SNAP_MIN_M = 0.5;
export const SNAP_MAX_M = 80;
/** Auto radius for a `curved` object without criteria (cut-and-cover with no design speed): 50 m, assumed — no official figure (criteria.ts). */
import { FALLBACK_AUTO_RADIUS_M } from '../geometry/alignment/criteria';
export { FALLBACK_AUTO_RADIUS_M };
export { FALLBACK_AUTO_RADIUS_LABEL } from '../geometry/alignment/criteria';

const D2R = Math.PI / 180;
const KY = 110574;
const kx = (lat: number) => 111320 * Math.cos(lat * D2R);

export const normBearing = (b: number) => ((b % 360) + 360) % 360;
/** Signed difference a − b folded to (−180, 180]. */
export const angleDiff = (a: number, b: number) => {
  let d = normBearing(a - b);
  if (d > 180) d -= 360;
  return d;
};

/** Plan distance (m), local equirectangular. */
export function distanceM(a: readonly number[], b: readonly number[]): number {
  const lat = (a[1] + b[1]) / 2;
  return Math.hypot((b[0] - a[0]) * kx(lat), (b[1] - a[1]) * KY);
}

/** Bearing a → b (degrees clockwise from north). */
export function bearingDeg(a: readonly number[], b: readonly number[]): number {
  const lat = (a[1] + b[1]) / 2;
  const dx = (b[0] - a[0]) * kx(lat), dy = (b[1] - a[1]) * KY;
  return normBearing(Math.atan2(dx, dy) / D2R);
}

/** The point at `lengthM` from `from` on `bearing`. z is copied from `from`. */
export function destination(from: readonly number[], bearing: number, lengthM: number): Pt3 {
  const r = bearing * D2R;
  const dx = Math.sin(r) * lengthM, dy = Math.cos(r) * lengthM;
  const lat = from[1] + dy / KY;
  return [from[0] + dx / kx((from[1] + lat) / 2), lat, from[2] ?? 0];
}

/** Signed deflection at b (a → b → c), degrees, + = left turn. */
export function deflectionDeg(a: readonly number[], b: readonly number[], c: readonly number[]): number {
  return -angleDiff(bearingDeg(b, c), bearingDeg(a, b));
}

/** Absolute bearing snapped to `step` (0, 15, 30 … ; 45 and 90 fall out). */
export const snapBearingAbsolute = (bearing: number, step = ANGLE_SNAP_STEP_DEG) => normBearing(Math.round(bearing / step) * step);

/** Bearing whose deflection from `prevBearing` is snapped to `step` (0 = straight on). */
export const snapBearingRelative = (bearing: number, prevBearing: number, step = ANGLE_SNAP_STEP_DEG) =>
  normBearing(prevBearing + Math.round(angleDiff(bearing, prevBearing) / step) * step);

/** A pixel tolerance as metres, bounded. */
export const pxToMetres = (px: number, metresPerPixel: number) =>
  Math.min(SNAP_MAX_M, Math.max(SNAP_MIN_M, px * (Number.isFinite(metresPerPixel) && metresPerPixel > 0 ? metresPerPixel : 1)));

/** Metres as degrees of latitude (what SnapManager's degree distances compare against). */
export const metresToDeg = (m: number) => m / KY;

/** Network snap radii (degrees) for the current zoom. */
export function snapRadiiDeg(metresPerPixel: number): { vertexDeg: number; edgeDeg: number } {
  return { vertexDeg: metresToDeg(pxToMetres(SNAP_VERTEX_PX, metresPerPixel)), edgeDeg: metresToDeg(pxToMetres(SNAP_EDGE_PX, metresPerPixel)) };
}

/** True when b is the same click as a (within DUPLICATE_PX on screen). */
export const isNearDuplicate = (a: readonly number[] | undefined, b: readonly number[], metresPerPixel: number) =>
  !!a && distanceM(a, b) <= Math.max(0.05, DUPLICATE_PX * (metresPerPixel > 0 ? metresPerPixel : 0.01));

// ---- tangent guide ----------------------------------------------------------------------------------------------------

export interface TangentGuide {
  /** The road end the new line starts on. */
  origin: Pt3;
  /** Bearing that continues the road smoothly. */
  bearingDeg: number;
  roadId: string;
}

/** The continuation bearing at a road end: leaving the start goes against the first segment, the end along the last. */
export function guideFromRoadEnd(coords: readonly (readonly number[])[], atStart: boolean, roadId: string): TangentGuide | null {
  if (coords.length < 2) return null;
  const n = coords.length;
  const [end, prev] = atStart ? [coords[0], coords[1]] : [coords[n - 1], coords[n - 2]];
  if (distanceM(prev, end) < 0.01) return null;
  return { origin: [end[0], end[1], end[2] ?? 0], bearingDeg: bearingDeg(prev, end), roadId };
}

/** The cursor moved onto the guide ray when within `tolM` of it (and ahead of the origin), else null. */
export function snapToGuide(guide: TangentGuide, cursor: readonly number[], tolM: number): Pt3 | null {
  const d = distanceM(guide.origin, cursor);
  if (d < 0.01) return null;
  const off = angleDiff(bearingDeg(guide.origin, cursor), guide.bearingDeg) * D2R;
  const along = d * Math.cos(off), perp = Math.abs(d * Math.sin(off));
  if (along <= 0 || perp > tolM) return null;
  return destination(guide.origin, guide.bearingDeg, along);
}

// ---- typed input ------------------------------------------------------------------------------------------------------

export type TypedField = 'length' | 'bearing' | 'radius';
export interface TypedInput {
  field: TypedField;
  text: string;
  /** Values already accepted (Tab moves on from length to bearing and keeps the length). */
  lengthM: number | null;
  bearingDeg: number | null;
}
export const emptyTypedInput = (): TypedInput => ({ field: 'length', text: '', lengthM: null, bearingDeg: null });

const parseNum = (s: string) => {
  if (!s || s === '.' || s === '-') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

/** Effective typed length / bearing, including the text being typed. */
export function typedValues(t: TypedInput): { lengthM: number | null; bearingDeg: number | null; radiusM: number | null } {
  const cur = parseNum(t.text);
  return {
    lengthM: t.field === 'length' && cur !== null && cur > 0 ? cur : t.lengthM,
    bearingDeg: t.field === 'bearing' && cur !== null ? normBearing(cur) : t.bearingDeg,
    radiusM: t.field === 'radius' && cur !== null && cur >= 0 ? cur : null,
  };
}

export const hasTypedInput = (t: TypedInput) => t.text !== '' || t.lengthM !== null || t.bearingDeg !== null || t.field !== 'length';

/**
 * Apply one key to the typed input. Returns the new state, or null when the key is not part of typed input
 * (so the caller handles it as a shortcut). Digits and '.' type; Backspace edits the text; Tab switches length ↔ bearing;
 * R starts a radius entry.
 */
export function applyTypedKey(t: TypedInput, key: string): TypedInput | null {
  if (/^[0-9]$/.test(key) || (key === '.' && !t.text.includes('.')) || (key === '-' && t.field === 'bearing' && t.text === '')) {
    return { ...t, text: t.text + key };
  }
  if (key === 'Backspace' && t.text !== '') return { ...t, text: t.text.slice(0, -1) };
  if (key === 'Tab') {
    const v = typedValues(t);
    if (t.field === 'length') return { ...t, field: 'bearing', lengthM: v.lengthM, text: t.bearingDeg !== null ? String(Math.round(t.bearingDeg * 10) / 10) : '' };
    if (t.field === 'bearing') return { ...t, field: 'length', bearingDeg: v.bearingDeg, text: t.lengthM !== null ? String(t.lengthM) : '' };
    return { ...t, field: 'length', text: '' };
  }
  if (key === 'r' || key === 'R') return { ...t, field: 'radius', text: '' };
  return null;
}

// ---- cursor resolution ------------------------------------------------------------------------------------------------

export type AngleSnapMode = 'none' | 'absolute' | 'relative';

export interface ResolveInput {
  /** PIs placed so far. */
  points: readonly (readonly number[])[];
  /** Raw (or network-snapped) cursor position. */
  cursor: Pt3;
  /** True when `cursor` is a network snap: it wins over the angle snap and the guide (it is a real connection). */
  networkSnapped: boolean;
  angleSnap: AngleSnapMode;
  typed: TypedInput;
  guide: TangentGuide | null;
  metresPerPixel: number;
  stepDeg?: number;
}

export interface ResolvedCursor {
  point: Pt3;
  /** What constrained the point. */
  constraint: 'none' | 'network' | 'angle-absolute' | 'angle-relative' | 'typed' | 'guide';
  lengthM: number | null;
  bearingDeg: number | null;
  /** Deflection at the last placed PI if this point were added (degrees, + left); null with < 2 points. */
  deflectionDeg: number | null;
}

export function resolveCursor(inp: ResolveInput): ResolvedCursor {
  const { points, cursor } = inp;
  const last = points[points.length - 1];
  const prev = points.length >= 2 ? points[points.length - 2] : null;
  const finish = (point: Pt3, constraint: ResolvedCursor['constraint']): ResolvedCursor => {
    if (!last) return { point, constraint, lengthM: null, bearingDeg: null, deflectionDeg: null };
    const L = distanceM(last, point);
    const b = L > 0.001 ? bearingDeg(last, point) : null;
    return { point, constraint, lengthM: L, bearingDeg: b, deflectionDeg: prev && b !== null ? deflectionDeg(prev, last, point) : null };
  };
  if (!last) {
    return finish(cursor, inp.networkSnapped ? 'network' : 'none');
  }
  const t = typedValues(inp.typed);
  const typedAny = t.lengthM !== null || t.bearingDeg !== null;
  if (typedAny) {
    let b = t.bearingDeg ?? bearingDeg(last, cursor);
    if (t.bearingDeg === null && inp.angleSnap === 'absolute') b = snapBearingAbsolute(b, inp.stepDeg);
    else if (t.bearingDeg === null && inp.angleSnap === 'relative' && prev) b = snapBearingRelative(b, bearingDeg(prev, last), inp.stepDeg);
    const L = t.lengthM ?? distanceM(last, cursor);
    return finish(destination(last, b, L), 'typed');
  }
  if (inp.networkSnapped) return finish(cursor, 'network');
  if (inp.angleSnap !== 'none') {
    const raw = bearingDeg(last, cursor);
    const L = distanceM(last, cursor);
    if (inp.angleSnap === 'relative' && prev) {
      return finish(destination(last, snapBearingRelative(raw, bearingDeg(prev, last), inp.stepDeg), L), 'angle-relative');
    }
    return finish(destination(last, snapBearingAbsolute(raw, inp.stepDeg), L), 'angle-absolute');
  }
  // Tangent guide: only for the first segment from the road end
  if (inp.guide && points.length === 1 && distanceM(inp.guide.origin, last) < 0.05) {
    const g = snapToGuide(inp.guide, cursor, pxToMetres(GUIDE_SNAP_PX, inp.metresPerPixel));
    if (g) return finish(g, 'guide');
  }
  return finish(cursor, 'none');
}

// ---- the alignment being drawn ----------------------------------------------------------------------------------------

/** Draw modes that build an alignment (line tools). Building / zone / study area stay plain polygons. */
const MODE_TYPE: Record<string, AlignableObjectType> = {
  draw_road: 'road', draw_flyover: 'flyover', draw_metro_flyover: 'metro_flyover', draw_metro: 'metro_line',
  draw_underground: 'underground_alignment', draw_utility: 'utility',
};
export const alignableTypeForMode = (mode: string): AlignableObjectType | null => MODE_TYPE[mode] ?? null;

export interface DrawSettingsInput {
  mode: string;
  roadClass?: RoadClassification;
  undergroundKind?: UndergroundAlignmentKind;
}

export function drawAlignmentSettings(inp: DrawSettingsInput): AlignmentSettings | null {
  const type = alignableTypeForMode(inp.mode);
  if (!type) return null;
  return defaultAlignmentSettings({ type, roadClass: inp.roadClass, alignmentKind: inp.undergroundKind });
}

/** The automatic radius for a new interior PI (§3.3): the minimum radius for the design speed; the fit rule clamps it. */
export function autoRadiusM(s: AlignmentSettings, opts: DrawCheckOptions = {}): number {
  if (s.behaviour === 'angled') return 0;
  const r = s.designSpeedKmh !== null || s.criteria === 'metro-pune-sk-dpr' ? minRadius(s.criteria, s.designSpeedKmh ?? 0, s.eMax) : null;
  if (!r) return FALLBACK_AUTO_RADIUS_M;
  const tbm = opts.tbm && s.criteria === 'metro-pune-sk-dpr' ? METRO_PUNE_SK_DPR.minRadiusTbmM : 0;
  return Math.ceil(Math.max(r.valueM, tbm));
}

/** A bored tunnel (TBM) uses the DPR's TBM minimum radius for the auto radius and the screen. */
export interface DrawCheckOptions { tbm?: boolean }

/** Per-PI radius request while drawing: null = auto, 0 = sharp corner (Ctrl+click), n = typed. */
export type DrawRadius = number | null;

export function buildDrawAlignment(
  points: readonly (readonly number[])[], radii: readonly DrawRadius[], s: AlignmentSettings, opts: DrawCheckOptions = {},
): HorizontalAlignment {
  const auto = autoRadiusM(s, opts);
  const last = points.length - 1;
  const pis: AlignmentPI[] = points.map((p, i) => {
    if (i === 0 || i === last) return { lon: p[0], lat: p[1], radiusM: 0 };
    if (s.behaviour === 'angled') return { lon: p[0], lat: p[1], radiusM: 0 };
    const r = radii[i] ?? null;
    return r === null ? { lon: p[0], lat: p[1], radiusM: auto, radiusSource: 'auto' } : { lon: p[0], lat: p[1], radiusM: r, radiusSource: 'user' };
  });
  return { v: 1, ...s, pis };
}

/**
 * Densified line of the alignment with z interpolated by chainage between the PIs' own z (the click heights),
 * so the rest of the pipeline sees the heights it saw before. null when the geometry is invalid (U-turn, coincident).
 */
export function densifyWithZ(a: HorizontalAlignment, points: readonly (readonly number[])[]): (DensifyResult & { coordinates: Pt3[] }) | null {
  const d = densifyAlignment(a);
  if (!d.ok) return null;
  const pc = d.piChainagesM;
  const zs = points.map(p => p[2] ?? 0);
  const coords = d.coordinates.map((c, i) => {
    const ch = d.chainagesM[i];
    let k = 0;
    while (k < pc.length - 2 && ch > pc[k + 1]) k++;
    const span = pc[k + 1] - pc[k];
    const t = span > 1e-9 ? Math.min(1, Math.max(0, (ch - pc[k]) / span)) : 0;
    return [c[0], c[1], zs[k] + (zs[k + 1] - zs[k]) * t] as Pt3;
  });
  // PIs that are vertices keep their exact click (and snap) position
  coords[0] = [points[0][0], points[0][1], zs[0]];
  coords[coords.length - 1] = [points[points.length - 1][0], points[points.length - 1][1], zs[zs.length - 1]];
  return { ...d, coordinates: coords };
}

export interface DrawReadoutData {
  lengthM: number | null;
  bearingDeg: number | null;
  /** Deflection at the last placed PI (degrees, + left). */
  deflectionDeg: number | null;
  /** Radius used at the last placed PI (after the fit rule), the requested one, and where it came from. */
  radiusM: number | null;
  requestedRadiusM: number | null;
  radiusSource: 'auto' | 'user' | 'sharp' | null;
  clamped: boolean;
  totalLengthM: number;
  behaviour: 'curved' | 'angled';
  constraint: ResolvedCursor['constraint'];
  typed: TypedInput;
  /** Screening flags for the PI at the corner being drawn (radius checks), from checkAlignment. */
  flags: AlignmentFlag[];
  designSpeedKmh: number | null;
}

/**
 * The readout for the drawing with the cursor as a tentative next point: the corner being formed is the last placed PI.
 */
export function drawReadout(
  points: readonly (readonly number[])[], radii: readonly DrawRadius[], s: AlignmentSettings, cursor: ResolvedCursor | null, typed: TypedInput,
  opts: DrawCheckOptions = {},
): DrawReadoutData {
  const pts = cursor && points.length > 0 ? [...points, cursor.point] : [...points];
  const rr = cursor && points.length > 0 ? [...radii, null] : [...radii];
  const corner = pts.length >= 3 ? (cursor && points.length > 0 ? points.length - 1 : pts.length - 2) : -1;
  const base: DrawReadoutData = {
    lengthM: cursor?.lengthM ?? null, bearingDeg: cursor?.bearingDeg ?? null, deflectionDeg: cursor?.deflectionDeg ?? null,
    radiusM: null, requestedRadiusM: null, radiusSource: null, clamped: false, totalLengthM: 0, behaviour: s.behaviour,
    constraint: cursor?.constraint ?? 'none', typed, flags: [], designSpeedKmh: s.designSpeedKmh,
  };
  if (pts.length < 2) return base;
  const a = buildDrawAlignment(pts, rr, s, opts);
  const f = filletAlignment(a);
  base.totalLengthM = f.ok ? f.lengthM : 0;
  if (corner > 0 && f.pis[corner]) {
    const fp = f.pis[corner];
    const req = a.pis[corner];
    base.requestedRadiusM = req.radiusM;
    base.radiusM = fp.radiusM;
    base.clamped = fp.clamped;
    base.radiusSource = s.behaviour === 'angled' || req.radiusM === 0 ? 'sharp' : (req.radiusSource ?? 'auto');
    if (f.ok) base.flags = checkAlignment(a, { tbm: opts.tbm }).filter(fl => fl.piIndex === corner || fl.piIndex === undefined);
  }
  return base;
}
