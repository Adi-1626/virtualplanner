/**
 * Horizontal alignment contract (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §3.1, phase 0).
 *
 * Editable geometry of a line object is a chain of PIs (points of intersection) with a circular radius at each interior PI.
 * `coordinates` on the object stays a DERIVED densified polyline, so every existing consumer keeps reading a polyline.
 * This file is the shared contract between the phase-1 agents: types plus the signatures of the geometry-core functions
 * (implemented in fillet.ts, densify.ts, stationing.ts, fromPolyline.ts, criteria.ts, checks.ts, remap.ts, defaults.ts).
 * Change it only with a note in your report.
 *
 * Every check result is SCREENING: a flag for a planner to look at, never a design check, compliance or approval.
 */
import type { Certainty } from '../../objects/certainty';
import type { RoadClassification, UndergroundAlignmentKind } from '../../objects/types';

// ---- stored model (travels in the object's `properties`; no backend schema change) -----------------------------------

export type CurveBehaviour = 'curved' | 'angled'; // angled = PIs only, radius always 0

export interface AlignmentPI {
  lon: number;
  lat: number;
  /** 0 = sharp angle point (no curve). Ignored at the two end PIs. */
  radiusM: number;
  /** Phase 3; absent = 0 (pure circular). */
  spiralInM?: number;
  spiralOutM?: number;
  /** auto = the auto-fillet value; user = typed or dragged. */
  radiusSource?: 'auto' | 'user';
}

export type AlignmentCriteria = 'irc86-urban' | 'irc73-rural' | 'metro-pune-sk-dpr' | 'none';

export interface HorizontalAlignment {
  v: 1;
  behaviour: CurveBehaviour;
  /** ≥ 2; first and last are the start/end points. */
  pis: AlignmentPI[];
  /** null = not set → checks say "no design speed set", never a pass. */
  designSpeedKmh: number | null;
  designSpeedSource: 'class-default' | 'user';
  /** Superelevation cap used by the screen (IRC:86-2018 §8.2.1; IRC:SP:90-2010 §6.13.2 for decks). */
  eMax: 0.04 | 0.07;
  criteria: AlignmentCriteria;
}

/** The object types that may carry `alignment`. */
export type AlignableObjectType = 'road' | 'flyover' | 'metro_flyover' | 'metro_line' | 'underground_alignment' | 'utility';

// ---- derived geometry ----------------------------------------------------------------------------------------------------

export type LonLat = [number, number];
export type LonLatZ = [number, number, number];

/** Why an interior PI carries no curve. */
export type NoCurveReason = 'end-pi' | 'radius-zero' | 'angled' | 'small-deflection';

/** One PI after the fillet and the fit rule (local plane metres, signed angles: + = left / anticlockwise). */
export interface FilletedPI {
  index: number;
  /** Signed deflection Δ in radians (0 at end PIs). */
  deflectionRad: number;
  /** The radius stored on the PI (what the user or auto-fillet asked for). */
  requestedRadiusM: number;
  /** The radius actually used after the fit rule; 0 = no curve. */
  radiusM: number;
  /** True when the requested radius did not fit and was reduced (fit rule §3.2). */
  clamped: boolean;
  /** T = R·tan(|Δ|/2). */
  tangentLengthM: number;
  /** L = R·|Δ|. */
  arcLengthM: number;
  /** Tangent-to-curve and curve-to-tangent points; null when there is no curve. */
  tc: LonLat | null;
  ct: LonLat | null;
  centre: LonLat | null;
  noCurveReason?: NoCurveReason;
}

/** One element of the horizontal alignment, with chainage along the derived line. */
export interface CurveElement {
  kind: 'tangent' | 'arc'; // 'spiral' in phase 3
  /** PI the arc belongs to; null for tangents. */
  piIndex: number | null;
  startChainageM: number;
  endChainageM: number;
  lengthM: number;
  /** Arc radius (m); null for tangents. */
  radiusM: number | null;
  /** Signed arc deflection (rad); null for tangents. */
  deflectionRad: number | null;
  start: LonLat;
  end: LonLat;
}

export type FilletError = 'too-few-pis' | 'coincident-pis' | 'u-turn';

