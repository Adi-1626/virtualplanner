import React from 'react';
import { Fuel, MousePointerClick, Flag, PencilRuler, GitCompareArrows, AlertTriangle } from 'lucide-react';
import type { ComparisonResult, Delta } from '../../engine/simulation/ScenarioComparison';
import { EvidenceChip } from '../environment/EnvBits';
import { AgreementChip, ChangePill, DeltaRows } from '../ScenarioDeltaTable';
import { Disclosure } from '../ui/viz';
import { hourLabel } from '../../engine/simulation/timeOfDay';

/**
 * Engine-free pieces of the Simulate workspace (docs/urbanos/SIMULATE_WORKSPACE.md), rendered in tests. Every
 * result block says how it is known with the same Measured / Modelled chip Environment uses: traffic counts are
 * measured; everything the traffic model computes (speeds, delays, volumes, verdicts, emissions, the live view) is
 * modelled, and the model fails validation (TAG M3.1).
 */

export type SimEvidence = 'measured' | 'modelled' | 'hypothetical';

const WHY: Record<SimEvidence, string> = {
  measured: 'counted on the road and published (see the source)',
  modelled: 'computed by the traffic model, which fails validation against Pune counts (TAG M3.1); use it to compare options on the same inputs, not as a forecast',
  hypothetical: 'a what-if setting you chose, run through the traffic model; neither observed nor forecast',
};

/** "Measured" / "Modelled" / "Hypothetical" on a result block. */
export const EvidenceTag: React.FC<{ kind: SimEvidence; testId?: string }> = ({ kind, testId }) => (
  kind === 'hypothetical'
    ? <EvidenceChip kind="inferred" label="Hypothetical" why={WHY.hypothetical} testId={testId ?? 'evidence-hypothetical'} />
    : <EvidenceChip kind={kind} label={kind === 'measured' ? 'Measured' : 'Modelled'} why={WHY[kind]} testId={testId ?? `evidence-${kind}`} />
);

/** A section title with its evidence tag on the right. */
export const ResultHeading: React.FC<{ title: string; kind: SimEvidence; aside?: React.ReactNode; testId?: string }> = ({ title, kind, aside, testId }) => (
  <div className="flex items-center justify-between gap-2" data-testid={testId}>
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
    <span className="flex items-center gap-1.5">{aside}<EvidenceTag kind={kind} /></span>
  </div>
);

/** The four steps of a study, shown before a road is picked. */
export const GetStartedCard: React.FC = () => (
  <div className="rounded-2xl border border-cyan-400/30 bg-cyan-500/5 px-4 py-4 space-y-3" data-testid="simulate-get-started">
    <div className="space-y-1">
      <p className="text-base font-semibold text-white flex items-center gap-2"><MousePointerClick size={18} className="text-cyan-300" aria-hidden />Click a road on the map</p>
      <p className="text-sm text-slate-300 leading-relaxed">Any road, bridge or flyover. Shift+click adds more roads, for a corridor.</p>
    </div>
    <ol className="space-y-1.5 text-sm text-slate-300" aria-label="How a study works">
      <li className="flex gap-2"><span className="text-cyan-300 tabular-nums">1</span><span><strong className="text-white">What's wrong:</strong> speed, delay, how full it is and what holds it up, at the hour you pick. About a minute.</span></li>
      <li className="flex gap-2"><span className="text-cyan-300 tabular-nums">2</span><span><Flag size={13} className="inline -mt-0.5 mr-1 text-slate-400" aria-hidden /><strong className="text-white">Save the existing city</strong> as the baseline.</span></li>
      <li className="flex gap-2"><span className="text-cyan-300 tabular-nums">3</span><span><PencilRuler size={13} className="inline -mt-0.5 mr-1 text-slate-400" aria-hidden /><strong className="text-white">Draw or edit</strong> your proposal in Design (a road, lanes, a junction, a signal).</span></li>
      <li className="flex gap-2"><span className="text-cyan-300 tabular-nums">4</span><span><GitCompareArrows size={13} className="inline -mt-0.5 mr-1 text-slate-400" aria-hidden /><strong className="text-white">Compare</strong>: the same trips, hour and runs on both, so the difference is your change.</span></li>
    </ol>
    <p className="text-xs text-slate-400 leading-snug">Results are <EvidenceTag kind="modelled" /> estimates: the traffic model does not yet match Pune's counts, so read them as "better or worse than the existing city", not as forecasts.</p>
  </div>
);

/** Which hour a comparison is for, and a warning when the panel now shows another hour. */
export const ComparisonHourNote: React.FC<{ comparisonHour: number; currentHour: number }> = ({ comparisonHour, currentHour }) => (
  <div className="space-y-1" data-testid="comparison-hour">
    <p className="text-[11px] text-slate-400">Existing city vs proposal at <strong className="text-slate-200 tabular-nums">{hourLabel(comparisonHour)}</strong>, same trips and runs on both.</p>
    {comparisonHour !== currentHour && (
      <p role="status" data-testid="comparison-hour-mismatch" className="rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-200 flex items-start gap-1">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
        This comparison is for {hourLabel(comparisonHour)}; the panel now shows {hourLabel(currentHour)}. Set the time back to {hourLabel(comparisonHour)} or save a new baseline at {hourLabel(currentHour)} to compare this hour.
      </p>
    )}
  </div>
);

/** One emission measure as a relative change only (label, runs agreeing, % change). */
const RelativeRow: React.FC<{ d: Delta }> = ({ d }) => (
  <li className="flex items-center justify-between gap-2 py-1" data-testid="emissions-relative-row">
    <span className="text-xs text-slate-300">{d.label}</span>
    <span className="flex items-center gap-1 shrink-0"><AgreementChip d={d} /><ChangePill d={d} /></span>
  </li>
);

/**
 * Compare: corridor fuel and emissions as relative change (same frozen demand and seeds); never part of the verdict.
 * The totals are behind a disclosure: from a traffic model that fails validation they are not for quoting (the
 * same rule as Environment's emissions card).
 */
export const EmissionsCompare: React.FC<{ c: ComparisonResult }> = ({ c }) => !c.emissions ? null : (
  <div className="space-y-1" data-testid="emissions-compare">
    <ResultHeading title="Fuel and emissions nearby" kind="modelled" aside={<Fuel size={12} className="text-slate-500" aria-hidden />} />
    <p className="text-[11px] text-slate-500 leading-snug">Change from the existing city, in the simulated neighbourhood. Read distance first: more traffic served burns more fuel in total.</p>
    <ul className="divide-y divide-white/5">{c.emissions.deltas.filter(d => !/idling/i.test(d.label)).map(d => <RelativeRow key={d.label} d={d} />)}</ul>
    <Disclosure title="Model totals (not for quoting)" tone="subtle" testId="emissions-totals">
      <DeltaRows rows={c.emissions.deltas} />
      <p>{c.emissions.note} Model: <a className="underline" href={c.emissions.source} target="_blank" rel="noreferrer">{c.emissions.model}</a>.</p>
    </Disclosure>
  </div>
);
