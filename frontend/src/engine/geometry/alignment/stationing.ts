/** Distance-along-line (chainage) helpers on a polyline [lon, lat, z?][] (GEOMETRY_EDITOR_DESIGN.md §3.2). */
import { chainages, projectorFor, toXY, type Projector } from '../../underground/alignmentGeometry';
import { filletAlignment } from './fillet';
import type {
  ChainagesFn, CurveElement, CurveElementsFn, HorizontalAlignment, PointAtChainageFn, ProjectedPoint, ProjectOntoLineFn, StationPoint,
} from './types';

type Coords = readonly (readonly number[])[];

/** Cumulative plan chainage (m) at each vertex, starting at 0 (same plane as the underground profile code). */
export const chainagesOf: ChainagesFn = (coords: Coords) => chainages(coords);

/** Chainage of vertex i (clamped to the line). */
export const stationOfVertex = (coords: Coords, i: number): number => {
  const ch = chainagesOf(coords);
  return ch.length ? ch[Math.max(0, Math.min(ch.length - 1, i))] : 0;
};

/** Plan bearing (degrees clockwise from north, 0–360) from a to b in the given plane. */
export function bearingDeg(a: readonly number[], b: readonly number[], proj: Projector = projectorFor([a, b])): number {
  const [x0, y0] = toXY(proj, a);
  const [x1, y1] = toXY(proj, b);
  const d = (Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI;
  return (d + 360) % 360;
}

function at(coords: Coords, proj: Projector, i: number, t: number, ch: number): StationPoint {
  const a = coords[i], b = coords[Math.min(i + 1, coords.length - 1)];
  const lerp = (k: number) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
  return { lon: lerp(0), lat: lerp(1), z: lerp(2), chainageM: ch, segmentIndex: i, t, bearingDeg: bearingDeg(a, b, proj) };
}

/** Point and tangent bearing at a chainage (clamped to [0, length]); null for fewer than 2 vertices. */
export const pointAtChainage: PointAtChainageFn = (coords: Coords, chainageM: number): StationPoint | null => {
  if (coords.length < 2) return null;
  const proj = projectorFor(coords);
  const ch = chainages(coords, proj);
  const L = ch[ch.length - 1];
  const c = Math.max(0, Math.min(L, Number.isFinite(chainageM) ? chainageM : 0));
  for (let i = 0; i + 1 < coords.length; i++) {
    const seg = ch[i + 1] - ch[i];
    if (c <= ch[i + 1] || i + 2 === coords.length) {
      if (seg <= 0) continue;
      return at(coords, proj, i, Math.max(0, Math.min(1, (c - ch[i]) / seg)), c);
    }
  }
  return at(coords, proj, 0, 0, 0); // every segment zero-length
};

/** Tangent bearing (degrees from north) at a chainage. */
export const tangentAt = (coords: Coords, chainageM: number): number | null => pointAtChainage(coords, chainageM)?.bearingDeg ?? null;

/** Nearest point on the line to `point` [lon, lat], with its chainage and plan offset (m). */
export const projectOntoLine: ProjectOntoLineFn = (coords: Coords, point: readonly number[]): ProjectedPoint | null => {
  if (coords.length < 2) return null;
  const proj = projectorFor(coords);
  const ch = chainages(coords, proj);
  const [px, py] = toXY(proj, point);
  let best: ProjectedPoint | null = null;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [ax, ay] = toXY(proj, coords[i]);
    const [bx, by] = toXY(proj, coords[i + 1]);
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const off = Math.hypot(ax + dx * t - px, ay + dy * t - py);
    if (!best || off < best.offsetM - 1e-12) best = { ...at(coords, proj, i, t, ch[i] + (ch[i + 1] - ch[i]) * t), offsetM: off };
  }
  return best;
};

/** Tangent / arc elements with chainage (arc length), for the panel, checks and remaps. Empty when the geometry is invalid. */
export const curveElements: CurveElementsFn = (a: Pick<HorizontalAlignment, 'behaviour' | 'pis'>): CurveElement[] => filletAlignment(a).elements;
