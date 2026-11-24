/**
 * The project-level traffic-model verdict, COMPUTED from recorded measurements against fixed TAG M3.1 criteria
 * (UK DfT TAG unit M3.1, May 2026,
 * https://assets.publishing.service.gov.uk/media/6a033d074fb0713aa63ea802/tag-m3-1-highway-assignment-modelling.pdf).
 *
 * Counts and the river screen line: the app's own per-site runs (each site in its own 2 km study area at its own
 * hour, assigned volume, motor vehicles), docs/urbanos/TRAFFIC_CALIBRATION_P9.md §4, re-run on branch p10-estimated
 * (docs/urbanos/TRAFFIC_ESTIMATED_P10.md §5), which also scores them against the ESTIMATED 2026 volumes. The
 * sites are split once into CALIBRATION (may be fitted) and HOLD-OUT (never fitted) in
 * backend/data/observed_validation/pune_network_validation_v1.json; both are shown separately (TAG M3.1 §3.3).
 * Re-run on branch p11-sim (docs/urbanos/SIM_USER_TEST_P11.md §2) with the p11 engine: the same shipped configuration
 * gives 2/15 within GEH 5 (hold-out 1/8, mean GEH 31.4) and river −26.5% (p10: −26.2%); the small changes come from the
 * unified road centreline lengths. The p11 zone demand + estimate match was tried twice and is not shipped (worse on the
 * hold-out river screen line, collapsed area speeds).
 * Speeds: docs/ENGINEERING_VALIDATION.md §5.0 (code c916854), not re-run in p9.
 * These are recorded results, not live values: update COUNT_RESULTS / RIVER_SCREENLINE only from a re-run.
 * The criteria below are TAG's and must not be loosened to change a verdict.
 */
export interface ValidationRow {
  test: string;
  required: string;
  result: string;
  status: 'FAIL' | 'PASS' | 'NOT EVALUATED';
}

/** One count site: observed motor vehicles and the model's assigned volume at the counted hour (veh/h, both directions). */
export interface CountSiteResult {
  id: string;
  name: string;
  role: 'calibration' | 'holdout';
  hour: number;
  count: number;
  model: number;
}

/** TAG M3.1 Table 2/3 criteria (fixed). */
export const TAG_CRITERIA = {
  /** Share of sites that must have GEH < 5. */
  gehShare: 0.85,
  geh: 5,
  /** Share of sites that must meet the flow criterion. */
  flowShare: 0.85,
  /** Screen-line total within this fraction of the count. */
  screenline: 0.05,
} as const;

export const geh = (m: number, c: number) => Math.sqrt(2 * (m - c) ** 2 / Math.max(1, m + c));
/** TAG flow criterion: within 100 veh/h below 700, 15% from 700 to 2,700, 400 veh/h above 2,700. */
export const flowOk = (m: number, c: number) => Math.abs(m - c) <= (c < 700 ? 100 : c <= 2700 ? 0.15 * c : 400);

/**
 * Per-site results, shipped configuration (class-typical edge flows per lane; re-run on p10-estimated with the estimated
 * traffic switched off: identical to p9). The city-wide ESTIMATED traffic as edge flows was tried and is not shipped:
 * 0/15 within GEH 5, hold-out 0/8 (mean GEH 36.9), river +51.5% (docs/urbanos/TRAFFIC_ESTIMATED_P10.md §5). Counts: CMP 2008 (motor vehicles, cycles and carts removed; another hour of the same site moved
 * with the Pune hourly profile; Sambhaji's model is its non-two-wheeler volume as the count excludes two-wheelers)
 * and Gunjan Chowk 2017.
 */
