import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Loader2, RefreshCw, TriangleAlert, Undo2, X as XIcon } from 'lucide-react';
import { freshnessApi, type FactsVersion, type Proposal, type UpdaterStatus } from '../../lib/freshnessApi';
import { EmptyState } from '../ui/EmptyState';
import { inputCls } from '../projects/projectData';
import { Disclosure } from '../ui/Disclosure';
import {
  CONFIDENCE_HELP, CONFIDENCE_LABEL, CONFIDENCE_TONE, STATUS_LABEL, flagLabel, approvedNotApplied, changeLine,
  conflictSummary, evidenceDate, evidenceSource, groupProposals, needsNote, proposalIsOfficial, rollbackTargets, sourceCount, versionNote,
} from './factUpdatesModel';

const TONE_COLOR = { good: 'var(--measured, #3FB950)', warn: 'var(--warn, #E8833A)', bad: 'var(--fail, #FF6B61)', unknown: 'var(--unknown, #9AA4B2)' };
const reviewerName = () => localStorage.getItem('td-user') ?? '';
const toast = (msg: string, kind: 'success' | 'error') => (window as unknown as { showToast?: (m: string, k: string) => void }).showToast?.(msg, kind);

export interface ProposalActions {
  reviewer: string;
  busy: string | null;
  onApprove: (p: Proposal, note: string) => void;
  onReject: (p: Proposal, note: string) => void;
}

/**
 * One proposed fact: value, how it changes the dataset, confidence, conflict warning, the quoted sentences with links,
 * flags, and Approve / Reject. Pure presentational (tested with renderToStaticMarkup).
 */
export const ProposalCard: React.FC<{ p: Proposal; actions: ProposalActions }> = ({ p, actions }) => {
  const [note, setNote] = useState('');
  const tone = TONE_COLOR[CONFIDENCE_TONE[p.confidence]];
  const conflict = conflictSummary(p);
  const noteNeeded = needsNote(p);
  const official = proposalIsOfficial(p);
  const canDecide = official && (p.status === 'pending' || p.status === 'approved' || p.status === 'rolled_back');
  const disabled = !!actions.busy || !actions.reviewer;
  return (
    <li className="uos-card space-y-1.5" data-testid={`proposal-${p.id}`} data-confidence={p.confidence} data-status={p.status}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-label text-text-2">{p.attribute_label}</span>
        <span className="text-label text-text-1 font-semibold" data-testid="proposal-value">{p.label}</span>
        <span className="uos-data-chip" style={{ borderColor: tone, color: tone }} title={CONFIDENCE_HELP[p.confidence]} data-testid="proposal-confidence">
          {CONFIDENCE_LABEL[p.confidence]}</span>
        <span className="text-meta text-text-3">{sourceCount(p)}</span>
        {p.status !== 'pending' && <span className="uos-data-chip">{STATUS_LABEL[p.status] ?? p.status}</span>}
      </div>
      <p className="text-meta text-text-2" data-testid="proposal-change">{changeLine(p)}{p.temporal === 'planned' ? ' · a plan, not a completed fact' : ''}</p>
      {conflict && (
        <p className="text-meta flex items-start gap-1" style={{ color: TONE_COLOR.bad }} role="note" data-testid="proposal-conflict">
          <TriangleAlert size={12} aria-hidden className="mt-0.5 shrink-0" />{conflict}</p>
      )}
      {!official && <p className="text-meta" style={{ color: TONE_COLOR.bad }} role="note" data-testid="proposal-not-official">
        Not from an official source: it can never be approved or enter the dataset.</p>}
      <ul className="space-y-1" data-testid="proposal-evidence">
        {(official ? p.evidence ?? [] : []).map(e => (
          <li key={e.claim_id} className="text-meta text-text-2">
            <blockquote className="border-l-2 pl-2 italic text-text-1" style={{ borderColor: 'var(--border-strong)' }}>“{e.quote}”</blockquote>
            <span className="text-text-3">
              {e.publisher} · {evidenceSource(e)} · {evidenceDate(e)}
              {e.attribution !== 'sentence' && e.attribution !== 'page_rule' ? ' · project named only in context' : ''}
              {e.note ? ` · ${e.note}` : ''}{' · '}
              <a className="uos-link inline-flex items-center gap-0.5" href={e.url} target="_blank" rel="noreferrer">source<ExternalLink size={10} aria-hidden /></a>
            </span>
          </li>
        ))}
      </ul>
      {p.flags.length > 0 && (
        <ul className="flex flex-wrap gap-1" data-testid="proposal-flags">
          {p.flags.map(f => <li key={f.code} className="uos-data-chip" title={f.detail} style={{ color: TONE_COLOR.warn, borderColor: TONE_COLOR.warn }}>{flagLabel(f)}</li>)}
        </ul>
      )}
      {p.decided_by && <p className="text-meta text-text-3">Decided by {p.decided_by}{p.decision_note ? ` — ${p.decision_note}` : ''}</p>}
      {canDecide && (
        <div className="flex flex-wrap items-center gap-1.5">
          <input className={`${inputCls} flex-1 min-w-[12rem]`} style={{ width: 'auto' }} value={note} onChange={e => setNote(e.target.value)}
            placeholder={noteNeeded ? 'Note required: how was this checked?' : 'Note (optional)'} aria-label={`Review note for ${p.attribute_label} ${p.label}`} />
          {(p.status === 'pending' || p.status === 'rolled_back') && (
            <button type="button" className="uos-btn uos-btn-sm" data-testid="proposal-approve" disabled={disabled || (noteNeeded && !note.trim())}
              title={!actions.reviewer ? 'Set your name (Traffic data / Projects) to review' : noteNeeded && !note.trim() ? 'Official sources disagree, the date slipped or the value was LLM-extracted: add a note' : 'Approve (does not change the dataset until applied)'}
              onClick={() => actions.onApprove(p, note)}>
              {actions.busy === `a${p.id}` ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}Approve</button>
          )}
          <button type="button" className="uos-btn uos-btn-sm" data-testid="proposal-reject" disabled={disabled}
            onClick={() => actions.onReject(p, note)}>
            {actions.busy === `r${p.id}` ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <XIcon size={13} aria-hidden />}Reject</button>
        </div>
      )}
    </li>
  );
};

