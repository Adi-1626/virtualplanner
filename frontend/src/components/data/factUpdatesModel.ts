/**
 * Pure helpers for Data catalogue → Fact updates (the review queue of the data-freshness service). No React, no fetch.
 */
import type { Confidence, Evidence, FactsVersion, Proposal } from '../../lib/freshnessApi';

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  official: 'Official source', corroborated: 'Corroborated (2 independent outlets)', single_source: 'Single source',
  conflicting: 'Sources disagree', unverified: 'Not verified', slipped: 'Slipped (date passed)',
};
export const CONFIDENCE_HELP: Record<Confidence, string> = {
  official: 'Stated by the implementing or approving authority. Official pages can still be out of date.',
  corroborated: 'No official source; two independent reputable outlets state it (different publishers, different wording).',
  single_source: 'One reputable source only. Approving it needs a note saying how it was checked.',
  conflicting: 'Another source gives a different value. Approving one marks the others superseded; a note is required.',
  unverified: 'Only aggregator, undated or out-of-date sources. Never enough on its own.',
  slipped: 'A planned date that has passed and was replaced by a later reported date. Kept as history.',
};
export const CONFIDENCE_TONE: Record<Confidence, 'good' | 'warn' | 'bad' | 'unknown'> = {
  official: 'good', corroborated: 'good', single_source: 'warn', conflicting: 'bad', unverified: 'unknown', slipped: 'unknown',
};
export const TIER_LABEL: Record<number, string> = { 1: 'Official', 2: 'Press', 3: 'Other' };
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for review', approved: 'Approved — not applied yet', rejected: 'Rejected', applied: 'In the dataset',
  superseded: 'Superseded', rolled_back: 'Rolled back',
};
export const FLAG_LABEL: Record<string, string> = {
  undated_source: 'Undated source', stale_source: 'Old source', tier3_only: 'Only minor sources', llm_only: 'LLM-extracted only',
  attribution_by_context: 'Project named only in context', year_resolved: 'Year inferred', cites_other_report: 'Repeats another report',
  official_page_undated: 'Undated official page', planned_date_passed: 'Planned date has passed', newer_competitor: 'Newer value exists',
  official_may_be_outdated: 'Official page may be out of date', official_disagrees: 'Official source disagrees',
  new_evidence_since_decision: 'New evidence since decision', slipped: 'Slipped',
};

/** Approve without a note only when the evidence is official or corroborated (the backend enforces the same rule). */
export function needsNote(p: Proposal): boolean {
  return p.confidence !== 'official' && p.confidence !== 'corroborated';
}

/** "Dataset: 26 m → proposed ~28 m", "New: ~28 m" or "Same as the dataset (28 m)". */
export function changeLine(p: Proposal): string {
  if (!p.current_value) return `New value: ${p.label}`;
  if (p.conflicts.some(c => c.kind === 'dataset_value')) return `Changes the dataset: ${p.current_value.label} → ${p.label}`;
  return `Agrees with the dataset (${p.current_value.label})`;
}

/** The competing values from other sources, newest first, as one sentence; '' when none. */
export function conflictSummary(p: Proposal): string {
  const others = p.conflicts.filter(c => c.kind === 'source_disagreement');
  if (!others.length) return '';
  return `Other sources say ${others.map(c => `${c.value}${c.newest_evidence_at ? ` (${c.newest_evidence_at.slice(0, 10)})` : ''}`).join(', ')}.`;
}

/** "2 independent · 0 official" */
export function sourceCount(p: Proposal): string {
  return `${p.independent_sources} independent source${p.independent_sources === 1 ? '' : 's'} · ${p.official_sources} official`;
}

export function evidenceDate(e: Evidence): string {
  if (!e.published_at) return 'undated';
  const d = e.published_at.slice(0, 10);
  return e.published_from === 'retrieved' ? `as shown on ${d} (page undated)` : d;
}

export interface ProjectGroup { projectId: string; projectName: string; items: Proposal[] }

/** Pending first (conflicts on top), then approved; grouped by project in name order. */
export function groupProposals(list: Proposal[]): ProjectGroup[] {
  const order: Record<string, number> = { pending: 0, approved: 1, rolled_back: 2 };
  const by = new Map<string, ProjectGroup>();
  for (const p of list) {
    const g = by.get(p.project_id) ?? { projectId: p.project_id, projectName: p.project_name, items: [] };
    g.items.push(p);
    by.set(p.project_id, g);
  }
  const rank = (p: Proposal) => (order[p.status] ?? 9) * 10 + (p.confidence === 'conflicting' ? 0 : 1);
  for (const g of by.values()) g.items.sort((a, b) => rank(a) - rank(b) || a.attribute_label.localeCompare(b.attribute_label) || a.label.localeCompare(b.label));
  return [...by.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export function approvedNotApplied(list: Proposal[]): Proposal[] {
  return list.filter(p => p.status === 'approved' && !p.applied_version_id);
}

/** A registry review note with version ids ("superseded by dsv_…") written as version labels ("superseded by v3"). */
export function versionNote(note: string, vs: FactsVersion[]): string {
  return note.replace(/\bdsv_[0-9a-f]+\b/g, id => vs.find(v => v.id === id)?.version_label ?? 'a later version');
}

/** Versions a reviewer can roll back to: superseded ones (the registry re-activates them). */
export function rollbackTargets(vs: FactsVersion[]): FactsVersion[] {
  return vs.filter(v => v.review_status === 'superseded');
}
