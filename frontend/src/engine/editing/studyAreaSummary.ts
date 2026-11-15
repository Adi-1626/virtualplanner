import type { Area, CityObject } from '../objects/types';
import { pointInArea } from './studyAreaImport';

/**
 * What a study area holds, counted from the objects in the project (imported
 * and drawn), for the Study area summary. Pure, so it is unit-tested.
 *
 * Honesty labels (docs/urbanos/DESIGN_WORKSPACE.md, Study Area):
 * - road length, buildings, metro and signal counts are MEASURED from the
 *   mapped data (OpenStreetMap); completeness is OSM's, not a survey;
 * - junctions are DERIVED: vertices where three or more road arms meet, from
 *   the road geometry (OSM ways share the vertex where roads connect).
 */
export interface StudyAreaSummary {
  /** Road length inside the area by OSM highway class (km); user-drawn roads count under their class. */
  roadKmByClass: { cls: string; km: number }[];
  roadKm: number;
  roads: number;
  /** Of roadKm: on bridges / flyovers (OSM bridge=*) or user flyovers. */
  elevatedKm: number;
  junctions: number;
  roundaboutJunctions: number;
  /** Mapped signals (OSM highway=traffic_signals) inside; null until the area's data was loaded this session. */
  signals: number | null;
  buildings: number;
  metroKm: number;
  metroStations: number;
  /** Area of the polygon, km². */
  areaKm2: number;
}

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
function metres(a: readonly number[], b: readonly number[]): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Polygon area on a local equirectangular projection (good to well under 1 % for a few km). */
export function polygonAreaKm2(ring: readonly (readonly number[])[]): number {
  if (ring.length < 3) return 0;
  const lat0 = rad(ring.reduce((s, p) => s + p[1], 0) / ring.length);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = rad(ring[i][0]) * Math.cos(lat0) * R, yi = rad(ring[i][1]) * R;
    const xj = rad(ring[j][0]) * Math.cos(lat0) * R, yj = rad(ring[j][1]) * R;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a) / 2 / 1e6;
}

const key = (p: readonly number[]) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/** The OSM highway value, or the app road class for drawn roads. */
function roadClassLabel(o: any): string {
  const hw: string | undefined = o.osmProvenance?.originalTags?.highway;
  if (hw) return hw.replace(/_link$/, ' link');
  return o.type === 'flyover' || o.type === 'metro_flyover' ? 'flyover (drawn)' : `${o.roadClass ?? 'road'} (drawn)`;
}

const ROAD_TYPES = new Set(['road', 'flyover', 'metro_flyover']);

/** Length of a polyline inside the area: each segment counted by the share of its sample points inside. */
function lengthInside(coords: readonly (readonly number[])[], area: Area): number {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const d = metres(a, b);
    if (d === 0) continue;
    const n = Math.min(16, Math.max(1, Math.ceil(d / 25)));
    let inside = 0;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (pointInArea([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], area)) inside++;
    }
    m += (d * inside) / n;
  }
  return m;
}

export function summariseStudyArea(area: Area, objects: readonly CityObject[], signals: readonly (readonly number[])[] | null = null): StudyAreaSummary {
  const inBox = (p: readonly number[]) => p[0] >= area.minLon && p[0] <= area.maxLon && p[1] >= area.minLat && p[1] <= area.maxLat;
  // A line can cross the area with no vertex inside it: test its bounding box, not its vertices
  const lineNear = (c: readonly (readonly number[])[]) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of c) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    return x1 >= area.minLon && x0 <= area.maxLon && y1 >= area.minLat && y0 <= area.maxLat;
  };
  const byClass = new Map<string, number>();
  let roadKm = 0, roads = 0, elevatedKm = 0, metroKm = 0, metroStations = 0, buildings = 0;
  // vertex key -> neighbouring vertex keys (arms), and whether a roundabout way passes
  const arms = new Map<string, Set<string>>();
  const roundabout = new Set<string>();
  const at = new Map<string, readonly number[]>();

  for (const o of objects as any[]) {
    const coords = o.coordinates as readonly (readonly number[])[] | undefined;
    if (!Array.isArray(coords) || !coords.length) continue;
    if (ROAD_TYPES.has(o.type)) {
      if (!lineNear(coords)) continue;
      const m = lengthInside(coords, area);
      if (m <= 0) continue;
      roads++;
      roadKm += m / 1000;
      const cls = roadClassLabel(o);
      byClass.set(cls, (byClass.get(cls) ?? 0) + m / 1000);
      if (o.type !== 'road' || o.osmProvenance?.bridge) elevatedKm += m / 1000;
      if (o.type !== 'road') continue; // grade-separated decks do not make at-grade junctions
      for (let i = 0; i < coords.length; i++) {
        const k = key(coords[i]);
        let s = arms.get(k);
        if (!s) { s = new Set(); arms.set(k, s); at.set(k, coords[i]); }
        if (i > 0) s.add(key(coords[i - 1]));
        if (i < coords.length - 1) s.add(key(coords[i + 1]));
        if (o.osmProvenance?.roundabout) roundabout.add(k);
      }
    } else if (o.type === 'building') {
      if (coords.some(inBox) && coords.some(p => pointInArea(p, area))) buildings++;
    } else if (o.type === 'metro_line') {
      if (lineNear(coords)) metroKm += lengthInside(coords, area) / 1000;
    } else if (o.type === 'metro_station') {
      const p = (Array.isArray(coords[0]) ? coords[0] : coords) as readonly number[];
      if (pointInArea(p, area)) metroStations++;
    }
  }

  let junctions = 0, roundaboutJunctions = 0;
  for (const [k, s] of arms) {
    if (s.size < 3 || !pointInArea(at.get(k)!, area)) continue;
    junctions++;
    if (roundabout.has(k)) roundaboutJunctions++;
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    roadKmByClass: [...byClass].map(([cls, km]) => ({ cls, km: round(km) })).sort((a, b) => b.km - a.km),
    roadKm: round(roadKm),
    roads,
    elevatedKm: round(elevatedKm),
    junctions,
    roundaboutJunctions,
    signals: signals ? signals.filter(p => pointInArea(p, area)).length : null,
    buildings,
    metroKm: round(metroKm),
    metroStations,
    areaKm2: round(polygonAreaKm2(area.polygonCoordinates)),
  };
}
