/**
 * Flyover approach ramps from the deck height and the decided grade (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D5),
 * shared by the 3D profile (objects/flyoverHelper.ts) and the desk check (simulation/BridgeFeasibilityEngine.ts) so the
 * model and the check describe the same ramp.
 *
 * - Grade limit: 4 % on urban roads, 3.3 % on a highway (IRC:SP:90-2023 §4.13; urban = IRC:86-2018 §9.2).
 * - Vertical curves: a square parabola at the ramp foot (0 → g) and at the top (g → 0), each the minimum length for the
 *   design speed (IRC:86-2018 Table 9.2; IRC:SP:23-1993 Table 7 at 100 km/h). The sight-distance length (IRC:SP:23) is
 *   not worked out: screening only.
 * - Per end the ramp needs max(H/g, Lv) + Lv of the drawn alignment: H/g on the grade, plus half a curve at each end of
 *   it. With full curves the steepest point is exactly g.
 * - A drawn line shorter than two ramps keeps its deck height: the ramps are squeezed into half the line each, so the
 *   modelled grade is steeper than the limit. The check reports that grade (fail on a design).
 * - As-built flyovers (mapped, never reshaped here) keep the legacy 40 m smoothstep ramp: `model: 'legacy-40m'`.
 */
import type { RoadClassification } from '../../objects/types';
import { IRC86_DESIGN_SPEED_KMH, IRC_SP90_2023, VERTICAL_CURVE_MIN } from '../alignment/criteria';

/** The old fixed ramp: kept only for as-built flyovers and to read back heights made with it. */
export const LEGACY_RAMP_LENGTH_M = 40;
/** The ramp foot sits this far above the ground road so its surface stays visible (no z-fighting). Picture only. */
export const RAMP_FOOT_CLEARANCE_M = 0.25;

/**
 * Maximum approach (ramp) gradient by the class of road carried (D5):
 * urban roads 4 %, IRC:SP:90-2023 §4.13 ("a gradient of 4 percent should be considered the maximum as per IRC:86");
 * highway 3.3 %, IRC:SP:90-2023 §4.13 Table 4.12 limiting gradient, plain & rolling terrain.
 */
export function maxRampGrade(roadClass?: RoadClassification): { grade: number; source: string } {
  return roadClass === 'highway'
    ? { grade: IRC_SP90_2023.highwayLimitingGradientPct / 100, source: IRC_SP90_2023.highwayGradientSource }
    : { grade: IRC_SP90_2023.urbanMaxGradientPct / 100, source: IRC_SP90_2023.urbanGradientSource };
}

/** Class design speed (IRC:86-2018 Table 3.1, D1) when the object has none of its own. */
export function classDesignSpeedKmh(roadClass?: RoadClassification): number {
  switch (roadClass) {
    case 'highway': return IRC86_DESIGN_SPEED_KMH.urbanExpressway;
    case 'collector': return IRC86_DESIGN_SPEED_KMH.collector;
    case 'local': return IRC86_DESIGN_SPEED_KMH.local;
    default: return IRC86_DESIGN_SPEED_KMH.arterial;
  }
}

/** Minimum vertical-curve length for a design speed: the table row at or above it (the longer curve), capped at 100 km/h. */
export function verticalCurveMin(designSpeedKmh: number): { lengthM: number; source: string } {
  const keys = Object.keys(VERTICAL_CURVE_MIN).map(Number).sort((a, b) => a - b);
  const k = keys.find(v => v >= designSpeedKmh) ?? keys[keys.length - 1];
  const row = VERTICAL_CURVE_MIN[k];
  return { lengthM: row.minLengthM, source: `${row.source} (${k} km/h)` };
}

export interface FlyoverRampProfile {
  model: 'grade' | 'legacy-40m';
  deckHeightM: number;
  /** Grade limit (fraction) and its source. */
  gradeLimit: number;
  gradeSource: string;
  designSpeedKmh: number;
  /** Vertical-curve length at the foot and at the top of each ramp (the design value, before any squeeze). */
  verticalCurveM: number;
  verticalCurveSource: string;
  /** Length on the grade alone (H / g), m. */
  gradeLengthM: number;
  /** Alignment each ramp needs at the limit with its vertical curves, m (max(H/g, Lv) + Lv). */
  rampLengthM: number;
  /** Length of the drawn alignment the profile was made for, m. */
  totalLengthM: number;
  /** Ramp length actually modelled at each end, m (= rampLengthM unless the line is too short). */
  modelledRampM: number;
  /** Vertical-curve length actually modelled, m. */
  modelledCurveM: number;
  /** Steepest grade of the modelled ramp (fraction). */
  modelledMaxGrade: number;
  /** The modelled ramp stays within the limit (always true for legacy; it is not judged). */
  withinLimit: boolean;
}

