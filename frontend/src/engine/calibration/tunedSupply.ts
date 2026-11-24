import type { SupplyParams } from '../simulation/supplyParams';
import { scoreProjectCheck, type ProjectScore } from './projectCheck';
import { P13_RECORD } from './projectValidationRecord';

/**
 * p13: whether the tuned (estimated) supply set is used by default.
 *
 * Rule (docs/urbanos/VALIDATION_P13.md): ON by default only if the tuned set PASSES the project check on its hold-out
 * records AND does not worsen the official-count check (sites within GEH 5 overall and on the hold-out, and the size of
 * the river screen-line error). Otherwise it stays an opt-in setting labelled "tuned (estimated)".
 * Computed from the recorded runs in projectValidationRecord.ts, never set by hand.
 */
export interface OfficialCheckNumbers { gehAll: number; gehHoldout: number; n: number; nHoldout: number; riverPct: number }

export function officialNotWorse(base: OfficialCheckNumbers, tuned: OfficialCheckNumbers): boolean {
  return tuned.gehAll >= base.gehAll && tuned.gehHoldout >= base.gehHoldout && Math.abs(tuned.riverPct) <= Math.abs(base.riverPct) + 1e-9;
}

export function decideTunedDefault(project: ProjectScore | null, base: OfficialCheckNumbers | null, tuned: OfficialCheckNumbers | null): { on: boolean; reason: string } {
  if (!project || !base || !tuned) return { on: false, reason: 'no tuned set recorded' };
  if (!project.pass) return { on: false, reason: 'the tuned set does not pass the project check on its hold-out records' };
  if (!officialNotWorse(base, tuned)) return { on: false, reason: 'the tuned set makes the official-count check worse' };
  return { on: true, reason: 'the tuned set passes the project check on its hold-out records and does not worsen the official-count check' };
}

export const PROJECT_SCORE_DEFAULT: ProjectScore = scoreProjectCheck(P13_RECORD.defaultObs);
export const PROJECT_SCORE_TUNED: ProjectScore | null = P13_RECORD.tuned ? scoreProjectCheck(P13_RECORD.tuned.obs) : null;
export const TUNED_SUPPLY: SupplyParams | null = P13_RECORD.tuned?.params ?? null;
export const TUNED_DECISION = decideTunedDefault(PROJECT_SCORE_TUNED, P13_RECORD.officialDefault, P13_RECORD.tuned?.official ?? null);
export const TUNED_SUPPLY_DEFAULT_ON = TUNED_DECISION.on;
