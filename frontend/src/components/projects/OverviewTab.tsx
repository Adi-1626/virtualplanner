import React, { useEffect, useState } from 'react';
import { FileDown, Link2, Loader2, Pencil, Trash2 } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { Section, Button, Notice, Facts, Segmented } from '../ui/kit';
import { MetricTile } from '../ui/MetricTile';
import { Disclosure } from '../ui/Disclosure';
import { CertaintyBadge, TrustBadge } from '../ui/badges';
import { planningApi, LINK_TYPE_LABEL, STATUS_LABEL, type Linkable, type LinkType, type Project, type ProjectStatus } from '../../engine/planning/planningApi';
import { cardSummary, openActionableCount, startSteps } from '../../lib/planningProjects';
import { StaleBadge } from './common';
import { StepList } from './GetStarted';
import { inputCls, labelCls, when, type Act, type ProjectBundle } from './projectData';
import { projectStudyAreaOptions } from './studyAreaOptions';

export const OverviewTab: React.FC<{ b: ProjectBundle; who: string; act: Act; reload: () => void; goTab: (t: string) => void; onDeleted: () => void }> = ({ b, who, act, reload, goTab, onDeleted }) => {
  const p = b.project;
  const sum = cardSummary({ links: p.links, elements: b.elements.length, issues: b.issues, stale: b.stale });
  const unknownDepth = b.elements.filter(e => e.z_min_m == null || e.z_max_m == null).length;
  const lastCoord = b.stale?.coordination_runs[0] ?? null;
  const trafficRuns = b.stale?.runs.length ?? 0;
  const preferred = (p.links ?? []).find(l => l.entity_type === 'scenario' && l.entity_id === p.preferred_scenario_id);
  const [editing, setEditing] = useState(false);
  const steps = startSteps({ user: who, project: {
    alternatives: sum.alternatives, elements: b.elements.length, checked: !!lastCoord || b.issues.length > 0,
    exported: b.events.some(e => e.action === 'export' && e.entity_type === 'project_report'),
  } });
  const stepTab: Partial<Record<string, string>> = { attach: 'alternatives', elements: 'alternatives', check: 'conflicts' };
  return (
    <>
      {editing ? <EditDetails b={b} who={who} act={act} onDone={() => setEditing(false)} /> : (
        <div className="flex items-start gap-2">
          {p.description ? <p className="flex-1 text-sm text-slate-200 whitespace-pre-wrap" data-testid="project-purpose">{p.description}</p>
            : <p className="flex-1 text-sm text-slate-500">No purpose recorded.</p>}
          <Button size="sm" variant="ghost" icon={Pencil} disabled={!who} onClick={() => setEditing(true)} data-testid="edit-project" title={who ? 'Edit name, purpose and study area' : 'Enter your name first'}>Edit</Button>
        </div>
      )}
      {steps.some(s => !s.done) && (
        <section className="rounded-xl border border-cyan-400/25 bg-cyan-500/[0.05] px-3 py-2 space-y-1.5" data-testid="next-steps">
          <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Next steps</div>
          <StepList steps={steps.filter(s => s.id !== 'create')} onStep={id => {
            if (id === 'export') { document.querySelector<HTMLElement>('[data-testid=export-pdf]')?.focus(); return; }
            const t = stepTab[id]; if (t) goTab(t);
          }} />
        </section>
      )}
      <div className="grid grid-cols-2 gap-2" data-testid="project-metrics">
        <button type="button" className="text-left" onClick={() => goTab('alternatives')} title="Open Alternatives">
          <MetricTile label="Alternatives" value={sum.alternatives} hint={preferred ? `★ ${preferred.label}` : 'None preferred'} />
        </button>
        <button type="button" className="text-left" onClick={() => goTab('alternatives')} title="Open Alternatives">
          <MetricTile label="Proposal elements" value={sum.elements}
            badge={unknownDepth ? <CertaintyBadge certainty="unknown" note={`${unknownDepth} element(s) with depth or height UNKNOWN`} /> : null}
            hint={unknownDepth ? `${unknownDepth} with depth unknown` : undefined} />
        </button>
        <button type="button" className="text-left" onClick={() => goTab('conflicts')} title="Open Conflicts">
          <MetricTile label="Open conflicts" value={lastCoord || b.issues.length ? openActionableCount(b.issues) : null}
            badge={lastCoord ? <StaleBadge verdict={lastCoord} /> : null}
            hint={lastCoord ? `Detection ${when(lastCoord.created_at)}` : b.issues.length ? 'Raised by other projects; not run here' : 'Detection not run'} data-testid="metric-open-conflicts" />
        </button>
        <button type="button" className="text-left" onClick={() => goTab('assessments')} title="Open Assessments">
          <MetricTile label="Stale assessments" value={b.stale ? sum.staleAssessments : null}
            hint={sum.unknownStale ? `${sum.unknownStale} cannot be checked` : undefined}
            badge={trafficRuns ? <TrustBadge trust="fails_validation" testId="overview-traffic-trust" /> : null} />
        </button>
      </div>
      <Facts rows={[
        ['Created', `${p.created_by}, ${when(p.created_at)}`],
        ['Study area', p.area ? p.area.name : p.bbox ? 'bounding box' : 'not set'],
        ['Baseline', <span key="b" title={p.baseline_fingerprint}>{p.baseline_changed_since_created ? <span className="text-amber-300">changed since project created</span> : 'unchanged since project created'}</span>],
      ]} />
      <Section title="Status">
        {p.status === 'decision_recorded' ? <Notice tone="info">A decision is recorded (in this tool). Status can be moved back for further study.</Notice> : null}
        <fieldset disabled={!who} className={who ? '' : 'opacity-60'} data-testid="status-control">
          <Segmented label="Project status" value={p.status === 'decision_recorded' ? ('' as ProjectStatus) : p.status}
            options={(['draft', 'under_study', 'under_review'] as const).map(s => ({ value: s, label: STATUS_LABEL[s] }))}
            onChange={s => { if (who && s !== p.status) void act(() => planningApi.setStatus(p.id, s as Exclude<ProjectStatus, 'decision_recorded'>, who)); }} />
        </fieldset>
        <p className="text-xs text-slate-500">{who ? 'A working label for the team. “Decision recorded” is set only by recording a decision (Reviews & decisions); none of these is an approval.' : 'Enter your name on the project list to change the status.'}</p>
      </Section>
      <Section title="Report">
        <div className="flex gap-2">
          <a data-testid="export-pdf" className={EXPORT_CLS} href={planningApi.reportUrl(p.id, 'pdf', who)} onClick={() => setTimeout(reload, 1500)}><FileDown size={14} aria-hidden />PDF</a>
          <a data-testid="export-docx" className={EXPORT_CLS} href={planningApi.reportUrl(p.id, 'docx', who)} onClick={() => setTimeout(reload, 1500)}><FileDown size={14} aria-hidden />DOCX</a>
        </div>
        {!who && <p className="text-xs text-slate-500">Exports are recorded in Activity as “unattributed” until you enter your name.</p>}
        <Disclosure summary="What the report contains">
          <p className="text-xs text-slate-400">Summary, baseline, datasets with provenance labels, scenarios, versions and run inputs, comparison from run records, feasibility findings with certainty labels, documents, reviews, decision, assumptions and unknowns, audit summary. Every export is recorded in Activity.</p>
        </Disclosure>
      </Section>
      <Attachments p={p} linkable={b.linkable} who={who} act={act} />
      <DeleteProject b={b} who={who} onDeleted={onDeleted} />
    </>
  );
};

