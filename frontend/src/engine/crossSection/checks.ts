/**
 * Cross-section screening (docs/urbanos/CROSS_SECTIONS.md §Checks). SCREENING ONLY: every result names its source and
 * never reads as compliance; the best state is "no flag found". Values not known (available right-of-way, frontage
 * land use) stay unknown, never assumed.
 *
 * Statuses: fail = below the lowest value the source states (or wider than a known RoW); warn = below a desirable / Pune
 * value; unknown = cannot be screened; info = context; pass = no flag found.
 */
import type { RoadClassification } from '../objects/types';
import { SCREENING_DISCLAIMER } from '../geometry/alignment/criteria';
import { elementsTotalM, sourceLabel, type SourceRef, type XsElement } from './templates';

export type XsCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown' | 'info';

export interface XsCheck {
  id: string;
  name: string;
  status: XsCheckStatus;
  actual: number | null;
  required: number | null;
  unit: string;
  message: string;
  /** Source(s) the threshold comes from, with clause and page. */
  basis: string;
  screening: true;
}

const S = {
  irc86FootpathTable51: { key: 'IRC86', section: '§5.1 Table 5.1 (pedestrian zone: residential 1.8 m, commercial 2.5 m, high-intensity commercial 4.0 m)', printedPage: 7, pdfPage: 15 },
  usdgFootpath: { key: 'USDG', section: '§3.1 Footpath ("clear and unobstructed minimum walking zone of 2m")', printedPage: 7, pdfPage: 20 },
  irc86Lane: { key: 'IRC86', section: '§5.4 and Table 5.5 (lane 3.5 m; 3.0 m permissible on access roads to residential areas)', printedPage: 14, pdfPage: 22 },
  irc86Classes: { key: 'IRC86', section: '§2.1 Definitions (collector streets "shall be designed with dedicated footpaths"; arterials provide safe, segregated NMT facilities; local streets "may not have a dedicated footpath")', printedPage: 3, pdfPage: 11 },
  irc86Median: { key: 'IRC86', section: '§5.1.2 / §5.6 (median minimum 1.2 m; desirable 5 m)', printedPage: 9, pdfPage: 17 },
  irc86Cycle: { key: 'IRC86', section: '§5.3 (cycle track ≥ 2 m per direction one-way, 3 m two-way; 0.5 m buffer)', printedPage: 12, pdfPage: 20 },
  usdgCycle: { key: 'USDG', section: '§3.2 Cycle track (clear cycling zone ≥ 2 m one-way, 3 m two-way)', printedPage: 9, pdfPage: 22 },
} satisfies Record<string, SourceRef>;

export const XS_SOURCES = S;

export const XS_THRESHOLDS = {
  footpathIrcMinM: 1.8,
  footpathUsdgMinM: 2.0,
  footpathCommercialM: 2.5,
  footpathHighIntensityM: 4.0,
  laneIrcM: 3.5,
  laneIrcResidentialAccessM: 3.0,
  medianMinM: 1.2,
  cycleOneWayMinM: 2.0,
} as const;

export interface XsCheckContext {
  roadClass: RoadClassification;
  /** Right-of-way available on the ground (m) when known (DP / survey / planner entry); null/undefined = unknown. */
  availableRowM?: number | null;
  /** What the available RoW came from, shown with the check. */
  availableRowSource?: string;
}

const m = (n: number) => `${Math.round(n * 100) / 100} m`;
const mk = (c: Omit<XsCheck, 'screening' | 'message'> & { text: string }): XsCheck => {
  const { text, ...rest } = c;
  return { ...rest, screening: true, message: `${text} ${SCREENING_DISCLAIMER}` };
};

/** Footpath strips on each outer side (left of the first carriageway, right of the last). */
function sides(els: readonly XsElement[]) {
  const cw = els.map((e, i) => (e.kind === 'carriageway' ? i : -1)).filter(i => i >= 0);
  if (!cw.length) return { left: [...els], right: [] as XsElement[] };
  return { left: els.slice(0, cw[0]), right: els.slice(cw[cw.length - 1] + 1) };
}

