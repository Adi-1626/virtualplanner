/**
 * Standards tables used by the geometry screen (GEOMETRY_EDITOR_DESIGN.md §2.2; urban roads moved to IRC:86-2018,
 * docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md). Only values the design doc read from the
 * official texts / the Pune S–K DPR, each with its source string. Clause numbers are cited; the texts are not shipped.
 * Every use of these is SCREENING, never a design check, compliance or approval.
 */
import type { AlignmentCriteria, CriterionValue, MinRadiusFn, TransitionLengthFn } from './types';

export const SCREENING_DISCLAIMER = 'Screening only — not a design check or approval.';

/**
 * Auto radius for a `curved` object that has no design criteria (cut-and-cover box with no design speed): 50 m.
 * ASSUMED — no official figure. Cut-and-cover is a construction method; the governing curve is that of what the box
 * carries (a road: IRC:86-2018 Table 8.2 at its design speed; a metro: the project DPR). No Indian code or the Pune S–K DPR
 * gives a cut-and-cover radius, so this is a drawing aid only and the curve is reported as not checked
 * (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D6).
 */
export const FALLBACK_AUTO_RADIUS_M = 50;
export const FALLBACK_AUTO_RADIUS_LABEL = 'assumed, no official figure';

/**
 * IRC:86-2018 (Geometric Design Standards for Urban Roads and Streets, first revision, Nov 2018) Table 3.1 proposed design
 * speeds, plain terrain (km/h). Supersedes the IRC:86-1983 Table 1 values (arterial 80, collector 50). Text read from the
 * Public.Resource.Org copy (law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf); IRC sells the code and hosts no free
 * copy (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D1).
 */
export const IRC86_DESIGN_SPEED_KMH = { urbanExpressway: 80, arterial: 60, subArterial: 60, collector: 40, local: 30 } as const;
export const IRC86_DESIGN_SPEED_SOURCE = 'IRC:86-2018 Table 3.1 (plain terrain)';

/** Side friction used by the IRC radius formula R = V²/(127(e+f)) (IRC:86-2018 §8.3, IRC:73). */
export const IRC_SIDE_FRICTION = 0.15;

/** IRC:86-2018 §8.3 Table 8.2 minimum radii (m) by design speed (km/h), superelevation limited to 7 % and to 4 %. */
export const IRC86_TABLE10_MIN_RADIUS_M: Readonly<Record<number, { e7: number; e4: number }>> = {
  20: { e7: 15, e4: 20 },
  30: { e7: 30, e4: 40 },
  40: { e7: 60, e4: 70 },
  50: { e7: 90, e4: 105 },
  60: { e7: 130, e4: 150 },
  70: { e7: 175, e4: 200 },
  80: { e7: 230, e4: 265 },
};
export const IRC86_TABLE10_SOURCE = 'IRC:86-2018 Table 8.2';

/**
 * IRC:86-2018 §8.2.1 superelevation cap: 7 %; "on urban sections with frequent intersections, it will be desirable to
 * limit the super elevation to 4 per cent". Same wording as IRC:86-1983 §10.2.1.
 */
export const IRC86_EMAX = { max: 0.07, urbanDesirable: 0.04, source: 'IRC:86-2018 §8.2.1' } as const;

/** IRC:86-2018 §7.1 Table 7.1 safe stopping sight distance (m) by design speed (km/h). */
export const IRC86_TABLE8_SSD_M: Readonly<Record<number, number>> = { 20: 20, 30: 30, 40: 45, 50: 60, 60: 80, 70: 105, 80: 120 };

/** IRC:86-2018 §9.2 gradient (urban roads) and Table 9.1 minimum gradient on kerbed pavements. */
export const IRC86_GRADIENT = {
  maxPct: 4, desirableWithSlowTrafficPct: 2, source: 'IRC:86-2018 §9.2',
  minDesirablePct: 0.5, minAbsolutePct: 0.3, minSource: 'IRC:86-2018 Table 9.1',
} as const;

