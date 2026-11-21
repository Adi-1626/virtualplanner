/**
 * Typed client for /api/coordination (backend/api/coordination_router.py, docs/urbanos/COORDINATION_AND_SUBSURFACE.md).
 * Shared city model: proposal elements with 3D extents, clearance rules, cross-project conflict detection, conflict status,
 * stale-assessment indicators, subsurface records (AGS4 subset / CSV / JSON) and the environment layer catalogue.
 *
 * Honesty rules carried by the types: depth `null` = UNKNOWN (never 0); `certainty` is measured | estimated | hypothetical |
 * unknown; `no_conflict_within_available_data` is not proof of no conflict; seeded clearance rules are cited PERMISSION
 * distances, not engineering clearances. No UI here.
 */
import { API_BASE, trackedFetch } from './api';
import { redactPaths } from './redactPaths';

export type Certainty = 'measured' | 'estimated' | 'hypothetical' | 'unknown';
export type ConflictClass = 'conflict' | 'potential_conflict' | 'vertically_separated' | 'no_conflict_within_available_data' | 'unknown_no_coverage';
export type ConflictStatus = 'open' | 'acknowledged' | 'resolved';
export type ElementKind =
  | 'road' | 'road_widening' | 'flyover' | 'bridge' | 'metro_tunnel' | 'metro_viaduct' | 'metro_station' | 'tunnel' | 'utility'
  | 'pipeline' | 'drainage' | 'building' | 'foundation' | 'pier' | 'excavation' | 'protected_monument' | 'other';
export type QualityLevel = 'QL-A' | 'QL-B' | 'QL-C' | 'QL-D';
export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

export interface ProfilePoint { chainage_m: number; z_min_m: number | null; z_max_m: number | null }

export interface ProposalElement {
  id: string; project_id: string; kind: ElementKind; name: string; scenario_id: string | null; scenario_version_id: string | null;
  element_ref: string | null; geometry: GeoJsonGeometry | null; own_geometry: boolean; width_m: number | null;
  z_min_m: number | null; z_max_m: number | null; z_ref: 'ground' | 'msl' | 'unknown'; z_known: { z_min: boolean; z_max: boolean };
  profile: ProfilePoint[] | null; clearance_m: number | null; construction_phase: 'permanent' | 'temporary_works';
  provenance: string; certainty: Certainty; notes: string[]; created_by: string; created_at: string; updated_at: string;
}
export interface ElementInput {
  kind: ElementKind; name?: string; scenario_id?: string | null; scenario_version_id?: string | null; element_ref?: string | null;
  geometry?: GeoJsonGeometry | null; width_m?: number | null; z_min_m?: number | null; z_max_m?: number | null;
  z_ref?: 'ground' | 'msl' | 'unknown'; profile?: ProfilePoint[] | null; clearance_m?: number | null;
  construction_phase?: 'permanent' | 'temporary_works'; provenance?: string; certainty?: Certainty; created_by: string;
}
export interface ElementPatch extends Partial<Omit<ElementInput, 'created_by' | 'element_ref' | 'scenario_id' | 'z_ref' | 'construction_phase'>> {
  edited_by: string; clear_fields?: ('width_m' | 'z_min_m' | 'z_max_m' | 'clearance_m' | 'scenario_version_id' | 'profile')[];
}

export interface ClearanceRule {
  id: string; label: string; rule_type: 'permission_distance' | 'engineering_clearance'; subject_kind: string; other_kind: string;
  horizontal_m: number | null; vertical_m: number | null; horizontal_label: string; vertical_label: string;
  basis: 'cited_permission_distance' | 'user_entered'; basis_label: string; is_permission_distance: boolean; is_engineering_clearance: boolean;
  citation: string | null; note: string; active: boolean; created_by: string; created_at: string; updated_at: string;
}
export interface RuleInput {
  label: string; rule_type: 'permission_distance' | 'engineering_clearance'; subject_kind?: string; other_kind?: string;
  horizontal_m?: number | null; vertical_m?: number | null; citation?: string | null; note?: string; created_by: string;
}
export interface RulePatch {
  edited_by: string; label?: string; horizontal_m?: number; vertical_m?: number; subject_kind?: string; other_kind?: string;
  active?: boolean; note?: string; citation?: string; clear_fields?: ('horizontal_m' | 'vertical_m' | 'citation')[];
}

