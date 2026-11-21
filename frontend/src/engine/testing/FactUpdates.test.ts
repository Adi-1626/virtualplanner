import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Fact, FactsVersion, Proposal } from '../../lib/freshnessApi';
import { ApplyBar, ProposalCard, type ProposalActions } from '../../components/data/FactUpdatesPane';
import { approvedNotApplied, changeLine, conflictSummary, groupProposals, needsNote, rollbackTargets } from '../../components/data/factUpdatesModel';
import { loadReportedFacts, reportedDepthFor, reportedDepthText, reportedFacts, setReportedFacts } from '../underground/reportedFacts';
import { DEPTH_NOT_MAPPED, objectTip } from '../underground/hoverInfo';
import type { CityObject } from '../objects/types';

const ev = (over = {}) => ({
  claim_id: 'c1', quote: 'The TBMs will operate at a depth of around 28 metres below ground level.', attribution: 'previous_sentence',
  extractor: 'pattern:tunnel_depth_m@1', cites_other: false, note: '', value: '~28 m', temporal: 'planned', document_id: 'd1',
  url: 'https://www.hindustantimes.com/cities/pune-news/four-tbms.html', domain: 'hindustantimes.com', publisher: 'Hindustan Times',
  tier: 2 as const, title: 'Four TBMs to arrive', published_at: '2026-08-21T08:06:30+05:30', published_from: 'meta',
  retrieved_at: '2026-11-21T11:00:00Z', sha256: 'ab', manual: false, ...over,
});
const prop = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'fup_1', project_id: 'pune_metro_line_1b_swargate_katraj', project_name: 'Pune Metro Line 1B Swargate–Katraj',
  attribute: 'tunnel_depth_m', attribute_label: 'Tunnel depth below ground', value_num: 28, value_text: null, unit: 'm',
  qualifier: 'approx', temporal: 'planned', label: '~28 m', status: 'pending', verdict: 'corroborated', confidence: 'corroborated',
  independent_sources: 2, official_sources: 0, evidence_count: 2, flags: [], conflicts: [], current_value: null,
  newest_evidence_at: '2026-11-04', decided_by: null, decided_at: null, decision_note: null, applied_version_id: null,
  created_at: null, evidence: [ev(), ev({ claim_id: 'c2', publisher: 'Punekar News', domain: 'punekarnews.in', url: 'https://www.punekarnews.in/x', quote: 'The machines will operate at a depth of around 28 metres below ground level.', published_at: '2026-11-04' })],
  ...over,
});
const actions = (over: Partial<ProposalActions> = {}): ProposalActions => ({ reviewer: 'Asha', busy: null, onApprove: vi.fn(), onReject: vi.fn(), ...over });
const html = (p: Proposal, a = actions()) => renderToStaticMarkup(createElement(ProposalCard, { p, actions: a }));

describe('Fact updates review card', () => {
  it('shows value, confidence, the exact quotes with links and publishers, and approve/reject', () => {
    const h = html(prop());
    expect(h).toContain('~28 m');
    expect(h).toContain('Corroborated (2 independent outlets)');
    expect(h).toContain('2 independent sources · 0 official');
    expect(h).toContain('“The TBMs will operate at a depth of around 28 metres below ground level.”');
    expect(h).toContain('href="https://www.hindustantimes.com/cities/pune-news/four-tbms.html"');
    expect(h).toContain('Hindustan Times · Press · 2026-08-21');
    expect(h).toContain('project named only in context');
    expect(h).toContain('data-testid="proposal-approve"');
    expect(h).toContain('data-testid="proposal-reject"');
    expect(h).toContain('a plan, not a completed fact');
    expect(h).not.toContain('proposal-conflict');
  });

  it('warns about conflicts and the dataset change, and a conflicting value cannot be approved without a note', () => {
    const p = prop({
      attribute: 'completion_target', attribute_label: 'Completion target', label: 'December 2030', value_num: null, value_text: '2030-12',
      confidence: 'conflicting', verdict: 'conflict', independent_sources: 1,
      conflicts: [{ kind: 'source_disagreement', value: 'December 2029', proposal_id: 'fup_2', detail: '', newest_evidence_at: '2026-05-31' },
                  { kind: 'dataset_value', value: 'February 2029', detail: 'the dataset currently says February 2029' }],
      current_value: { label: 'February 2029', value_num: null, value_text: '2029-02', proposal_id: null },
      flags: [{ code: 'official_page_undated', detail: 'x' }],
    });
    const h = html(p);
    expect(h).toContain('data-testid="proposal-conflict"');
    expect(h).toContain('Other sources say December 2029 (2026-05-31).');
    expect(h).toContain('Changes the dataset: February 2029 → December 2030');
    expect(h).toContain('Sources disagree');
    expect(h).toContain('Undated official page');
    expect(h).toMatch(/data-testid="proposal-approve" disabled=""/);
    expect(h).toContain('Note required');
    expect(needsNote(p)).toBe(true);
    expect(needsNote(prop())).toBe(false);
    expect(needsNote(prop({ confidence: 'official' }))).toBe(false);
  });

  it('without a reviewer name nothing can be decided; applied proposals have no buttons', () => {
    expect(html(prop(), actions({ reviewer: '' }))).toMatch(/data-testid="proposal-approve" disabled=""/);
    const applied = html(prop({ status: 'applied', decided_by: 'Asha', applied_version_id: 'dsv_2' }));
    expect(applied).not.toContain('proposal-approve');
    expect(applied).toContain('In the dataset');
    expect(applied).toContain('Decided by Asha');
  });

  it('model helpers: change line, conflicts, grouping, apply and rollback targets', () => {
    expect(changeLine(prop())).toBe('New value: ~28 m');
    expect(changeLine(prop({ current_value: { label: '~28 m', value_num: 28, value_text: null, proposal_id: null } }))).toBe('Agrees with the dataset (~28 m)');
    expect(conflictSummary(prop())).toBe('');
    const list = [prop({ id: 'a', project_name: 'B project', project_id: 'b' }), prop({ id: 'b', confidence: 'conflicting' }), prop({ id: 'c', status: 'approved' })];
    const g = groupProposals(list);
    expect(g.map(x => x.projectName)).toEqual(['B project', 'Pune Metro Line 1B Swargate–Katraj']);
    expect(g[1].items.map(x => x.id)).toEqual(['b', 'c']);
    expect(approvedNotApplied(list).map(x => x.id)).toEqual(['c']);
    const vs: FactsVersion[] = [
      { id: 'v2', version_label: 'v2', review_status: 'active', facts: 1, sha256: null, reviewed_by: 'Asha', reviewed_at: null, review_note: null, notes: '', created_at: null },
      { id: 'v1', version_label: 'v1', review_status: 'superseded', facts: 0, sha256: null, reviewed_by: 'system', reviewed_at: null, review_note: null, notes: '', created_at: null },
    ];
    expect(rollbackTargets(vs).map(v => v.id)).toEqual(['v1']);
    const bar = renderToStaticMarkup(createElement(ApplyBar, { approved: [prop({ status: 'approved' })], versions: vs, reviewer: 'Asha', busy: null, onApply: vi.fn(), onRollback: vi.fn() }));
    expect(bar).toContain('version v2 · 1 facts');
    expect(bar).toContain('Apply 1 approved fact as a new version');
    expect(bar).toContain('Roll back to v1');
  });
});

