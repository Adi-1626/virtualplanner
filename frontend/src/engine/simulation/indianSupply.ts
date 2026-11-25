import type { DrivableObject, StudyArea } from './StudyAreaExplorer';
import { VEHICLE_TYPES } from './TrafficMicroSim';
import { roadKeys } from './roadSection';
import { entryCapacityPcu } from '../streetDesign/roundabout';
import { ircCategory } from './roadParameters';
import { P14, FRICTION_ORDER, type FrictionClass, type UrbanClass } from './supplyConfig';

/**
 * p14 supply model for Indian urban roads (docs/urbanos/SUPPLY_P14.md): free-flow speed and mid-block capacity by road
 * class, carriageway typology, lane width and side friction; the Indo-HCM volume-delay function; unsignalised priority
 * and roundabout entry delay. Every number comes from supplyConfig.ts (P14), labelled there.
 */

/** A building as the side-friction inference reads it: centroid and whether it is commercial frontage (shop, office, amenity). */
export type BuildingPoint = readonly [number, number, 0 | 1];

const M_PER_DEG = 111320;
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * M_PER_DEG * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * M_PER_DEG);
const tagsOf = (r: DrivableObject | undefined): Record<string, string> => (r?.type === 'road' ? r.osmProvenance?.originalTags ?? {} : {});

/** Urban road class of a road: from its OSM highway tag, else from the drawn road's class. */
export function urbanClassOf(road: DrivableObject | undefined): UrbanClass {
  const hw = tagsOf(road).highway;
  if (hw) return P14.classOfHighway.value[hw] ?? 'local';
  const cls = road?.roadClass ?? 'local';
  return cls === 'highway' || cls === 'arterial' ? 'arterial' : cls === 'collector' ? 'collector' : 'local';
}

/** Lane capacity of the carriageway's base section (PCU/h/lane), Indo-HCM Table 5.4 by typology. */
export function baseLaneCapacityPcu(lanesThisWay: number, twoWayUndivided: boolean, cls: UrbanClass): number {
  const c = P14.laneCapacityPcu.value, n = Math.max(1, Math.round(lanesThisWay));
  if (twoWayUndivided) return n <= 1 ? c.undivided2 : c.divided4 * P14.undividedMultilaneRatio.value;
  // A carriageway of a divided road, or a one-way street; a single-lane one is taken as the two-lane undivided lane (assumption)
  if (n <= 1) return c.undivided2;
  if (n === 2) return c.divided4;
  // 8- and 10-lane values only where signals are 1-3 km apart (Table 5.4 note): urban expressways only
  if (n >= 4 && cls === 'expressway') return n >= 5 ? c.divided10 : c.divided8;
  return c.divided6;
}

/** Operating speed (85th percentile of car free speeds) of a base section with this lane capacity (Indo-HCM Eq. 5.4 inverted). */
export function operatingSpeedOfLaneCapacity(laneCapPcu: number): number {
  const m = P14.laneCapacityFromSpeed.value;
  return Math.min(m.maxKmh, Math.max(m.minKmh, (laneCapPcu - m.intercept) / m.slope));
}

/** Lane width (m): the OSM width / est_width of the carriageway shared by its lanes, else the class default. */
export function laneWidthM(road: DrivableObject | undefined, lanesTotal: number): number {
  const t = tagsOf(road);
  const w = parseFloat(t.width ?? t.est_width ?? '');
  if (Number.isFinite(w) && w > 2 && lanesTotal > 0) return w / lanesTotal;
  return /^(residential|living_street|service|unclassified)$/.test(t.highway ?? '') ? P14.accessRoadLaneWidthM.value : P14.baseLaneWidthM.value;
}

/** Free-flow speed factor for lane width (HCM 2000 Exhibit 21-4 relative to the 3.5 m base; 1 at 3.5 m and wider). */
export function laneWidthFactor(widthM: number): number {
  const rows = P14.laneWidthReduction.value;
  const f = (w: number) => {
    const x = Math.max(3.0, Math.min(3.6, w));
    for (let i = 1; i < rows.length; i++) {
      const [w0, r0] = rows[i - 1], [w1, r1] = rows[i];
      if (x <= w0 && x >= w1) return r0 + (r1 - r0) * (w0 - x) / (w0 - w1);
    }
    return 0;
  };
  return Math.min(1, 1 - (f(widthM) - f(P14.baseLaneWidthM.value)) / 100);
}

export interface P14LinkSupply {
  cls: UrbanClass;
  friction: FrictionClass;
  /** Operating speed of the base section (km/h): min(design speed, typology speed). */
  operatingKmh: number;
  /** Mean free-flow speed of cars (km/h), after the posted cap, lane width and side friction. */
  carFfsKmh: number;
  /** Speed of the mixed stream at low flow (km/h) = carFfsKmh x s0. */
  streamKmh: number;
  laneCapPcu: number;
  /** Mid-block capacity of this direction (PCU/h, Indo-HCM PCUs) after side friction. */
  capacityPcu: number;
  laneWidthM: number;
}

