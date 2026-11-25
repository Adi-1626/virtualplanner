/** Client for /api/planning (backend/api/planning_router.py, docs/PLANNING_WORKSPACE.md). */
import { API_BASE, apiErrorFromResponse, trackedFetch } from '../../lib/api';

export type ProjectStatus = 'draft' | 'under_study' | 'under_review' | 'decision_recorded';
export type LinkType = 'scenario' | 'scenario_version' | 'run' | 'dataset' | 'assessment';
export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  scenario: 'Scenario', scenario_version: 'Scenario version', run: 'Simulation run', dataset: 'Traffic dataset', assessment: 'Feasibility assessment',
};
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draft', under_study: 'Under study', under_review: 'Under review', decision_recorded: 'Decision recorded',
};

export interface ProjectLink { id: number; entity_type: LinkType; entity_id: string; label: string; exists: boolean; note: string; added_by: string; added_at: string }
export interface Decision {
  id: string; seq: number; decision_text: string; decided_by: string; role: string; organisation: string; scenario_id: string | null;
  scenario_version_id: string | null; evidence_refs: { type: string; id: string }[]; supersedes: string | null; created_at: string;
  kind: 'planning_decision_recorded_in_tool'; kind_label: string; is_statutory_approval: false;
}
export interface Project {
  id: string; name: string; description: string; area_id: string | null; bbox: number[] | null; baseline_id: string; baseline_fingerprint: string;
  status: ProjectStatus; status_label: string; preferred_scenario_id?: string | null; created_by: string; created_at: string; link_count: number;
  baseline_current_fingerprint?: string; baseline_changed_since_created?: boolean; links?: ProjectLink[]; decisions?: Decision[];
  area?: { id: string; name: string; bbox: number[] } | null;
}
export interface AuditEvent {
  id: number; at: string; actor: string; actor_source: string; action: string; entity_type: string; entity_id: string;
  parent_type: string | null; parent_id: string | null; label: string; changed_fields: string[] | null; before_hash: string | null; after_hash: string | null;
}
export type Linkable = Record<LinkType, { id: string; label: string; kind?: string; synthetic?: boolean; scenario_id?: string }[]>;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await trackedFetch(`${API_BASE}/api/planning${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw await apiErrorFromResponse(res, `/api/planning${path}`);
  return res.json() as Promise<T>;
}

export const planningApi = {
  projects: () => call<Project[]>('GET', '/projects'),
  project: (id: string) => call<Project>('GET', `/projects/${id}`),
  create: (b: { name: string; description: string; area_id?: string | null; created_by: string }) => call<Project>('POST', '/projects', b),
  setStatus: (id: string, status: Exclude<ProjectStatus, 'decision_recorded'>, edited_by: string) => call<Project>('PATCH', `/projects/${id}`, { status, edited_by }),
  /** Marks an attached scenario as the preferred alternative ('' clears). A working flag, not a decision (audited). */
  setPreferred: (id: string, scenarioId: string, edited_by: string) => call<Project>('PATCH', `/projects/${id}`, { preferred_scenario_id: scenarioId, edited_by }),
  /** Name, purpose and study area ('' clears the area). Audited as a project update. */
  update: (id: string, b: { name?: string; description?: string; area_id?: string }, edited_by: string) => call<Project>('PATCH', `/projects/${id}`, { ...b, edited_by }),
  /** Deletes a project without a recorded decision (409 otherwise); confirmName must repeat its name. Linked records are kept. */
  remove: (id: string, removedBy: string, confirmName: string) =>
    call<{ status: 'deleted'; elements: number; runs: number; findings: number }>('DELETE', `/projects/${id}?removed_by=${encodeURIComponent(removedBy)}&confirm_name=${encodeURIComponent(confirmName)}`),
  linkable: () => call<Linkable>('GET', '/linkable'),
  link: (id: string, entity_type: LinkType, entity_id: string, added_by: string) => call<ProjectLink>('POST', `/projects/${id}/links`, { entity_type, entity_id, added_by }),
  unlink: (id: string, linkId: number, by: string) => call<unknown>('DELETE', `/projects/${id}/links/${linkId}?removed_by=${encodeURIComponent(by)}`),
  audit: (id: string) => call<{ events: AuditEvent[]; finding_inserts_hidden?: number }>('GET', `/projects/${id}/audit`).then(r => r.events),
  /** The timeline plus how many finding rows written by conflict checks were left out of it. */
  timeline: (id: string) => call<{ events: AuditEvent[]; finding_inserts_hidden?: number }>('GET', `/projects/${id}/audit`)
    .then(r => ({ events: r.events, findingInsertsHidden: r.finding_inserts_hidden ?? 0 })),
  decide: (id: string, b: { decision_text: string; decided_by: string; role?: string; organisation?: string; scenario_version_id?: string | null; evidence_refs?: { type: string; id: string }[] }) =>
    call<Decision>('POST', `/projects/${id}/decisions`, b),
  reportUrl: (id: string, format: 'pdf' | 'docx', by: string) => `${API_BASE}/api/planning/projects/${id}/report?format=${format}&requested_by=${encodeURIComponent(by)}`,
};