export interface StaleVerdict {
  /** true = stale, false = current, null = UNKNOWN (inputs not fully recorded) */
  stale: boolean | null; reasons: string[]; not_checked: string[]; label: string; computed_at: string; run_kind?: string;
}
export interface PermissionTrigger { rule_id: string; label: string; distance_m: number; threshold_m: number; basis: string; citation: string | null; note: string }
export interface ConflictFinding {
  id: string; run_id: string; project_a_id: string; element_a_id: string; segment_a: number | null;
  b_type: 'project_element' | 'baseline_road' | 'osm_metro' | 'subsurface_utility' | 'design_object' | 'layer' | 'project'; project_b_id: string | null;
  b_ref: string; segment_b: number | null; class: ConflictClass; class_label: string; horizontal_distance_m: number | null;
  vertical_gap_m: number | null; certainty: Certainty; reasons: string[]; permission_triggers: PermissionTrigger[];
  evidence: Record<string, unknown>; status: ConflictStatus; status_by: string | null; status_note: string | null;
  status_at: string | null; status_carried_from: string | null; created_at: string;
}
export interface ProjectIssue extends ConflictFinding {
  raised_by_project: string; other_project: string | null; run_stale: StaleVerdict | null;
  /** Set when the status shown was recorded on the other project's copy of the same pair (both projects ran the check). */
  status_from_finding?: string;
}
/** GET /projects-summary: one row per project for the project list and Reports. */
export interface ProjectSummary {
  id: string; name: string; status: 'draft' | 'under_study' | 'under_review' | 'decision_recorded'; created_by: string; created_at: string;
  area: string | null; has_bbox: boolean; alternatives: number; links: number; elements: number;
  /** false = no conflict check involves the project (then open_conflicts is null = not checked, never 0). */
  checked: boolean; open_conflicts: number | null;
  last_check: ({ id: string; created_at: string } & StaleVerdict) | null;
  /** Attachments per type (scenario, scenario_version, run, dataset, assessment). */
  link_counts: Partial<Record<string, number>>; decisions: number; traffic_runs: number;
  /** Newest export per label ("PDF report", "DOCX report", "CSV conflict summary"), ISO time. */
  last_exports: Partial<Record<string, string>>;
  /** Findings visible to the project (as in Conflicts); null when no check involves it. */
  findings: number | null;
}
export interface CoordinationRun {
  id: string; project_id: string; engine_version: string; created_by: string; created_at: string;
  summary: { counts: Partial<Record<ConflictClass, number>>; elements: number; skipped_elements: { element_id: string; reason: string }[];
    other_projects: string[]; layers: Record<string, number>; permission_triggers: number; [k: string]: unknown };
  inputs: Record<string, unknown>; stale: StaleVerdict; conflicts?: ConflictFinding[];
}
export interface ProjectStale {
  project_id: string;
  runs: ({ id: string; scenario_id: string; created_at: string } & StaleVerdict)[];
  assessments: ({ id: string; name: string } & StaleVerdict)[];
  coordination_runs: ({ id: string; created_at: string } & StaleVerdict)[];
}

export interface SubsurfaceDataset {
  id: string; project_id: string | null; record_type: 'borehole' | 'utility'; format: 'ags4' | 'csv' | 'json'; name: string;
  file_name: string | null; file_sha256: string | null; publisher: string; source_url: string; licence: string; data_date: string | null;
  coverage_bbox: number[] | null; coverage_label: string; provenance: string; record_count: number; warnings: string[];
  supersedes_id: string | null; imported_by: string; imported_at: string;
}
export interface SubsurfaceRecord {
  id: string; dataset_id: string; record_type: 'borehole' | 'utility'; external_id: string; geometry: GeoJsonGeometry | null;
  location_note: string; ground_level_m: number | null; final_depth_m: number | null;
  strata: { top_m: number | null; base_m: number | null; description: string; legend?: string | null; geology?: string | null }[];
  water_strikes: number[]; spt: { top_m: number | null; n: number | null }[]; utility_type: string | null; owner: string | null;
  depth_m: number | null; diameter_m: number | null; quality_level: QualityLevel | 'UNKNOWN' | null; survey_method: string | null;
  z_min_m: number | null; z_max_m: number | null; z_certainty: Certainty; properties: Record<string, unknown>;
}
export interface ImportInput {
  record_type: 'borehole' | 'utility'; format: 'ags4' | 'csv' | 'json'; content?: string; records?: Record<string, unknown>[];
  name: string; file_name?: string; publisher?: string; source_url?: string; licence?: string; data_date?: string;
  coverage_bbox?: [number, number, number, number]; provenance?: string; project_id?: string; grid_epsg?: number;
  supersedes_id?: string; imported_by: string;
}
export interface EnvironmentLayer {
  id: string; domain: string; name: string; status: 'available' | 'not_imported'; status_label: string; status_source: string;
  source: string; licence: string; data_date: string | null; limitations: string; feature_count?: number | null; coverage_bbox?: number[] | null;
  recommended_sources: { name: string; publisher: string; url: string; licence: string; notes: string; status: string }[];
}