/**
 * p14 free-flow speed and capacity of one direction of a carriageway.
 * `postedKmh`: the posted limit (OSM maxspeed, a connected piece's maxspeed, the municipal default, or the speed a drawn
 * road was given): a cap on the mean car speed, no longer the free-flow speed itself (p13 decision D1 used it as such).
 */
export function p14LinkSupply(road: DrivableObject | undefined, lanesThisWay: number, twoWayUndivided: boolean, postedKmh: number, friction: FrictionClass): P14LinkSupply {
  const cls = urbanClassOf(road);
  const laneCap = baseLaneCapacityPcu(lanesThisWay, twoWayUndivided, cls);
  const operating = Math.min(P14.designSpeedKmh.value[cls], operatingSpeedOfLaneCapacity(laneCap));
  const width = laneWidthM(road, twoWayUndivided ? 2 * Math.max(1, lanesThisWay) : Math.max(1, lanesThisWay));
  const ff = P14.frictionFactor.value[friction];
  const carFfs = Math.max(10, Math.min(postedKmh > 0 ? postedKmh : Infinity, operating * P14.meanOfOperatingSpeed.value) * laneWidthFactor(width) * ff);
  return { cls, friction, operatingKmh: operating, carFfsKmh: carFfs, streamKmh: carFfs * P14.vdf.value.s0, laneCapPcu: laneCap,
    capacityPcu: laneCap * Math.max(1, Math.round(lanesThisWay)) * ff, laneWidthM: width };
}

// ── Volume-delay function ───────────────────────────────────────────────

/** Travel time / car free-flow time at volume/capacity x (Indo-HCM Table 5.7 fit; linear along the tangent above x = 1). */
export function p14TimeRatio(x: number): number {
  const { alpha, beta, s0 } = P14.vdf.value;
  const v = Math.max(0, x);
  if (v <= 1 || !P14.vdfLinearAboveCapacity.value) return (1 + alpha * Math.pow(v, beta)) / s0;
  return (1 + alpha + alpha * beta * (v - 1)) / s0;
}

// ── PCU ─────────────────────────────────────────────────────────────────

const meanPcu = (table: Record<string, number>) => VEHICLE_TYPES.reduce((n, t) => n + t.share * (table[t.kind] ?? 1), 0);
/** Multiply an Indo-HCM saturation flow (Table 6.3 PCUs) by this to express it in mid-block PCUs (Table 5.2) for the Pune mix. */
export const SIGNAL_TO_MIDBLOCK_PCU = meanPcu(P14.pcuMidblock.value) / meanPcu(P14.pcuSignal.value);
/** Heavy vehicles (buses, trucks) in the mix, % of vehicles. */
export const HEAVY_PCT = 100 * VEHICLE_TYPES.filter(t => t.kind === 'bus' || t.kind === 'truck').reduce((n, t) => n + t.share, 0);

// ── Unsignalised junctions ──────────────────────────────────────────────

export interface GapParams { tcBase: number; fLV: number; a: number; b: number }
/** Critical and follow-up gaps (s): t_c = t_c,base + f_LV ln(P_HV), t_f = 0.6 t_c (Indo-HCM Ch. 8 as quoted). */
export function gaps(p: GapParams, heavyPct = HEAVY_PCT) {
  const tc = p.tcBase + p.fLV * Math.log(Math.max(P14.heavyShareFloorPct.value, heavyPct));
  return { tc, tf: P14.followUpShare.value * tc };
}
/** Movement capacity (PCU/h) against a conflicting flow vc (PCU/h): C = a vc e^(-vc (tc - b)/3600) / (1 - e^(-vc tf/3600)). */
export function gapCapacityPcu(vc: number, p: GapParams, heavyPct = HEAVY_PCT): number {
  const { tc, tf } = gaps(p, heavyPct);
  return capacityFromGaps(vc, tc, tf, p.a, p.b);
}
/** The Indo-HCM Ch. 8 movement capacity for given gaps (vc -> 0: 3600 a / tf). */
export function capacityFromGaps(vc: number, tc: number, tf: number, a: number, b: number): number {
  if (vc < 1) return 3600 * a / tf;
  return a * vc * Math.exp(-vc * (tc - b) / 3600) / (1 - Math.exp(-vc * tf / 3600));
}
/** Control delay (s/veh) of a stream v (PCU/h) at capacity c (PCU/h) over T hours (HCM 2000 Eq. 17-38). */
export function controlDelayS(v: number, c: number, T = P14.delayPeriodH.value): number {
  const cap = Math.max(1, c), x = Math.max(0, v) / cap;
  return 3600 / cap + 900 * T * ((x - 1) + Math.sqrt((x - 1) ** 2 + (3600 / cap) * x / (450 * T))) + 5;
}

