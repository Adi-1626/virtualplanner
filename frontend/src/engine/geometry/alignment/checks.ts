/**
 * Horizontal alignment screening flags (GEOMETRY_EDITOR_DESIGN.md §4.3). Every flag is SCREENING: it names its source and
 * never reads as compliance; the best state is "no flag found". No design speed / no criteria → "not checked", never a pass.
 */
import { minRadius, METRO_PUNE_SK_DPR, requiredTransitionLength, SCREENING_DISCLAIMER } from './criteria';
import { filletAlignment } from './fillet';
import type { AlignmentFlag, CheckAlignmentFn, CheckOptions, HorizontalAlignment } from './types';

const r0 = (m: number) => `${Math.round(m)} m`;
const deg = (rad: number) => `${Math.round((Math.abs(rad) * 180) / Math.PI)}°`;
const flag = (f: Omit<AlignmentFlag, 'screening' | 'message'> & { text: string }): AlignmentFlag => {
  const { text, ...rest } = f;
  return { ...rest, screening: true, message: `${text} ${SCREENING_DISCLAIMER}` };
};

export const checkAlignment: CheckAlignmentFn = (a: HorizontalAlignment, opts: CheckOptions = {}): AlignmentFlag[] => {
  const out: AlignmentFlag[] = [];
  const fr = filletAlignment(a);
  if (!fr.ok) {
    if (fr.error === 'u-turn')
      out.push(flag({ code: 'u-turn-refused', severity: 'warn', piIndex: fr.errorPiIndex, source: 'none',
        text: `Turn at point ${fr.errorPiIndex! + 1} is a U-turn (179° or more); a U-turn needs two points.` }));
    return out;
  }
  const metro = a.criteria === 'metro-pune-sk-dpr';
  const V = a.designSpeedKmh;
  const curves = fr.pis.filter(p => p.radiusM > 0);
  const anyBend = fr.pis.some(p => Math.abs(p.deflectionRad) > 0);
  if (anyBend && a.behaviour === 'curved') {
    if (a.criteria === 'none')
      out.push(flag({ code: 'not-checked-no-criteria', severity: 'info', source: 'none', text: 'Curves not checked: no design criteria set for this object.' }));
    else if (!metro && !(V && V > 0))
      out.push(flag({ code: 'not-checked-no-design-speed', severity: 'info', source: 'none', text: 'Curves not checked: no design speed set.' }));
  }
  const checkable = a.criteria !== 'none' && (metro || (V !== null && V > 0));

  for (const p of fr.pis) {
    const n = p.index + 1;
    if (a.behaviour === 'curved' && p.noCurveReason === 'radius-zero' && Math.abs(p.deflectionRad) > 0)
      out.push(flag({ code: 'sharp-angle-point', severity: 'info', piIndex: p.index, source: 'none',
        text: `Point ${n} is a sharp angle point (${deg(p.deflectionRad)} deflection, no curve).` }));
    if (!(p.radiusM > 0)) continue;
    if (p.clamped)
      out.push(flag({ code: 'radius-reduced-to-fit', severity: 'warn', piIndex: p.index, source: 'fit rule (tangent lengths between points)', radiusM: p.radiusM, requiredM: p.requestedRadiusM,
        text: `Radius at point ${n} reduced to ${r0(p.radiusM)} to fit between points (asked for ${r0(p.requestedRadiusM)}).` }));
    if (!checkable) continue;
    const R = p.radiusM;
    if (metro) {
      const min = opts.tbm ? METRO_PUNE_SK_DPR.minRadiusTbmM : METRO_PUNE_SK_DPR.minRadiusLimitingM;
      const what = opts.tbm ? 'TBM-section minimum' : 'limiting minimum';
      if (R < min)
        out.push(flag({ code: 'radius-below-minimum', severity: 'warn', piIndex: p.index, source: METRO_PUNE_SK_DPR.source, radiusM: R, requiredM: min,
          text: `R ${r0(R)} at point ${n} is below the ${what} ${r0(min)} (${METRO_PUNE_SK_DPR.source}; ${METRO_PUNE_SK_DPR.elevatedNote} for elevated lines).` }));
      else if (R < METRO_PUNE_SK_DPR.minRadiusPreferentialM)
        out.push(flag({ code: 'radius-below-preferred', severity: 'info', piIndex: p.index, source: METRO_PUNE_SK_DPR.source, radiusM: R, requiredM: METRO_PUNE_SK_DPR.minRadiusPreferentialM,
          text: `R ${r0(R)} at point ${n} is below the preferential ${r0(METRO_PUNE_SK_DPR.minRadiusPreferentialM)} (${METRO_PUNE_SK_DPR.source}).` }));
      const arc = fr.elements.find(e => e.kind === 'arc' && e.piIndex === p.index);
      if (arc && (opts.stationChainagesM ?? []).some(c => c >= arc.startChainageM && c <= arc.endChainageM) && R < METRO_PUNE_SK_DPR.minRadiusAtStationsM)
        out.push(flag({ code: 'radius-below-station-minimum', severity: 'warn', piIndex: p.index, source: METRO_PUNE_SK_DPR.source, radiusM: R, requiredM: METRO_PUNE_SK_DPR.minRadiusAtStationsM,
          text: `A station lies on the curve at point ${n}; R ${r0(R)} is below ${r0(METRO_PUNE_SK_DPR.minRadiusAtStationsM)} at stations (${METRO_PUNE_SK_DPR.source}).` }));
      if (p.arcLengthM < METRO_PUNE_SK_DPR.minCurveBetweenTransitionsM)
        out.push(flag({ code: 'metro-short-curve', severity: 'warn', piIndex: p.index, source: `${METRO_PUNE_SK_DPR.source} §5.2.5`, requiredM: METRO_PUNE_SK_DPR.minCurveBetweenTransitionsM,
          text: `Curve at point ${n} is ${r0(p.arcLengthM)} long, under ${r0(METRO_PUNE_SK_DPR.minCurveBetweenTransitionsM)} (${METRO_PUNE_SK_DPR.source} §5.2.5).` }));
      out.push(flag({ code: 'transition-not-modelled', severity: 'info', piIndex: p.index, source: `${METRO_PUNE_SK_DPR.source} §5.2.5`,
        text: `Transition not modelled at point ${n}; the transition length of ${METRO_PUNE_SK_DPR.source} §5.2.5 depends on cant, which is not modelled.` }));
    } else {
      const min = minRadius(a.criteria, V!, a.eMax);
      if (min && R < min.valueM - 1e-9)
        out.push(flag({ code: 'radius-below-minimum', severity: 'warn', piIndex: p.index, source: min.source, radiusM: R, requiredM: min.valueM,
          text: `R ${r0(R)} is below ${r0(min.valueM)} (${V} km/h, e ${Math.round(a.eMax * 100)} %, ${min.source}) at point ${n}.` }));
      const ls = requiredTransitionLength(V!, R);
      out.push(flag({ code: 'transition-not-modelled', severity: 'info', piIndex: p.index, source: ls?.source ?? 'IRC:86-1983 §10.1', requiredM: ls?.valueM,
        text: `Transition not modelled at point ${n} (IRC:86 §10.1 expects spiral transitions)${ls ? `; it would need about ${r0(ls.valueM)} at ${V} km/h (${ls.source})` : ''}.` }));
    }
  }

  // Tangents between consecutive curves.
  for (let k = 0; k + 1 < curves.length; k++) {
    const i = curves[k].index, j = curves[k + 1].index;
    if (j !== i + 1) continue; // a sharp or straight PI sits between them
    const arcI = fr.elements.find(e => e.kind === 'arc' && e.piIndex === i)!;
    const arcJ = fr.elements.find(e => e.kind === 'arc' && e.piIndex === j)!;
    const straight = arcJ.startChainageM - arcI.endChainageM;
    if (straight < 1e-3)
      out.push(flag({ code: 'curves-touch-no-tangent', severity: 'info', piIndex: j, source: 'none',
        text: `Curves at points ${i + 1} and ${j + 1} meet with no straight between them.` }));
    if (metro && straight < METRO_PUNE_SK_DPR.minStraightBetweenCurvesM)
      out.push(flag({ code: 'metro-short-straight', severity: 'warn', piIndex: j, source: `${METRO_PUNE_SK_DPR.source} §5.2.5`, requiredM: METRO_PUNE_SK_DPR.minStraightBetweenCurvesM,
        text: `Straight between curves at points ${i + 1} and ${j + 1} is ${r0(straight)}, under ${r0(METRO_PUNE_SK_DPR.minStraightBetweenCurvesM)} (${METRO_PUNE_SK_DPR.source} §5.2.5).` }));
  }
  return out;
};