// ── underground screening (POST /underground/screen; docs/urbanos/UNDERGROUND_CHECKS.md) ───────────────────────────
/** Automated statuses are the first three; 'verified' only when a person recorded QL-A field evidence for the pair. */
export type ScreeningStatus = 'potential_conflict' | 'requires_investigation' | 'insufficient_data' | 'verified';
export type ScreeningCategory = 'clearance' | 'metro' | 'cover' | 'buildings' | 'watercourse' | 'groundwater' | 'geology' | 'data_gap';
export interface ScreeningAsset {
  id: string; name: string; kind: string; kind_label: string;
  layer: 'design_proposed' | 'design_existing' | 'utility_record' | 'osm_metro' | 'building' | 'watercourse';
  status: 'proposed' | 'existing'; quality_level: string; certainty: Certainty;
  dataset: { id: string; name?: string; quality_level?: string; [k: string]: unknown };
  width_m: number | null; crown_depth_m: number | null; invert_depth_m: number | null; distance_m?: number | null;
}
export interface ScreeningRuleCite { id: string; dim: 'H' | 'V' | '3D'; value_m: number; type: string; source: string; clause: string; note?: string }
export interface ScreeningFinding {
  id: string; pair_key: string; fingerprint: string; status: ScreeningStatus; status_label: string; computed_status?: ScreeningStatus;
  category: ScreeningCategory; protection_zone?: boolean; title: string;
  checked: string; data_used: { dataset: string; dataset_id: string; quality_level: string; datum?: string }[];
  found: string[]; not_checked: string[]; next_steps: string[]; rules: ScreeningRuleCite[];
  measurements: Record<string, number | boolean | null | (number | null)[]>;
  location: [number, number]; proposed: ScreeningAsset; other: ScreeningAsset | null; buildings?: ScreeningAsset[];
  merged_pieces?: number;
  /** Insufficient data only: the shared reason (one dataset / network / missing input) these findings are grouped under. */
  gap_group?: { key: string; label: string; unit: string };
  verification?: { id: string; verified_by: string; method: string; evidence: string; recorded_at: string | null; stale?: boolean };
}
export interface ScreeningChecklistItem { check: string; result: 'flagged' | 'nothing found in the available data' | 'not checked'; detail: string }
export interface ScreeningLayer { id: string; name: string; used: boolean; quality_level?: string; records?: number; datum?: string; coverage?: string }
export interface ScreeningRun {
  engine_version: string; config_version: string; scenario_id: string; generated_at: string; banner: string; disclaimer: string;
  /** Set when the run was saved (every full check): reopening the alternative shows it. */
  run_id?: string; saved_at?: string; inputs_hash?: string;
  summary: {
    counts: Record<ScreeningStatus, number>; worst_status: ScreeningStatus | null; headline: string;
    proposed_checked: (ScreeningAsset & { checklist: ScreeningChecklistItem[] })[]; skipped: { id: string; name: string; reason: string }[];
    existing_assets_read: number; not_checked: string[]; status_meaning: Record<ScreeningStatus, { label: string; meaning: string }>;
  };
  layers: ScreeningLayer[]; findings: ScreeningFinding[];
  /** Lon/lat GeoJSON per asset id (proposed, other side and listed buildings). */
  geometries: Record<string, GeoJsonGeometry | { type: 'MultiLineString' | 'MultiPolygon'; coordinates: unknown }>;
  rules_table: { pair: string; rows: (ScreeningRuleCite & { compare_only?: boolean; on_breach?: string })[] }[];
  timings_ms: Record<string, number>;
}
/** A Design object as stored ({id, type, name, scenarioId, coordinates, properties}). */
export interface ScreeningObject { id: string; type: string; name: string; scenarioId?: string; coordinates: unknown; properties: Record<string, unknown> }
export interface VerificationInput {
  pair_key: string; fingerprint: string; method: 'trial_pit' | 'vacuum_excavation' | 'survey_of_exposed_asset'; evidence: string;
  measured_horizontal_m?: number | null; measured_vertical_m?: number | null; note?: string; verified_by: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await trackedFetch(`${API_BASE}/api/coordination${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch { /* keep statusText */ }
    throw new Error(`${res.status}: ${redactPaths(msg)}`);
  }
  return res.json() as Promise<T>;
}
const q = (s: string) => encodeURIComponent(s);

export const coordinationApi = {
  vocabulary: () => call<Record<string, unknown>>('GET', '/vocabulary'),
  // proposal elements
  listElements: (projectId: string) => call<ProposalElement[]>('GET', `/projects/${q(projectId)}/elements`),
  createElement: (projectId: string, body: ElementInput) => call<ProposalElement>('POST', `/projects/${q(projectId)}/elements`, body),
  getElement: (id: string) => call<ProposalElement>('GET', `/elements/${q(id)}`),
  patchElement: (id: string, body: ElementPatch) => call<ProposalElement>('PATCH', `/elements/${q(id)}`, body),
  deleteElement: (id: string, removedBy: string) => call<{ deleted: string; note: string }>('DELETE', `/elements/${q(id)}?removed_by=${q(removedBy)}`),
  // clearance rules
  listRules: () => call<{ rules: ClearanceRule[]; rule_set_hash: string; engineering_clearances_note: string }>('GET', '/clearance-rules'),
  createRule: (body: RuleInput) => call<ClearanceRule>('POST', '/clearance-rules', body),
  patchRule: (id: string, body: RulePatch) => call<ClearanceRule>('PATCH', `/clearance-rules/${q(id)}`, body),
  // detection
  detect: (projectId: string, runBy: string, screeningRadiusM?: number) =>
    call<CoordinationRun>('POST', `/projects/${q(projectId)}/detect`, { run_by: runBy, ...(screeningRadiusM ? { screening_radius_m: screeningRadiusM } : {}) }),
  listRuns: (projectId: string) => call<CoordinationRun[]>('GET', `/projects/${q(projectId)}/runs`),
  getRun: (runId: string) => call<CoordinationRun>('GET', `/runs/${q(runId)}`),
  projectIssues: (projectId: string, includeClear = false) =>
    call<{ project_id: string; issues: ProjectIssue[]; note: string }>('GET', `/projects/${q(projectId)}/conflicts${includeClear ? '?include_clear=true' : ''}`),
  setConflictStatus: (id: string, status: ConflictStatus, actor: string, note: string) =>
    call<ConflictFinding & { note: string }>('PATCH', `/conflicts/${q(id)}/status`, { status, actor, note }),
  // staleness
  stale: (kind: 'run' | 'assessment' | 'coordination_run', id: string) => call<StaleVerdict & { kind: string; id: string }>('GET', `/stale/${kind}/${q(id)}`),
  projectStale: (projectId: string) => call<ProjectStale>('GET', `/projects/${q(projectId)}/stale`),
  /** Every project's counts in one call (alternatives, elements, open conflicts, latest check + stale verdict). */
  projectsSummary: () => call<{ projects: ProjectSummary[] }>('GET', '/projects-summary').then(r => r.projects),
  // subsurface
  importSubsurface: (body: ImportInput) => call<SubsurfaceDataset & { meta: Record<string, unknown>; records: SubsurfaceRecord[] }>('POST', '/subsurface/import', body),
  listDatasets: (projectId?: string) => call<SubsurfaceDataset[]>('GET', `/subsurface/datasets${projectId ? `?project_id=${q(projectId)}` : ''}`),
  getDataset: (id: string) => call<SubsurfaceDataset & { records: SubsurfaceRecord[] }>('GET', `/subsurface/datasets/${q(id)}`),
  listRecords: (opts: { bbox?: [number, number, number, number]; recordType?: 'borehole' | 'utility' } = {}) => {
    const p = new URLSearchParams();
    if (opts.bbox) p.set('bbox', opts.bbox.join(','));
    if (opts.recordType) p.set('record_type', opts.recordType);
    const s = p.toString();
    return call<{ records: SubsurfaceRecord[]; note: string }>('GET', `/subsurface/records${s ? `?${s}` : ''}`);
  },
  // underground screening (read-only; verifications are recorded by a person)
  screenUnderground: (body: { scenario_id: string; objects?: ScreeningObject[]; focus_ids?: string[] }) =>
    call<ScreeningRun>('POST', '/underground/screen', body),
  /** Last saved screening of the alternative; stale when the objects sent now (or the records / engine) differ from the run's. */
  latestScreening: (body: { scenario_id: string; objects?: ScreeningObject[] }) =>
    call<{ run: ScreeningRun | null; stale?: boolean; stale_reasons?: string[] }>('POST', '/underground/runs/latest', body),
  /** Screening report (re-runs the check on these objects): PDF / DOCX / CSV as a Blob plus the server's file name. */
  screeningReport: async (body: { scenario_id: string; objects?: ScreeningObject[] }, format: 'pdf' | 'docx' | 'csv'): Promise<{ blob: Blob; filename: string; findings: number }> => {
    const res = await trackedFetch(`${API_BASE}/api/coordination/underground/screen/report?format=${format}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
    const cd = res.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? `underground-screening.${format}`;
    return { blob: await res.blob(), filename, findings: Number(res.headers.get('X-Findings') ?? 0) };
  },
  recordVerification: (body: VerificationInput) => call<{ id: string; pair_key: string; created_at: string }>('POST', '/underground/verifications', body),
  // environment
  environmentLayers: () => call<{ layers: EnvironmentLayer[]; note: string }>('GET', '/environment-layers'),
};
