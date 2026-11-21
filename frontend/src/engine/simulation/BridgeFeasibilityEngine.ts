import type { RoadObject } from '../objects/types';

// ─── Result Types ────────────────────────────────────────────────────────────

/** `unknown`: the data needed to decide is not in the model (e.g. median widths of OSM roads are not mapped). */
export type FeasibilityStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface FeasibilityCheck {
  id: string;
  name: string;
  status: FeasibilityStatus;
  message: string;
  /** null when there is nothing to measure (e.g. no road under the deck). */
  actual: number | null;
  required: number;
  unit: string;
  /** What the check was worked out from, and what it assumed. */
  basis?: string;
}

export interface SurfaceImpact {
  roadId: string;
  roadName: string;
  capacityReductionPercent: number;
  originalCapacity: number;
  reducedCapacity: number;
  reason: string;
}

export interface FeasibilityResult {
  /** No check failed. Not a statement that the flyover can be built: see `scope` and `notChecked`. */
  feasible: boolean;
  checks: FeasibilityCheck[];
  surfaceRoadImpacts: SurfaceImpact[];
  rampLengthRequired: number;
  rampLengthAvailable: { start: number; end: number };
  totalFlyoverLength: number;
  /** What kind of check this is. Always a desk screen on mapped geometry, never a feasibility study. */
  scope?: string;
  /** What these checks do not look at. A result with no failed check only means none of the checked items blocks it. */
  notChecked?: string[];
}

export const BRIDGE_SCREEN_SCOPE =
  'Desk screen on mapped road geometry (OpenStreetMap and drawn roads). Not a feasibility study.';

export const BRIDGE_SCREEN_NOT_CHECKED: string[] = [
  'Whether the ramps and piers fit inside the road width (right-of-way, land take)',
  'Vertical clearance under the deck (deck depth is not modelled)',
  'Ground conditions and foundations (no soil data)',
  'Underground utilities along the pier line',
  'Buildings, trees and heritage structures beside the alignment',
  'Structural design, construction cost and traffic diversion during works',
  'Traffic benefit (run Simulate for that)',
];

/** Distinct names, at most `max`, then "and N more". */
function listNames(names: string[], max = 4): string {
  const unique = [...new Set(names)];
  return unique.length <= max ? unique.join('; ') : `${unique.slice(0, max).join('; ')} and ${unique.length - max} more`;
}

/** Road attributes taken from OpenStreetMap: lane counts come from `lanes` tags or class defaults, median widths are always defaults. */
function isMappedOsm(road: RoadObject): boolean {
  return !!road.osmProvenance || road.id.startsWith('osm_');
}

// ─── IRC/MORTH Constants ─────────────────────────────────────────────────────

/**
 * Ramp gradient used by this desk check: 5 % (1 in 20), an app screening value with no cited source. It was labelled
 * "IRC:SP-73", which is the two-laning manual, not the grade-separator one. The grade-separator clause is
 * IRC:SP:90-2010 §6.14: a gradient "in any case greater than 3.5 percent should not be provided"
 * (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §1.5, §2.2). TODO(geometry phase 3, decision D5): move this to 3.5 % with that
 * citation together with the grade-driven flyover ramps; kept at 5 % until the user decides, so results do not change.
 */
const MAX_RAMP_GRADE = 0.05; // 5% = 1 in 20

/** IRC:6 — Minimum median width to fit a standard pier cap (2.4m cap + 0.3m clearance each side) */
const MIN_MEDIAN_FOR_PIER_M = 3.0;

/**
 * Minimum flat deck length used by the desk check (app screening value). TODO: no clause for a 50 m minimum deck was
 * found (it was labelled IRC:SP-73, the two-laning manual); find the official source or drop the citation.
 */
const MIN_FLAT_DECK_M = 50.0;

/** MORTH — Ramp merge/weave zone capacity penalty applied to the surface road */
const RAMP_MERGE_CAPACITY_REDUCTION = 0.25; // 25% reduction

// ─── Geometry Helpers ────────────────────────────────────────────────────────

