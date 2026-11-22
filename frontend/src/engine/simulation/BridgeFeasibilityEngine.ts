import type { RoadClassification, RoadObject } from '../objects/types';
import { flyoverRampProfile, maxRampGrade, type FlyoverRampProfile } from '../geometry/vertical/flyoverRamp';

// ─── Result Types ────────────────────────────────────────────────────────────

/**
 * `unknown`: the data needed to decide is not in the model (e.g. median widths of OSM roads are not mapped).
 * `info`: shown for information only, never a blocker (a limit read against an as-built flyover, which is never judged).
 */
export type FeasibilityStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'info';

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
  /** Short plain-language figure for the card header; when absent the header shows `actual / required unit`. */
  display?: string;
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
  /** Alignment each ramp needs at the grade limit, with its vertical curves (m, rounded up). */
  rampLengthRequired: number;
  /** Length on the grade alone, H / g (m, rounded up). */
  rampGradeLength?: number;
  /** Ramp length the 3D model has at each end (m): the required length, or half the line when it is too short. */
  rampLengthAvailable: { start: number; end: number };
  /** The ramp profile the 3D model draws (geometry/vertical/flyoverRamp.ts), the same one this check reads. */
  rampProfile?: FlyoverRampProfile;
  totalFlyoverLength: number;
  /** What kind of check this is. Always a desk screen on mapped geometry, never a feasibility study. */
  scope?: string;
  /** What these checks do not look at. A result with no failed check only means none of the checked items blocks it. */
  notChecked?: string[];
  /** True when run on an as-built (existing, mapped) flyover: limits are information only, nothing fails, nothing is changed. */
  asBuilt?: boolean;
}

export interface BridgeScreenOptions {
  /** An existing / as-built flyover (mapped, not designed here): the grade limit is shown as information, never a fail. */
  asBuilt?: boolean;
  /** Class of the road carried (sets the gradient limit). Absent = urban road. */
  roadClass?: RoadClassification;
  /** Design speed of the deck (sets the vertical-curve length). Absent = the class design speed (IRC:86-2018 Table 3.1). */
  designSpeedKmh?: number | null;
  /**
   * Metro lines in the model (OSM imports and drawn lines). Only elevated ones (level above ground) are screened.
   * Absent = not supplied, so the metro check says it could not look.
   */
  metroLines?: MetroScreenInput[];
  /** Width of the flyover deck (m). Absent = lanes × 3.5 m + 1.5 m (assumed). */
  deckWidthM?: number;
}

export interface MetroScreenInput {
  id: string;
  name: string;
  coordinates: [number, number, number][];
  /** Track level above ground (m) as the model holds it. */
  level: number;
  /** Where the level comes from: an OSM line (bridge / layer tag only, height not mapped) or a drawn design. */
  levelSource: 'osm_assumed' | 'drawn';
  /** Modelled deck width (m); OSM does not map it. */
  deckWidthM?: number;
}

/**
 * Maha-Metro NOC zone: 20 m either side of the edge of any Metro structure. Official: UDCPR 2020 cl. 14.2.1.7, applied by
 * Maha-Metro Public Notice No. Maha Metro/Pune/Plng/NOC/9549/2026 (15.04.2026), https://punemetrorail.org/download/PUBLIC-NOTICE-ENGLISH.pdf
 * (read 2026-11-21; the same rule as backend/coordination/seed.py and screening_config.py C15).
 */
export const METRO_NOC_ZONE_M = 20;
export const METRO_NOC_SOURCE = 'UDCPR 2020 cl. 14.2.1.7 + Maha-Metro Public Notice 9549/2026 (15.04.2026)';
/**
 * Vertical clearance between a road deck and a metro viaduct used by the screen: 5.5 m, ASSUMED. No official clearance
 * standard was read for this case (IRC:54 and the IRC:SP:90 clearance clause are not read; Maha-Metro publishes no road-
 * over/under-viaduct clearance on its site that was found; decision T3 in TRANSPORT_TOOLS_CS2_RESEARCH.md). 5.5 m is the
 * figure the model already uses for the space under a flyover deck (objects/bridgeElevation.ts).
 */
