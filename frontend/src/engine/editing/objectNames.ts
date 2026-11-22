import type { RoadClassification } from '../objects/types';

/**
 * Default names of newly drawn objects. They used to end in a slice of the random id ("Road opj4"), which means nothing
 * to a planner. Now: a plain description, with the nearest named street when one is close ("New arterial road near
 * Karve Road"), otherwise a running number ("New arterial road 1"). The user renames it in the inspector.
 */

export const ROAD_CLASS_NAME: Record<RoadClassification, string> = {
  highway: 'highway', arterial: 'arterial road', collector: 'collector road', local: 'local road',
};

/** A street name nearer than this to the new object's middle is used in its name. */
export const NEAR_STREET_M = 150;

export interface NamedLine { name: string; coordinates: readonly (readonly number[])[] }

const kx = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const KY = 110574;

function distToPolylineM(p: readonly number[], line: readonly (readonly number[])[]): number {
  let best = Infinity;
  const ax = kx(p[1]);
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[Math.min(i + 1, line.length - 1)];
    const ax0 = (a[0] - p[0]) * ax, ay0 = (a[1] - p[1]) * KY;
    const bx0 = (b[0] - p[0]) * ax, by0 = (b[1] - p[1]) * KY;
    const dx = bx0 - ax0, dy = by0 - ay0;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax0 * dx + ay0 * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax0 + t * dx, ay0 + t * dy));
  }
  return best;
}

/** The middle of what was drawn: the middle vertex of a line, or the point itself. */
export function middleOf(points: readonly (readonly number[])[]): readonly number[] | null {
  if (!points.length) return null;
  if (points.length === 1) return points[0];
  let lon = 0, lat = 0;
  for (const p of points) { lon += p[0]; lat += p[1]; }
  return [lon / points.length, lat / points.length];
}

/** The nearest really named street (an OSM `name` tag or a name the user typed) within `maxM`, or null. */
export function nearestStreetName(at: readonly number[] | null, streets: readonly NamedLine[], maxM = NEAR_STREET_M): string | null {
  if (!at) return null;
  let best: { name: string; d: number } | null = null;
  for (const s of streets) {
    if (!s.name || s.coordinates.length < 1) continue;
    const d = distToPolylineM(at, s.coordinates);
    if (d <= maxM && (!best || d < best.d)) best = { name: s.name, d };
  }
  return best?.name ?? null;
}

/** "New <kind> near <street>", or "New <kind> <n>" with the next free number; never a duplicate of `taken`. */
export function newObjectName(kind: string, near: string | null, taken: ReadonlySet<string>): string {
  const base = `New ${kind}`;
  if (near) {
    const named = `${base} near ${near}`;
    if (!taken.has(named)) return named;
    for (let i = 2; ; i++) if (!taken.has(`${named} (${i})`)) return `${named} (${i})`;
  }
  for (let i = 1; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Name of an OSM way with no `name` tag, from its highway class in plain words: "Secondary link road (unnamed)". */
export function osmUnnamedRoadName(highway: string | undefined): string {
  const h = (highway || 'road').replace(/_/g, ' ').trim();
  return h === 'road' ? 'Road (unnamed)' : `${cap(h)} road (unnamed)`;
}

/** The placeholder older imports stored for an unnamed way ("Secondary_link Road", "Residential Road"). */
const LEGACY_PLACEHOLDER = /^([a-z]+(?:_[a-z]+)*) road$/i;

/**
 * Plain-language name for a road loaded from an older database: a legacy placeholder of an OSM way with no name tag
 * becomes "Secondary link road (unnamed)". A real name, or a name the user typed, is returned unchanged.
 */
export function readableRoadName(name: string | undefined, tags: Record<string, string> | undefined): string | undefined {
  if (!name || tags?.name) return name;
  const m = LEGACY_PLACEHOLDER.exec(name.trim());
  if (!m) return name;
  const highway = tags?.highway;
  // Only rewrite what the importer generated: the class in the name must be the way's own highway tag
  if (highway && highway.toLowerCase() !== m[1].toLowerCase()) return name;
  return osmUnnamedRoadName(m[1].toLowerCase());
}

/** What the snap marker says, in plain words. */
export function snapDescription(kind: 'junction' | 'start' | 'end' | 'vertex' | 't_junction', objectName: string | undefined, typeLabel: string): string {
  const what = objectName || typeLabel;
  switch (kind) {
    case 'junction': return objectName ? `Snap to junction: ${objectName}` : 'Snap to junction';
    case 'start': return `Snap to the start of ${what}`;
    case 'end': return `Snap to the end of ${what}`;
    case 'vertex': return `Snap to a point on ${what}`;
    case 't_junction': return `Join ${what} here (new T-junction)`;
  }
}
