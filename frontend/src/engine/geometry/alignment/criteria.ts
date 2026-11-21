/**
 * Standards tables used by the geometry screen (GEOMETRY_EDITOR_DESIGN.md §2.2). Only values the design doc read from the
 * official texts / the Pune S–K DPR, each with its source string. Clause numbers are cited; the texts are not shipped.
 * Every use of these is SCREENING, never a design check, compliance or approval.
 */
import type { AlignmentCriteria, CriterionValue, MinRadiusFn, TransitionLengthFn } from './types';

export const SCREENING_DISCLAIMER = 'Screening only — not a design check or approval.';

/** IRC:86-1983 Table 1 design speeds (km/h). */
export const IRC86_DESIGN_SPEED_KMH = { arterial: 80, subArterial: 60, collector: 50, local: 30 } as const;
export const IRC86_DESIGN_SPEED_SOURCE = 'IRC:86-1983 Table 1';

/** Side friction used by the IRC radius formula R = V²/(127(e+f)) (IRC:86 §10.3, IRC:73). */
export const IRC_SIDE_FRICTION = 0.15;

/** IRC:86-1983 §10.3 Table 10 minimum radii (m) by design speed (km/h), for e = 7 % and e = 4 %. */
export const IRC86_TABLE10_MIN_RADIUS_M: Readonly<Record<number, { e7: number; e4: number }>> = {
  30: { e7: 30, e4: 40 },
  50: { e7: 90, e4: 105 },
  60: { e7: 130, e4: 150 },
  80: { e7: 230, e4: 265 },
};
export const IRC86_TABLE10_SOURCE = 'IRC:86-1983 Table 10';

/** IRC:86-1983 §10.2.1 superelevation cap: 7 %, desirably 4 % on urban sections with frequent intersections. */
export const IRC86_EMAX = { max: 0.07, urbanDesirable: 0.04, source: 'IRC:86-1983 §10.2.1' } as const;

/** IRC:86-1983 §9 Table 8 safe stopping sight distance (m) by design speed (km/h). */
export const IRC86_TABLE8_SSD_M: Readonly<Record<number, number>> = { 30: 30, 50: 60, 60: 80, 80: 120 };

/** IRC:86-1983 §11.2 gradient (urban roads) and Table 13 minimum gradient on kerbed pavements. */
export const IRC86_GRADIENT = {
  maxPct: 4, desirableWithSlowTrafficPct: 2, source: 'IRC:86-1983 §11.2',
  minDesirablePct: 0.5, minAbsolutePct: 0.3, minSource: 'IRC:86-1983 Table 13',
} as const;

/**
 * Vertical curves: max grade change with no curve (%) and min vertical-curve length (m) by design speed.
 * IRC:86-1983 Table 14 (30/50/60/80) with IRC:SP:23-1993 Table 7 adding 40 and 100 km/h.
 */
export const VERTICAL_CURVE_MIN: Readonly<Record<number, { maxGradeChangePct: number; minLengthM: number; source: string }>> = {
  30: { maxGradeChangePct: 1.5, minLengthM: 15, source: 'IRC:86-1983 Table 14' },
  40: { maxGradeChangePct: 1.2, minLengthM: 20, source: 'IRC:SP:23-1993 Table 7' },
  50: { maxGradeChangePct: 1.0, minLengthM: 30, source: 'IRC:86-1983 Table 14' },
  60: { maxGradeChangePct: 0.8, minLengthM: 40, source: 'IRC:86-1983 Table 14' },
  80: { maxGradeChangePct: 0.6, minLengthM: 50, source: 'IRC:86-1983 Table 14' },
  100: { maxGradeChangePct: 0.5, minLengthM: 60, source: 'IRC:SP:23-1993 Table 7' },
};

/** IRC:73-1980 rural highways: max superelevation (plain/rolling) and Table 19 gradients. Table 16 radii were NOT read. */
export const IRC73 = {
  eMax: 0.07,
  gradientPlainRollingPct: { ruling: 3.3, limiting: 5, exceptional: 6.7 },
  gradientSource: 'IRC:73-1980 Table 19',
} as const;

/** IRC:SP:90-2010 grade separators. */
export const IRC_SP90 = {
  eMax: 0.07, eMaxUrbanFrequentIntersections: 0.04, eMaxSource: 'IRC:SP:90-2010 §6.13.2',
  maxGradientPct: 3.5, gradientSource: 'IRC:SP:90-2010 §6.14',
  minRadiusRightAngleTJunctionM: 9, tJunctionSource: 'IRC:SP:90-2010 §6.18',
  minStraightApproachM: 15, approachSource: 'IRC:SP:90-2010 §9.1',
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

/** R = V²/(127(e+f)) (IRC:86 §10.3, IRC:73). */
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
        source: `calculated from IRC:86-1983 §10.3 formula R = V²/127(e+f), f 0.15, e ${ePct} % (${designSpeedKmh} km/h is not in Table 10)`,
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
 * IRC:86-1983 §10.5.2 minimum transition length (m): the larger of 0.0215 V³/(C R), C = 80/(75+V) bounded 0.5–0.8,
 * and 2.7 V²/R. Reported as "would need" while spirals are not modelled.
 */
export const requiredTransitionLength: TransitionLengthFn = (designSpeedKmh: number, radiusM: number): CriterionValue | null => {
  if (!(designSpeedKmh > 0) || !(radiusM > 0)) return null;
  const V = designSpeedKmh;
  const C = Math.min(0.8, Math.max(0.5, 80 / (75 + V)));
  const valueM = Math.max((0.0215 * V ** 3) / (C * radiusM), (2.7 * V * V) / radiusM);
  return { valueM, basis: 'formula', source: 'calculated from IRC:86-1983 §10.5.2 formulas' };
};
