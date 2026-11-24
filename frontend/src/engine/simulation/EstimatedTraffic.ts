import { apiGet } from '../../lib/api';
import type { DrivableObject } from './StudyAreaExplorer';

/**
 * City-wide ESTIMATED traffic (docs/urbanos/TRAFFIC_ESTIMATED_P10.md; dataset backend/data/estimated_traffic, built by
 * urbanos-data/estimated/traffic-v1/scripts/build_estimated_traffic.py). Label: "estimated (project-level, not for decisions)".
 *
 * Every road in Pune gets a weekday daily volume from its OSM road type, lanes, the activity density around it
 * (CMP-2024 zone population + employment) and its distance to the old city, with the few parameters fitted to real
 * counts (calibration split) and checked on held-out counts. Roads at a calibration count are scaled to it. An hour and
 * a direction are taken from the Pune hourly profile and a peak inbound / outbound split. It is not measured anywhere;
 * it gives any study area the user selects edge flows that vary road by road instead of one flow per lane.
 */
export interface EstimatedTrafficModel {
  id: string;
  label: string;
  baseYear: number;
  cbd: [number, number];
  kmPerDeg: { lon: number; lat: number };
  params: Record<string, number>;
  priorDaily: Record<string, number>;
  refLanes: Record<string, number>;
  activityRef: number;
  activityFloor: number;
  groupOfHighway: Record<string, string>;
  linkFactor: number;
  /** Share of a road's estimated flow a study area takes as edge (through) traffic, fitted on calibration crossings only. */
  areaEdgeScale?: number;
  hourShare: number[];
  inboundDelta: number[];
  radialityDampKm: number;
  classShares: Record<string, Record<string, number>>;
  grid: { minLon: number; minLat: number; step: number; nx: number; ny: number; values: number[] };
  riverBridgeWays: number[];
  wayOverrides: Record<string, { factor: number; anchor: string }>;
  rules: { osmWays: number[]; kind: 'two_wheeler_only' | 'closed' | 'add_daily'; dailyMotor?: number; addDaily?: Record<string, number>; from: string | null; source: string }[];
  split?: { calibration: string[]; holdout: string[] };
}

const GROUP_OF_CLASS: Record<string, string> = { highway: 'trunk', arterial: 'primary', collector: 'tertiary', local: 'residential' };
const riverSets = new WeakMap<EstimatedTrafficModel, Set<number>>();

/** The OSM way id of a road imported from OSM (road id `osm_<way>` or its provenance), else null. */
export function osmWayOf(road: DrivableObject | undefined): number | null {
  const p = (road as { osmProvenance?: { osmId?: number | string } } | undefined)?.osmProvenance;
  if (p?.osmId !== undefined && p.osmId !== null && !Number.isNaN(Number(p.osmId))) return Number(p.osmId);
  const m = /^osm_(\d+)$/.exec(road?.id ?? '');
  return m ? Number(m[1]) : null;
}

function activity(m: EstimatedTrafficModel, lon: number, lat: number): number {
  const g = m.grid;
  const i = Math.floor((lon - g.minLon) / g.step), j = Math.floor((lat - g.minLat) / g.step);
  return i >= 0 && i < g.nx && j >= 0 && j < g.ny ? g.values[j * g.nx + i] : 0;
}
const kmBetween = (m: EstimatedTrafficModel, a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * m.kmPerDeg.lon, (a[1] - b[1]) * m.kmPerDeg.lat);