export interface FlyoverRampOptions {
  roadClass?: RoadClassification;
  designSpeedKmh?: number | null;
  /** As-built (mapped) flyover: the legacy 40 m ramp, never reshaped. */
  asBuilt?: boolean;
}

const EPS = 1e-9;

/** The ramp profile for a deck height on a drawn line of `totalLengthM`. */
export function flyoverRampProfile(deckHeightM: number, totalLengthM: number, opts: FlyoverRampOptions = {}): FlyoverRampProfile {
  const H = Math.max(0, Number.isFinite(deckHeightM) ? deckHeightM : 0);
  const total = Math.max(0, totalLengthM);
  const { grade, source } = maxRampGrade(opts.roadClass);
  const speed = opts.designSpeedKmh && opts.designSpeedKmh > 0 ? opts.designSpeedKmh : classDesignSpeedKmh(opts.roadClass);
  const vc = verticalCurveMin(speed);
  const gradeLengthM = H / grade;
  if (opts.asBuilt) {
    const r = Math.min(LEGACY_RAMP_LENGTH_M, total / 2);
    return {
      model: 'legacy-40m', deckHeightM: H, gradeLimit: grade, gradeSource: source, designSpeedKmh: speed,
      verticalCurveM: vc.lengthM, verticalCurveSource: vc.source, gradeLengthM, rampLengthM: LEGACY_RAMP_LENGTH_M,
      totalLengthM: total, modelledRampM: r, modelledCurveM: 0,
      // smoothstep: steepest at mid-ramp, 1.5 × the mean
      modelledMaxGrade: r > EPS ? (1.5 * (H - RAMP_FOOT_CLEARANCE_M)) / r : 0, withinLimit: true,
    };
  }
  const Lv = vc.lengthM;
  const rampLengthM = Math.max(gradeLengthM, Lv) + Lv;
  const modelledRampM = Math.min(rampLengthM, total / 2);
  const squeeze = rampLengthM > EPS ? modelledRampM / rampLengthM : 0;
  const modelledCurveM = Math.min(Lv * squeeze, modelledRampM / 2);
  const modelledMaxGrade = modelledRampM - modelledCurveM > EPS ? H / (modelledRampM - modelledCurveM) : 0;
  return {
    model: 'grade', deckHeightM: H, gradeLimit: grade, gradeSource: source, designSpeedKmh: speed,
    verticalCurveM: Lv, verticalCurveSource: vc.source, gradeLengthM, rampLengthM, totalLengthM: total,
    modelledRampM, modelledCurveM, modelledMaxGrade, withinLimit: modelledMaxGrade <= grade + 1e-6,
  };
}

/**
 * Height of the ramp above its foot at distance `s` from the foot (0 … modelledRampM), m: a parabola over the first
 * curve, the grade, a parabola over the top curve. Above the ramp: the deck height.
 */
function gradeRampHeight(p: FlyoverRampProfile, s: number): number {
  const F = p.modelledRampM, Lc = p.modelledCurveM, H = p.deckHeightM;
  if (F <= EPS) return H;
  if (s <= 0) return 0;
  if (s >= F) return H;
  const g = p.modelledMaxGrade;
  if (Lc <= EPS) return g * s;
  if (s <= Lc) return (g * s * s) / (2 * Lc);
  if (s >= F - Lc) return H - (g * (F - s) * (F - s)) / (2 * Lc);
  return (g * Lc) / 2 + g * (s - Lc);
}

/**
 * Height of the deck surface above the ground line at chainage `d` of a line of `p.totalLengthM`, m. The ramp foot is
 * lifted by RAMP_FOOT_CLEARANCE_M (picture only), scaled so the deck itself is exactly at the deck height.
 */
export function flyoverOffsetAt(p: FlyoverRampProfile, d: number): number {
  const total = p.totalLengthM, H = p.deckHeightM, c = Math.min(RAMP_FOOT_CLEARANCE_M, H);
  const s = Math.min(d, total - d); // distance from the nearer ramp foot
  if (p.model === 'legacy-40m') {
    const r = p.modelledRampM;
    if (r <= EPS || s >= r) return H;
    const t = Math.max(0, s / r);
    return c + t * t * (3 - 2 * t) * (H - c);
  }
  const z = gradeRampHeight(p, s);
  return H > EPS ? c + (z / H) * (H - c) : 0;
}
