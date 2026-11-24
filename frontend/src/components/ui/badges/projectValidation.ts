/**
 * The second, separately labelled validation result (p13, docs/urbanos/VALIDATION_P13.md):
 * "Project check against estimated data (journey times from Google/TomTom, counts from published studies)".
 *
 * It never replaces the official-count check (trafficValidation.ts), which keeps its own TAG M3.1 verdict and is always
 * shown first. Both are computed from recorded runs against fixed criteria (calibration/projectCheck.ts); the project check
 * is scored on its HOLD-OUT records only. Text for the banner and the validation popover comes from here so every screen
 * says the same thing.
 */
import { PROJECT_CRITERIA, type ProjectScore } from '../../../engine/calibration/projectCheck';
import { PROJECT_SCORE_DEFAULT, PROJECT_SCORE_TUNED, TUNED_DECISION, TUNED_SUPPLY } from '../../../engine/calibration/tunedSupply';
import { P13_RECORD } from '../../../engine/calibration/projectValidationRecord';
import type { ValidationRow } from './trafficValidation';

export const PROJECT_CHECK_TITLE = 'Project check against estimated data (journey times from Google/TomTom, counts from published studies)';
export const PROJECT_CHECK_SHORT = 'Project check (estimated data)';
export const PROJECT_DATA_NOTE = 'Estimated / third-party data: Google Maps typical weekday journey times (09:00 and 23:00, read 25 Nov 2026) on 28 Pune corridors and 32 published counts (Maha-Metro DPR surveys, Nov–Dec 2021, factored to 2026). Not official counts; never mixed with the official-count check.';

const pct = (x: number | null) => (x === null ? 'n/a' : `${x < 0 ? '−' : '+'}${Math.abs(100 * x).toFixed(1)}%`);
const share = (k: number, n: number) => `${k} / ${n}`;

/** Rows for the validation popover (hold-out only decides; calibration shown for reference). */
export function projectRows(s: ProjectScore): ValidationRow[] {
  const h = s.holdout, c = s.calibration;
  const status = (ok: boolean): ValidationRow['status'] => (ok ? 'PASS' : 'FAIL');
  return [
    { test: `Journey times within 15% or 1 min, hold-out routes (${h.jt.n}, never tuned)`, required: '≥ 85% of routes', result: `${share(h.jt.ok, h.jt.n)} (median error ${pct(h.jt.medianRelErr)})`, status: status(s.checks.jt) },
    { test: `Published counts, GEH < 5, hold-out sites (${h.counts.n}, never tuned)`, required: '≥ 85% of sites', result: `${share(h.counts.gehOk, h.counts.n)} (mean GEH ${h.counts.meanGeh?.toFixed(1) ?? 'n/a'}, R² ${h.counts.r2?.toFixed(2) ?? 'n/a'})`, status: status(s.checks.counts) },
    { test: `River crossings total, hold-out sites (${h.river.n})`, required: 'within 5%', result: `${h.river.model.toLocaleString('en-US')} vs ${h.river.observed.toLocaleString('en-US')} (${pct(h.river.pct)})`, status: status(s.checks.screenline) },
    { test: `For reference: calibration records (journey times ${share(c.jt.ok, c.jt.n)}, counts GEH < 5 ${share(c.counts.gehOk, c.counts.n)})`, required: '—', result: 'not used for the verdict', status: 'NOT EVALUATED' },
  ];
}

export type BannerState = 'both_fail' | 'project_pass_official_fail' | 'both_pass' | 'official_pass_project_fail';

export function bannerState(officialPass: boolean, projectPass: boolean): BannerState {
  if (officialPass && projectPass) return 'both_pass';
  if (officialPass) return 'official_pass_project_fail';
  return projectPass ? 'project_pass_official_fail' : 'both_fail';
}

/**
 * What the two results mean for use, by state. Never says "validated" for the project check: it is a project-level
 * check on estimated data.
 */