export interface FilletResult {
  ok: boolean;
  /** Set when ok = false. u-turn: |Δ| ≥ 179° at errorPiIndex (a U-turn needs two PIs). */
  error?: FilletError;
  errorPiIndex?: number;
  pis: FilletedPI[];
  elements: CurveElement[];
  lengthM: number;
}

export interface FilletOptions {
  /** Deflections below this are straight-through (default 0.5°). */
  minDeflectionDeg?: number;
  /** Deflections at or above this are refused (default 179°). */
  maxDeflectionDeg?: number;
}

export interface DensifyOptions {
  /** Max chord sagitta on arcs (default 0.10 m). */
  sagittaM?: number;
  /** Max step along arcs (default 10 m). Tangents keep only their end points. */
  maxStepM?: number;
  /** z written on every vertex (default 0 = on the ground; the type's pipeline sets heights). */
  z?: number;
}

export interface DensifyResult {
  ok: boolean;
  error?: FilletError;
  errorPiIndex?: number;
  /** The derived polyline for `coordinates`. With every radius 0 this equals the PIs exactly. */
  coordinates: LonLatZ[];
  /** Chainage (m) at each vertex. */
  chainagesM: number[];
  /** Chainage of each PI on the line: its own vertex, or the arc midpoint for a curved PI. Used for depth controls. */
  piChainagesM: number[];
  fillet: FilletResult;
}

/** A point at a chainage on a polyline. */
export interface StationPoint {
  lon: number;
  lat: number;
  z: number;
  chainageM: number;
  /** Segment index i (between vertex i and i+1) and fraction t along it. */
  segmentIndex: number;
  t: number;
  /** Bearing of the line there, degrees clockwise from north. */
  bearingDeg: number;
}

/** Result of projecting a point onto a polyline. */
export interface ProjectedPoint extends StationPoint {
  /** Plan distance from the point to the line (m). */
  offsetM: number;
}

// ---- migration ------------------------------------------------------------------------------------------------------------

export interface FromPolylineOptions {
  /** Douglas–Peucker tolerance on the plan points (default 0.05 m). */
  toleranceM?: number;
  /** Round-trip guard (default 0.001 m): if polyline → PIs → polyline moves any vertex more, every vertex is kept as a PI. */
  roundTripToleranceM?: number;
  /** Typed (not derived) depth at vertex i, or null when none was typed. Dropped vertices whose typed depth differs from the interpolation by > 1 cm are kept as PIs. */
  typedDepthAt?: (i: number) => number | null;
  /** Fields copied onto the alignment (defaults from defaults.ts otherwise). */
  settings?: Partial<Omit<HorizontalAlignment, 'v' | 'pis'>>;
}

export interface FromPolylineResult {
  alignment: HorizontalAlignment;
  /** Index into the source coordinates of each PI (strictly increasing, first 0, last n-1). */
  keptIndices: number[];
  /** False when the round-trip guard fell back to keeping every vertex. */
  roundTripOk: boolean;
  /** Max plan deviation of the regenerated polyline from the source (m). */
  maxDeviationM: number;
}

/** Why an object's geometry may not be converted / reshaped (decision D6: OSM-imported stays locked). */
export type GeometryLockReason = 'osm-import' | 'imported-metro' | 'from-records';

// ---- criteria and checks ----------------------------------------------------------------------------------------------------

/** A minimum value with where it came from. basis 'table' = read from the cited table; 'formula' = calculated from the cited formula. */
export interface CriterionValue {
  valueM: number;
  basis: 'table' | 'formula' | 'project-value';
  /** e.g. "IRC:86-2018 Table 8.2" or "calculated from IRC:73-1980 formula R = V²/127(e+f), f 0.15". */
  source: string;
}

export type AlignmentFlagCode =
  | 'not-checked-no-design-speed'
  | 'not-checked-no-criteria'
  | 'radius-below-minimum'
  | 'radius-below-preferred'
  | 'radius-below-station-minimum'
  | 'radius-reduced-to-fit'
  | 'curves-touch-no-tangent'
  | 'transition-not-modelled'
  | 'metro-short-curve'
  | 'metro-short-straight'
  | 'sharp-angle-point'
  | 'u-turn-refused';