/** Roundabout entry capacity per lane (PCU/h) from the ring's inscribed circle diameter and the circulating flow (IRC:65 Table 9.1). */
export function roundaboutEntryPcu(icdM: number, qcPcu: number): number {
  return entryCapacityPcu(Math.min(70, Math.max(20.5, icdM)), Math.max(0, qcPcu)) ?? 1200;
}

// ── Side friction ───────────────────────────────────────────────────────

/** OSM buildings (backend /api/osm/buildings elements) as centroids with a commercial-frontage flag. */
export function buildingPointsFromOsm(elements: readonly { tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }[]): BuildingPoint[] {
  const out: BuildingPoint[] = [];
  for (const el of elements) {
    const g = el.geometry;
    if (!g?.length) continue;
    let x = 0, y = 0;
    for (const p of g) { x += p.lon; y += p.lat; }
    const t = el.tags ?? {};
    const commercial = /^(commercial|retail|office|supermarket|kiosk|hotel)$/.test(t.building ?? '') || !!t.shop || !!t.amenity || !!t.office;
    out.push([x / g.length, y / g.length, commercial ? 1 : 0]);
  }
  return out;
}

export interface FrictionInfo { cls: FrictionClass; accessPerKm: number; buildingsPer100m: number | null; commercialPer100m: number | null; lengthM: number; basis: string }

/** No frontage: flyovers, bridges, tunnels, ramps, motorways, motor roads. */
function noFrontage(road: DrivableObject | undefined): boolean {
  if (!road) return false;
  if (road.type === 'flyover' || road.type === 'metro_flyover') return true;
  const t = tagsOf(road);
  return /^(motorway|.*_link)$/.test(t.highway ?? '') || t.motorroad === 'yes' || (!!t.bridge && t.bridge !== 'no') || (!!t.tunnel && t.tunnel !== 'no');
}

/**
 * Side-friction level per road of the area (docs/urbanos/SUPPLY_P14.md §1.3). Roads are grouped by name / ref and OSM
 * class (one road split into many OSM ways is one road); a road's level is the higher of:
 *  - access points: junctions on it where another road joins, per km (thresholds P14.accessPerKm);
 *  - frontage: buildings with a centroid within P14.buildingsPer100m.frontageM of it, per 100 m, and commercial ones
 *    (only when building points are given; without them the level rests on access points alone, said in `basis`).
 */