/** The apply bar + version history (roll back). */
export const ApplyBar: React.FC<{ approved: Proposal[]; versions: FactsVersion[]; reviewer: string; busy: string | null;
  onApply: () => void; onRollback: (v: FactsVersion) => void }> = ({ approved, versions, reviewer, busy, onApply, onRollback }) => {
  const active = versions.find(v => v.review_status === 'active');
  const targets = rollbackTargets(versions);
  const note = (n: string) => versionNote(n, versions);
  return (
    <div className="uos-card space-y-1.5" data-testid="facts-apply-bar">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-label text-text-1">Facts dataset: {active ? `version ${active.version_label} · ${active.facts ?? 0} facts` : 'no version yet'}</span>
        <span className="flex-1" />
        <button type="button" className="uos-btn uos-btn-sm" data-testid="facts-apply" disabled={!approved.length || !!busy || !reviewer}
          title={!reviewer ? 'Set your name to apply' : 'Write the approved facts as a new dataset version (registered and activated with your name)'}
          onClick={onApply}>
          {busy === 'apply' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
          Apply {approved.length} approved fact{approved.length === 1 ? '' : 's'} as a new version</button>
      </div>
      {targets.length > 0 && (
        <Disclosure summary={`Versions (${versions.length}) and roll back`}>
          <ul className="space-y-1 text-meta text-text-2" data-testid="facts-versions">
            {versions.map(v => (
              <li key={v.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-text-1">{v.version_label}</span><span>{v.review_status}</span><span>{v.facts ?? 0} facts</span>
                <span className="text-text-3">{v.reviewed_by ?? ''}{v.review_note ? ` — ${note(v.review_note)}` : ''}</span>
                {v.review_status === 'superseded' && (
                  <button type="button" className="uos-btn uos-btn-sm ml-auto" disabled={!!busy || !reviewer} data-testid={`facts-rollback-${v.version_label}`}
                    onClick={() => onRollback(v)}><Undo2 size={12} aria-hidden />Roll back to {v.version_label}</button>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
};

/** Data catalogue → Fact updates: the review queue of `python -m updater` (docs/urbanos/DATA_FRESHNESS_SERVICE.md). */
export const FactUpdatesPane: React.FC = () => {
  const [list, setList] = useState<Proposal[] | null>(null);
  const [versions, setVersions] = useState<FactsVersion[]>([]);
  const [status, setStatus] = useState<UpdaterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const reviewer = reviewerName();
  const load = useCallback(() => {
    setError(null);
    freshnessApi.proposals().then(setList).catch((e: Error) => { setList([]); setError(e.message); });
    freshnessApi.versions().then(setVersions).catch(() => setVersions([]));
    freshnessApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok, 'success'); load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const groups = useMemo(() => groupProposals(list ?? []), [list]);
  const approved = useMemo(() => approvedNotApplied(list ?? []), [list]);
  const actions: ProposalActions = {
    reviewer, busy,
    onApprove: (p, note) => void act(`a${p.id}`, () => freshnessApi.approve(p.id, reviewer, note), 'Approved — apply to add it to the dataset'),
    onReject: (p, note) => void act(`r${p.id}`, () => freshnessApi.reject(p.id, reviewer, note), 'Rejected'),
  };
  if (list == null) return <p className="p-4 text-label text-text-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />Loading…</p>;
  const lastRun = status?.last_runs?.[0];
  return (
    <div className="uos-data-features space-y-3" data-testid="fact-updates">
      <p className="text-label text-text-2">
        New facts about watched Pune projects, found by the data-freshness service on official sites only: government and agency pages
        (gov.in, nic.in, Maha-Metro, Parliament, MSRDC). News reports are never used. Each fact shows the sentence it came from. Nothing changes the
        dataset until a named reviewer approves it and applies it as a new version; every version can be rolled back.
      </p>
      {error && <p className="text-label text-warn" role="status">Could not load the review queue ({error}).</p>}
      <div className="flex items-center gap-2 text-meta text-text-3 flex-wrap">
        <span>{error ? 'Last run unknown (the server did not answer).' : lastRun ? `Last run ${lastRun.started_at?.slice(0, 16).replace('T', ' ')} UTC · ${lastRun.errors.length} source error(s)` : 'The service has not run yet (python -m updater run).'}</span>
        {status && !status.audit.ok && <span style={{ color: TONE_COLOR.bad }}>Audit log check failed: {status.audit.reason}</span>}
        <span className="flex-1" />
        <button type="button" className="uos-btn uos-btn-sm" onClick={load} aria-label="Reload review queue"><RefreshCw size={13} aria-hidden />Reload</button>
      </div>
      {!error && !!status?.facts.withheld?.length && (
        <p className="text-label flex items-start gap-1" style={{ color: TONE_COLOR.warn }} role="status" data-testid="facts-withheld">
          <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
          {status.facts.withheld.length} fact{status.facts.withheld.length === 1 ? '' : 's'} in the active version {status.facts.withheld.length === 1 ? 'is' : 'are'} not
          from an official source and {status.facts.withheld.length === 1 ? 'is' : 'are'} hidden from the app. Run python -m updater migrate-official-only to replace that version.</p>
      )}
      {!reviewer && <p className="text-label" style={{ color: TONE_COLOR.warn }}>Set your name (Traffic data or Projects) to approve, reject or apply.</p>}
      {!error && <ApplyBar approved={approved} versions={versions} reviewer={reviewer} busy={busy}
        onApply={() => void act('apply', () => freshnessApi.apply(reviewer), 'New facts version applied')}
        onRollback={v => void act(`rb${v.id}`, () => freshnessApi.rollback(v.id, reviewer), `Rolled back to ${v.version_label}`)} />}
      {!error && groups.length === 0 && <EmptyState icon={Check} title="Nothing to review">The service has no pending proposals.</EmptyState>}
      {groups.map(g => (
        <section key={g.projectId} data-testid={`fact-project-${g.projectId}`}>
          <h3 className="text-label font-semibold text-text-1 mb-1">{g.projectName}</h3>
          <ul className="space-y-1.5">{g.items.map(p => <ProposalCard key={p.id} p={p} actions={actions} />)}</ul>
        </section>
      ))}
    </div>
  );
};
