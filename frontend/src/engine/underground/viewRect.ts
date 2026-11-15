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