const EXPORT_CLS = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold bg-white/[0.07] text-slate-100 hover:bg-white/[0.12] border border-white/10';

/** Name, purpose and study area (PATCH; audited as a project update). */
const EditDetails: React.FC<{ b: ProjectBundle; who: string; act: Act; onDone: () => void }> = ({ b, who, act, onDone }) => {
  const p = b.project;
  const [name, setName] = useState(p.name);
  const [desc, setDesc] = useState(p.description ?? '');
  const [areaId, setAreaId] = useState(p.area_id ?? '');
  const [areas, setAreas] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiGet<{ id: string; name: string }[]>('/api/areas').then(a => setAreas(projectStudyAreaOptions(a))).catch(() => setAreas([])); }, []);
  const changed = name.trim() !== p.name || desc.trim() !== (p.description ?? '').trim() || areaId !== (p.area_id ?? '');
  const save = async () => {
    setBusy(true);
    const body: { name?: string; description?: string; area_id?: string } = {};
    if (name.trim() !== p.name) body.name = name.trim();
    if (desc.trim() !== (p.description ?? '').trim()) body.description = desc.trim();
    if (areaId !== (p.area_id ?? '')) body.area_id = areaId;
    await act(async () => { await planningApi.update(p.id, body, who); onDone(); });
    setBusy(false);
  };
  return (
    <Section title="Project details">
      <div><label className={labelCls} htmlFor="pe-name">Name</label><input id="pe-name" data-testid="edit-name" className={inputCls} value={name} maxLength={200} onChange={e => setName(e.target.value)} /></div>
      <div><label className={labelCls} htmlFor="pe-desc">Purpose — the planning question it answers</label><textarea id="pe-desc" data-testid="edit-desc" rows={3} className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} /></div>
      <div>
        <label className={labelCls} htmlFor="pe-area">Study area</label>
        <select id="pe-area" data-testid="edit-area" className={inputCls} value={areaId} onChange={e => setAreaId(e.target.value)}>
          <option value="">— none —</option>
          {(areas ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          {p.area_id && areas && !areas.some(a => a.id === p.area_id) && <option value={p.area_id}>{p.area?.name ?? 'current study area'}</option>}
        </select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" icon={busy ? Loader2 : undefined} spin={busy} disabled={busy || !changed || !name.trim()} onClick={() => void save()} data-testid="save-project">Save</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <p className="text-xs text-slate-500">Recorded in Activity. Alternatives, elements and findings are not changed.</p>
    </Section>
  );
};