/**
 * Vertical curves: max grade change with no curve (%) and min vertical-curve length (m) by design speed.
 * IRC:86-2018 Table 9.2 (20–80 km/h) with IRC:SP:23-1993 Table 7 for 100 km/h.
 */
export const VERTICAL_CURVE_MIN: Readonly<Record<number, { maxGradeChangePct: number; minLengthM: number; source: string }>> = {
  20: { maxGradeChangePct: 1.5, minLengthM: 15, source: 'IRC:86-2018 Table 9.2' },
  30: { maxGradeChangePct: 1.5, minLengthM: 15, source: 'IRC:86-2018 Table 9.2' },
  40: { maxGradeChangePct: 1.2, minLengthM: 20, source: 'IRC:86-2018 Table 9.2' },
  50: { maxGradeChangePct: 1.0, minLengthM: 30, source: 'IRC:86-2018 Table 9.2' },
  60: { maxGradeChangePct: 0.8, minLengthM: 40, source: 'IRC:86-2018 Table 9.2' },
  70: { maxGradeChangePct: 0.6, minLengthM: 50, source: 'IRC:86-2018 Table 9.2' },
  80: { maxGradeChangePct: 0.6, minLengthM: 50, source: 'IRC:86-2018 Table 9.2' },
  100: { maxGradeChangePct: 0.5, minLengthM: 60, source: 'IRC:SP:23-1993 Table 7' },
};

/** IRC:73-1980 rural highways: max superelevation (plain/rolling) and Table 19 gradients. Table 16 radii were NOT read. */
export const IRC73 = {
  eMax: 0.07,
  gradientPlainRollingPct: { ruling: 3.3, limiting: 5, exceptional: 6.7 },
  gradientSource: 'IRC:73-1980 Table 19',
} as const;

/**
 * IRC:SP:90-2010 grade separators — SUPERSEDED by IRC:SP:90-2023 (first revision, July 2023). Kept for reference: its §6.14
 * 3.5 % approach-gradient cap is no longer in the 2023 edition (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D5).
 */
export const IRC_SP90 = {
  eMax: 0.07, eMaxUrbanFrequentIntersections: 0.04, eMaxSource: 'IRC:SP:90-2010 §6.13.2',
  maxGradientPct: 3.5, gradientSource: 'IRC:SP:90-2010 §6.14',
  minRadiusRightAngleTJunctionM: 9, tJunctionSource: 'IRC:SP:90-2010 §6.18',
  minStraightApproachM: 15, approachSource: 'IRC:SP:90-2010 §9.1',
  supersededBy: 'IRC:SP:90-2023',
} as const;

/**
 * IRC:SP:90-2023 Guidelines for Grade Separators and Elevated Structures (first revision, July 2023), the current edition.
 * Read from the Public.Resource.Org copy (law.resource.org/pub/in/bis/irc/irc.gov.in.sp.142.2024.pdf); tables OCR'd (scan).
 * - §4.9 Table 4.3: urban design speeds = IRC:86-2018 Table 3.1.
 * - §4.12.2 superelevation: 7 % if R < desirable minimum; 5 % if R ≥ desirable minimum on urban sections / major junctions;
 *   4 % on urban sections with frequent intersections.
 * - §4.13 gradient: urban roads "a gradient of 4 percent should be considered the maximum as per IRC:86"; highways
 *   Table 4.12 (plain & rolling) ruling 2.5 %, limiting 3.3 %; "gradient steeper than limiting gradient should be avoided".
 */
export const IRC_SP90_2023 = {
  eMaxSmallRadius: 0.07, eMaxUrbanLargeRadius: 0.05, eMaxUrbanFrequentIntersections: 0.04, eMaxSource: 'IRC:SP:90-2023 §4.12.2',
  urbanMaxGradientPct: 4, urbanGradientSource: 'IRC:SP:90-2023 §4.13 (urban roads: 4 % maximum, as IRC:86-2018 §9.2)',
  highwayRulingGradientPct: 2.5, highwayLimitingGradientPct: 3.3, highwayGradientSource: 'IRC:SP:90-2023 §4.13 Table 4.12 (plain & rolling, limiting)',
} as const;

