import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, FileDown, FolderKanban, MapPin, ShieldQuestion } from 'lucide-react';
import { coordinationApi, type ConflictClass, type ScreeningFinding, type ScreeningObject, type ScreeningRun, type ScreeningStatus } from '../../lib/coordinationApi';
import { planningApi, type Project } from '../../engine/planning/planningApi';
import type { CityObject, UndergroundAlignmentObject } from '../../engine/objects/types';
import { engineInstance } from '../../engine/TwinCityEngine';
import { filterObjectsForScenario } from '../../engine/scenarios/scenarioFilter';
import { alignmentElementPayload } from '../../engine/underground/alignmentGeometry';
import { useEngineObjects } from '../../shell/useEngineObjects';
import { Disclosure } from '../ui/Disclosure';
import { field, input, inputStyle, lbl, labelStyle, note } from './common';
import { USER_KEY } from './useSubsurfaceRecords';
import { useUndergroundStore } from './undergroundStore';
import { useScreeningStore } from './screeningStore';
import {
  CATEGORY_LABEL, CLASS_TEXT, DIM_LABEL, RULE_TYPE_LABEL, SCREENING_BANNER, STATUS_TEXT, countsByStatus, forObject, groupBySeverity,
  highlightTargets, isStale, keyNumbers, plainSummary, screenedAsProposed,
} from './conflictClasses';
import { clearConflictHighlight, showConflictHighlight } from './conflictHighlight';
import { gapCountText, groupGaps, type GapGroup } from './screeningGroups';

const SCREENED_TYPES = new Set(['underground_alignment', 'utility', 'metro_line', 'metro_station']);
const isScreened = (o: CityObject) => SCREENED_TYPES.has(o.type);
const PAGE = 40;

/** Legacy badge for project-detection classes (Projects → Conflicts style). */
export const ClassBadge: React.FC<{ cls: ConflictClass; count?: number }> = ({ cls, count }) => (
  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-semibold" style={{ border: `1px solid ${CLASS_TEXT[cls].color}`, color: CLASS_TEXT[cls].color }}
    title={CLASS_TEXT[cls].hint} data-testid={`ug-class-${cls}`}>
    {CLASS_TEXT[cls].label}{count !== undefined ? ` · ${count}` : ''}
  </span>
);

export const StatusBadge: React.FC<{ status: ScreeningStatus; count?: number; onClick?: () => void; active?: boolean }> = ({ status, count, onClick, active }) => {
  const t = STATUS_TEXT[status];
  const cls = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-meta font-semibold whitespace-nowrap';
  const style: React.CSSProperties = { border: `1px solid ${t.color}`, color: t.color, background: active ? 'var(--surface-2)' : undefined };
  const body = <>{t.label}{count !== undefined ? ` · ${count}` : ''}</>;
  return onClick
    ? <button type="button" className={cls} style={style} title={t.hint} aria-pressed={active} onClick={onClick} data-testid={`ug-status-${status}`}>{body}</button>
    : <span className={cls} style={style} title={t.hint} data-testid={`ug-status-${status}`}>{body}</span>;
};