export function bannerText(officialPass: boolean, project: ProjectScore, using: 'default' | 'tuned'): { state: BannerState; headline: string; project: string; meaning: string } {
  const state = bannerState(officialPass, project.pass);
  const h = project.holdout;
  const params = using === 'tuned' ? 'tuned parameters (estimated)' : 'default parameters';
  const proj = `${PROJECT_CHECK_SHORT}, ${params}, hold-out: journey times ${h.jt.ok}/${h.jt.n} within 15% (85% needed), published counts ${h.counts.gehOk}/${h.counts.n} within GEH 5 (85% needed), river crossings ${pct(h.river.pct)} (5% needed): ${project.pass ? 'passes' : 'fails'}.`;
  const headline = {
    both_fail: 'Traffic model fails the official-count check and the project check against estimated data',
    project_pass_official_fail: 'Traffic model passes the project check against estimated data but fails the official-count check',
    official_pass_project_fail: 'Traffic model meets the official-count criteria but fails the project check against estimated data',
    both_pass: 'Traffic model meets the official-count criteria and passes the project check against estimated data',
  }[state];
  const meaning = {
    both_fail: 'Use it to see the direction of a change and the trade-offs between alternatives run on the same inputs; do not quote its volumes, times or percentages.',
    project_pass_official_fail: 'Good enough for a project-level comparison: the direction of a change, the trade-offs between alternatives and rough magnitudes. Not validated against official counts, so not for design or approval numbers.',
    official_pass_project_fail: 'Volumes match the official counts but journey times or the estimated counts do not: treat times with caution.',
    both_pass: 'Numbers are still model estimates; screening, not approval.',
  }[state];
  return { state, headline, project: proj, meaning };
}

export const PROJECT_CHECK = {
  title: PROJECT_CHECK_TITLE,
  dataNote: PROJECT_DATA_NOTE,
  criteria: PROJECT_CRITERIA,
  runId: P13_RECORD.runId,
  default: PROJECT_SCORE_DEFAULT,
  tuned: PROJECT_SCORE_TUNED,
  tunedAvailable: !!TUNED_SUPPLY,
  tunedDecision: TUNED_DECISION,
  source: 'docs/urbanos/VALIDATION_P13.md; data in urbanos-data/estimated/validation-v1 (journey_times.csv, counts.csv, split.json)',
};

/** The score for the parameters in use. */
export const projectScoreFor = (using: 'default' | 'tuned'): ProjectScore => (using === 'tuned' && PROJECT_SCORE_TUNED ? PROJECT_SCORE_TUNED : PROJECT_SCORE_DEFAULT);

/**
 * The project check as one entry of a list-of-checks banner. Same shape as `ValidationCheck` in p12-flow's
 * trafficValidation.ts (commit 9ee7092: `VALIDATION_CHECKS` drawn by ValidationBanner.tsx), declared here structurally so
 * this branch does not depend on that one. Mapping once both are merged:
 *   import { projectValidationCheck } from './projectValidation';
 *   export const VALIDATION_CHECKS = [COUNTS_CHECK, projectValidationCheck('default')];
 * and in Simulate pass `checks={[COUNTS_CHECK, projectValidationCheck(sim.supplySet)]}` to ValidationBanner, so the entry
 * follows the parameters in use. The official-count entry (COUNTS_CHECK) stays first and unchanged.
 */
export interface ProjectValidationCheck { id: 'project_estimated'; label: string; outcome: 'fails' | 'passes'; checked: string; result: string; why?: string }

export function projectValidationCheck(using: 'default' | 'tuned'): ProjectValidationCheck {
  const s = projectScoreFor(using), h = s.holdout;
  const params = using === 'tuned' && PROJECT_SCORE_TUNED ? 'tuned parameters (estimated)' : 'default parameters';
  const failing = [!s.checks.jt && 'journey times', !s.checks.counts && 'published counts', !s.checks.screenline && 'river crossings'].filter(Boolean) as string[];
  return {
    id: 'project_estimated',
    label: 'Model against estimated data (project check)',
    outcome: s.pass ? 'passes' : 'fails',
    checked: `${params}: Google Maps typical journey times on ${h.jt.n / 2} hold-out corridors (09:00 and 23:00) and ${h.counts.n} hold-out published counts (Maha-Metro DPR 2021, factored to 2026), none used in tuning; TAG M3.1 criteria: 85% of journey times within 15% or 1 min, 85% of counts within GEH 5, river crossings within 5%.`,
    result: `Journey times ${h.jt.ok}/${h.jt.n} within (median error ${pct(h.jt.medianRelErr)}); counts ${h.counts.gehOk}/${h.counts.n} within GEH 5; river crossings ${pct(h.river.pct)}.`,
    why: s.pass ? 'Estimated / third-party data, not official counts: a project-level check, not validation.' : `Misses on ${failing.join(', ')}. Estimated / third-party data, not official counts.`,
  };
}