describe('Underground: reviewed published depth in the metro tooltip', () => {
  const fact: Fact = {
    project_id: 'pune_metro_line_1b_swargate_katraj', project_name: 'Line 1B', project_kind: 'metro_underground', osm_name_patterns: ['katraj'],
    attribute: 'tunnel_depth_m', attribute_label: 'Tunnel depth below ground', value_num: 28, value_text: null, unit: 'm', qualifier: 'approx',
    temporal: 'planned', label: '~28 m', confidence: 'corroborated', proposal_id: 'fup_1', certainty: 'reported', suitability: 'screening',
    evidence: [{ url: 'u1', publisher: 'Hindustan Times', tier: 2, published_at: '2026-08-21', quote: 'q' }, { url: 'u2', publisher: 'Punekar News', tier: 2, published_at: '2026-11-04', quote: 'q' }],
  };
  const line = { id: 'm1', type: 'metro_line', name: 'Swargate - Katraj (under construction)', elevation: -6, coordinates: [[73.86, 18.5, 0], [73.86, 18.45, 0]], tags: { tunnel: 'yes' }, status: 'under_construction' } as unknown as CityObject;
  const other = { ...line, id: 'm2', name: 'Purple Line: PCMC - Swargate' } as unknown as CityObject;

  it('matches by the project OSM name patterns and words it as reported, not surveyed', () => {
    expect(reportedDepthFor(line, [fact])).toBe(fact);
    expect(reportedDepthFor(other, [fact])).toBeNull();
    expect(reportedDepthText(fact)).toBe('reported ~28 m below ground (Hindustan Times 2026-08-21, Punekar News 2026-11-04 · 2 independent outlets · not surveyed)');
  });

  it('tooltip keeps "Depth not mapped" and adds the reported figure only for an unmapped tunnel', () => {
    const tip = objectTip(line, { unmappedMetro: () => ({ inferred: false }), reportedDepth: o => (reportedDepthFor(o, [fact]) ? reportedDepthText(fact) : null) });
    expect(tip?.depth).toBe(`${DEPTH_NOT_MAPPED} in OSM · reported ~28 m below ground (Hindustan Times 2026-08-21, Punekar News 2026-11-04 · 2 independent outlets · not surveyed)`);
    const plain = objectTip(other, { unmappedMetro: () => ({ inferred: false }), reportedDepth: o => (reportedDepthFor(o, [fact]) ? 'x' : null) });
    expect(plain?.depth).toBe(DEPTH_NOT_MAPPED);
    const elevated = objectTip({ ...line, elevation: 12, tags: {} } as unknown as CityObject, { unmappedMetro: () => null, reportedDepth: () => 'x' });
    expect(elevated?.depth).not.toContain('reported');
  });

  it('a facts file that failed its sha256 check is never used', async () => {
    setReportedFacts([]);
    await loadReportedFacts(async () => ({ facts: [fact], sha256_ok: false }));
    expect(reportedFacts()).toEqual([]);
  });
});
