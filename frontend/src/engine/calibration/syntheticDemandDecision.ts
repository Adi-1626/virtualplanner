import { scoreProjectCheck, type ProjectScore } from './projectCheck';
import { officialNotWorse, type OfficialCheckNumbers } from './tunedSupply';
import { P13_RECORD } from './projectValidationRecord';
import { P14_SYNTHETIC_RECORD } from './syntheticDemandRecord';

/**
 * p14: whether the SYNTHETIC land-use demand (demand/syntheticDemand.ts) replaces the area estimate by default.
 *
 * Rule (docs/urbanos/DEMAND_P14.md, the same bar as the p13 tuned set): ON by default only if, with the synthetic demand,
 * the p13 project check PASSES on its hold-out records (same records, same 50/50 seed-13 split, same TAG M3.1 criteria)
 * AND the official-count check is not made worse (when it was run with the synthetic demand). Otherwise it stays an
 * opt-in setting labelled "synthetic". Computed from the recorded runs (syntheticDemandRecord.ts), never set by hand.
 */
export function decideSyntheticDefault(project: ProjectScore | null, base: OfficialCheckNumbers | null, synthetic: OfficialCheckNumbers | null): { on: boolean; reason: string } {
  if (!project) return { on: false, reason: 'the hold-out check has not been run with the synthetic demand' };
  if (!project.pass) return { on: false, reason: 'with the synthetic demand the project check does not pass on its hold-out records' };
  if (base && synthetic && !officialNotWorse(base, synthetic)) return { on: false, reason: 'the synthetic demand makes the official-count check worse' };
  return { on: true, reason: 'with the synthetic demand the project check passes on its hold-out records and the official-count check is not worse' };
}

export const PROJECT_SCORE_SYNTHETIC: ProjectScore | null = P14_SYNTHETIC_RECORD ? scoreProjectCheck(P14_SYNTHETIC_RECORD.obs) : null;
export const SYNTHETIC_DECISION = decideSyntheticDefault(PROJECT_SCORE_SYNTHETIC, P13_RECORD.officialDefault, P14_SYNTHETIC_RECORD?.official ?? null);
export const SYNTHETIC_DEMAND_DEFAULT_ON = SYNTHETIC_DECISION.on;
/** The synthetic demand's calibration parameters as recorded (scale 1, beta as built when nothing was tuned). */
export const SYNTHETIC_PARAMS = P14_SYNTHETIC_RECORD?.params ?? { scale: 1, betaMult: 1 };
