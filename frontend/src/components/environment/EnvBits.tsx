/** Small shared pieces of the Environment panel: the Measured / Modelled / Inferred chip and the source · date · licence line. */
import React from 'react';
import { EVIDENCE_HELP, type Evidence, type MetaLine } from './envPlanner';

const COLOR: Record<Evidence, string> = { measured: '#5cc9a7', modelled: '#8ab4ff', inferred: '#e8b04a' };

export const EvidenceChip: React.FC<{ kind: Evidence; label: string; why?: string; testId?: string }> = ({ kind, label, why, testId }) => (
  <span className="inline-flex items-center rounded border px-1 py-px text-[11px] font-semibold leading-none whitespace-nowrap"
    style={{ color: COLOR[kind], borderColor: COLOR[kind], background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
    title={`${label}: ${why ? `${why}. ` : ''}${EVIDENCE_HELP[kind]}`} data-testid={testId} data-evidence={kind}>{label}</span>
);

/** "[Measured] PMC via OpenCity · 2019 · Public domain" — every layer row carries this line. */
export const LayerMeta: React.FC<{ m: MetaLine; testId?: string }> = ({ m, testId }) => (
  <p className="text-meta text-text-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0 [overflow-wrap:anywhere]" data-testid={testId}>
    <EvidenceChip kind={m.evidence} label={m.evidenceLabel} why={m.why} />
    <span>{m.source}</span><span aria-hidden>·</span><span className="tabular-nums">{m.date}</span><span aria-hidden>·</span><span>{m.licence}</span>
  </p>
);