export interface AlignmentFlag {
  code: AlignmentFlagCode;
  /** warn = a value below a cited minimum; info = context (not checked, transition length, …). */
  severity: 'warn' | 'info';
  /** Always true: these are screening flags, never approval or compliance. */
  screening: true;
  piIndex?: number;
  /** Plain words, ending with the screening disclaimer. */
  message: string;
  /** The cited source, or 'none'. */
  source: string;
  /** Values the message talks about (m), when relevant. */
  radiusM?: number;
  requiredM?: number;
}

export interface CheckOptions {
  /** Chainages (m) of metro stations on this line; a curve containing one is checked against the station minimum. */
  stationChainagesM?: number[];
  /** Bored with a TBM (Pune S–K DPR absolute minimum 200 m). */
  tbm?: boolean;
}

// ---- remap -----------------------------------------------------------------------------------------------------------------

/** Minimal shape of a per-vertex depth entry (UndergroundVertexDepth uses crownDepthM, UtilityVertexDepth uses depthM). */
export type DepthValueKey = 'crownDepthM' | 'depthM';
export type DepthEntryLike = { certainty: Certainty; isDefault?: boolean } & Partial<Record<DepthValueKey, number | null>>;
/** A derived entry carries derived: true; certainty = the worse of the two bracketing controls; unknown → unknown. */
export type DerivedDepth<T> = T & { derived?: boolean };

/** Minimal shape of a level crossing for re-matching (engine/editing/levelCrossings.ts LevelCrossing). */
export interface CrossingLike { roadId: string; point: [number, number, number]; decision: unknown }

// ---- defaults (decisions D1–D4, D6 — not yet confirmed by the user; constants live in defaults.ts) -------------------------

export interface AlignmentDefaultsInput {
  type: AlignableObjectType;
  roadClass?: RoadClassification;
  alignmentKind?: UndergroundAlignmentKind;
}
export type AlignmentSettings = Omit<HorizontalAlignment, 'v' | 'pis'>;

// ---- function signatures (implemented by agent A; the stubs throw until then) --------------------------------------------

export type FilletAlignmentFn = (a: Pick<HorizontalAlignment, 'behaviour' | 'pis'>, opts?: FilletOptions) => FilletResult;
/** Largest radius that fits at interior PI i given its neighbours' requested tangents (fit rule); Infinity for Δ < min. */
export type MaxFittingRadiusFn = (a: Pick<HorizontalAlignment, 'pis'>, piIndex: number) => number;
export type DensifyAlignmentFn = (a: Pick<HorizontalAlignment, 'behaviour' | 'pis'>, opts?: DensifyOptions) => DensifyResult;

export type ChainagesFn = (coords: readonly (readonly number[])[]) => number[];
export type PointAtChainageFn = (coords: readonly (readonly number[])[], chainageM: number) => StationPoint | null;
export type ProjectOntoLineFn = (coords: readonly (readonly number[])[], point: readonly number[]) => ProjectedPoint | null;
export type CurveElementsFn = (a: Pick<HorizontalAlignment, 'behaviour' | 'pis'>) => CurveElement[];

export type AlignmentFromPolylineFn = (coords: readonly (readonly number[])[], opts?: FromPolylineOptions) => FromPolylineResult;
export type GeometryLockFn = (obj: { type: string; id: string; osmProvenance?: unknown; tags?: unknown; lifecycle?: string; status?: string; evidence?: string }) => GeometryLockReason | null;

export type MinRadiusFn = (criteria: AlignmentCriteria, designSpeedKmh: number, eMax: 0.04 | 0.07) => CriterionValue | null;
export type TransitionLengthFn = (designSpeedKmh: number, radiusM: number) => CriterionValue | null;
export type CheckAlignmentFn = (a: HorizontalAlignment, opts?: CheckOptions) => AlignmentFlag[];

export type RemapSectionsFn = <S extends { startNodeIndex: number; endNodeIndex: number }>(
  sections: readonly S[], oldCoords: readonly (readonly number[])[], newCoords: readonly (readonly number[])[],
) => S[];
export type InterpolateDepthsFn = <T extends DepthEntryLike>(
  controls: readonly T[], controlChainagesM: readonly number[], vertexChainagesM: readonly number[], valueKey: DepthValueKey,
) => DerivedDepth<T>[];
export type RematchCrossingsFn = <C extends CrossingLike>(previous: readonly C[], next: readonly C[], toleranceM?: number) => C[];

export type DefaultAlignmentSettingsFn = (input: AlignmentDefaultsInput) => AlignmentSettings;