export function bfe_getDistanceMeters(
  lon1: number, lat1: number,
  lon2: number, lat2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Computes the total path length of a polyline in metres. */
export function bfe_pathLengthMeters(coords: [number, number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += bfe_getDistanceMeters(
      coords[i - 1][0], coords[i - 1][1],
      coords[i][0], coords[i][1]
    );
  }
  return total;
}

/**
 * Returns the available approach road length for a ramp at a given flyover endpoint.
 * We scan all surface roads and return the longest connected road segment
 * within 60m of the flyover endpoint.
 */
export function bfe_getRampApproachLength(
  flyoverEndCoord: [number, number, number],
  roads: RoadObject[]
): number {
  let best = 0;

  for (const road of roads) {
    if (road.coordinates.length < 2) continue;

    let closestDist = Infinity;
    for (const c of road.coordinates) {
      const d = bfe_getDistanceMeters(flyoverEndCoord[0], flyoverEndCoord[1], c[0], c[1]);
      if (d < closestDist) closestDist = d;
    }

    if (closestDist > 60) continue;

    const roadLen = bfe_pathLengthMeters(road.coordinates);
    if (roadLen > best) best = roadLen;
  }

  return best;
}

/**
 * Returns all pure surface roads (type 'road') whose path passes spatially
 * within 30m of the flyover's mid-section (i.e. not the ramps).
 * Interpolates points every 10m along the flyover path to handle 2-point paths.
 */
export function bfe_findUnderpassingRoads(
  flyoverCoords: [number, number, number][],
  rampLength: number,
  allRoads: RoadObject[]
): RoadObject[] {
  if (flyoverCoords.length < 2) return [];

  const totalLen = bfe_pathLengthMeters(flyoverCoords);
  const midSection: [number, number, number][] = [];

  // Sample the flyover path every 10m; keep samples in the mid (non-ramp) zone
  const SAMPLE_INTERVAL_M = 10;
  let cumDist = 0;

  for (let i = 1; i < flyoverCoords.length; i++) {
    const p1 = flyoverCoords[i - 1];
    const p2 = flyoverCoords[i];
    const segLen = bfe_getDistanceMeters(p1[0], p1[1], p2[0], p2[1]);
    const steps = Math.max(1, Math.ceil(segLen / SAMPLE_INTERVAL_M));

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const d = cumDist + t * segLen;

      // Only include points in the flat deck (non-ramp) zone
      if (d > rampLength && d < totalLen - rampLength) {
        const pt: [number, number, number] = [
          p1[0] + t * (p2[0] - p1[0]),
          p1[1] + t * (p2[1] - p1[1]),
          (p1[2] || 0) + t * ((p2[2] || 0) - (p1[2] || 0))
        ];
        midSection.push(pt);
      }
    }
    cumDist += segLen;
  }

  if (midSection.length === 0) return [];

  const PROXIMITY_DEG = 30 / 111000; // ~30 metres in degrees

  return allRoads.filter(road => {
    if (road.type !== 'road') return false;
    for (const midPt of midSection) {
      for (const roadPt of road.coordinates) {
        const d = Math.sqrt(
          (midPt[0] - roadPt[0]) ** 2 +
          (midPt[1] - roadPt[1]) ** 2
        );
        if (d < PROXIMITY_DEG) return true;
      }
    }
    return false;
  });
}

/**
 * Returns surface roads that are spatially adjacent to a flyover ramp endpoint (within 60m).
 */