export const METRO_VERTICAL_CLEARANCE_M = 5.5;
/** Depth of the upper structure (viaduct girder or flyover deck) between its running level and its underside: 2.0 m, ASSUMED (not modelled). */
export const UPPER_STRUCTURE_DEPTH_M = 2.0;
export const METRO_CLEARANCE_LABEL = 'assumed, no official clearance standard read';
/** Deck width the model assumes for an OSM metro viaduct, which does not map width. */
const OSM_METRO_DECK_WIDTH_M = 8;

export const BRIDGE_SCREEN_SCOPE =
  'Desk screen on mapped road geometry (OpenStreetMap and drawn roads). Not a feasibility study.';

export const BRIDGE_SCREEN_NOT_CHECKED: string[] = [
  'Whether the ramps and piers fit inside the road width (right-of-way, land take)',
  'Vertical clearance to roads under the deck (deck depth is not modelled); the elevated metro is screened, with assumed values',
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

/**
 * An existing, mapped flyover (OSM / municipal / surveyed record, geometry not edited here) rather than a design made in
 * this tool. Its screen is information only (D5): never "fails", and the screen never changes it or the roads around it.
 */
export function isAsBuiltFlyover(obj: { id: string; osmProvenance?: unknown; provenance?: { originalSource?: string; geometryModified?: boolean } }): boolean {
  if (obj.provenance?.geometryModified) return false;
  if (obj.osmProvenance || (obj.id ?? '').startsWith('osm_')) return true;
  const src = obj.provenance?.originalSource;
  return src === 'OSM' || src === 'municipal' || src === 'surveyed';
}

// ─── IRC/MORTH Constants ─────────────────────────────────────────────────────

/**
 * Maximum approach (ramp) gradient by the class of road carried (D5: 4 % urban, 3.3 % highway, IRC:SP:90-2023 §4.13).
 * Defined with the ramp profile (geometry/vertical/flyoverRamp.ts) so the 3D ramp and this check use one rule.
 */
export { maxRampGrade };

/** IRC:6 — Minimum median width to fit a standard pier cap (2.4m cap + 0.3m clearance each side) */
const MIN_MEDIAN_FOR_PIER_M = 3.0;

/**
 * Minimum flat deck length used by the desk check: 50 m, ASSUMED — no official figure. It was labelled IRC:SP-73 (the
 * two-laning manual); neither IRC:SP:90-2010 nor IRC:SP:90-2023 gives a minimum deck length (2010 §9.1 asks for ≥ 15 m
 * straight approach at each end of a straight stilted portion, a different thing). So the check can only warn, never fail
 * (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D6).
 */
export const MIN_FLAT_DECK_M = 50.0;
export const MIN_FLAT_DECK_LABEL = 'assumed, no official figure';

/**
 * Ramp merge/weave zone capacity penalty applied to the surface roads near each ramp end: 25 %, ASSUMED. It was labelled
 * "MORTH" with no document or clause, and none was found (p5-qa 2026-11-22), so it is shown as an assumption.
 */
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
    allRoads: RoadObject[],
    opts: BridgeScreenOptions = {}
  ): FeasibilityResult {
    const asBuilt = !!opts.asBuilt;

    const surfaceRoads = allRoads.filter(r => r.type === 'road');
    const checks: FeasibilityCheck[] = [];
    const impacts: SurfaceImpact[] = [];

    // ── Derived geometry ──────────────────────────────────────────────────────

    const totalLength = bfe_pathLengthMeters(flyoverCoords);

    // Ramp profile: the one the 3D model draws (geometry/vertical/flyoverRamp.ts, objects/flyoverHelper.ts). Each ramp needs
    // max(H/g, Lv) + Lv of the drawn line: H/g on the grade (IRC:SP:90-2023 §4.13) and half a vertical curve
    // (IRC:86-2018 Table 9.2) at each end of it. An as-built flyover is drawn with the legacy 40 m ramp and not judged.
    const design = flyoverRampProfile(elevation, totalLength, { roadClass: opts.roadClass, designSpeedKmh: opts.designSpeedKmh });
    const model = asBuilt ? flyoverRampProfile(elevation, totalLength, { roadClass: opts.roadClass, designSpeedKmh: opts.designSpeedKmh, asBuilt: true }) : design;
    const MAX_RAMP_GRADE = design.gradeLimit, MAX_RAMP_GRADE_SOURCE = design.gradeSource;
    const rampLengthRequired = Math.ceil(design.rampLengthM - 1e-6);
    const rampGradeLength = Math.ceil(design.gradeLengthM - 1e-6);
    const curve = Math.round(design.verticalCurveM);
    const pct = `${+(MAX_RAMP_GRADE * 100).toFixed(1)} %`;
    const modelPct = `${(model.modelledMaxGrade * 100).toFixed(1)} %`;
    const modelRamp = Math.round(model.modelledRampM);

    const startCoord = flyoverCoords[0];
    const endCoord = flyoverCoords[flyoverCoords.length - 1];

    // ── Check 1: Ramp Grade (IRC:SP:90-2023 §4.13; information only on an as-built flyover) ─

    const rampGradeStatus: FeasibilityStatus = asBuilt ? 'info' : design.withinLimit ? 'pass' : 'fail';
    const need = `${rampGradeLength} m on the grade plus ${rampLengthRequired - rampGradeLength} m for the vertical curves = ${rampLengthRequired} m at each end`;

    checks.push({
      id: 'ramp_grade',
      name: `Ramp grade ≤ ${pct} (${MAX_RAMP_GRADE_SOURCE})`,
      status: rampGradeStatus,
      message: asBuilt
        ? `As-built flyover: for information only. A ${elevation} m rise at ${pct} would need ${need}; the model keeps its legacy ${modelRamp} m ramps, its as-built gradient is not measured here and it is not judged against the limit.`
        : design.withinLimit
          ? `A ${elevation} m deck at ${pct} needs ${need}. The ${Math.round(totalLength)} m alignment holds both ramps and the 3D model draws them so (steepest ${modelPct}).`
          : `A ${elevation} m deck at ${pct} needs ${need} (${2 * rampLengthRequired} m for both), but the alignment is ${Math.round(totalLength)} m. The 3D model squeezes each ramp into ${modelRamp} m, a ${modelPct} grade, steeper than ${pct}. Lengthen the flyover or lower the deck.`,
      actual: modelRamp,
      required: rampLengthRequired,
      unit: 'm ramp each end',
      basis: `Ramp profile of the 3D model on the drawn alignment: H / g on the grade (${MAX_RAMP_GRADE_SOURCE}) with a ${curve} m vertical curve at its foot and top (${design.verticalCurveSource}, minimum length; the sight-distance length is not worked out). Screening only. Not checked: whether the road under each ramp is wide enough to hold it.`
    });

    // ── Check 2: Minimum Deck Length (50 m, assumed — no official figure: warn, never fail) ───────

    const minDeckLength = 2 * rampLengthRequired + MIN_FLAT_DECK_M;
    const deckShort = totalLength < minDeckLength;
    const deckStatus: FeasibilityStatus = asBuilt ? 'info' : deckShort ? 'warn' : 'pass';

    checks.push({
      id: 'deck_length',
      name: `Min deck length (${MIN_FLAT_DECK_M} m flat deck, ${MIN_FLAT_DECK_LABEL})`,
      status: deckStatus,
      message: !deckShort
        ? `Flyover length ${Math.round(totalLength)}m ≥ ${minDeckLength}m (${rampLengthRequired}m+${rampLengthRequired}m ramps + ${MIN_FLAT_DECK_M}m deck).`
        : `Flyover length ${Math.round(totalLength)}m < ${minDeckLength}m (${rampLengthRequired}m+${rampLengthRequired}m ramps at ${pct} + ${MIN_FLAT_DECK_M}m deck). The ${MIN_FLAT_DECK_M} m deck is ${MIN_FLAT_DECK_LABEL}, so this is a prompt to look, not a blocker.`,
      actual: Math.round(totalLength),
      required: minDeckLength,
      unit: 'm total',
      basis: `Drawn alignment length (measured on the map). Ramps as in the ramp-grade check (${MAX_RAMP_GRADE_SOURCE}, ${design.verticalCurveSource}); the ${MIN_FLAT_DECK_M} m flat deck is ${MIN_FLAT_DECK_LABEL}.`
    });

    // ── Check 3: Pier Fit in Median (IRC:6) ───────────────────────────────────

    const underpassingRoads = bfe_findUnderpassingRoads(flyoverCoords, model.modelledRampM, surfaceRoads);
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
        laneMismatchList.push(`${road.name} (${road.laneCount} ${road.laneCount === 1 ? 'lane' : 'lanes'})`);
      }
    }

    const adjLanes = allAdjRoads.map(r => r.laneCount);
    const laneRange = adjLanes.length === 0 ? '' : Math.min(...adjLanes) === Math.max(...adjLanes) ? `${adjLanes[0]}` : `${Math.min(...adjLanes)}–${Math.max(...adjLanes)}`;
    if (allAdjRoads.length === 0) laneMatchStatus = 'info';
    checks.push({
      id: 'lane_match',
      name: 'Lane count match',
      status: laneMatchStatus,
      // Nearness only: this check does not say the ramps are joined to those roads (the connectivity line says that).
      message: allAdjRoads.length === 0
        ? `No mapped road within 60 m of either end of the flyover, so there is nothing to compare its ${flyoverLanes} lanes with.`
        : laneMatchStatus === 'pass'
          ? `The flyover's ${flyoverLanes} ${flyoverLanes === 1 ? 'lane is' : 'lanes are'} no more than any road within 60 m of its ends (${laneRange} lanes). Whether the ramps are joined to those roads is shown under Connectivity.`
          : `The flyover has ${flyoverLanes} lanes; roads within 60 m of its ends have fewer: ${listNames(laneMismatchList)}. Merge bottleneck risk if the ramps feed them. Whether the ramps are joined to those roads is shown under Connectivity.`,
      actual: flyoverLanes,
      required: allAdjRoads.length > 0 ? Math.max(...adjLanes) : flyoverLanes,
      unit: 'lanes',
      display: allAdjRoads.length === 0 ? `Deck ${flyoverLanes} lanes` : `Deck ${flyoverLanes} lanes · roads near the ends ${laneRange}`,
      basis: (allAdjRoads.length === 0 ? 'Roads within 60 m of either end (joined or not).' : 'Roads within 60 m of either end, joined or not. ')
        + (allAdjRoads.some(isMappedOsm)
          ? 'Lane counts of OpenStreetMap roads come from their lanes tag, or a default for the road class when the tag is missing.'
          : allAdjRoads.length === 0 ? '' : 'Lane counts as set on the roads in the model.')
    });

    // ── Check 5: Elevated metro (NOC zone, footprint and vertical clearance) ───
    checks.push(metroClearanceCheck(flyoverCoords, totalLength, elevation, model.modelledRampM, opts.metroLines,
      opts.deckWidthM ?? flyoverLanes * 3.5 + 1.5));

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
        reason: 'Assumed 25 % loss in the ramp merge/weave zone (no published figure; screening assumption)'
      });
    }

    // ── As-built: information only — nothing fails, no surface road is changed ──
    if (asBuilt) {
      for (const c of checks) if (c.status === 'fail' || c.status === 'warn') c.status = 'info';
      impacts.length = 0;
    }

    // ── Overall Feasibility ────────────────────────────────────────────────────
    const hasFail = checks.some(c => c.status === 'fail');

    return {
      feasible: !hasFail,
      asBuilt: asBuilt || undefined,
      checks,
      surfaceRoadImpacts: impacts,
      rampLengthRequired,
      rampGradeLength,
      rampLengthAvailable: { start: modelRamp, end: modelRamp },
      rampProfile: model,
      totalFlyoverLength: Math.round(totalLength),
      scope: BRIDGE_SCREEN_SCOPE,
      notChecked: BRIDGE_SCREEN_NOT_CHECKED,
    };
  }
}

