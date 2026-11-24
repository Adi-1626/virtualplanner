import React from 'react';
import { ArrowLeftRight, CheckCircle2, CornerDownLeft, Info, Loader2, Lock, X, AlertTriangle, History } from 'lucide-react';
import { useRoundTrip } from '../../shell/roundTripController';
import { roundTrip } from '../../shell/roundTrip';
import { STUDY_DISTANCES_M } from '../../engine/simulation/SimulationMode';
import { BASE_ACTIVE_TEXT, changeCountText, legHeadline, outsideAreaText, sinceLastTest, UNDERGROUND_ONLY_TEXT, verdictWord, widerRange, type TripTest } from '../../engine/simulation/roundTrip';
import { hourLabel } from '../../engine/simulation/timeOfDay';
import { formatDistanceM } from '../../lib/format';
import { Button, Notice } from '../ui/kit';
import { Chip } from '../ui/viz';
import type { Tone } from '../ui/vizTones';

const VERDICT_TONE: Record<TripTest['verdict'], Tone> = { better: 'good', worse: 'bad', mixed: 'warn', no_change: 'neutral' };

/**
 * The "Return to study" bar (docs/urbanos/SIM_FLOW_P12.md §3): on the map in every workspace but Simulate while the
 * planner is changing a proposal for a Simulate study. It names the study and what is being changed, counts the
 * changes, and offers "Done – re-test" and "Cancel"; it asks before re-testing a change Simulate would not see.
 */
