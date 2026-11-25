import type { ProjectScore } from '../../../engine/calibration/projectCheck';
import { PROJECT_SCORE_SYNTHETIC, SYNTHETIC_DECISION, SYNTHETIC_PARAMS } from '../../../engine/calibration/syntheticDemandDecision';
import { P14_SYNTHETIC_RECORD } from '../../../engine/calibration/syntheticDemandRecord';

/**
 * p14: what the panel says about the SYNTHETIC land-use demand (docs/urbanos/DEMAND_P14.md). Label `synthetic` wherever
 * the demand is shown: demo data from assumptions and web sources, never measured, never mixed with official or
 * estimated data.
 */
export const SYNTHETIC_DEMAND_NAME = 'Synthetic land-use demand';
export const SYNTHETIC_DEMAND_NOTE = 'Label: synthetic. A 4-step demand model (trip generation, gravity distribution, mode split, hourly profiles) run on synthetic land use: every OSM building given residents and jobs reconciled to the CMP-2024 zone totals. Demo data from assumptions and web sources; not measured and not for decisions. Trips start and end at the area\'s buildings; traffic from beyond enters where its city route crosses the area\'s edge.';

const pct = (x: number | null) => (x === null ? 'n/a' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);

/** The project-check score to show for the demand and parameters in use (null: that combination was not checked). */
export function demandProjectScore(synthetic: boolean, supply: 'default' | 'tuned'): ProjectScore | null | undefined {
  if (!synthetic) return undefined; // the area estimate: the p13 scores apply
  return supply === 'default' ? PROJECT_SCORE_SYNTHETIC : null;
}

/** The banner line for the synthetic demand when it is in use (null when the area estimate runs). */
export function syntheticDemandBannerLine(synthetic: boolean, supply: 'default' | 'tuned'): string | null {
  if (!synthetic) return null;
  const s = demandProjectScore(true, supply);
  const head = `Demand: ${SYNTHETIC_DEMAND_NAME.toLowerCase()} (label synthetic: demo data, not measured)`;
  if (!s) return `${head}. Not checked against the estimated data${supply === 'tuned' ? ' with the tuned parameters' : ''} yet: treat every number as unchecked.`;
  const h = s.holdout;
  return `${head}. Project check with it, hold-out: journey times ${h.jt.ok}/${h.jt.n} within 15%, published counts ${h.counts.gehOk}/${h.counts.n} within GEH 5, river crossings ${pct(h.river.pct)}: ${s.pass ? 'passes' : 'fails'}.`;
}

export const SYNTHETIC_DEMAND_CHECK = {
  recorded: !!P14_SYNTHETIC_RECORD,
  runId: P14_SYNTHETIC_RECORD?.runId ?? null,
  decision: SYNTHETIC_DECISION,
  params: SYNTHETIC_PARAMS,
  score: PROJECT_SCORE_SYNTHETIC,
};