// ─── Elevated metro screen ──────────────────────────────────────────────────

/** Local metres east / north of `o`. */
function toLocal(o: readonly number[], p: readonly number[]): [number, number] {
  return [(p[0] - o[0]) * 111320 * Math.cos((o[1] * Math.PI) / 180), (p[1] - o[1]) * 110540];
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Samples along the drawn line every `step` m: position and chainage. */
function sampleLine(coords: [number, number, number][], step: number): { p: [number, number, number]; d: number }[] {
  const out: { p: [number, number, number]; d: number }[] = [];
  let cum = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    const seg = bfe_getDistanceMeters(a[0], a[1], b[0], b[1]);
    const n = Math.max(1, Math.ceil(seg / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), 0], d: cum + t * seg });
    }
    cum += seg;
  }
  return out;
}

/**
 * Screens a flyover against elevated metro lines in the model:
 * - inside the official Maha-Metro NOC zone (20 m from the edge of the metro structure) → NOC needed;
 * - where the two footprints overlap (crossing, or running along under / over the viaduct), the level difference
 *   less the upper structure's depth is compared with a vertical clearance. Both the clearance and the structure
 *   depth are assumed (no official standard read), and an OSM viaduct's level is the model's default because OSM
 *   does not map its height — so this can only warn ("potential conflict"), never clear or approve.
 */