export const RoundTripBar: React.FC = () => {
  const { trip, changes, ask, baseActive } = useRoundTrip();
  const leg = trip?.leg;
  // Esc on an open question closes the question only (keep editing): not the drawing, the selection or the test
  const asking = !!ask && !!leg;
  React.useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); roundTrip().dismissAsk(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [asking]);
  if (!trip || !leg) return null;
  const rt = roundTrip();
  const study = trip.study;
  const busy = leg.phase === 'retesting';
  const wider = widerRange(study.rangeMeters, STUDY_DISTANCES_M);
  return (
    <section className="uos-roundtrip" role="region" aria-label="Return to study" data-testid="roundtrip-bar" data-phase={leg.phase}>
      <div className="flex flex-wrap items-start gap-2 min-w-0">
        <ArrowLeftRight size={16} className="text-cyan-300 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1 basis-[300px]">
          <p className="text-[13px] font-semibold text-white leading-snug" data-testid="roundtrip-study">
            {trip.resumed ? 'Resume: ' : ''}Testing a change for {study.label}
            <span className="font-normal text-slate-400"> · {hourLabel(study.hour)} {study.day} · {formatDistanceM(study.rangeMeters)} area</span>
          </p>
          <p className="text-xs text-slate-300 leading-snug" data-testid="roundtrip-target">
            {legHeadline(leg)} · changes go into the proposal <strong className="text-cyan-200">“{leg.proposalName}”</strong>{leg.createdProposal ? ' (made for this test)' : ''}; the existing city is not changed.
          </p>
          <p className="text-[11px] text-slate-400" data-testid="roundtrip-changes">{changes ? changeCountText(changes) : 'Counting changes…'}{changes && changes.network > 0 && changes.inArea < changes.network ? ` (${changes.network - changes.inArea} outside the study area)` : ''}</p>
        </div>
        <div className="flex gap-1.5 shrink-0 flex-wrap justify-end ml-auto">
          <Button size="sm" variant="primary" icon={busy ? Loader2 : CornerDownLeft} spin={busy} disabled={busy || baseActive} data-testid="roundtrip-done" onClick={() => void rt.finish()}
            title="Go back to the study, run this proposal on the baseline's trips, hour and seeds, and compare">{trip.resumed ? 'Return and re-test' : 'Done – re-test'}</Button>
          <Button size="sm" variant="ghost" icon={X} disabled={busy} data-testid="roundtrip-cancel" onClick={() => rt.cancel()} title="Go back to the study without a re-test">Cancel</Button>
        </div>
      </div>
      {baseActive && (
        <div className="uos-roundtrip-ask" data-testid="roundtrip-base-active">
          <p className="flex items-start gap-1.5"><Lock size={13} className="shrink-0 mt-0.5 text-amber-300" />{BASE_ACTIVE_TEXT}</p>
          <div className="flex gap-1.5 flex-wrap"><Button size="sm" variant="primary" onClick={() => rt.switchBackToProposal()}>Back to “{leg.proposalName}”</Button><Button size="sm" variant="ghost" onClick={() => rt.end()}>End this test</Button></div>
        </div>
      )}
      {ask?.kind === 'outside' && (
        <div className="uos-roundtrip-ask" data-testid="roundtrip-ask-outside">
          <p className="flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-300" />{outsideAreaText(ask.names, study.rangeMeters)}</p>
          <div className="flex gap-1.5 flex-wrap">
            {wider && <Button size="sm" variant="primary" data-testid="roundtrip-widen" onClick={() => void rt.finish({ widenTo: wider })} title="A new baseline is saved for the larger area first">Widen the study to {formatDistanceM(wider)} and re-test</Button>}
            <Button size="sm" onClick={() => void rt.finish({ outsideAccepted: true })}>Re-test anyway</Button>
            <Button size="sm" variant="ghost" onClick={() => rt.dismissAsk()}>Keep editing</Button>
          </div>
        </div>
      )}
      {ask?.kind === 'underground' && (
        <div className="uos-roundtrip-ask" data-testid="roundtrip-ask-underground">
          <p className="flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-0.5 text-cyan-300" />{UNDERGROUND_ONLY_TEXT}</p>
          <div className="flex gap-1.5 flex-wrap"><Button size="sm" variant="primary" onClick={() => void rt.finish({ noRetest: true })}>Return to the study</Button><Button size="sm" variant="ghost" onClick={() => rt.dismissAsk()}>Keep editing</Button></div>
        </div>
      )}
      {ask?.kind === 'cancel' && (
        <div className="uos-roundtrip-ask" data-testid="roundtrip-ask-cancel">
          <p className="flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-300" />{changes ? changeCountText(changes) : 'Changes'} made since you left Simulate. {leg.createdProposal ? `Undo deletes the proposal “${leg.proposalName}” made for this test.` : `Undo takes “${leg.proposalName}” back to where it was.`}</p>
          <div className="flex gap-1.5 flex-wrap">
            <Button size="sm" data-testid="roundtrip-cancel-undo" onClick={() => void rt.cancelWith('undo')}>Undo them and return</Button>
            <Button size="sm" data-testid="roundtrip-cancel-keep" onClick={() => void rt.cancelWith('keep')}>Keep them and return</Button>
            <Button size="sm" variant="ghost" onClick={() => rt.dismissAsk()}>Stay here</Button>
          </div>
        </div>
      )}
      {trip.status && trip.status.tone !== 'good' && <p className={`text-[11px] ${trip.status.tone === 'bad' ? 'text-rose-300' : 'text-amber-200'}`} role="status" data-testid="roundtrip-bar-status">{trip.status.text}</p>}
    </section>
  );
};

/**
 * Inside the Simulate panel (Improve & compare): the round trip's progress or outcome, a leg left open (the planner
 * came back by the rail), and the tests of this study so far with the change since the previous one.
 */
