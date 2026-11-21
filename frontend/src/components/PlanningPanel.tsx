import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { SidePanel, PanelHeader, PanelBody, Section, Button, Notice } from './ui/kit';
import { apiGet } from '../lib/api';
import { planningApi, STATUS_LABEL, type Project } from '../engine/planning/planningApi';
import { coordinationApi, type ProjectSummary } from '../lib/coordinationApi';
import { filterProjects, showGetStarted, type ProjectSort } from '../lib/planningProjects';
import { inputCls, labelCls } from './projects/projectData';
import { ProjectList } from './projects/ProjectList';
import { ProjectPage } from './projects/ProjectPage';
import { GetStarted } from './projects/GetStarted';
import { useShellStore } from '../shell/useShellStore';

/**
 * Planning & Approval Workspace (docs/PLANNING_WORKSPACE.md) redesigned as the Projects & Coordination workspace
 * (docs/urbanos/PROJECTS_AND_COORDINATION_UI.md, PROJECTS_WORKSPACE.md): project cards → a project page with tabs
 * (components/projects/*): Overview, Alternatives (+ proposal elements), Assessments (stale indicators), Datasets,
 * Conflicts (cross-project coordination), Reviews & decisions (append-only; never a statutory approval), Activity (audit).
 * The list reads one summary call (GET /api/coordination/projects-summary), not four calls per card.
 * All original data-testids and aria-labels are kept (some now live inside a tab).
 */

/** Above this many projects the list gets a search box, a status filter and a sort. */
const FILTER_FROM = 6;
/** The planner pressed "Hide" on Get started (this browser). */
const START_HIDDEN_KEY = 'td-projects-get-started-hidden';

