import React from 'react';
import { TRAFFIC_VALIDATION, type ValidationRow } from './trafficValidation';
import { PROJECT_CHECK, projectRows } from './projectValidation';

const Rows: React.FC<{ rows: readonly ValidationRow[] }> = ({ rows }) => (
  <table className="w-full text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
    <thead><tr style={{ color: 'var(--text-3, #8B95A3)' }} className="text-left"><th className="font-medium pb-1">Test</th><th className="font-medium pb-1">Needed</th><th className="font-medium pb-1">Result</th></tr></thead>
    <tbody>
      {rows.map(r => (
        <tr key={r.test} data-status={r.status} className="align-top border-t" style={{ borderColor: 'var(--border, #333C47)' }}>
          <td className="py-1 pr-1">{r.test}</td>
          <td className="py-1 pr-1" style={{ color: 'var(--text-2, #A9B3C1)' }}>{r.required}</td>
          <td className="py-1"><span style={{ color: r.status === 'FAIL' ? 'var(--fail, #FF6B61)' : 'var(--text-2, #A9B3C1)' }} className="font-semibold">{r.status}</span> {r.result}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/** Compact table of the recorded TAG M3.1 results, verdict and row status computed in trafficValidation.ts. */
export const ValidationSummary: React.FC = () => (
  <div data-testid="validation-summary" className="flex flex-col gap-2">
    <p className="font-semibold" style={{ color: TRAFFIC_VALIDATION.verdict === 'fails_validation' ? 'var(--fail, #FF6B61)' : 'var(--text-1, #E6EAF0)' }}>
      Official-count check: {TRAFFIC_VALIDATION.verdict === 'fails_validation' ? 'traffic model fails validation' : 'traffic model meets the recorded criteria'} ({TRAFFIC_VALIDATION.standard})
    </p>
    <p style={{ color: 'var(--text-2, #A9B3C1)' }}>{TRAFFIC_VALIDATION.meaning}</p>
    <Rows rows={TRAFFIC_VALIDATION.rows} />
    <p style={{ color: 'var(--text-3, #8B95A3)' }}>
      Recorded in {TRAFFIC_VALIDATION.source} (code {TRAFFIC_VALIDATION.codeRef}). Criteria: <a href={TRAFFIC_VALIDATION.standardUrl} target="_blank" rel="noreferrer" className="underline">{TRAFFIC_VALIDATION.standardTitle}</a>.
    </p>
    <div data-testid="project-check-summary" className="flex flex-col gap-2 border-t pt-2" style={{ borderColor: 'var(--border, #333C47)' }}>
      <p className="font-semibold" style={{ color: PROJECT_CHECK.default.pass ? 'var(--text-1, #E6EAF0)' : 'var(--fail, #FF6B61)' }}>
        {PROJECT_CHECK.title}, default parameters: {PROJECT_CHECK.default.pass ? 'passes' : 'fails'} (hold-out)
      </p>
      <p style={{ color: 'var(--text-2, #A9B3C1)' }}>{PROJECT_CHECK.dataNote}</p>
      <Rows rows={projectRows(PROJECT_CHECK.default)} />
      {PROJECT_CHECK.tuned && (<>
        <p className="font-semibold" style={{ color: PROJECT_CHECK.tuned.pass ? 'var(--text-1, #E6EAF0)' : 'var(--fail, #FF6B61)' }}>Tuned parameters (estimated): {PROJECT_CHECK.tuned.pass ? 'passes' : 'fails'} (hold-out). {PROJECT_CHECK.tunedDecision.on ? 'On by default' : 'Opt-in'}: {PROJECT_CHECK.tunedDecision.reason}.</p>
        <Rows rows={projectRows(PROJECT_CHECK.tuned)} />
      </>)}
      <p style={{ color: 'var(--text-3, #8B95A3)' }}>Recorded in {PROJECT_CHECK.source} (run {PROJECT_CHECK.runId}).</p>
    </div>
  </div>
);