/** The five fixed parts of a result, in order (UNDERGROUND_RESEARCH §4). */
const FindingDetail: React.FC<{ f: ScreeningFinding }> = ({ f }) => {
  const sec = 'text-[11px] font-semibold uppercase tracking-wide text-text-3 mt-1.5';
  return (
    <div className="text-meta text-text-2 space-y-0.5" data-testid="ug-finding-detail">
      <div className={sec}>Checked</div><p>{f.checked}</p>
      <div className={sec}>Data used</div>
      <ul className="list-disc pl-4">{f.data_used.map(d => <li key={d.dataset_id}>{d.dataset} · {d.quality_level}{d.datum ? ` · datum ${d.datum}` : ''}</li>)}</ul>
      <div className={sec}>Found</div>
      <ul className="list-disc pl-4">{f.found.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {f.buildings && f.buildings.length > 0 && (
        <p>Nearest: {f.buildings.slice(0, 5).map(b => `${b.name || 'building'} (${b.distance_m?.toFixed(1) ?? '?'} m)`).join(', ')}{f.buildings.length > 5 ? ` and ${f.buildings.length - 5} more` : ''}.</p>
      )}
      <div className={sec}>Not checked</div>
      <ul className="list-disc pl-4" data-testid="ug-finding-not-checked">{f.not_checked.map((x, i) => <li key={i}>{x}</li>)}</ul>
      <div className={sec}>Next investigation</div>
      <ol className="list-decimal pl-4" data-testid="ug-finding-next">{f.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
      {f.rules.length > 0 && (
        <Disclosure summary="Rules applied">
          <ul className="space-y-0.5">{f.rules.map((r, i) => (
            <li key={`${r.id}-${i}`}>{r.id}: {r.value_m.toFixed(2)} m {DIM_LABEL[r.dim] ?? r.dim} · {RULE_TYPE_LABEL[r.type] ?? r.type} · {r.source} {r.clause !== '—' ? r.clause : ''}</li>
          ))}</ul>
        </Disclosure>
      )}
      {f.verification && (
        <p className={f.verification.stale ? 'text-warn' : ''}>Field verification by {f.verification.verified_by} ({f.verification.method.replace(/_/g, ' ')}){f.verification.stale ? ' — an asset changed since; re-verify' : ''}.</p>
      )}
      {(f.category === 'clearance' || f.category === 'metro') && f.status !== 'verified' && <VerifyForm f={f} />}
    </div>
  );
};

/** Verified is only ever set by a person recording QL-A field evidence for this pair. */
const VerifyForm: React.FC<{ f: ScreeningFinding }> = ({ f }) => {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<'trial_pit' | 'vacuum_excavation' | 'survey_of_exposed_asset'>('trial_pit');
  const [evidence, setEvidence] = useState('');
  const [who, setWho] = useState(() => localStorage.getItem(USER_KEY) ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  if (!open) return <button type="button" className="uos-btn uos-btn-sm mt-1" onClick={() => setOpen(true)} data-testid="ug-verify-open">Record field verification…</button>;
  const save = async () => {
    setState('saving');
    try {
      localStorage.setItem(USER_KEY, who.trim());
      await coordinationApi.recordVerification({ pair_key: f.pair_key, fingerprint: f.fingerprint, method, evidence: evidence.trim(), verified_by: who.trim() });
      setState('saved');
    } catch (e) { setState((e as Error).message); }
  };
  return (
    <div className="uos-card mt-1 flex flex-col gap-1.5" data-testid="ug-verify-form">
      <p className="text-[11px]" style={note}>Only for evidence seen in the field (trial pit, vacuum excavation or a survey of the exposed asset). The result shows Verified on the next check, until either asset changes.</p>
      <div className={field}><label className={lbl} style={labelStyle} htmlFor={`v-m-${f.id}`}>Method</label>
        <select id={`v-m-${f.id}`} className={input} style={inputStyle} value={method} onChange={e => setMethod(e.target.value as typeof method)}>
          <option value="trial_pit">Trial pit</option><option value="vacuum_excavation">Vacuum excavation</option><option value="survey_of_exposed_asset">Survey of exposed asset</option>
        </select></div>
      <div className={field}><label className={lbl} style={labelStyle} htmlFor={`v-e-${f.id}`}>Evidence (what was seen, record reference)</label>
        <input id={`v-e-${f.id}`} className={input} style={inputStyle} value={evidence} onChange={e => setEvidence(e.target.value)} /></div>
      <div className={field}><label className={lbl} style={labelStyle} htmlFor={`v-w-${f.id}`}>Your name</label>
        <input id={`v-w-${f.id}`} className={input} style={inputStyle} value={who} onChange={e => setWho(e.target.value)} /></div>
      <button type="button" className="uos-btn uos-btn-sm self-start" disabled={state === 'saving' || evidence.trim().length < 3 || !who.trim()} onClick={() => void save()}>Save verification</button>
      {state === 'saved' && <p className="text-meta text-text-2" role="status">Saved. Run the check again to see it.</p>}
      {state !== 'idle' && state !== 'saving' && state !== 'saved' && <p className="text-meta text-fail" role="alert">{state}</p>}
    </div>
  );
};

const FindingRow: React.FC<{ f: ScreeningFinding; run: ScreeningRun; selected: boolean; onSelect: (f: ScreeningFinding | null) => void }> = ({ f, run, selected, onSelect }) => {
  const nums = keyNumbers(f);
  return (
    <li className="uos-card text-meta" data-testid="ug-finding" data-status={f.status} data-category={f.category}>
      <button type="button" className="w-full text-left flex items-start gap-2" aria-expanded={selected} onClick={() => onSelect(selected ? null : f)} data-testid="ug-finding-open">
        {selected ? <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden /> : <ChevronRight size={14} className="mt-0.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-text-1 break-words">{f.title}</span>
          <span className="block text-text-2">
            <span className="text-text-3">{CATEGORY_LABEL[f.category]}</span>{nums.length ? ` · ${nums.join(' · ')}` : ''}
            {f.protection_zone ? ' · Maha-Metro NOC' : ''}
          </span>
        </span>
        <span title="Show on map" className="shrink-0 text-text-3"><MapPin size={14} aria-hidden /></span>
      </button>
      {selected && (
        <div className="mt-1.5 pl-5">
          <p className="text-[11px] mb-1" style={note}>
            On the map: <span style={{ color: '#e879f9' }}>■</span> proposed · <span style={{ color: '#fbbf24' }}>■</span> {f.other ? 'other asset' : f.buildings?.length ? 'buildings' : '—'}
            {run.geometries[f.proposed.id] ? '' : ' (no geometry)'}
          </p>
          <FindingDetail f={f} />
        </div>
      )}
    </li>
  );
};

/** One reason why findings can't be judged (a dataset, a network, a missing input); the findings behind it on expand. */
const GapGroupRow: React.FC<{ g: GapGroup; run: ScreeningRun; selectedId: string | null; onSelect: (f: ScreeningFinding | null) => void }> = ({ g, run, selectedId, onSelect }) => {
  const [open, setOpen] = useState(() => g.findings.some(f => f.id === selectedId));
  const [shown, setShown] = useState(PAGE);
  return (
    <li className="uos-card text-meta" data-testid="ug-gap-group" data-key={g.key}>
      <button type="button" className="w-full text-left flex items-start gap-2" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="ug-gap-group-open">
        {open ? <ChevronDown size={14} className="mt-0.5 shrink-0" aria-hidden /> : <ChevronRight size={14} className="mt-0.5 shrink-0" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-text-1 break-words">{g.label}</span>
          <span className="block text-text-2" data-testid="ug-gap-group-count">{gapCountText(g)}</span>
        </span>
      </button>
      {open && (
        <div className="mt-1.5 pl-3">
          <ul className="space-y-1">{g.findings.slice(0, shown).map(f => <FindingRow key={f.id} f={f} run={run} selected={selectedId === f.id} onSelect={onSelect} />)}</ul>
          {g.findings.length > shown && <button type="button" className="uos-btn uos-btn-sm mt-1" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, g.findings.length - shown)} more of {g.findings.length - shown}</button>}
        </div>
      )}
    </li>
  );
};

const Group: React.FC<{ status: ScreeningStatus; findings: ScreeningFinding[]; run: ScreeningRun; selectedId: string | null; onSelect: (f: ScreeningFinding | null) => void }> = ({ status, findings, run, selectedId, onSelect }) => {
  const gaps = useMemo(() => (status === 'insufficient_data' ? groupGaps(findings) : null), [status, findings]);
  const [open, setOpen] = useState(status !== 'insufficient_data' || (gaps?.length ?? 0) <= 8);
  const [shown, setShown] = useState(PAGE);
  return (
    <section data-testid={`ug-group-${status}`}>
      <button type="button" className="flex items-center gap-1.5 w-full text-left py-1" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <StatusBadge status={status} count={findings.length} />
        <span className="text-meta text-text-3 min-w-0 truncate">{STATUS_TEXT[status].hint}</span>
      </button>
      {open && gaps && (
        <>
          <p className="text-[11px] mb-1" style={note}>Grouped by what is missing. Open a line to see each place.</p>
          <ul className="space-y-1" data-testid="ug-gap-groups">{gaps.map(g => <GapGroupRow key={g.key} g={g} run={run} selectedId={selectedId} onSelect={onSelect} />)}</ul>
        </>
      )}
      {open && !gaps && (
        <>
          <ul className="space-y-1">{findings.slice(0, shown).map(f => <FindingRow key={f.id} f={f} run={run} selected={selectedId === f.id} onSelect={onSelect} />)}</ul>
          {findings.length > shown && <button type="button" className="uos-btn uos-btn-sm mt-1" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, findings.length - shown)} more of {findings.length - shown}</button>}
        </>
      )}
    </section>
  );
};

/**
 * Underground conflict check (docs/urbanos/UNDERGROUND_CHECKS.md): screens every proposed underground object of the active
 * alternative (alignments and utilities drawn in Design) against existing records, metro, buildings, groundwater and each
 * other, via POST /api/coordination/underground/screen (read-only). `a` = the alignment open in the panel: its findings are
 * listed first. Clicking a finding flies to it and highlights both assets.
 */
export const ConflictCheck: React.FC<{ a?: UndergroundAlignmentObject | null }> = ({ a }) => {
  const objects = useEngineObjects(isScreened);
  const sid = engineInstance.scenarios.getActiveScenarioId();
  const visible = useMemo(() => filterObjectsForScenario(objects, sid), [objects, sid]);
  const entry = useScreeningStore(s => s.runs[sid]);
  const setRun = useScreeningStore(s => s.setRun);
  const selectedId = useScreeningStore(s => s.selectedFindingId);
  const select = useScreeningStore(s => s.select);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);        // null = all objects
  const [statusFilter, setStatusFilter] = useState<ScreeningStatus | null>(null);

  useEffect(() => () => clearConflictHighlight(), []);
  // Reopening: no result in this session for the alternative → show its last saved run, marked stale if objects changed since.
  const [restoring, setRestoring] = useState(false);
  const hasEntry = !!entry;
  useEffect(() => {
    if (hasEntry) return;
    let live = true;
    setRestoring(true);
    const objs = visible.map(o => engineInstance.objects.schemaOf(o) as ScreeningObject);
    coordinationApi.latestScreening({ scenario_id: sid, objects: objs })
      .then(r => {
        if (!live || !r.run) return;
        const cur = useScreeningStore.getState().runs[sid];
        if (cur) return;                                            // a check finished meanwhile
        setRun(sid, r.run, { restored: true, stale: !!r.stale, staleReasons: r.stale_reasons ?? [], comparedAt: new Date().toISOString() }, r.run.saved_at ?? r.run.generated_at);
      })
      .catch(() => { /* no saved run reachable: the panel simply starts empty */ })
      .finally(() => { if (live) setRestoring(false); });
    return () => { live = false; };
    // visible is read once per alternative: staleness after that is tracked by isStale on edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, hasEntry]);
  const run = entry?.run ?? null;
  const proposedCount = visible.filter(o => screenedAsProposed(o as { type: string; scenarioId?: string; status?: string; lifecycle?: string }, sid)).length;

  const screeningBody = (): ScreeningObject[] => visible.map(o => engineInstance.objects.schemaOf(o) as ScreeningObject);

  const check = async () => {
    setBusy(true); setErr(null);
    clearConflictHighlight();
    try {
      const body = screeningBody();
      const r = await coordinationApi.screenUnderground({ scenario_id: sid, objects: body });
      setRun(sid, r);
      setScope(a && r.summary.proposed_checked.some(p => p.id === a.id) ? a.id : null);
      setStatusFilter(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };

  const onSelect = (f: ScreeningFinding | null) => {
    select(f?.id ?? null);
    if (!f || !run) { clearConflictHighlight(); return; }
    const t = highlightTargets(f, run.geometries);
    showConflictHighlight(f.id, t.proposed, t.other, t.bounds);
  };

  const scoped = run ? forObject(run.findings, scope) : [];
  const counts = countsByStatus(scoped);
  const filtered = statusFilter ? scoped.filter(f => f.status === statusFilter) : scoped;
  const groups = groupBySeverity(filtered, a?.id);
  const origin = entry?.origin;
  const stale = entry ? (origin?.stale ?? false) || isStale(origin?.comparedAt ?? entry.at, visible) : false;
  const objChecklist = run?.summary.proposed_checked.find(p => p.id === scope);

  return (
    <div className="flex flex-col gap-2" data-testid="ug-conflict-check">
      <div role="note" className="flex items-start gap-1.5 rounded px-2 py-1.5 text-meta font-semibold" style={{ border: '1px solid var(--warn, #f59e0b)', color: 'var(--warn, #f59e0b)' }} data-testid="ug-screening-banner">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden /> {run?.banner ?? SCREENING_BANNER}
      </div>
      <p className="text-[11px]" style={note}>
        Checks every proposed tunnel, metro, trunk, drain and utility in this alternative against PMC sewer and storm-drain records, OpenStreetMap metro,
        objects drawn in Design, building footprints, nallas, groundwater wells and boreholes, using Indian clearance rules (stricter rule wins).
      </p>
      <button type="button" className="uos-btn self-start" onClick={() => void check()} disabled={busy || proposedCount === 0} data-testid="ug-check-conflicts">
        <ShieldQuestion size={14} aria-hidden /> {busy ? 'Checking…' : restoring && !run ? 'Loading last check…' : run ? 'Check again' : `Check ${proposedCount} proposed object${proposedCount === 1 ? '' : 's'}`}
      </button>
      {proposedCount === 0 && <p className="text-meta text-text-2">Nothing to check: draw a proposed underground alignment or utility (objects marked existing or abandoned are what proposals are checked against).</p>}
      {err && <p className="text-label text-fail" role="alert">The check could not run: {err}</p>}
      {run && (
        <div className="flex flex-col gap-2" data-testid="ug-conflict-results">
          {origin?.restored && (
            <p className="text-meta text-text-2" data-testid="ug-check-restored">
              Last saved check, {new Date(entry!.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.
            </p>
          )}
          {stale && (
            <div className="text-meta text-warn" role="status" data-testid="ug-check-stale">
              <span className="font-semibold">Stale</span> — {origin?.staleReasons.length ? origin.staleReasons.join(' ') : 'Objects were edited after this check.'} Check again for current results.
            </div>
          )}
          <p className="text-label text-text-1" data-testid="ug-check-summary">{plainSummary(run)}</p>
          {run.summary.proposed_checked.length > 1 && (
            <div className={field}>
              <label className={lbl} style={labelStyle} htmlFor="ug-cc-scope">Show findings for</label>
              <select id="ug-cc-scope" className={input} style={inputStyle} value={scope ?? ''} onChange={e => { setScope(e.target.value || null); onSelect(null); }} data-testid="ug-cc-scope">
                <option value="">All {run.summary.proposed_checked.length} proposed objects</option>
                {run.summary.proposed_checked.map(p => <option key={p.id} value={p.id}>{p.name} ({p.kind_label})</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-1" data-testid="ug-status-summary">
            {(Object.keys(STATUS_TEXT) as ScreeningStatus[]).filter(s => counts[s] > 0).map(s => (
              <StatusBadge key={s} status={s} count={counts[s]} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? null : s)} />
            ))}
          </div>
          <div className="flex flex-col gap-2 max-h-[28rem] overflow-auto pr-1" data-testid="ug-findings">
            {groups.map(g => <Group key={`${scope}-${statusFilter}-${g.status}`} status={g.status} findings={g.findings} run={run} selectedId={selectedId} onSelect={onSelect} />)}
          </div>
          {objChecklist && (
            <Disclosure summary={`What was checked for ${objChecklist.name}`} open data-testid="ug-checklist">
              <ul className="text-meta text-text-2 space-y-0.5">{objChecklist.checklist.map(c => (
                <li key={c.check}><span className="text-text-1">{c.check}</span>: <span className={c.result === 'flagged' ? 'text-warn' : ''}>{c.result}</span>{c.detail && c.result !== 'flagged' ? ` — ${c.detail}` : ''}</li>
              ))}</ul>
            </Disclosure>
          )}
          <section className="uos-card" data-testid="ug-not-checked">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">What wasn&rsquo;t checked</div>
            <ul className="list-disc pl-4 text-meta text-text-2">{run.summary.not_checked.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </section>
          <Disclosure summary="Data used" data-testid="ug-layers">
            <ul className="text-meta text-text-2 space-y-0.5">{run.layers.map(l => (
              <li key={l.id}>{l.used ? '' : 'Not available: '}{l.name}{l.records !== undefined ? ` · ${l.records.toLocaleString('en-IN')} records` : ''}{l.quality_level ? ` · ${l.quality_level}` : ''}{l.datum ? ` · datum ${l.datum}` : ''}{l.coverage ? ` · ${l.coverage}` : ''}</li>
            ))}</ul>
          </Disclosure>
          <Disclosure summary="Clearance rules (by asset pair)" data-testid="ug-rules">
            <table className="uos-table text-meta"><thead><tr><th>Pair</th><th>Rule</th><th className="num">Value</th><th>Direction</th><th>Type</th><th>Source</th></tr></thead>
              <tbody>{run.rules_table.flatMap(t => t.rows.map((r, i) => (
                <tr key={`${t.pair}-${r.id}-${i}`}><td>{i === 0 ? t.pair : ''}</td><td>{r.id}</td><td className="num">{r.value_m.toFixed(2)} m</td><td>{DIM_LABEL[r.dim] ?? r.dim}</td>
                  <td>{RULE_TYPE_LABEL[r.type] ?? r.type}{r.compare_only ? ' (comparison only)' : ''}</td><td>{r.source} {r.clause !== '—' ? r.clause : ''}</td></tr>
              )))}</tbody></table>
            <p className="text-[11px] mt-1" style={note}>Where two sources differ the stricter value is used and both are cited. Thresholds are widened by each record&rsquo;s positional uncertainty (ASCE 38 quality level). {run.disclaimer}</p>
          </Disclosure>
          <ReportExport sid={sid} objects={screeningBody} stale={stale} />
          {a && <ProjectRegistration a={a} />}
        </div>
      )}
    </div>
  );
};

/** Screening report: the backend re-runs the check on the objects as they are now and returns PDF or CSV. */
const ReportExport: React.FC<{ sid: string; objects: () => ScreeningObject[]; stale: boolean }> = ({ sid, objects, stale }) => {
  const [busy, setBusy] = useState<null | 'pdf' | 'csv'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const get = async (format: 'pdf' | 'csv') => {
    setBusy(format); setMsg(null);
    try {
      const { blob, filename, findings } = await coordinationApi.screeningReport({ scenario_id: sid, objects: objects() }, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMsg(`Downloaded ${filename} (${findings.toLocaleString('en-IN')} findings).`);
    } catch (e) { setMsg(`The report could not be made: ${(e as Error).message}`); } finally { setBusy(null); }
  };
  return (
    <section className="uos-card flex flex-col gap-1.5" data-testid="ug-report">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Screening report</div>
      <p className="text-[11px]" style={note}>
        For sharing with utility owners and engineers: summary, every finding in its five parts, rules and sources, what wasn&rsquo;t checked and the
        next-investigation plan. The check is run again on the objects as they are now{stale ? ' (they changed since the result above)' : ''}.
      </p>
      <div className="flex gap-1.5">
        <button type="button" className="uos-btn uos-btn-sm" disabled={busy !== null} onClick={() => void get('pdf')} data-testid="ug-report-pdf">
          <FileDown size={14} aria-hidden /> {busy === 'pdf' ? 'Preparing PDF…' : 'PDF report'}
        </button>
        <button type="button" className="uos-btn uos-btn-sm" disabled={busy !== null} onClick={() => void get('csv')} data-testid="ug-report-csv">
          <FileDown size={14} aria-hidden /> {busy === 'csv' ? 'Preparing CSV…' : 'Findings CSV'}
        </button>
      </div>
      {msg && <p className="text-meta text-text-2" role="status" data-testid="ug-report-status">{msg}</p>}
    </section>
  );
};

/**
 * Optional: register the open alignment as a proposal element of a planning project, so other projects' conflict checks
 * and Projects → Conflicts see it (POST …/projects/{pid}/elements, then …/detect). Same behaviour as before the screening.
 */
const ProjectRegistration: React.FC<{ a: UndergroundAlignmentObject }> = ({ a }) => {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [pid, setPid] = useState('');
  const [user, setUser] = useState(() => localStorage.getItem(USER_KEY) ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setCheck = useUndergroundStore(s => s.setCheck);
  const load = () => { if (!projects) planningApi.projects().then(ps => { setProjects(ps); setPid(p => p || ps[0]?.id || ''); }).catch(e => setMsg((e as Error).message)); };
  const share = async () => {
    setBusy(true); setMsg(null);
    try {
      localStorage.setItem(USER_KEY, user.trim());
      const payload = alignmentElementPayload(a);
      const { scenario_id: _sid, element_ref: _ref, ...patch } = payload;
      void _sid; void _ref;
      const marker = `alignment ${a.id} `;
      const existing = (await coordinationApi.listElements(pid)).find(e => e.provenance.includes(marker)
        || (e.element_ref === a.id && (e.scenario_id ?? null) === payload.scenario_id));
      const element = existing
        ? await coordinationApi.patchElement(existing.id, { ...patch, edited_by: user.trim(),
          clear_fields: [...(payload.width_m === null ? ['width_m' as const] : []), ...(payload.z_min_m === null ? ['z_min_m' as const] : []), ...(payload.z_max_m === null ? ['z_max_m' as const] : [])] })
        : await coordinationApi.createElement(pid, { ...payload, created_by: user.trim() });
      const result = await coordinationApi.detect(pid, user.trim());
      setCheck(a.id, { projectId: pid, element, run: result, at: new Date().toISOString() });
      setMsg(`Shared with the project. Its coordination run has ${result.conflicts?.length ?? 0} findings — see Projects → Conflicts.`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <details className="uos-disclosure" onToggle={e => { if ((e.target as HTMLDetailsElement).open) load(); }} data-testid="ug-share-project">
      <summary className="uos-disclosure-summary"><FolderKanban size={14} aria-hidden /> Share {a.name} with a planning project</summary>
      <div className="uos-disclosure-body flex flex-col gap-1.5">
        {projects && projects.length === 0 && <p className="text-meta text-text-2">No planning project yet — create one in Projects.</p>}
        {projects && projects.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className={field}><label className={lbl} style={labelStyle} htmlFor="ug-cc-project">Planning project</label>
              <select id="ug-cc-project" data-testid="ug-cc-project" className={input} style={inputStyle} value={pid} onChange={e => setPid(e.target.value)}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className={field}><label className={lbl} style={labelStyle} htmlFor="ug-cc-user">Your name</label>
              <input id="ug-cc-user" data-testid="ug-cc-user" className={input} style={inputStyle} value={user} onChange={e => setUser(e.target.value)} /></div>
          </div>
        )}
        <button type="button" className="uos-btn uos-btn-sm self-start" disabled={busy || !pid || !user.trim()} onClick={() => void share()}>{busy ? 'Sharing…' : 'Share and run project coordination'}</button>
        {msg && <p className="text-meta text-text-2" role="status">{msg}</p>}
      </div>
    </details>
  );
};