/** Middle point of a polyline as the dataset takes it: the middle vertex, or the mean of the two middle vertices. */
export function midOf(coords: readonly (readonly number[])[]): [number, number] {
  const n = coords.length;
  if (n % 2) return [coords[(n - 1) / 2][0], coords[(n - 1) / 2][1]];
  const a = coords[n / 2 - 1], b = coords[n / 2];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export interface RoadEstimateInput {
  highway: string | null;
  roadClass: string;
  lanes: number;
  oneway: boolean;
  mid: readonly number[];
  osmWay: number | null;
}

export function roadEstimateInput(road: DrivableObject): RoadEstimateInput {
  const tags = (road as { osmProvenance?: { originalTags?: Record<string, string> } }).osmProvenance?.originalTags;
  const r = road as { laneCount?: number; isOneWay?: boolean; roadClass?: string; coordinates: number[][] };
  return { highway: tags?.highway ?? null, roadClass: r.roadClass ?? 'local', lanes: Math.max(1, r.laneCount || 2), oneway: !!r.isOneWay, mid: midOf(r.coordinates), osmWay: osmWayOf(road) };
}

/**
 * Estimated weekday daily motor vehicles on a road (one-way road: its one direction; two-way: both), 0 where a rule closes it.
 * `basis` says where the number comes from.
 */
export function estimateDaily(m: EstimatedTrafficModel, x: RoadEstimateInput): { daily: number; basis: 'model' | 'anchored' | 'rule' | 'closed' } {
  const way = x.osmWay;
  if (way !== null) {
    for (const r of m.rules) {
      if (!r.osmWays.includes(way)) continue;
      if (r.kind === 'closed') return { daily: 0, basis: 'closed' };
      if (r.kind === 'two_wheeler_only' && r.dailyMotor !== undefined) return { daily: r.dailyMotor, basis: 'rule' };
    }
  }
  const hw = x.highway ?? '';
  const link = hw.endsWith('_link');
  const group = m.groupOfHighway[link ? hw.slice(0, -5) : hw] ?? GROUP_OF_CLASS[x.roadClass] ?? 'residential';
  const lanesX = x.lanes * (x.oneway ? 2 : 1);
  const act = Math.max(activity(m, x.mid[0], x.mid[1]), m.activityFloor);
  let rivers = riverSets.get(m);
  if (!rivers) { rivers = new Set(m.riverBridgeWays); riverSets.set(m, rivers); }
  const river = way !== null && rivers.has(way) ? 1 : 0;
  const p = m.params;
  const mu = p['mu_' + group] ?? Math.log(m.priorDaily[group] ?? m.priorDaily.residential);
  const ln = mu + p.b_lanes * Math.log(lanesX / (m.refLanes[group] ?? 2)) + p.b_act * Math.log(act / m.activityRef)
    + p.b_dist * (kmBetween(m, x.mid, m.cbd) - 5) + p.b_river * river;
  let v = Math.exp(ln) * (link ? m.linkFactor : 1) * (x.oneway ? 0.5 : 1);
  let basis: 'model' | 'anchored' = 'model';
  if (way !== null && m.wayOverrides[String(way)]) { v *= m.wayOverrides[String(way)].factor; basis = 'anchored'; }
  if (way !== null) for (const r of m.rules) if (r.kind === 'add_daily' && r.addDaily?.[String(way)]) v += r.addDaily[String(way)];
  return { daily: v, basis };
}

/**
 * Share of a two-way road's hourly volume travelling along `heading` (a vector, lon/lat degrees) at `at`: half each way,
 * with the peak inbound (toward the old city) / outbound tilt scaled by how radial the road runs there.
 */
export function directionShare(m: EstimatedTrafficModel, at: readonly number[], heading: readonly number[], hour: number): number {
  const dx = heading[0] * m.kmPerDeg.lon, dy = heading[1] * m.kmPerDeg.lat, L = Math.hypot(dx, dy);
  const rx = (at[0] - m.cbd[0]) * m.kmPerDeg.lon, ry = (at[1] - m.cbd[1]) * m.kmPerDeg.lat, R = Math.hypot(rx, ry);
  if (L < 1e-9 || R < 1e-9) return 0.5;
  const r = (dx * rx + dy * ry) / (L * R) * Math.min(1, R / m.radialityDampKm);   // > 0: this direction is outbound
  const inbound = 0.5 + Math.abs(r) * m.inboundDelta[((hour % 24) + 24) % 24];
  return r > 0 ? 1 - inbound : r < 0 ? inbound : 0.5;
}

/**
 * Motor vehicles per hour on one directed link of a road at `hour` (weekday). `heading` is the link's direction of travel,
 * `at` a point on it (the dataset uses the way's middle point and its first-to-last direction).
 */
export function estimatedLinkFlow(m: EstimatedTrafficModel, road: DrivableObject, at: readonly number[], heading: readonly number[], hour: number): number {
  const x = roadEstimateInput(road);
  const { daily } = estimateDaily(m, x);
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  return daily * m.hourShare[h] * (x.oneway ? 1 : directionShare(m, at, heading, h));
}

export const DEFAULT_ESTIMATED_TRAFFIC = 'pune_estimated_traffic_v1';
export async function fetchEstimatedTraffic(id = DEFAULT_ESTIMATED_TRAFFIC): Promise<EstimatedTrafficModel> {
  const doc = await apiGet<EstimatedTrafficModel & { schema?: string; status?: string }>(`/api/estimated-traffic/${encodeURIComponent(id)}`);
  if (doc?.status !== 'estimated' || !doc.params || !doc.grid?.values?.length || doc.hourShare?.length !== 24) throw new Error(`Estimated traffic ${id}: not a valid estimated-traffic model`);
  return doc;
}