/** Pune Metro Swargate–Katraj Revised Final DPR (21-12-2022), underground section. PROJECT values, not a national code. */
export const METRO_PUNE_SK_DPR = {
  maxDesignSpeedKmh: 90,
  minRadiusLimitingM: 120,
  minRadiusPreferentialM: 225,
  minRadiusTbmM: 200,
  minRadiusAtStationsM: 1000,
  gradientDesirableMaxPct: 3, gradientUnavoidableMaxPct: 4,
  tunnelMinGradientDesirablePct: 0.5, tunnelMinGradientAbsolutePct: 0.25, stationMaxGradientPct: 0.2,
  verticalRadiusDesirableM: 2500, verticalRadiusAbsoluteM: 1500,
  constantGradeDesirableM: 50, constantGradeAbsoluteM: 25,
  minCurveBetweenTransitionsM: 25,
  minStraightBetweenCurvesM: 25,
  source: 'Pune Metro Swargate–Katraj Revised Final DPR (2022), underground section — project value',
  elevatedNote: 'elevated section not stated in the DPR; underground-section value used',
} as const;

/** R = V²/(127(e+f)) (IRC:86-2018 §8.3, IRC:73). */
export const radiusFromFormula = (designSpeedKmh: number, e: number, f = IRC_SIDE_FRICTION) => (designSpeedKmh * designSpeedKmh) / (127 * (e + f));

export const minRadius: MinRadiusFn = (criteria: AlignmentCriteria, designSpeedKmh: number, eMax: 0.04 | 0.07): CriterionValue | null => {
  if (!(designSpeedKmh > 0) && criteria !== 'metro-pune-sk-dpr') return null;
  const ePct = Math.round(eMax * 100);
  switch (criteria) {
    case 'irc86-urban': {
      const row = IRC86_TABLE10_MIN_RADIUS_M[designSpeedKmh];
      if (row) return { valueM: eMax === 0.07 ? row.e7 : row.e4, basis: 'table', source: IRC86_TABLE10_SOURCE };
      return {
        valueM: radiusFromFormula(designSpeedKmh, eMax), basis: 'formula',
        source: `calculated from IRC:86-2018 §8.3 formula R = V²/127(e+f), f 0.15, e ${ePct} % (${designSpeedKmh} km/h is not in Table 8.2)`,
      };
    }
    case 'irc73-rural':
      return {
        valueM: radiusFromFormula(designSpeedKmh, eMax), basis: 'formula',
        source: `calculated from IRC:73-1980 formula R = V²/127(e+f), f 0.15, e ${ePct} % (Table 16 not read)`,
      };
    case 'metro-pune-sk-dpr':
      return { valueM: METRO_PUNE_SK_DPR.minRadiusLimitingM, basis: 'project-value', source: METRO_PUNE_SK_DPR.source };
    case 'none':
      return null;
  }
};

/**
 * Minimum transition length (m): the larger of 0.0215 V³/(C R), C = 80/(75+V) bounded 0.5–0.8, and 2.7 V²/R
 * (IRC:86-1983 §10.5.2 formulas; IRC:86-2018 §8.5 keeps the same two criteria — its formula images have no text layer —
 * and its Table 8.3 gives the same values, e.g. 80 km/h R 250 → 85 m, 60 km/h R 150 → 65 m).
 * Reported as "would need" while spirals are not modelled (decision D4).
 */
export const requiredTransitionLength: TransitionLengthFn = (designSpeedKmh: number, radiusM: number): CriterionValue | null => {
  if (!(designSpeedKmh > 0) || !(radiusM > 0)) return null;
  const V = designSpeedKmh;
  const C = Math.min(0.8, Math.max(0.5, 80 / (75 + V)));
  const valueM = Math.max((0.0215 * V ** 3) / (C * radiusM), (2.7 * V * V) / radiusM);
  return { valueM, basis: 'formula', source: 'calculated from the IRC:86 transition formulas (IRC:86-2018 §8.5, Table 8.3)' };
};