export function bfe_findRampAdjacentRoads(
  flyoverEndCoord: [number, number, number],
  allRoads: RoadObject[]
): RoadObject[] {
  const PROXIMITY_DEG = 60 / 111000; // ~60 metres
  return allRoads.filter(road => {
    if (road.type !== 'road') return false;
    return road.coordinates.some(c =>
      Math.sqrt((c[0] - flyoverEndCoord[0]) ** 2 + (c[1] - flyoverEndCoord[1]) ** 2) < PROXIMITY_DEG
    );
  });
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export class BridgeFeasibilityEngine {

  /**
   * Runs all IRC/MORTH engineering feasibility checks for a flyover.
   *
   * @param flyoverCoords  The raw ground-level coordinates of the flyover path
   * @param elevation      The peak deck elevation above ground in metres (e.g. 6.0)
   * @param flyoverLanes   Total lane count on the flyover deck
   * @param allRoads       All current RoadObjects in the scene (surface roads)
   * @returns              FeasibilityResult with individual check results and surface road impacts
   */
  public run(
    flyoverCoords: [number, number, number][],
    elevation: number,
    flyoverLanes: number,
    allRoads: RoadObject[]
  ): FeasibilityResult {

    const surfaceRoads = allRoads.filter(r => r.type === 'road');
    const checks: FeasibilityCheck[] = [];
    const impacts: SurfaceImpact[] = [];

    // ── Derived geometry ──────────────────────────────────────────────────────

    const totalLength = bfe_pathLengthMeters(flyoverCoords);

    // ramp length = elevation / max_grade (5 % app screening value; see MAX_RAMP_GRADE)
    const rampLengthRequired = Math.ceil(elevation / MAX_RAMP_GRADE);

    const startCoord = flyoverCoords[0];
    const endCoord = flyoverCoords[flyoverCoords.length - 1];

    const rampStartAvail = bfe_getRampApproachLength(startCoord, surfaceRoads);
    const rampEndAvail   = bfe_getRampApproachLength(endCoord, surfaceRoads);

    // ── Check 1: Ramp Grade (5 % screening value; IRC:SP:90 §6.14 caps 3.5 %) ─

    const minRampAvail = Math.min(rampStartAvail, rampEndAvail);
    const rampGradeStatus: FeasibilityStatus =
      minRampAvail >= rampLengthRequired ? 'pass' : 'fail';

    checks.push({
      id: 'ramp_grade',
      name: 'Ramp Grade (5 % screening value)',
      status: rampGradeStatus,
      message: rampGradeStatus === 'pass'
        ? `A ${elevation} m rise at 5% needs ${rampLengthRequired} m of ramp. The longest mapped road within 60 m of each end is long enough (start ${Math.round(rampStartAvail)} m, end ${Math.round(rampEndAvail)} m).`
        : `A ${elevation} m rise at 5% needs ${rampLengthRequired} m of ramp, but the shortest approach road found is ${Math.round(minRampAvail)} m${minRampAvail === 0 ? ' (no mapped road within 60 m of an end)' : ''}. The ramp would be steeper than 5%.`,
      actual: Math.round(minRampAvail),
      required: rampLengthRequired,
      unit: 'm approach',
      basis: 'Length of mapped roads near each end, at a 5 % ramp (app screening value; IRC:SP:90-2010 §6.14 says grade-separator gradients above 3.5 % should not be provided, which needs longer ramps). Not checked: whether that road is straight and wide enough to hold the ramp.'
    });

    // ── Check 2: Minimum Deck Length (app screening value; TODO source) ───────

    const minDeckLength = 2 * rampLengthRequired + MIN_FLAT_DECK_M;
    const deckStatus: FeasibilityStatus = totalLength >= minDeckLength ? 'pass' : 'fail';

    checks.push({
      id: 'deck_length',
      name: 'Min Deck Length (IRC:SP-73)',
      status: deckStatus,
      message: deckStatus === 'pass'
        ? `Flyover length ${Math.round(totalLength)}m ≥ minimum ${minDeckLength}m (${rampLengthRequired}m+${rampLengthRequired}m ramps + ${MIN_FLAT_DECK_M}m deck).`
        : `Flyover too short. Length ${Math.round(totalLength)}m < minimum ${minDeckLength}m. Increase flyover span.`,
      actual: Math.round(totalLength),
      required: minDeckLength,
      unit: 'm total',
      basis: 'Drawn alignment length (measured on the map).'
    });

    // ── Check 3: Pier Fit in Median (IRC:6) ───────────────────────────────────

    const underpassingRoads = bfe_findUnderpassingRoads(flyoverCoords, rampLengthRequired, surfaceRoads);
    // Median widths are only evidence when someone set them: OpenStreetMap does not map median width, so the
    // model's value for an OSM road is a class default, and those roads count as "not known" instead of narrow or wide.
    const narrowMedianRoads: string[] = [];
    const unmappedMedianRoads: string[] = [];

    for (const road of underpassingRoads) {
      const medianWidth = road.hasDivider ? (road.dividerWidth || 0) : 0;
      if (isMappedOsm(road)) unmappedMedianRoads.push(road.name);
      else if (medianWidth < MIN_MEDIAN_FOR_PIER_M) narrowMedianRoads.push(`${road.name} (${medianWidth.toFixed(1)} m median)`);
    }
    const pierFitStatus: FeasibilityStatus =
      narrowMedianRoads.length > 0 ? 'warn' : unmappedMedianRoads.length > 0 ? 'unknown' : 'pass';
    const measured = underpassingRoads.filter(r => !isMappedOsm(r));
    const unmappedNote = unmappedMedianRoads.length > 0
      ? ` Median width is not mapped for ${unmappedMedianRoads.length} OpenStreetMap road(s) under the deck (${listNames(unmappedMedianRoads)}); survey them before placing piers.`
      : '';

    checks.push({
      id: 'pier_fit',
      name: 'Pier Fit in Median (IRC:6)',
      status: pierFitStatus,
      message: underpassingRoads.length === 0
        ? 'No mapped surface road crosses under the deck mid-section (within 30 m), so no pier has to sit in a median.'
        : pierFitStatus === 'warn'
          ? `${narrowMedianRoads.length} road(s) under the deck have a median under ${MIN_MEDIAN_FOR_PIER_M} m: ${listNames(narrowMedianRoads)}. A standard pier would not fit; a portal or modified pier may be needed.${unmappedNote}`
          : pierFitStatus === 'unknown'
            ? unmappedNote.trim()
            : `All ${underpassingRoads.length} road(s) under the deck have a median of at least ${MIN_MEDIAN_FOR_PIER_M} m.`,
      actual: measured.length > 0
        ? Math.min(...measured.map(r => r.hasDivider ? (r.dividerWidth || 0) : 0))
        : null,
      required: MIN_MEDIAN_FOR_PIER_M,
      unit: 'm median',
      basis: underpassingRoads.length === 0
        ? 'Mapped roads within 30 m of the deck mid-section.'
        : unmappedMedianRoads.length > 0
          ? 'Median widths set on drawn roads; OpenStreetMap does not map median width, so OSM roads are not judged.'
          : 'Median widths as set on the roads in the model.'
    });

    // ── Check 4: Lane Count Match (MORTH) ──────────────────────────────────────

    const startAdjRoads = bfe_findRampAdjacentRoads(startCoord, surfaceRoads);
    const endAdjRoads   = bfe_findRampAdjacentRoads(endCoord, surfaceRoads);

    // De-duplicate by id
    const adjRoadMap = new Map<string, RoadObject>();
    [...startAdjRoads, ...endAdjRoads].forEach(r => adjRoadMap.set(r.id, r));
    const allAdjRoads = Array.from(adjRoadMap.values());

    let laneMatchStatus: FeasibilityStatus = 'pass';
    const laneMismatchList: string[] = [];

    for (const road of allAdjRoads) {
      if (flyoverLanes > road.laneCount) {
        laneMatchStatus = 'warn';
        laneMismatchList.push(`${road.name} (${road.laneCount} lanes)`);
      }
    }

    checks.push({
      id: 'lane_match',
      name: 'Lane Count Match (MORTH)',
      status: laneMatchStatus,
      message: laneMatchStatus === 'pass'
        ? `Flyover ${flyoverLanes} lanes matches or is ≤ adjacent surface roads.`
        : `Flyover has ${flyoverLanes} lanes but connects to: ${listNames(laneMismatchList)}. Merge bottleneck risk.`,
      actual: flyoverLanes,
      required: allAdjRoads.length > 0 ? Math.max(...allAdjRoads.map(r => r.laneCount)) : flyoverLanes,
      unit: 'lanes',
      basis: allAdjRoads.some(isMappedOsm)
        ? 'Lane counts of OpenStreetMap roads come from their lanes tag, or a default for the road class when the tag is missing.'
        : allAdjRoads.length === 0 ? 'No mapped road within 60 m of either end.' : 'Lane counts as set on the roads in the model.'
    });

    // ── Surface Road Impact Calculation ───────────────────────────────────────
    // Ramp-adjacent roads lose 25% effective capacity (MORTH weave zone penalty).

    for (const road of allAdjRoads) {
      const reducedCapacity = Math.round(road.trafficCapacity * (1 - RAMP_MERGE_CAPACITY_REDUCTION));
      impacts.push({
        roadId: road.id,
        roadName: road.name,
        capacityReductionPercent: Math.round(RAMP_MERGE_CAPACITY_REDUCTION * 100),
        originalCapacity: road.trafficCapacity,
        reducedCapacity,
        reason: 'Flyover ramp merge/weave zone reduces effective lane throughput (MORTH)'
      });
    }

    // ── Overall Feasibility ────────────────────────────────────────────────────
    const hasFail = checks.some(c => c.status === 'fail');

    return {
      feasible: !hasFail,
      checks,
      surfaceRoadImpacts: impacts,
      rampLengthRequired,
      rampLengthAvailable: {
        start: Math.round(rampStartAvail),
        end: Math.round(rampEndAvail)
      },
      totalFlyoverLength: Math.round(totalLength),
      scope: BRIDGE_SCREEN_SCOPE,
      notChecked: BRIDGE_SCREEN_NOT_CHECKED,
    };
  }
}