export const COUNT_RESULTS: CountSiteResult[] = [
  { id: 'cmp08_shivaji', name: 'Shivaji Bridge', role: 'calibration', hour: 18, count: 7245, model: 2444 },
  { id: 'cmp08_shinde', name: 'Shinde Bridge', role: 'calibration', hour: 18, count: 4636, model: 1631 },
  { id: 'cmp08_smjoshi', name: 'S. M. Joshi Bridge', role: 'calibration', hour: 11, count: 4036, model: 2080 },
  { id: 'cmp08_rajaram', name: 'Raja Ram Bridge', role: 'calibration', hour: 10, count: 7050, model: 7304 },
  { id: 'cmp08_sangam', name: 'Sangam Bridge (old + new)', role: 'calibration', hour: 19, count: 15640, model: 10907 },
  { id: 'cmp08_wadia_rob', name: 'ROB at Wadia College', role: 'calibration', hour: 11, count: 4454, model: 3078 },
  { id: 'cmp08_sancheti_rob', name: 'ROB near Sancheti Hospital', role: 'calibration', hour: 19, count: 6255, model: 5720 },
  { id: 'cmp08_mhatre', name: 'Mhatre Bridge', role: 'holdout', hour: 18, count: 9753, model: 5013 },
  { id: 'cmp08_tilak', name: 'Tilak Bridge', role: 'holdout', hour: 10, count: 2070, model: 1799 },
  { id: 'cmp08_sambhaji', name: 'Sambhaji Bridge (no two-wheelers)', role: 'holdout', hour: 11, count: 4251, model: 2006 },
  { id: 'cmp08_yerwada_ambedkar', name: 'Yerwada + Ambedkar bridges', role: 'holdout', hour: 18, count: 19143, model: 18890 },
  { id: 'cmp08_rangehill_rub', name: 'RUB at Range Hill', role: 'holdout', hour: 16, count: 1611, model: 2752 },
  { id: 'gunjan17_09', name: 'Gunjan Chowk 09:00', role: 'holdout', hour: 9, count: 10034, model: 5804 },
  { id: 'gunjan17_14', name: 'Gunjan Chowk 14:00', role: 'holdout', hour: 14, count: 6581, model: 4084 },
  { id: 'gunjan17_19', name: 'Gunjan Chowk 19:00', role: 'holdout', hour: 19, count: 9460, model: 5804 },
];

/** River screen line (CMP 2008 screen line 2, 9 crossings, each at its own hour, motor vehicles). Sambhaji at its total model volume. */
export const RIVER_SCREENLINE = { crossings: 9, model: 54247, count: 73824 };

/**
 * The same runs against the ESTIMATED 2026 volumes of the same crossings (urbanos-data/estimated/traffic-v1/anchors.csv:
 * count-derived 2026 daily x the Pune hourly share at the run's hour). Estimated, not measured: shown beside the official
 * counts, never instead of them. Roles are the estimated dataset's own calibration / hold-out split.
 */
export const ESTIMATED_BASIS_RESULTS: { id: string; role: 'calibration' | 'holdout'; hour: number; target: number; model: number }[] = [
  { id: 'cmp08_shivaji', role: 'calibration', hour: 18, target: 7503, model: 2444 },
  { id: 'cmp08_mhatre', role: 'holdout', hour: 18, target: 9152, model: 5013 },
  { id: 'cmp08_shinde', role: 'calibration', hour: 18, target: 5662, model: 1631 },
  { id: 'cmp08_tilak', role: 'holdout', hour: 10, target: 5440, model: 1799 },
  { id: 'cmp08_smjoshi', role: 'calibration', hour: 11, target: 5875, model: 2080 },
  { id: 'cmp08_sambhaji', role: 'holdout', hour: 11, target: 5707, model: 4180 },
  { id: 'cmp08_rajaram', role: 'calibration', hour: 10, target: 7743, model: 7304 },
  { id: 'cmp08_sangam', role: 'calibration', hour: 19, target: 20166, model: 10907 },
  { id: 'cmp08_yerwada_ambedkar', role: 'holdout', hour: 18, target: 21694, model: 18890 },
  { id: 'cmp08_sancheti_rob', role: 'calibration', hour: 19, target: 16025, model: 5720 }
];
export const ESTIMATED_RIVER = { crossings: 9, model: 54248, target: 88942 };
/** Where the edge flows of the shipped model come from (said on the banner). */
export const EDGE_FLOW_BASIS = 'Edge flows: class-typical flows per lane; edge flows calibrated to estimated data (pune_estimated_traffic_v1: estimated, project-level, not for decisions) were tried and are not used, being worse on the hold-out sites; nor is area demand from estimated zone land use matched to the estimated road volumes (p11, worse on the hold-out river screen line)';

export interface CountSummary { n: number; withinGeh5: number; flowOk: number; meanGeh: number }
export function summarizeCounts(rows: readonly CountSiteResult[]): CountSummary {
  const g = rows.map(r => geh(r.model, r.count));
  return { n: rows.length, withinGeh5: g.filter(x => x < TAG_CRITERIA.geh).length, flowOk: rows.filter(r => flowOk(r.model, r.count)).length,
    meanGeh: g.length ? g.reduce((a, b) => a + b, 0) / g.length : NaN };
}