/** Delete with the name typed again. A project with a recorded decision is kept (decisions are append-only). */
const DeleteProject: React.FC<{ b: ProjectBundle; who: string; onDeleted: () => void }> = ({ b, who, onDeleted }) => {
  const p = b.project;
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const decided = (p.decisions ?? []).length > 0;
  const runs = b.stale?.coordination_runs.length ?? 0;
  const del = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await planningApi.remove(p.id, who, typed);
      (window as any).showToast?.(`Project “${p.name}” deleted (${r.elements} element${r.elements === 1 ? '' : 's'}, ${r.runs} conflict check${r.runs === 1 ? '' : 's'} archived).`, 'success');
      onDeleted();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Section title="Delete project">
      {decided ? <p className="text-xs text-slate-400" data-testid="delete-blocked">This project has a recorded decision. Decisions are append-only, so the project is kept.</p> : !open ? (
        <Button size="sm" variant="ghost" icon={Trash2} className="text-rose-300 hover:text-rose-200" disabled={!who} onClick={() => setOpen(true)} data-testid="delete-project">Delete this project…</Button>
      ) : (
        <div className="space-y-1.5 rounded-lg border border-rose-400/30 bg-rose-500/[0.06] px-2.5 py-2" data-testid="delete-confirm">
          <p className="text-xs text-slate-200">Deletes the project, its {b.elements.length} proposal element{b.elements.length === 1 ? '' : 's'} and its attachments. The alternatives, runs, datasets and screenings it links to are kept.{' '}
            {runs ? `Its ${runs} conflict check${runs === 1 ? ' and its findings are' : 's and their findings are'} archived with it` : 'Its findings are archived with it'}, and so are other projects’ findings against it: kept as an archived record on the server (the deletion is noted in the other projects’ Activity), no longer in active lists or reports. A deleted project cannot be opened again in the app.</p>
          <label className={labelCls} htmlFor="pd-name">Type the project name to confirm: <b className="text-slate-200">{p.name}</b></label>
          <input id="pd-name" className={inputCls} value={typed} onChange={e => setTyped(e.target.value)} data-testid="delete-name" autoComplete="off" />
          {err && <Notice tone="bad">{err}</Notice>}
          <div className="flex gap-2">
            <Button size="sm" icon={busy ? Loader2 : Trash2} spin={busy} className="!bg-rose-500/80 !text-white hover:!bg-rose-500" disabled={busy || typed.trim() !== p.name.trim()} onClick={() => void del()} data-testid="delete-confirm-button">Delete project</Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setTyped(''); setErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </Section>
  );
};

/** All linked records (any type) — the original attach control, kept so every link type stays reachable. */
const Attachments: React.FC<{ p: Project; linkable: Linkable | null; who: string; act: Act }> = ({ p, linkable, who, act }) => {
  const [type, setType] = useState<LinkType>('scenario');
  const [eid, setEid] = useState('');
  const linked = new Set((p.links ?? []).map(l => `${l.entity_type}:${l.entity_id}`));
  const options = (linkable?.[type] ?? []).filter(o => !linked.has(`${type}:${o.id}`));
  return (
    <Section title="Linked records" aside={`${p.links?.length ?? 0}`}>
      <ul className="space-y-1" data-testid="project-links">
        {(p.links ?? []).map(l => (
          <li key={l.id} className="flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/5 px-2.5 py-1.5 text-sm">
            <span className="text-[10px] uppercase tracking-wide text-slate-400 w-24 shrink-0">{LINK_TYPE_LABEL[l.entity_type]}</span>
            <span className={`flex-1 min-w-0 truncate ${l.exists ? 'text-slate-100' : 'text-rose-300'}`} title={l.entity_id}>{l.label}</span>
            <button aria-label="Detach" title="Detach (the record itself is kept)" disabled={!who} onClick={() => act(() => planningApi.unlink(p.id, l.id, who))}
              className="p-1 rounded text-slate-400 hover:text-rose-300 cursor-pointer disabled:opacity-40"><Trash2 size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[8.5rem_1fr] gap-2">
        <select aria-label="Record type" data-testid="link-type" className={inputCls} value={type} onChange={e => { setType(e.target.value as LinkType); setEid(''); }}>
          {(Object.keys(LINK_TYPE_LABEL) as LinkType[]).map(t => <option key={t} value={t}>{LINK_TYPE_LABEL[t]}</option>)}
        </select>
        <select aria-label="Record" data-testid="link-record" className={inputCls} value={eid} onChange={e => setEid(e.target.value)}>
          <option value="">{options.length ? '— choose —' : '— none available —'}</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}{o.kind && type === 'dataset' ? ` [${o.kind}${o.synthetic ? ', synthetic' : ''}]` : ''}</option>)}
        </select>
      </div>
      <Button size="sm" icon={Link2} data-testid="attach" disabled={!eid || !who} onClick={() => act(async () => { await planningApi.link(p.id, type, eid, who); setEid(''); })}>Attach</Button>
      <p className="text-xs text-slate-500">Attaching references the existing record; nothing is copied.</p>
    </Section>
  );
};
