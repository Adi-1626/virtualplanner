/**
 * Typed client for /api/updater (backend/api/updater_router.py; docs/urbanos/DATA_FRESHNESS_SERVICE.md).
 * The data-freshness service runs separately (`python -m updater run`); this client only reads its proposals and records
 * a reviewer's decisions. Nothing reaches the dataset without approve → apply.
 */
import { API_BASE } from './api';
import { redactPaths } from './redactPaths';

export type Confidence = 'official' | 'corroborated' | 'single_source' | 'conflicting' | 'unverified' | 'slipped';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'superseded' | 'rolled_back';

export interface Evidence {
  claim_id: string; quote: string; attribution: 'sentence' | 'previous_sentence' | 'article' | 'page_rule' | string;
  extractor: string; cites_other: boolean; note: string; value: string; temporal: 'planned' | 'reported' | null;
  document_id: string; url: string; domain: string; publisher: string; tier: 1 | 2 | 3; title: string;
  published_at: string | null; published_from: string; retrieved_at: string | null; sha256: string | null; manual: boolean;
}
export interface Flag { code: string; detail: string }
export interface Conflict { kind: 'source_disagreement' | 'dataset_value'; value: string | null; proposal_id?: string | null; status?: string; detail: string; newest_evidence_at?: string | null }
export interface FactValue { label: string; value_num: number | null; value_text: string | null; proposal_id: string | null; confidence?: string | null }
export interface Proposal {
  id: string; project_id: string; project_name: string; attribute: string; attribute_label: string;
  value_num: number | null; value_text: string | null; unit: string | null; qualifier: string; temporal: string | null;
  label: string; status: ProposalStatus; verdict: 'corroborated' | 'needs_corroboration' | 'conflict'; confidence: Confidence;
  independent_sources: number; official_sources: number; evidence_count: number; flags: Flag[]; conflicts: Conflict[];
  current_value: FactValue | null; newest_evidence_at: string | null; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; applied_version_id: string | null; created_at: string | null; evidence?: Evidence[];
}
export interface FactEvidence { url: string; publisher: string; domain?: string; tier: number | null; title?: string; published_at: string | null; quote: string; retrieved_at?: string | null }
export interface Fact {
  project_id: string; project_name: string; project_kind: string | null; osm_name_patterns: string[]; attribute: string;
  attribute_label: string; value_num: number | null; value_text: string | null; unit: string | null; qualifier: string;
  temporal: string | null; label: string; confidence?: string | null; proposal_id: string | null; approved_by?: string | null;
  approved_at?: string | null; origin?: string; certainty: 'reported'; suitability: 'screening'; evidence: FactEvidence[];
}
export interface FactsResponse { version_id: string | null; version_label: string | null; facts: Fact[]; sha256_ok: boolean | null; error: string | null }
export interface FactsVersion { id: string; version_label: string; review_status: 'active' | 'pending_review' | 'superseded' | 'rejected'; facts: number | null; sha256: string | null; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; notes: string; created_at: string | null }
export interface RunSummary { id: string; mode: string; started_at: string | null; finished_at: string | null; stats: Record<string, unknown>; errors: { source: string; url?: string; error: string }[] }
export interface UpdaterStatus {
  proposals: Partial<Record<ProposalStatus, number>>; last_runs: RunSummary[];
  facts: { version_id: string | null; version_label: string | null; sha256_ok: boolean | null; error: string | null; count: number };
  audit: { ok: boolean; rows: number; reason?: string }; watched_projects: number;
  sources: { id: string; kind: string; enabled: boolean; tier: number; publisher: string; url: string; note: string }[];
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const b = await r.json(); if (b?.detail) msg = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail); } catch { /* keep status */ }
    throw new Error(redactPaths(msg));
  }
  return r.json() as Promise<T>;
}
const post = <T>(path: string, body: unknown) => j<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const freshnessApi = {
  status: () => j<UpdaterStatus>('/api/updater/status'),
  proposals: (status = 'pending,approved') => j<Proposal[]>(`/api/updater/proposals?status=${encodeURIComponent(status)}`),
  approve: (id: string, reviewer: string, note = '') => post<Proposal>(`/api/updater/proposals/${encodeURIComponent(id)}/approve`, { reviewer, note }),
  reject: (id: string, reviewer: string, note = '') => post<Proposal>(`/api/updater/proposals/${encodeURIComponent(id)}/reject`, { reviewer, note }),
  apply: (reviewer: string, note = '', activate = true) => post<{ version_id: string; version_label: string; review_status: string }>('/api/updater/apply', { reviewer, note, activate }),
  rollback: (versionId: string, reviewer: string, note = '') => post<{ version_label: string }>('/api/updater/rollback', { version_id: versionId, reviewer, note }),
  versions: () => j<FactsVersion[]>('/api/updater/versions'),
  facts: () => j<FactsResponse>('/api/updater/facts'),
};
