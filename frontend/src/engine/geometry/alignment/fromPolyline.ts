/**
 * Lazy, lossless migration of a legacy polyline to PIs with radius 0 (GEOMETRY_EDITOR_DESIGN.md §3.5).
 * Douglas–Peucker at 0.05 m drops collinear points (10 m flyover resampling, crossing vertices on straights) and keeps the
 * clicked corners; dropped vertices with a typed depth that the interpolation would not reproduce (> 1 cm) are kept;
 * a round-trip guard (1 mm) falls back to keeping every vertex. Radius 0 everywhere ⇒ the regenerated polyline is the
 * kept vertices, so the shape does not move.
 */
import { chainages, projectorFor, toXY } from '../../underground/alignmentGeometry';
import { densifyAlignment } from './densify';
import { defaultAlignmentSettings, GEOMETRY_DEFAULTS } from './defaults';
import type {
  AlignmentFromPolylineFn, FromPolylineOptions, FromPolylineResult, GeometryLockFn, GeometryLockReason, HorizontalAlignment,
} from './types';

export const MIGRATION_DP_TOLERANCE_M = 0.05;
export const MIGRATION_ROUND_TRIP_TOLERANCE_M = 0.001;
export const MIGRATION_TYPED_DEPTH_TOLERANCE_M = 0.01;

type Coords = readonly (readonly number[])[];
type V2 = readonly [number, number];

/** Plan distance from p to segment ab (m). */
export function pointSegmentDistance(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
}

/** Douglas–Peucker on plan points: indices kept (sorted, always first and last). Distance is to the segment, not the line. */
export function douglasPeucker(xy: readonly V2[], toleranceM: number): number[] {
  const n = xy.length;
  if (n <= 2) return xy.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, wd = toleranceM;
    for (let i = a + 1; i < b; i++) {
      const d = pointSegmentDistance(xy[i], xy[a], xy[b]);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  const out: number[] = [];
  keep.forEach((k, i) => { if (k) out.push(i); });
  return out;
}

/** Max plan distance (m) from any source vertex to the polyline through `kept`. */
function maxDeviation(xy: readonly V2[], regenerated: readonly V2[]): number {
  let worst = 0;
  for (const p of xy) {
    let d = Infinity;
    for (let i = 0; i + 1 < regenerated.length; i++) d = Math.min(d, pointSegmentDistance(p, regenerated[i], regenerated[i + 1]));
    if (regenerated.length === 1) d = Math.hypot(p[0] - regenerated[0][0], p[1] - regenerated[0][1]);
    worst = Math.max(worst, d);
  }
  return worst;
}

/** Add back dropped vertices whose typed depth the chainage interpolation between kept typed depths would not reproduce. */
function keepTypedDepths(kept: number[], ch: readonly number[], typedDepthAt: (i: number) => number | null): number[] {
  const set = new Set(kept);
  for (let guard = 0; guard < ch.length; guard++) {
    const sorted = [...set].sort((x, y) => x - y);
    let added = false;
    for (let k = 0; k + 1 < sorted.length; k++) {
      const a = sorted[k], b = sorted[k + 1];
      const da = typedDepthAt(a), db = typedDepthAt(b);
      for (let j = a + 1; j < b; j++) {
        const dj = typedDepthAt(j);
        if (dj === null || !Number.isFinite(dj)) continue;
        const span = ch[b] - ch[a];
        const interp = da === null || db === null ? null : span > 0 ? da + ((db - da) * (ch[j] - ch[a])) / span : da;
        if (interp === null || Math.abs(interp - dj) > MIGRATION_TYPED_DEPTH_TOLERANCE_M) { set.add(j); added = true; break; }
      }
      if (added) break;
    }
    if (!added) return sorted;
  }
  return [...set].sort((x, y) => x - y);
}

export const alignmentFromPolyline: AlignmentFromPolylineFn = (coords: Coords, opts: FromPolylineOptions = {}): FromPolylineResult => {
  const settings = { ...defaultAlignmentSettings({ type: 'road' }), behaviour: 'curved' as const, ...opts.settings };
  const make = (idx: number[]): HorizontalAlignment => ({
    v: 1, ...settings, pis: idx.map(i => ({ lon: coords[i][0], lat: coords[i][1], radiusM: 0 })),
  });
  const all = coords.map((_, i) => i);
  if (coords.length < 3) return { alignment: make(all), keptIndices: all, roundTripOk: true, maxDeviationM: 0 };
  const proj = projectorFor(coords);
  const xy = coords.map(c => toXY(proj, c) as V2);
  // Exact repeats of the previous point carry no shape; drop them first (they would be coincident PIs).
  const distinct = all.filter(i => i === 0 || xy[i][0] !== xy[i - 1][0] || xy[i][1] !== xy[i - 1][1]);
  let kept = douglasPeucker(distinct.map(i => xy[i]), opts.toleranceM ?? MIGRATION_DP_TOLERANCE_M).map(k => distinct[k]);
  if (kept[kept.length - 1] !== coords.length - 1) kept.push(coords.length - 1);
  if (opts.typedDepthAt) kept = keepTypedDepths(kept, chainages(coords, proj), opts.typedDepthAt);
  const alignment = make(kept);
  const regen = densifyAlignment(alignment).coordinates.map(c => toXY(proj, c) as V2);
  const dev = maxDeviation(xy, regen);
  if (dev <= (opts.roundTripToleranceM ?? MIGRATION_ROUND_TRIP_TOLERANCE_M)) return { alignment, keptIndices: kept, roundTripOk: true, maxDeviationM: dev };
  return { alignment: make(all), keptIndices: all, roundTripOk: false, maxDeviationM: 0 };
};

/** Why this object's geometry stays locked (not converted / reshaped), or null when it may be converted (decision D6). */
export const geometryLockReason: GeometryLockFn = (obj): GeometryLockReason | null => {
  if (!GEOMETRY_DEFAULTS.importedGeometryLocked) return null;
  if (obj.type === 'metro_line' && (/^osm_m_/.test(obj.id) || obj.tags !== undefined)) return 'imported-metro';
  if (obj.osmProvenance !== undefined && obj.osmProvenance !== null) return 'osm-import';
  if (/^osm_/.test(obj.id)) return 'osm-import';
  if (obj.type === 'underground_alignment' && obj.lifecycle === 'existing') return 'from-records';
  if (obj.type === 'utility' && obj.status === 'existing') return 'from-records';
  return null;
};