export const PlanningPanel: React.FC<{ onClose: () => void; /** Open this project directly (command palette). */ initialOpenId?: string | null }> = ({ onClose, initialOpenId }) => {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUserState] = useState(() => localStorage.getItem('td-user') ?? '');
  const setUser = (v: string) => { setUserState(v); localStorage.setItem('td-user', v); };
  const [creating, setCreating] = useState(false);
  const [startHidden, setStartHidden] = useState(() => localStorage.getItem(START_HIDDEN_KEY) === '1');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<ProjectSort>('newest');

  const reload = useCallback(async () => {
    setLoading(true);
    try { setProjects(await coordinationApi.projectsSummary()); setError(null); } catch (e) { setError(String((e as Error).message ?? e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const shown = useMemo(() => (projects ? filterProjects(projects, query, status, sort) : []), [projects, query, status, sort]);

  return (
    <SidePanel label="Planning projects" wide>
      {openId
        ? <ProjectPage id={openId} user={user} onBack={() => { setOpenId(null); void reload(); }} onClose={onClose}
            onDeleted={() => { setOpenId(null); if (useShellStore.getState().openProjectId) useShellStore.getState().openProject(null); void reload(); }} />
        : (
          <>
            <PanelHeader title="Planning projects" subtitle="One project per planning activity: its alternatives, conflicts with other agencies’ projects, assessments and decisions" onClose={onClose} />
            <PanelBody>
              {error && (
                <Notice tone="bad" action={<Button size="sm" icon={RefreshCw} onClick={() => void reload()} data-testid="projects-retry">Try again</Button>}>
                  The project list could not be loaded ({error}). Nothing was changed.
                </Notice>
              )}
              <div>
                <label className={labelCls} htmlFor="pl-user">Your name (recorded with every change; not verified)</label>
                <input id="pl-user" data-testid="planning-user" className={inputCls} value={user} onChange={e => setUser(e.target.value)} placeholder="e.g. A. Planner, PMC Road Dept" />
              </div>
              {!creating && showGetStarted({ user, projects, hidden: startHidden }) && (
                <GetStarted user={user} onCreate={() => setCreating(true)} others={projects?.length ?? 0}
                  onHide={projects && projects.length > 0 ? () => { localStorage.setItem(START_HIDDEN_KEY, '1'); setStartHidden(true); } : undefined} />
              )}
              <NewProject user={user} open={creating} setOpen={setCreating} onCreated={p => { void reload(); setOpenId(p.id); }} />
              <Section title="Projects" aside={projects ? (shown.length !== projects.length ? `${shown.length} of ${projects.length}` : `${projects.length}`) : undefined}>
                {projects && projects.length > FILTER_FROM && (
                  <div className="grid grid-cols-[1fr_auto_auto] gap-1.5" data-testid="project-filters">
                    <label className="relative">
                      <span className="sr-only">Search projects</span>
                      <Search size={14} aria-hidden className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input className={`${inputCls} pl-7`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, area, person" data-testid="project-search" />
                    </label>
                    <select aria-label="Filter by status" className={inputCls} value={status} onChange={e => setStatus(e.target.value)} data-testid="project-status-filter">
                      <option value="">All statuses</option>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <select aria-label="Sort projects" className={inputCls} value={sort} onChange={e => setSort(e.target.value as ProjectSort)} data-testid="project-sort">
                      <option value="newest">Newest first</option>
                      <option value="name">Name A–Z</option>
                      <option value="open_conflicts">Most open conflicts</option>
                    </select>
                  </div>
                )}
                {!projects ? (error ? null : <Notice icon={Loader2} spin>Loading projects…</Notice>)
                  : projects.length === 0 ? <p className="text-sm text-slate-400">No planning project yet.</p>
                  : shown.length === 0 ? <p className="text-sm text-slate-400" data-testid="projects-no-match">No project matches the search.</p>
                  : <ProjectList projects={shown} onOpen={setOpenId} />}
                {loading && projects && <p className="text-xs text-slate-500">Refreshing…</p>}
              </Section>
            </PanelBody>
          </>
        )}
    </SidePanel>
  );
};

const NewProject: React.FC<{ user: string; open: boolean; setOpen: (v: boolean) => void; onCreated: (p: Project) => void }> = ({ user, open, setOpen, onCreated }) => {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [areaId, setAreaId] = useState('');
  const [areas, setAreas] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open && !areas) apiGet<{ id: string; name: string }[]>('/api/areas').then(a => setAreas(a.map(x => ({ id: x.id, name: x.name })))).catch(() => setAreas([]));
  }, [open, areas]);
  const reset = () => { setName(''); setDesc(''); setAreaId(''); setErr(null); };
  if (!open) return <Button icon={FolderPlus} variant="primary" data-testid="new-project" onClick={() => setOpen(true)}>New planning project</Button>;
  const create = async () => {
    setBusy(true); setErr(null);
    try { onCreated(await planningApi.create({ name: name.trim(), description: desc.trim(), area_id: areaId || null, created_by: user.trim() })); setOpen(false); reset(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Section title="New planning project">
      <div><label className={labelCls} htmlFor="pl-name">Name</label><input id="pl-name" data-testid="project-name" className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Karve Road flyover, phase 1" maxLength={200} /></div>
      <div><label className={labelCls} htmlFor="pl-desc">Purpose — the planning question it answers</label><textarea id="pl-desc" data-testid="project-desc" rows={2} className={inputCls} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Can a 4-lane flyover replace the signal at Nal Stop?" /></div>
      <div>
        <label className={labelCls} htmlFor="pl-area">Study area (optional)</label>
        <select id="pl-area" className={inputCls} value={areaId} onChange={e => setAreaId(e.target.value)} data-testid="project-area">
          <option value="">— none —</option>
          {(areas ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {areas && areas.length === 0 && <p className="text-xs text-slate-500 mt-1">No study area yet (draw one in Design → Study area). You can set it later.</p>}
      </div>
      <p className="text-xs text-slate-500">The project notes the current base city, so a later change to it is flagged. You can rename it or change the study area later.</p>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="flex gap-2">
        <Button variant="primary" icon={busy ? Loader2 : Plus} spin={busy} disabled={busy || !name.trim() || !user.trim()} data-testid="create-project" onClick={create}>Create</Button>
        <Button variant="ghost" onClick={() => { setOpen(false); reset(); }} data-testid="cancel-project">Cancel</Button>
      </div>
      {!user.trim() && <p className="text-xs text-amber-300" data-testid="need-name">Enter your name above first — it is recorded with the project.</p>}
      {user.trim() && !name.trim() && <p className="text-xs text-slate-400">Give the project a name.</p>}
    </Section>
  );
};