export function frictionByRoad(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, buildings?: readonly BuildingPoint[] | null): Map<string, FrictionInfo> {
  const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');
  const included = new Set(area.segments.map(s => s.key));
  const edges = [...area.network.edges.values()].filter(e => included.has(segKey(e.id)));
  const groupOf = new Map<string, string>();
  for (const e of edges) {
    if (groupOf.has(e.roadId)) continue;
    const r = roads.get(e.roadId);
    const k = [...roadKeys(r)].sort()[0];
    groupOf.set(e.roadId, k ? `${k}|${tagsOf(r).highway ?? r?.roadClass ?? ''}` : `id:${e.roadId}`);
  }
  // Length (each stretch once) and nodes per group; groups meeting at each node
  const len = new Map<string, number>(), nodes = new Map<string, Set<string>>(), atNode = new Map<string, Set<string>>();
  const seenSeg = new Set<string>();
  for (const e of edges) {
    const g = groupOf.get(e.roadId)!;
    const sk = segKey(e.id);
    if (!seenSeg.has(sk)) { seenSeg.add(sk); len.set(g, (len.get(g) ?? 0) + e.length); }
    const ns = nodes.get(g) ?? nodes.set(g, new Set()).get(g)!;
    for (const n of [e.fromNodeId, e.toNodeId]) { ns.add(n); (atNode.get(n) ?? atNode.set(n, new Set()).get(n)!).add(g); }
  }
  // Buildings near each group's roads (grid hash, ~55 m cells)
  const cell = 0.0005, frontage = P14.buildingsPer100m.value.frontageM;
  const grid = new Map<string, number[]>();
  if (buildings?.length) buildings.forEach((b, i) => { const k = `${Math.floor(b[0] / cell)}:${Math.floor(b[1] / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); });
  const near = new Map<string, Set<number>>();
  if (buildings?.length) {
    const roadsOfGroup = new Map<string, Set<string>>();
    groupOf.forEach((g, id) => (roadsOfGroup.get(g) ?? roadsOfGroup.set(g, new Set()).get(g)!).add(id));
    roadsOfGroup.forEach((ids, g) => {
      const found = near.get(g) ?? near.set(g, new Set()).get(g)!;
      for (const id of ids) {
        const c = roads.get(id)?.coordinates as number[][] | undefined;
        if (!c || c.length < 2) continue;
        for (let i = 1; i < c.length; i++) {
          const d = distM(c[i - 1], c[i]), steps = Math.max(1, Math.ceil(d / 20));
          for (let s = 0; s <= steps; s++) {
            const p = [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * s / steps, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * s / steps];
            const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const bi of grid.get(`${cx + dx}:${cy + dy}`) ?? []) if (!found.has(bi) && distM(p, buildings[bi]) <= frontage) found.add(bi);
          }
        }
      }
    });
  }
  const th = P14.accessPerKm.value, bt = P14.buildingsPer100m.value;
  const out = new Map<string, FrictionInfo>();
  const byGroup = new Map<string, FrictionInfo>();
  for (const [g, L] of len) {
    let access = 0;
    for (const n of nodes.get(g) ?? []) if ((atNode.get(n)?.size ?? 0) >= 2) access++;
    const km = Math.max(0.2, L / 1000);
    const accessPerKm = access / km;
    let cls: FrictionClass = accessPerKm >= th.high ? 'high' : accessPerKm >= th.medium ? 'medium' : 'low';
    let bPer: number | null = null, cPer: number | null = null, basis = 'access points';
    if (buildings) {
      const ids = near.get(g) ?? new Set<number>();
      let comm = 0;
      for (const bi of ids) comm += buildings[bi][2];
      const per = 100 / Math.max(100, L);
      bPer = ids.size * per; cPer = comm * per; basis = 'access points and building frontage';
      const bc: FrictionClass = cPer >= bt.commercialHigh || bPer >= bt.high ? 'high' : bPer >= bt.medium ? 'medium' : 'low';
      if (FRICTION_ORDER.indexOf(bc) > FRICTION_ORDER.indexOf(cls)) cls = bc;
    }
    byGroup.set(g, { cls, accessPerKm, buildingsPer100m: bPer, commercialPer100m: cPer, lengthM: L, basis });
  }
  groupOf.forEach((g, id) => {
    const info = byGroup.get(g)!;
    out.set(id, noFrontage(roads.get(id)) ? { ...info, cls: 'none', basis: 'no frontage (flyover, bridge, ramp or motorway)' } : info);
  });
  return out;
}

/** Road group of a road for junction inference: its first name / ref key, else its id. */
export function roadGroupKey(road: DrivableObject | undefined, id: string): string {
  const k = [...roadKeys(road)].sort()[0];
  return k ?? `id:${id}`;
}
const isRamp = (road: DrivableObject | undefined) => /_link$/.test(tagsOf(road).highway ?? '');

/**
 * p14: junctions taken as signalised although no signal is mapped (P14.inferSignals): where 3+ stretches meet and at least
 * two different roads (by name / ref) of IRC category arterial or sub-arterial, not ramps, arrive; not on a mapped
 * roundabout ring and not within matchM of a mapped signal. Returns the node coordinates.
 */
export function inferredSignalPoints(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, mapped: readonly (readonly [number, number])[] | undefined): [number, number][] {
  const { maxCategory, matchM } = P14.inferSignals.value;
  const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');
  const included = new Set(area.segments.map(s => s.key));
  const arms = new Map<string, Set<string>>(), groups = new Map<string, Set<string>>(), ring = new Set<string>();
  for (const e of area.network.edges.values()) {
    if (!included.has(segKey(e.id))) continue;
    const r = roads.get(e.roadId);
    for (const n of [e.fromNodeId, e.toNodeId]) {
      (arms.get(n) ?? arms.set(n, new Set()).get(n)!).add(segKey(e.id));
      if (r?.type === 'road' && r.osmProvenance?.roundabout) ring.add(n);
      if (!isRamp(r) && ircCategory(r) <= maxCategory) (groups.get(n) ?? groups.set(n, new Set()).get(n)!).add(roadGroupKey(r, e.roadId));
    }
  }
  const out: [number, number][] = [];
  for (const [n, g] of groups) {
    if (g.size < 2 || (arms.get(n)?.size ?? 0) < 3 || ring.has(n)) continue;
    const c = area.network.nodes.get(n)?.coordinates;
    if (!c) continue;
    if (mapped?.some(p => distM(p, c) < matchM)) continue;
    out.push([c[0], c[1]]);
  }
  return out;
}

/** Priority rank of an approach at an unsignalised junction (lower = higher priority): IRC category, ramps below their class. */
export const approachRank = (road: DrivableObject | undefined) => 2 * ircCategory(road) + (isRamp(road) ? 1 : 0);