export function metroClearanceCheck(
  flyoverCoords: [number, number, number][],
  totalLength: number,
  deckLevel: number,
  rampM: number,
  metroLines: MetroScreenInput[] | undefined,
  deckWidthM: number,
): FeasibilityCheck {
  const base = {
    id: 'metro_clearance',
    name: `Elevated metro (NOC ${METRO_NOC_ZONE_M} m; clearance ${METRO_VERTICAL_CLEARANCE_M} m, ${METRO_CLEARANCE_LABEL})`,
    required: METRO_VERTICAL_CLEARANCE_M,
    unit: 'm clearance',
  };
  if (!metroLines) {
    return { ...base, status: 'unknown', actual: null, message: 'Metro lines were not available to this check, so the elevated metro was not screened.', basis: 'No metro data supplied.' };
  }
  const elevated = metroLines.filter(m => m.level > 0 && m.coordinates.length >= 2);
  const origin = flyoverCoords[0];
  const samples = sampleLine(flyoverCoords, 5);
  const levelAt = (d: number) => rampM > 0 ? deckLevel * Math.max(0, Math.min(1, d / rampM, (totalLength - d) / rampM)) : deckLevel;

  type Hit = { line: MetroScreenInput; minDist: number; overlapM: number; minGap: number | null; inNoc: boolean };
  const hits: Hit[] = [];
  for (const line of elevated) {
    const pts = line.coordinates.map(c => toLocal(origin, c));
    const half = (line.deckWidthM ?? OSM_METRO_DECK_WIDTH_M) / 2;
    let minDist = Infinity, overlapM = 0, minGap: number | null = null;
    let prevOverlap: number | null = null;
    for (const s of samples) {
      const q = toLocal(origin, s.p);
      let dist = Infinity;
      for (let i = 1; i < pts.length; i++) dist = Math.min(dist, distToSegment(q, pts[i - 1], pts[i]));
      minDist = Math.min(minDist, dist);
      const overlaps = dist <= half + deckWidthM / 2;
      if (overlaps) {
        if (prevOverlap !== null) overlapM += s.d - prevOverlap;
        prevOverlap = s.d;
        const road = levelAt(s.d);
        // Running level to running level, less the depth of whichever structure is on top
        const gap = Math.abs(line.level - road) - UPPER_STRUCTURE_DEPTH_M;
        minGap = minGap === null ? gap : Math.min(minGap, gap);
      } else prevOverlap = null;
    }
    const edgeDist = minDist - half;
    if (edgeDist <= METRO_NOC_ZONE_M) hits.push({ line, minDist, overlapM, minGap, inNoc: true });
  }

  const sources = [...new Set(elevated.map(m => m.levelSource))];
  const levelBasis = sources.includes('osm_assumed')
    ? 'OpenStreetMap marks the line as elevated (bridge / layer) but does not map its height or deck width, so the model\'s 12 m level and 8 m deck are assumed.'
    : 'Metro levels as drawn in the model.';
  const basis = `Metro lines loaded in the model (study-area imports and drawn lines). NOC zone: ${METRO_NOC_SOURCE} (official). `
    + `Clearance ${METRO_VERTICAL_CLEARANCE_M} m and ${UPPER_STRUCTURE_DEPTH_M} m upper-structure depth are ${METRO_CLEARANCE_LABEL} `
    + `(IRC:54 and the IRC:SP:90 clearance clause were not read). Flyover deck level from the modelled ramp profile. ${elevated.length ? levelBasis : ''}`.trim();

  if (hits.length === 0) {
    return { ...base, status: 'info', actual: null,
      message: elevated.length === 0
        ? `No elevated metro line is loaded in the model here. Metro is loaded per study area, so this is not a confirmation that none exists; check the area is imported.`
        : `No elevated metro line loaded in the model comes within ${METRO_NOC_ZONE_M} m of the flyover (an absence in the loaded data, not a confirmation).`,
      basis };
  }
  const conflicts = hits.filter(h => h.minGap !== null && h.minGap < METRO_VERTICAL_CLEARANCE_M);
  const overlapping = hits.filter(h => h.minGap !== null);
  const names = (hs: Hit[]) => listNames(hs.map(h => h.line.name));
  const worst = overlapping.length ? Math.min(...overlapping.map(h => h.minGap!)) : null;
  const along = overlapping.filter(h => h.overlapM >= 30);
  let message: string;
  if (conflicts.length) {
    message = `Potential conflict with the elevated metro: ${names(conflicts)}. Where the flyover ${along.length ? `runs along the viaduct for about ${Math.round(Math.max(...along.map(h => h.overlapM)))} m` : 'crosses the viaduct'}, `
      + `the level difference less a ${UPPER_STRUCTURE_DEPTH_M} m structure leaves about ${Math.max(0, worst!).toFixed(1)} m, less than the ${METRO_VERTICAL_CLEARANCE_M} m used here. `
      + `${along.length ? 'Piers of one would also stand in the other\'s footprint. ' : ''}Inside the ${METRO_NOC_ZONE_M} m zone, a Maha-Metro NOC is required before any work.`;
  } else if (overlapping.length) {
    message = `The flyover crosses or runs along ${names(overlapping)}; the level difference less a ${UPPER_STRUCTURE_DEPTH_M} m structure leaves about ${worst!.toFixed(1)} m (≥ ${METRO_VERTICAL_CLEARANCE_M} m used here). Inside the ${METRO_NOC_ZONE_M} m zone, a Maha-Metro NOC is required before any work.`;
  } else {
    message = `The flyover passes within ${METRO_NOC_ZONE_M} m of ${names(hits)} without crossing it. A Maha-Metro NOC is required before any work in that zone.`;
  }
  return {
    ...base,
    status: 'warn',
    actual: worst === null ? null : Math.round(Math.max(0, worst) * 10) / 10,
    display: worst === null ? `NOC zone (${METRO_NOC_ZONE_M} m)` : `≈${Math.max(0, worst).toFixed(1)} m clear · ${METRO_VERTICAL_CLEARANCE_M} m used`,
    message,
    basis,
  };
}
