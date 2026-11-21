// Shared helpers for the alignment geometry tests: build lon/lat PIs from plan metres in the same plane fillet.ts uses.
import type { AlignmentPI } from '../geometry/alignment';
import { alignmentProjector } from '../geometry/alignment/fillet';
import { toXY } from '../underground/alignmentGeometry';

export const LON0 = 73.85, LAT0 = 18.5;
const KY = 110574;

/** Lon/lat for plan points (m) such that projectorFor(points) maps them back exactly (x relative to the first point). */
export function lonLatFromXY(pts: readonly (readonly [number, number])[]): [number, number][] {
  const lats = pts.map(p => LAT0 + p[1] / KY);
  const lat0 = lats.reduce((s, v) => s + v, 0) / lats.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return pts.map((p, i) => [LON0 + (p[0] - pts[0][0]) / kx, lats[i]]);
}

export function pisFromXY(pts: readonly (readonly [number, number])[], radiusM = 0): AlignmentPI[] {
  return lonLatFromXY(pts).map(([lon, lat]) => ({ lon, lat, radiusM }));
}

/** Plan XY (m) of lon/lat points in the PIs' plane, shifted so the first PI is at its original XY. */
export function xyIn(pis: readonly AlignmentPI[], pts: readonly (readonly number[])[], origin: readonly [number, number]): [number, number][] {
  const proj = alignmentProjector(pis);
  const o = toXY(proj, [pis[0].lon, pis[0].lat]);
  return pts.map(p => { const [x, y] = toXY(proj, p); return [x - o[0] + origin[0], y - o[1] + origin[1]]; });
}