export const RoundTripPanel: React.FC<{ seedKey: string }> = ({ seedKey }) => {
  const { trip } = useRoundTrip();
  const ref = React.useRef<HTMLDivElement>(null);
  const statusText = trip?.status?.text;
  React.useEffect(() => { if (statusText) ref.current?.scrollIntoView({ block: 'nearest' }); }, [statusText]);
  if (!trip || [...trip.study.seedRoadIds].sort().join('|') !== seedKey) return null;
  const rt = roundTrip();
  const leg = trip.leg;
  const tests = trip.tests;
  const last = tests.at(-1), prev = tests.at(-2);
  const since = last && prev ? sinceLastTest(prev, last) : [];
  const st = trip.status;
  return (
    <div className="space-y-2" ref={ref} data-testid="roundtrip-panel">
      {st && (
        <Notice tone={st.tone} icon={leg?.phase === 'retesting' ? Loader2 : st.tone === 'good' ? CheckCircle2 : st.tone === 'bad' ? AlertTriangle : Info} spin={leg?.phase === 'retesting'}
          action={<span className="flex gap-1">{st.retry && leg && <Button size="sm" onClick={() => rt.retry()}>Try again</Button>}{leg?.phase !== 'retesting' && <button aria-label="Dismiss" className="text-slate-300 hover:text-white cursor-pointer" onClick={() => rt.dismissStatus()}><X size={14} /></button>}</span>}>
          <span data-testid="roundtrip-status" data-tone={st.tone}>{st.text}</span>
        </Notice>
      )}
      {trip.baselineSavedByFlow && <p className="text-[11px] text-slate-400" data-testid="roundtrip-baseline-auto">The baseline (the existing city, Base) was saved automatically when you started testing, with this study's trips, hour and seeds. Every test is compared with it.</p>}
      {tests.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-1.5" data-testid="roundtrip-tests">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1"><History size={12} />Your tests of this road (each against the existing city)</p>
          <ol className="space-y-1">
            {tests.map(t => (
              <li key={t.iteration} className="flex items-center gap-2 text-xs" data-testid="roundtrip-test" data-verdict={t.verdict}>
                <span className="text-slate-500 tabular-nums">#{t.iteration}</span>
                <span className="text-slate-200 truncate flex-1" title={t.summary}>{t.target?.title ?? 'Own change'} <span className="text-slate-500">in “{t.proposalName}”</span></span>
                <Chip tone={VERDICT_TONE[t.verdict]}>{verdictWord(t.verdict)}</Chip>
              </li>
            ))}
          </ol>
          {since.length > 0 && (
            <div className="border-t border-white/10 pt-1.5" data-testid="roundtrip-since-last">
              <p className="text-[11px] text-slate-400">Test #{last!.iteration} against test #{prev!.iteration} (the road itself; both on the same baseline trips):</p>
              <table className="w-full text-[11px] tabular-nums"><tbody>
                {since.map(r => (
                  <tr key={r.label}><td className="text-slate-300 pr-2">{r.label}</td><td className="text-right text-slate-400">{fmtV(r.before, r.unit)} → {fmtV(r.after, r.unit)}</td>
                    <td className={`text-right pl-2 ${r.good === true ? 'text-emerald-300' : r.good === false ? 'text-rose-300' : 'text-slate-400'}`}>{r.change > 0 ? '+' : ''}{Math.round(r.change * 100)}%</td></tr>
                ))}
              </tbody></table>
              <p className="text-[11px] text-slate-500">Modelled, low confidence: read the direction, not the exact figures.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * A leg left open when the planner came back to Simulate by the rail (not with "Done – re-test"): shown above the
 * study on every tab, so the change is never silently left untested.
 */
export const OpenLegNotice: React.FC = () => {
  const { trip } = useRoundTrip();
  const leg = trip?.leg;
  if (!trip || !leg || leg.phase !== 'editing') return null;
  const rt = roundTrip();
  return (
    <Notice tone="info" icon={ArrowLeftRight} action={<span className="flex gap-1"><Button size="sm" variant="primary" data-testid="roundtrip-retest-now" onClick={() => void rt.finish()}>Re-test now</Button><Button size="sm" variant="ghost" onClick={() => rt.cancel()}>Cancel</Button></span>}>
      <span data-testid="roundtrip-open-leg">You were changing “{leg.proposalName}” for {trip.study.label} ({legHeadline(leg).toLowerCase()}). Re-test it against the saved baseline, or cancel.</span>
    </Notice>
  );
};

const fmtV = (v: number, unit: string) => `${Math.round(v).toLocaleString()}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;