export function checkCrossSection(els: readonly XsElement[], ctx: XsCheckContext): XsCheck[] {
  const out: XsCheck[] = [];
  const { left, right } = sides(els);

  // 1. Footpath clear width, per side (IRC86 Table 5.1 floor 1.8 m; Pune USDG 2.0 m)
  const fpBasis = `${sourceLabel(S.irc86FootpathTable51)}; ${sourceLabel(S.usdgFootpath)}`;
  for (const [side, strips] of [['Left', left], ['Right', right]] as const) {
    const fps = strips.filter(e => e.kind === 'footpath');
    const w = fps.reduce((n, e) => n + e.widthM, 0);
    if (fps.length === 0) {
      // 4. Missing footpath on an arterial / collector
      if (ctx.roadClass === 'arterial' || ctx.roadClass === 'collector')
        out.push(mk({ id: `footpath-missing-${side.toLowerCase()}`, name: `${side} footpath missing`, status: 'fail', actual: 0, required: XS_THRESHOLDS.footpathUsdgMinM, unit: 'm',
          text: `No footpath on the ${side.toLowerCase()} side of a${ctx.roadClass === 'arterial' ? 'n arterial' : ' collector'} road. IRC:86 asks for dedicated footpaths on collectors and segregated pedestrian facilities on arterials; Pune USDG provides footpaths on both edges of every street.`,
          basis: `${sourceLabel(S.irc86Classes)}; ${sourceLabel(S.usdgFootpath)}` }));
      else if (ctx.roadClass === 'local')
        out.push(mk({ id: `footpath-missing-${side.toLowerCase()}`, name: `${side} footpath`, status: 'info', actual: 0, required: null, unit: 'm',
          text: `No footpath on the ${side.toLowerCase()} side. IRC:86 allows a local street without a dedicated footpath only as a shared, traffic-calmed street (< 20 km/h); Pune USDG expects footpaths on both edges.`,
          basis: `${sourceLabel(S.irc86Classes)}; ${sourceLabel(S.usdgFootpath)}` }));
      continue;
    }
    const status: XsCheckStatus = w < XS_THRESHOLDS.footpathIrcMinM - 1e-6 ? 'fail' : w < XS_THRESHOLDS.footpathUsdgMinM - 1e-6 ? 'warn' : 'pass';
    out.push(mk({ id: `footpath-width-${side.toLowerCase()}`, name: `${side} footpath clear width`, status, actual: Math.round(w * 100) / 100, required: XS_THRESHOLDS.footpathUsdgMinM, unit: 'm',
      text: status === 'fail' ? `${m(w)} is below the IRC:86 minimum pedestrian zone of 1.8 m (residential) and the Pune USDG 2.0 m clear walking zone.`
        : status === 'warn' ? `${m(w)} meets the IRC:86 residential 1.8 m but is below the Pune USDG 2.0 m clear walking zone.`
        : `${m(w)} — no flag against IRC:86 1.8 m (residential) or Pune USDG 2.0 m.`,
      basis: fpBasis }));
  }
  if (left.some(e => e.kind === 'footpath') || right.some(e => e.kind === 'footpath'))
    out.push(mk({ id: 'footpath-land-use', name: 'Footpath for frontage land use', status: 'unknown', actual: null, required: null, unit: 'm',
      text: 'Frontage land use is not recorded, so the IRC:86 commercial (2.5 m) and high-intensity commercial (4.0 m) pedestrian-zone minimums were not screened.',
      basis: sourceLabel(S.irc86FootpathTable51) }));

  // 2. Lane width (IRC86 §5.4: 3.5 m; 3.0 m permissible on residential access roads; no maximum stated)
  const laneBasis = sourceLabel(S.irc86Lane);
  els.forEach((e, i) => {
    if (e.kind !== 'carriageway' || !(e.lanes && e.lanes > 0)) return;
    const lw = Math.round((e.widthM / e.lanes) * 100) / 100;
    const id = `lane-width-${i}`, name = `Lane width (${e.label})`;
    if (lw < XS_THRESHOLDS.laneIrcResidentialAccessM - 1e-6)
      out.push(mk({ id, name, status: 'fail', actual: lw, required: XS_THRESHOLDS.laneIrcM, unit: 'm',
        text: `${m(lw)} per lane is below the lowest IRC:86 lane width (3.0 m, residential access roads only; 3.5 m otherwise).`, basis: laneBasis }));
    else if (lw < XS_THRESHOLDS.laneIrcM - 1e-6)
      out.push(mk({ id, name, status: ctx.roadClass === 'local' ? 'info' : 'warn', actual: lw, required: XS_THRESHOLDS.laneIrcM, unit: 'm',
        text: ctx.roadClass === 'local' ? `${m(lw)} per lane: IRC:86 permits 3.0 m on access roads to residential areas (3.5 m otherwise).`
          : `${m(lw)} per lane is below the IRC:86 3.5 m lane; 3.0 m is permitted only on access roads to residential areas.`, basis: laneBasis }));
    else if (lw > XS_THRESHOLDS.laneIrcM + 1e-6)
      out.push(mk({ id, name, status: 'info', actual: lw, required: XS_THRESHOLDS.laneIrcM, unit: 'm',
        text: `${m(lw)} per lane is wider than the IRC:86 3.5 m lane (IRC:86 states no maximum; wide lanes invite higher speeds).`, basis: laneBasis }));
    else out.push(mk({ id, name, status: 'pass', actual: lw, required: XS_THRESHOLDS.laneIrcM, unit: 'm', text: `${m(lw)} per lane — no flag against IRC:86 3.5 m.`, basis: laneBasis }));
  });

  // Median (only when one is drawn)
  els.forEach((e, i) => {
    if (e.kind !== 'median') return;
    if (e.widthM < XS_THRESHOLDS.medianMinM - 1e-6)
      out.push(mk({ id: `median-width-${i}`, name: 'Median width', status: 'fail', actual: e.widthM, required: XS_THRESHOLDS.medianMinM, unit: 'm',
        text: `${m(e.widthM)} median is below the IRC:86 minimum of 1.2 m (desirable 5 m; 1.2 m is also the minimum pedestrian refuge).`, basis: sourceLabel(S.irc86Median) }));
  });

  // Cycle track (only when one is drawn)
  els.forEach((e, i) => {
    if (e.kind !== 'cycle_track') return;
    if (e.widthM < XS_THRESHOLDS.cycleOneWayMinM - 1e-6)
      out.push(mk({ id: `cycle-width-${i}`, name: 'Cycle track width', status: 'fail', actual: e.widthM, required: XS_THRESHOLDS.cycleOneWayMinM, unit: 'm',
        text: `${m(e.widthM)} is below the 2 m one-way cycle track minimum (3 m two-way).`, basis: `${sourceLabel(S.irc86Cycle)}; ${sourceLabel(S.usdgCycle)}` }));
  });

  // 3. Total width against the available right-of-way (unknown stays unknown)
  const total = elementsTotalM(els);
  const row = ctx.availableRowM;
  if (row == null || !(row > 0))
    out.push(mk({ id: 'row-fit', name: 'Fits the available right-of-way', status: 'unknown', actual: total, required: null, unit: 'm',
      text: `Cross-section is ${m(total)} wide; the available right-of-way here is not recorded, so the fit was not screened. Enter it from the DP / survey to screen.`, basis: 'Planner entry (no source recorded)' }));
  else if (total > row + 1e-6)
    out.push(mk({ id: 'row-fit', name: 'Fits the available right-of-way', status: 'fail', actual: total, required: row, unit: 'm',
      text: `Cross-section ${m(total)} is ${m(total - row)} wider than the available right-of-way ${m(row)}. Pune USDG: use the template of the next smaller RoW.`,
      basis: `Available RoW: ${ctx.availableRowSource || 'planner entry, source not stated'}` }));
  else
    out.push(mk({ id: 'row-fit', name: 'Fits the available right-of-way', status: 'pass', actual: total, required: row, unit: 'm',
      text: `Cross-section ${m(total)} fits the available ${m(row)}${total < row - 1e-6 ? `; ${m(row - total)} spare (Pune USDG gives spare width to footpath / cycle track / MUZ)` : ''}.`,
      basis: `Available RoW: ${ctx.availableRowSource || 'planner entry, source not stated'}` }));

  return out;
}

/** Counts for a header line ("2 flags · 1 not screened"). */
export function summarizeChecks(checks: readonly XsCheck[]) {
  return {
    fail: checks.filter(c => c.status === 'fail').length,
    warn: checks.filter(c => c.status === 'warn').length,
    unknown: checks.filter(c => c.status === 'unknown').length,
  };
}