const fmtPct = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x * 100).toFixed(1)}%`;
const fmtInt = (x: number) => Math.round(x).toLocaleString('en-US');
const pass = (ok: boolean): ValidationRow['status'] => (ok ? 'PASS' : 'FAIL');

export const COUNTS_ALL = summarizeCounts(COUNT_RESULTS);
export const COUNTS_CALIBRATION = summarizeCounts(COUNT_RESULTS.filter(r => r.role === 'calibration'));
export const COUNTS_HOLDOUT = summarizeCounts(COUNT_RESULTS.filter(r => r.role === 'holdout'));
export const RIVER_SCREENLINE_ERROR = RIVER_SCREENLINE.model / RIVER_SCREENLINE.count - 1;
export const ESTIMATED_HOLDOUT = summarizeCounts(ESTIMATED_BASIS_RESULTS.filter(r => r.role === 'holdout').map(r => ({ ...r, name: r.id, count: r.target })));
export const ESTIMATED_RIVER_ERROR = ESTIMATED_RIVER.model / ESTIMATED_RIVER.target - 1;

const gehRow = (label: string, s: CountSummary): ValidationRow => ({
  test: label, required: '> 85% of sites', result: `${s.withinGeh5} / ${s.n} (mean GEH ${s.meanGeh.toFixed(1)})`,
  status: pass(s.withinGeh5 / s.n > TAG_CRITERIA.gehShare),
});

const rows: ValidationRow[] = [
  gehRow('Counts, GEH < 5, all sites (assigned volume)', COUNTS_ALL),
  gehRow(`Counts, GEH < 5, calibration sites (${COUNTS_CALIBRATION.n})`, COUNTS_CALIBRATION),
  gehRow(`Counts, GEH < 5, hold-out sites (${COUNTS_HOLDOUT.n}, never fitted)`, COUNTS_HOLDOUT),
  { test: 'Counts, flow criterion', required: '> 85% of sites', result: `${COUNTS_ALL.flowOk} / ${COUNTS_ALL.n}`, status: pass(COUNTS_ALL.flowOk / COUNTS_ALL.n > TAG_CRITERIA.flowShare) },
  { test: `River screen line (${RIVER_SCREENLINE.crossings} crossings)`, required: 'within 5%',
    result: `${fmtInt(RIVER_SCREENLINE.model)} vs ${fmtInt(RIVER_SCREENLINE.count)} (${fmtPct(RIVER_SCREENLINE_ERROR)})`, status: pass(Math.abs(RIVER_SCREENLINE_ERROR) <= TAG_CRITERIA.screenline) },
  // Against the ESTIMATED 2026 volumes (not counts): shown so the estimated calibration is checked on its own terms too
  gehRow(`Estimated 2026 volumes, GEH < 5, hold-out crossings (${ESTIMATED_HOLDOUT.n}; estimated, not counts)`, ESTIMATED_HOLDOUT),
  { test: `River screen line vs estimated 2026 volumes (${ESTIMATED_RIVER.crossings} crossings; estimated, not counts)`, required: 'within 5%',
    result: `${fmtInt(ESTIMATED_RIVER.model)} vs ${fmtInt(ESTIMATED_RIVER.target)} (${fmtPct(ESTIMATED_RIVER_ERROR)})`, status: pass(Math.abs(ESTIMATED_RIVER_ERROR) <= TAG_CRITERIA.screenline) },
  // Speeds: recorded in docs/ENGINEERING_VALIDATION.md §5.0 (c916854); the p9 changes do not touch the speed runs' inputs
  { test: 'Section speeds within 15% (micro-sim)', required: '> 85% of 21', result: '4 / 21 (MAPE 38%, bias −18%)', status: 'FAIL' },
  { test: 'Corridor-hour speeds within 15%', required: '> 85% of 120', result: '27 / 120 (MAPE 54%, bias +40%)', status: 'FAIL' },
  { test: 'City speed by hour within 15%', required: '> 85% of 9', result: '2 / 9 (MAPE 32%, bias +32%)', status: 'FAIL' },
];

export const TRAFFIC_VALIDATION = {
  verdict: (rows.some(r => r.status === 'FAIL') ? 'fails_validation' : 'meets_criteria') as 'fails_validation' | 'meets_criteria',
  standard: 'TAG M3.1',
  standardTitle: 'UK DfT TAG unit M3.1, Highway Assignment Modelling (May 2026)',
  standardUrl: 'https://assets.publishing.service.gov.uk/media/6a033d074fb0713aa63ea802/tag-m3-1-highway-assignment-modelling.pdf',
  source: 'docs/urbanos/TRAFFIC_CALIBRATION_P9.md, re-run in docs/urbanos/TRAFFIC_ESTIMATED_P10.md (counts, screen line, estimated basis); docs/ENGINEERING_VALIDATION.md §5.0 (speeds)',
  codeRef: 'p9-calibration, re-run on p10-estimated (counts); c916854 (speeds)',
  edgeFlows: EDGE_FLOW_BASIS,
  rows,
  meaning: 'Numbers are estimated: use them to compare options on the same inputs, not as forecasts of Pune traffic.',
};

/** One-line summary for banners: sites within GEH 5 (all, then calibration and hold-out separately) and the river screen line. */
export const TRAFFIC_VALIDATION_SUMMARY =
  `${COUNTS_ALL.withinGeh5} of ${COUNTS_ALL.n} count sites within GEH 5 (calibration ${COUNTS_CALIBRATION.withinGeh5}/${COUNTS_CALIBRATION.n}, hold-out ${COUNTS_HOLDOUT.withinGeh5}/${COUNTS_HOLDOUT.n}); river screen line ${fmtPct(RIVER_SCREENLINE_ERROR)}. ${EDGE_FLOW_BASIS}`;

/** The river screen line in words, for longer explanations. */
export const RIVER_SCREENLINE_TEXT =
  `the ${RIVER_SCREENLINE.crossings === 9 ? 'nine' : RIVER_SCREENLINE.crossings} river crossings carry ${fmtInt(RIVER_SCREENLINE.model)} veh/h in the model against ${fmtInt(RIVER_SCREENLINE.count)} motor vehicles counted (${fmtPct(RIVER_SCREENLINE_ERROR)}; within 5% needed)`;

/** Short label used on every traffic / ODME / emissions output. */
export const FAILS_VALIDATION_LABEL = `Fails validation (${TRAFFIC_VALIDATION.standard})`;

/**
 * The banner in plain words (docs/urbanos/SIM_FLOW_P12.md §7): what was checked, what it found, why it fails, and what
 * that means for using a result. Built from the same recorded results and fixed criteria as the verdict; the
 * thresholds are TAG's and are not loosened here.
 */
export const TRAFFIC_VALIDATION_PLAIN = {
  headline: `Traffic model fails validation (${TRAFFIC_VALIDATION.standard})`,
  checked: `The model's traffic was compared with real counts at ${COUNTS_ALL.n} places in Pune (river bridges counted in 2008, Gunjan Chowk in 2017) and on the ${RIVER_SCREENLINE.crossings} river crossings taken together. The UK standard (TAG M3.1) needs 85% of places within GEH 5, a usual closeness test, and the crossings within 5% of the count.`,
  result: `${COUNTS_ALL.withinGeh5} of ${COUNTS_ALL.n} places are close enough (${COUNTS_HOLDOUT.withinGeh5} of the ${COUNTS_HOLDOUT.n} never used for fitting), and the river crossings carry ${Math.abs(Math.round(RIVER_SCREENLINE_ERROR * 1000) / 10)}% ${RIVER_SCREENLINE_ERROR < 0 ? 'less' : 'more'} traffic than counted.`,
  why: 'Why it fails: there are too few real counts (old, and on only a few roads); there are no classified turning counts at junctions and no measured journey times to calibrate against; and the trips are synthesized from OpenStreetMap roads (typical flows per lane where roads cross the study area\'s edge, plus trips from buildings or zones drawn in the project), not from a travel survey.',
  meaning: 'What it means: use a result for the direction of a change and its trade-offs between options run on the same inputs (better or worse, which roads gain or lose, where traffic moves). Do not quote its volumes, speeds or times as forecasts.',
} as const;

/**
 * One check shown in the validation banner. The banner lists checks in order, each separately labelled, so another check
 * (e.g. a project check against estimated data) is added as one more entry without touching the others.
 */
export interface ValidationCheck {
  id: string;
  /** Short name of the check, e.g. "Model against real traffic counts". */
  label: string;
  outcome: 'fails' | 'passes' | 'not_run' | 'screening';
  /** What was compared with what, and the criterion. */
  checked: string;
  /** What the comparison found. */
  result: string;
  /** Why it fails (or the caveat when it passes); optional. */
  why?: string;
}

/** The recorded check of the traffic model against Pune's counts (TAG M3.1). */
export const COUNTS_CHECK: ValidationCheck = {
  id: 'counts',
  label: 'Model against real traffic counts',
  outcome: TRAFFIC_VALIDATION.verdict === 'fails_validation' ? 'fails' : 'passes',
  checked: TRAFFIC_VALIDATION_PLAIN.checked,
  result: TRAFFIC_VALIDATION_PLAIN.result,
  why: TRAFFIC_VALIDATION_PLAIN.why,
};

/** Checks the Simulate banner shows, in order. */
export const VALIDATION_CHECKS: readonly ValidationCheck[] = [COUNTS_CHECK];
