import type { CityObject, UndergroundAlignmentObject, UtilityObject } from '../objects/types';

type WithCoords = { coordinates: readonly (readonly number[])[] };

/** Underground objects the work area is built around: drawn alignments and utilities (proposed or entered by the user). */
export const isWorkObject = (o: CityObject): o is UndergroundAlignmentObject | UtilityObject => o.type === 'underground_alignment' || o.type === 'utility';

/**
 * Lon/lat box around the given objects with a margin (m), for limiting ground translucency and listing records. Used with
 * every drawn alignment AND utility, so a proposed pipe is never outside the see-through area.
 */
export function alignmentsRect(as: readonly WithCoords[], marginM = 300): [number, number, number, number] | null {
  const pts = as.flatMap(a => a.coordinates as (readonly number[])[]);
  if (pts.length === 0) return null;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const dLat = marginM / 110574, dLon = marginM / (111320 * Math.cos((lat * Math.PI) / 180));
  return [Math.min(...pts.map(p => p[0])) - dLon, Math.min(...pts.map(p => p[1])) - dLat, Math.max(...pts.map(p => p[0])) + dLon, Math.max(...pts.map(p => p[1])) + dLat];
}

type Box = [number, number, number, number];
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Boxes to ask for records in: one per object (with the margin), merged where they overlap. A pipe drawn far from the
 * rest gets its own small box instead of stretching one box over everything in between (one remote pipe used to turn the
 * work area into a 4,000-record box).
 */
export function workBoxes(objs: readonly WithCoords[], marginM = 250): Box[] {
  let boxes = objs.map(o => alignmentsRect([o], marginM)).filter((b): b is Box => b !== null);
  for (let merged = true; merged;) {
    merged = false;
    const out: Box[] = [];
    for (const b of boxes) {
      const i = out.findIndex(o => overlaps(o, b));
      if (i < 0) { out.push([...b] as Box); continue; }
      const o = out[i];
      out[i] = [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])];
      merged = true;
    }
    boxes = out;
  }
  return boxes;
}

/** Local metres (east, north) of a lon/lat around a reference latitude: accurate to well under 1 % over a few km. */
function toLocal(p: readonly number[], lat0: number): [number, number] {
  return [p[0] * 111320 * Math.cos((lat0 * Math.PI) / 180), p[1] * 110574];
}
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function segSegDist(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number {
  const cross = (o: [number, number], p: [number, number], q: [number, number]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(segDist(a, c, d), segDist(b, c, d), segDist(c, a, b), segDist(d, a, b));
}
const segments = (pts: [number, number][]) => (pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p])) as [[number, number], [number, number]][];

/**
 * Plan distance (m) between a record geometry (Point / LineString / MultiLineString, lon/lat) and the nearest drawn
 * object's centreline. Null when the geometry has no coordinates.
 */
export function distanceToObjectsM(geom: { type: string; coordinates: unknown } | null, objs: readonly WithCoords[]): number | null {
  if (!geom || objs.length === 0) return null;
  const parts = geom.type === 'Point' ? [[geom.coordinates as number[]]] : geom.type === 'LineString' ? [geom.coordinates as number[][]]
    : geom.type === 'MultiLineString' ? (geom.coordinates as number[][][]) : [];
  const first = parts.find(p => p.length > 0);
  if (!first) return null;
  const lat0 = first[0][1];
  const rec = parts.filter(p => p.length > 0).flatMap(p => segments(p.map(q => toLocal(q, lat0))));
  let best = Infinity;
  for (const o of objs) {
    const os = segments((o.coordinates as (readonly number[])[]).map(p => toLocal(p, lat0)));
    for (const [a, b] of rec) for (const [c, d] of os) { best = Math.min(best, segSegDist(a, b, c, d)); if (best === 0) return 0; }
  }
  return Number.isFinite(best) ? best : null;
}
