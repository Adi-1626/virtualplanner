/**
 * Screening checks of the street design tools. Same shape as the cross-section checks (crossSection/checks.ts) so the
 * same list renders them. SCREENING ONLY: the best state is "no flag found", never a compliance or safety statement;
 * a value that is not known gives 'unknown', never a pass.
 */
import type { XsCheck, XsCheckStatus } from '../crossSection/checks';
import { SCREENING_DISCLAIMER } from '../geometry/alignment/criteria';
import { SD, sdLabel, type SdKey, type SdValue } from './sources';

export type SdCheck = XsCheck;
export type SdCheckStatus = XsCheckStatus;

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const fmtM = (n: number) => `${r2(n)} m`;

/** Basis text of one or more values. */
export const basisOf = (...keys: (SdKey | SdValue)[]) =>
  [...new Set(keys.map(k => sdLabel(typeof k === 'string' ? SD[k] : k)))].join('; ');

export function sdCheck(c: { id: string; name: string; status: SdCheckStatus; actual?: number | null; required?: number | null; unit?: string; text: string; basis: string }): SdCheck {
  return { id: c.id, name: c.name, status: c.status, actual: c.actual ?? null, required: c.required ?? null, unit: c.unit ?? 'm', basis: c.basis,
    screening: true, message: `${c.text} ${SCREENING_DISCLAIMER}` };
}

/** "fail ≥ 1 · warn · unknown" counts, as summarizeChecks. */
export function countFlags(checks: readonly SdCheck[]) {
  return { fail: checks.filter(c => c.status === 'fail').length, warn: checks.filter(c => c.status === 'warn').length,
    unknown: checks.filter(c => c.status === 'unknown').length };
}
