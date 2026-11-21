import React from 'react';
import type { ProjectSummary } from '../../lib/coordinationApi';
import { openConflictText } from '../../lib/planningProjects';
import { StaleBadge, StatusBadge } from './common';
import { when } from './projectData';

/**
 * Project cards from one summary call: name, status, study area, alternatives, proposal elements, open conflicts
 * ("not checked" — never 0 — when no conflict check involves the project) and whether the latest check is stale.
 */
export const ProjectList: React.FC<{ projects: ProjectSummary[]; onOpen: (id: string) => void }> = ({ projects, onOpen }) => (
  <ul className="space-y-1.5" data-testid="project-list">
    {projects.map(p => <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p.id)} />)}
  </ul>
);

const ProjectCard: React.FC<{ p: ProjectSummary; onOpen: () => void }> = ({ p, onOpen }) => {
  const stale = p.last_check?.stale === true;
  return (
    <li>
      <button data-testid="open-project" data-project={p.id} onClick={onOpen} className="w-full text-left rounded-xl bg-white/[0.04] border border-white/5 hover:border-white/20 px-3 py-2 cursor-pointer transition">
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-white truncate">{p.name}</span><StatusBadge status={p.status} /></div>
        <div className="text-xs text-slate-400 mt-0.5 truncate">{p.area ?? (p.has_bbox ? 'Bounding box' : 'No study area')} · by {p.created_by} · {when(p.created_at)}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs tabular-nums" data-testid="project-card-counts">
          <span className="text-slate-300">{p.alternatives} alternative{p.alternatives === 1 ? '' : 's'}</span>
          <span className="text-slate-300">{p.elements} element{p.elements === 1 ? '' : 's'}</span>
          <span className={p.open_conflicts ? 'text-amber-300' : 'text-slate-300'} data-testid="card-open-conflicts">{openConflictText(p.checked, p.open_conflicts)}</span>
          {p.last_check && stale && <StaleBadge verdict={p.last_check} />}
        </div>
      </button>
    </li>
  );
};
