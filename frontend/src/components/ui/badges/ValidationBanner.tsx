import React from 'react';
import { OctagonAlert } from 'lucide-react';
import { Disclosure } from '../Disclosure';
import { TRAFFIC_VALIDATION, TRAFFIC_VALIDATION_PLAIN, TRAFFIC_VALIDATION_SUMMARY, VALIDATION_CHECKS, type ValidationCheck } from './trafficValidation';

const OUTCOME_WORD: Record<ValidationCheck['outcome'], string> = { fails: 'Fails', passes: 'Passes', not_run: 'Not run', screening: 'Screening only' };
const OUTCOME_CLS: Record<ValidationCheck['outcome'], string> = { fails: 'text-fail', passes: 'text-measured', not_run: 'text-text-3', screening: 'text-warn' };

/** One labelled check: what was checked, what it found, why it fails. */
export const ValidationCheckRow: React.FC<{ c: ValidationCheck }> = ({ c }) => (
  <li className="space-y-1" data-testid="validation-check" data-check={c.id} data-outcome={c.outcome}>
    <p className="flex items-baseline gap-2"><span className="font-semibold flex-1 min-w-0">{c.label}</span><span className={`text-meta font-semibold shrink-0 ${OUTCOME_CLS[c.outcome]}`}>{OUTCOME_WORD[c.outcome]}</span></p>
    <p data-testid={c.id === 'counts' ? 'validation-checked' : `validation-checked-${c.id}`}>{c.checked} {c.result}</p>
    {c.why && <p data-testid={c.id === 'counts' ? 'validation-why' : `validation-why-${c.id}`}>{c.why}</p>}
  </li>
);

/**
 * The Simulate validation banner (docs/urbanos/SIM_FLOW_P12.md §7): the verdict, then each check as its own labelled
 * row, then what it means for using a result; the old one-line summary stays under "Technical summary".
 */
export const ValidationBanner: React.FC<{ checks?: readonly ValidationCheck[] }> = ({ checks = VALIDATION_CHECKS }) => (
  <div className="uos-banner-fail" role="status" data-testid="simulate-validation-banner">
    <OctagonAlert size={16} aria-hidden className="shrink-0 mt-0.5" />
    {TRAFFIC_VALIDATION.verdict === 'fails_validation' ? (
      <div className="space-y-1.5 min-w-0">
        <p className="font-semibold">{TRAFFIC_VALIDATION_PLAIN.headline}</p>
        <ul className="space-y-2" data-testid="validation-checks">{checks.map(c => <ValidationCheckRow key={c.id} c={c} />)}</ul>
        <p data-testid="validation-meaning" className="font-medium">{TRAFFIC_VALIDATION_PLAIN.meaning}</p>
        <Disclosure summary="Technical summary">
          <p className="text-meta">{TRAFFIC_VALIDATION_SUMMARY}.</p>
        </Disclosure>
      </div>
    ) : <p>Traffic model meets the recorded criteria ({TRAFFIC_VALIDATION.standard}): {TRAFFIC_VALIDATION_SUMMARY}.</p>}
  </div>
);
