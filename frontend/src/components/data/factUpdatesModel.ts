/**
 * Pure helpers for Data catalogue → Fact updates (the review queue of the data-freshness service). No React, no fetch.
 */
import type { Confidence, Evidence, FactsVersion, Proposal } from '../../lib/freshnessApi';
import { allOfficial, officialDomain } from '../../lib/officialSources';

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  official: 'Official source', official_conflicting: 'Official sources disagree', slipped: 'Slipped (date passed)',
  not_official: 'Not an official source',
};
export const CONFIDENCE_HELP: Record<Confidence, string> = {
  official: 'Stated by the responsible agency or Parliament on its own site. Official pages can still be out of date: check the date.',
  official_conflicting: 'Two official sources give different values (another proposal, or the official value already in the dataset); both are shown. A note is required.',
  slipped: 'An official planned date that has passed and was replaced by a later official date. Kept as history; a note is required to approve it.',
  not_official: 'Not from a government or agency site. It can never be approved or enter the dataset.',
};
export const CONFIDENCE_TONE: Record<Confidence, 'good' | 'warn' | 'bad' | 'unknown'> = {
  official: 'good', official_conflicting: 'bad', slipped: 'unknown', not_official: 'bad',
};
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for review', approved: 'Approved — not applied yet', rejected: 'Rejected', applied: 'In the dataset',
  superseded: 'Superseded', rolled_back: 'Rolled back',
};
export const FLAG_LABEL: Record<string, string> = {
  stale_source: 'Old official source', llm_only: 'LLM-extracted only', attribution_by_context: 'Project named only in context',
  year_resolved: 'Year inferred', official_page_undated: 'Undated official page', planned_date_passed: 'Planned date has passed',
  newer_competitor: 'Newer official value exists', new_evidence_since_decision: 'New evidence since decision', slipped: 'Slipped',
  not_official: 'Not an official source', dataset_date_passed: 'Dataset date has passed',
};

/** A flag in words; a code this build does not know (a database written by an older updater, before `migrate-official-only`)
 * shows its own sentence instead of the raw code ("official_may_be_outdated" was on screen in Final QA 2026-11-21). */
export function flagLabel(f: { code: string; detail: string }): string {
  if (FLAG_LABEL[f.code]) return FLAG_LABEL[f.code];
  const d = (f.detail || '').split(';')[0].trim();
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : 'Needs a check';
}

/** Every piece of evidence is from an official site (government / agency; lib/officialSources.ts mirrors the backend). */
export function proposalIsOfficial(p: Proposal): boolean {
  return p.confidence !== 'not_official' && allOfficial(p.evidence ?? []);
}

/** Approve without a note only for a plain official value (the backend enforces the same rule). */
export function needsNote(p: Proposal): boolean {
  return p.confidence !== 'official' || p.flags.some(f => f.code === 'llm_only');
}

/** "Official · pib.gov.in" — the evidence's site, which is what makes it official. */
export function evidenceSource(e: Evidence): string {
  const d = officialDomain(e.url);
  return d ? `Official · ${d}` : 'Not an official source';
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
  return `Other official sources say ${others.map(c => `${c.value}${c.newest_evidence_at ? ` (${c.newest_evidence_at.slice(0, 10)})` : ''}`).join(', ')}.`;
}

/** "2 official sources" (distinct official sites stating the value) */
export function sourceCount(p: Proposal): string {
  return `${p.official_sources} official source${p.official_sources === 1 ? '' : 's'}`;
}

export function evidenceDate(e: Evidence): string {
  if (!e.published_at) return 'undated';
  const d = e.published_at.slice(0, 10);
  return e.published_from === 'retrieved' ? `as shown on ${d} (page undated)` : d;
}

export interface ProjectGroup { projectId: string; projectName: string; items: Proposal[] }

/** Pending first (conflicts on top), then approved; grouped by project in name order. A proposal that is not backed only
 * by official sources is never listed (the backend leaves them out too). */
export function groupProposals(list: Proposal[]): ProjectGroup[] {
  list = list.filter(proposalIsOfficial);
  const order: Record<string, number> = { pending: 0, approved: 1, rolled_back: 2 };
  const by = new Map<string, ProjectGroup>();
  for (const p of list) {
    const g = by.get(p.project_id) ?? { projectId: p.project_id, projectName: p.project_name, items: [] };
    g.items.push(p);
    by.set(p.project_id, g);
  }
  const rank = (p: Proposal) => (order[p.status] ?? 9) * 10 + (p.confidence === 'official_conflicting' ? 0 : 1);
  for (const g of by.values()) g.items.sort((a, b) => rank(a) - rank(b) || a.attribute_label.localeCompare(b.attribute_label) || a.label.localeCompare(b.label));
  return [...by.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
}

export function approvedNotApplied(list: Proposal[]): Proposal[] {
  return list.filter(p => p.status === 'approved' && !p.applied_version_id && proposalIsOfficial(p));
}

/** A registry review note with version ids ("superseded by dsv_…") written as version labels ("superseded by v3"). */
export function versionNote(note: string, vs: FactsVersion[]): string {
  return note.replace(/\bdsv_[0-9a-f]+\b/g, id => vs.find(v => v.id === id)?.version_label ?? 'a later version');
}

/** Versions a reviewer can roll back to: superseded ones (the registry re-activates them). */
export function rollbackTargets(vs: FactsVersion[]): FactsVersion[] {
  return vs.filter(v => v.review_status === 'superseded');
}
