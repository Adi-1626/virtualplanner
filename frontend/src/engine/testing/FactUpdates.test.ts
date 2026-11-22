import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Fact, FactsVersion, Proposal } from '../../lib/freshnessApi';
import { ApplyBar, ProposalCard, type ProposalActions } from '../../components/data/FactUpdatesPane';
import { approvedNotApplied, changeLine, flagLabel, conflictSummary, groupProposals, needsNote, proposalIsOfficial, rollbackTargets, runStatusText, versionNote, withheldText } from '../../components/data/factUpdatesModel';
import { loadReportedFacts, reportedDepthFor, reportedDepthText, reportedFacts, setReportedFacts } from '../underground/reportedFacts';
import { DEPTH_NOT_MAPPED, NO_OFFICIAL_STATION_DEPTH, NO_OFFICIAL_TUNNEL_DEPTH, objectTip } from '../underground/hoverInfo';
import { allOfficial, isOfficialUrl, officialDomain } from '../../lib/officialSources';
import type { CityObject } from '../objects/types';

const MM = 'https://www.punemetrorail.org/Line_b.aspx';
const PIB = 'https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2046088';
const ev = (over = {}) => ({
  claim_id: 'c1', quote: 'Line 1 B Extension | Swargate - Katraj | 5.46 KM | 3 | -', attribution: 'page_rule',
  extractor: 'page_rule:profile_1b@1', cites_other: false, note: '', value: '5.46 km', temporal: null, document_id: 'd1',
  url: MM, domain: 'punemetrorail.org', publisher: 'Maha-Metro (Pune Metro Rail Project)', official: true,
  tier: 1, title: 'Line 1B', published_at: '2026-11-21', published_from: 'retrieved',
  retrieved_at: 'Sat 2026-11-21 4:30 PM IST (UTC+05:30)', sha256: 'ab', manual: false, ...over,
});
const prop = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'fup_1', project_id: 'pune_metro_line_1b_swargate_katraj', project_name: 'Pune Metro Line 1B Swargate–Katraj',
  attribute: 'length_km', attribute_label: 'Length', value_num: 5.46, value_text: null, unit: 'km',
  qualifier: 'exact', temporal: null, label: '5.46 km', status: 'pending', verdict: 'official', confidence: 'official',
  independent_sources: 2, official_sources: 2, evidence_count: 2, flags: [], conflicts: [], current_value: null,
  newest_evidence_at: '2026-11-21', decided_by: null, decided_at: null, decision_note: null, applied_version_id: null,
  created_at: null, evidence: [ev(), ev({ claim_id: 'c2', publisher: 'Press Information Bureau', domain: 'pib.gov.in', url: PIB, attribution: 'sentence',
    quote: 'Cabinet approves Pune Metro Phase-1 project extension towards south from Swargate to Katraj spanning 5.46 km', published_at: '2024-08-16', published_from: 'meta' })],
  ...over,
});
const actions = (over: Partial<ProposalActions> = {}): ProposalActions => ({ reviewer: 'Asha', busy: null, onApprove: vi.fn(), onReject: vi.fn(), ...over });
const html = (p: Proposal, a = actions()) => renderToStaticMarkup(createElement(ProposalCard, { p, actions: a }));
const NEWS = 'https://www.hindustantimes.com/cities/pune-news/four-tbms.html';

describe('official-sources rule (UI mirror of backend/updater/official.py)', () => {
  it('accepts government and agency sites, refuses news and look-alikes', () => {
    for (const [u, d] of [[PIB, 'pib.gov.in'], [MM, 'punemetrorail.org'], ['https://www.mahametro.org/', 'mahametro.org'],
      ['https://sansad.in/getFile/x.pdf', 'sansad.in'], ['https://msrdc.in/', 'msrdc.in'], ['https://morth.nic.in/', 'morth.nic.in'],
      ['https://urban.maharashtra.gov.in/x', 'maharashtra.gov.in'], ['https://www.pmrda.gov.in/feed/', 'pmrda.gov.in']] as const) {
      expect(officialDomain(u)).toBe(d);
    }
    for (const u of [NEWS, 'https://indianexpress.com/x', 'https://timesofindia.indiatimes.com/x', 'https://punemirror.com/x',
      'https://www.punekarnews.in/x', 'https://primetime24.com/x', 'https://themetrorailguy.com/x', 'https://press.siemens.com/x',
      'https://pib.gov.in.evil.com/x', 'https://pib.gov.in@evil.com/x', 'https://notpunemetrorail.org/', 'https://gov.in/',
      'ftp://pib.gov.in/x', 'https://10.0.0.1/', 'https://xn--pib-gov-in.com/', '', null]) {
      expect(isOfficialUrl(u)).toBe(false);
    }
    expect(allOfficial([])).toBe(false);
    expect(allOfficial([{ url: PIB }, { url: NEWS }])).toBe(false);
    expect(allOfficial([{ url: PIB }, { url: MM }])).toBe(true);
  });
});

describe('Fact updates review card', () => {
  it('shows value, confidence, the exact quotes with official links and sites, and approve/reject', () => {
    const h = html(prop());
    expect(h).toContain('5.46 km');
    expect(h).toContain('Official source');
    expect(h).toContain('2 official sources');
    expect(h).toContain('“Cabinet approves Pune Metro Phase-1 project extension towards south from Swargate to Katraj spanning 5.46 km”');
    expect(h).toContain(`href="${PIB.replace(/&/g, '&amp;')}"`);
    expect(h).toContain('Press Information Bureau · Official · pib.gov.in · 2024-08-16');
    expect(h).toContain('Official · punemetrorail.org · as shown on 2026-11-21 (page undated)');
    expect(h).toContain('data-testid="proposal-approve"');
    expect(h).toContain('data-testid="proposal-reject"');
    expect(h).not.toContain('proposal-conflict');
    expect(h).not.toMatch(/· Press ·|independent|outlet|Corroborated/);
  });

  it('two official sources that disagree: both shown, a note is required', () => {
    const p = prop({
      attribute: 'station_count', attribute_label: 'Stations', label: '5 stations', value_num: 5, confidence: 'official_conflicting', verdict: 'conflict',
      conflicts: [{ kind: 'source_disagreement', value: '3 stations', proposal_id: 'fup_2', detail: '', newest_evidence_at: '2024-08-16' },
                  { kind: 'dataset_value', value: '3 stations', detail: 'the dataset currently says 3 stations' }],
      current_value: { label: '3 stations', value_num: 3, value_text: null, proposal_id: null },
      flags: [{ code: 'official_page_undated', detail: 'x' }],
    });
    const h = html(p);
    expect(h).toContain('data-testid="proposal-conflict"');
    expect(h).toContain('Other official sources say 3 stations (2024-08-16).');
    expect(h).toContain('Changes the dataset: 3 stations → 5 stations');
    expect(h).toContain('Official sources disagree');
    expect(h).toContain('Undated official page');
    expect(h).toMatch(/data-testid="proposal-approve" disabled=""/);
    expect(h).toContain('Note required');
    expect(needsNote(p)).toBe(true);
    expect(needsNote(prop())).toBe(false);
    expect(needsNote(prop({ confidence: 'slipped' }))).toBe(true);
    expect(needsNote(prop({ flags: [{ code: 'llm_only', detail: '' }] }))).toBe(true);
  });

  it('a proposal with any news evidence is never shown with its quote and cannot be decided', () => {
    const news = prop({ confidence: 'not_official', evidence: [ev({ url: NEWS, domain: 'hindustantimes.com', publisher: 'Hindustan Times', quote: 'The TBMs will operate at a depth of around 28 metres below ground level.' })] });
    const mixed = prop({ evidence: [ev(), ev({ claim_id: 'n', url: NEWS, publisher: 'Hindustan Times' })] });
    for (const p of [news, mixed]) {
      expect(proposalIsOfficial(p)).toBe(false);
      const h = html(p);
      expect(h).toContain('data-testid="proposal-not-official"');
      expect(h).not.toContain('proposal-approve');
      expect(h).not.toContain('proposal-reject');
      expect(h).not.toContain('Hindustan Times');
      expect(h).not.toContain('28 metres');
    }
    expect(groupProposals([news, mixed, prop({ id: 'ok' })]).flatMap(g => g.items.map(x => x.id))).toEqual(['ok']);
    expect(approvedNotApplied([{ ...mixed, status: 'approved' }])).toEqual([]);
  });

  it('without a reviewer name nothing can be decided; applied proposals have no buttons', () => {
    expect(html(prop(), actions({ reviewer: '' }))).toMatch(/data-testid="proposal-approve" disabled=""/);
    const applied = html(prop({ status: 'applied', decided_by: 'Asha', applied_version_id: 'dsv_2' }));
    expect(applied).not.toContain('proposal-approve');
    expect(applied).toContain('In the dataset');
    expect(applied).toContain('Decided by Asha');
  });

  it('model helpers: change line, conflicts, grouping, apply and rollback targets', () => {
    expect(changeLine(prop())).toBe('New value: 5.46 km');
    expect(changeLine(prop({ current_value: { label: '5.46 km', value_num: 5.46, value_text: null, proposal_id: null } }))).toBe('Agrees with the dataset (5.46 km)');
    expect(conflictSummary(prop())).toBe('');
    const list = [prop({ id: 'a', project_name: 'B project', project_id: 'b' }), prop({ id: 'b', confidence: 'official_conflicting' }), prop({ id: 'c', status: 'approved' })];
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

  it('a rolled-back proposal is listed after pending / approved and can be approved again (integration QA)', () => {
    const rb = html(prop({ status: 'rolled_back', decided_by: 'Ravi', decision_note: 'not in the active facts after a rollback by Ravi' }));
    expect(rb).toContain('Rolled back');
    expect(rb).toContain('data-testid="proposal-approve"');
    expect(rb).toContain('data-testid="proposal-reject"');
    const g = groupProposals([prop({ id: 'r', status: 'rolled_back' }), prop({ id: 'a', status: 'approved' }), prop({ id: 'p' })]);
    expect(g[0].items.map(x => x.id)).toEqual(['p', 'a', 'r']);
  });

  it('version notes name versions, not registry ids (integration QA)', () => {
    const vs: FactsVersion[] = [
      { id: 'dsv_ab12', version_label: 'v3', review_status: 'active', facts: 1, sha256: null, reviewed_by: 'Asha', reviewed_at: null, review_note: null, notes: '', created_at: null },
      { id: 'dsv_0f9e', version_label: 'v2', review_status: 'superseded', facts: 1, sha256: null, reviewed_by: 'Asha', reviewed_at: null, review_note: 'superseded by dsv_ab12', notes: '', created_at: null },
    ];
    expect(versionNote('superseded by dsv_ab12', vs)).toBe('superseded by v3');
    expect(versionNote('superseded by dsv_ffff', vs)).toBe('superseded by a later version');
    const bar = renderToStaticMarkup(createElement(ApplyBar, { approved: [], versions: vs, reviewer: 'Asha', busy: null, onApply: vi.fn(), onRollback: vi.fn() }));
    expect(bar).toContain('superseded by v3');
    expect(bar).not.toContain('dsv_ab12');
  });
});

describe('Underground: official tunnel depth in the metro tooltip (official sources only)', () => {
  // a hypothetical official figure (no official tunnel depth exists today; used only to test the wording)
  const fact: Fact = {
    project_id: 'pune_metro_line_1b_swargate_katraj', project_name: 'Line 1B', project_kind: 'metro_underground', osm_name_patterns: ['katraj'],
    attribute: 'tunnel_depth_m', attribute_label: 'Tunnel depth below ground', value_num: 20, value_text: null, unit: 'm', qualifier: 'approx',
    temporal: 'planned', label: '~20 m', confidence: 'official', proposal_id: 'fup_1', certainty: 'reported', suitability: 'screening',
    evidence: [{ url: 'https://www.punemetrorail.org/download/PR.pdf', publisher: 'Maha-Metro', tier: 1, published_at: '2026-05-13', quote: 'q' }],
  };
  const newsFact: Fact = { ...fact, label: '~28 m', value_num: 28, confidence: 'corroborated',
    evidence: [{ url: NEWS, publisher: 'Hindustan Times', tier: 2, published_at: '2026-08-21', quote: 'q' }, { url: 'https://www.punekarnews.in/x', publisher: 'Punekar News', tier: 2, published_at: '2026-11-04', quote: 'q' }] };
  const line = { id: 'm1', type: 'metro_line', name: 'Swargate - Katraj (under construction)', elevation: -6, coordinates: [[73.86, 18.5, 0], [73.86, 18.45, 0]], tags: { tunnel: 'yes' }, status: 'under_construction' } as unknown as CityObject;
  const other = { ...line, id: 'm2', name: 'Purple Line: PCMC - Swargate' } as unknown as CityObject;
  const tipWith = (o: CityObject, facts: Fact[]) => objectTip(o, { unmappedMetro: () => ({ inferred: false }), reportedDepth: x => { const f = reportedDepthFor(x, facts); return f ? reportedDepthText(f) : null; } });

  it('the news-reported depth is never shown: "Depth not mapped (no official figure)"', () => {
    expect(reportedDepthFor(line, [newsFact])).toBeNull();
    expect(reportedDepthFor(line, [{ ...newsFact, confidence: 'official' }])).toBeNull();     // evidence decides, not the label
    expect(tipWith(line, [newsFact])?.depth).toBe('Depth not mapped (no official figure)');
    expect(tipWith(line, [])?.depth).toBe(NO_OFFICIAL_TUNNEL_DEPTH);
    const purple = { ...line, id: 'w586112436', name: 'Pune Metro Line 1: Purple Line', tags: { tunnel: 'yes', layer: '-2' } } as unknown as CityObject;
    const oldPurple: Fact = { ...newsFact, project_id: 'pune_metro_line_1_purple', osm_name_patterns: ['purple'], qualifier: 'max', label: 'up to 30 m', confidence: 'single_source',
      evidence: [{ url: 'https://www.hindustantimes.com/pune-news/x.html', publisher: 'Hindustan Times', tier: 2, published_at: '2019-12-24', quote: 'q' }] };
    expect(tipWith(purple, [oldPurple])?.depth).toBe(NO_OFFICIAL_TUNNEL_DEPTH);
    expect(tipWith(purple, [oldPurple])?.depth).not.toMatch(/30 m|Hindustan|reported/);
  });

  it('an official figure is worded as official, with its site, and not surveyed', () => {
    expect(reportedDepthFor(line, [fact])).toBe(fact);
    expect(reportedDepthFor(other, [fact])).toBeNull();
    expect(reportedDepthText(fact)).toBe('official ~20 m below ground (Maha-Metro 2026-05-13, punemetrorail.org · official · not surveyed)');
    expect(tipWith(line, [fact])?.depth).toBe(`${DEPTH_NOT_MAPPED} in OSM · official ~20 m below ground (Maha-Metro 2026-05-13, punemetrorail.org · official · not surveyed)`);
    expect(tipWith(other, [fact])?.depth).toBe(NO_OFFICIAL_TUNNEL_DEPTH);
    const elevated = objectTip({ ...line, elevation: 12, tags: {} } as unknown as CityObject, { unmappedMetro: () => null, reportedDepth: () => 'x' });
    expect(elevated?.depth).not.toContain('official');
  });

  it('underground station without an official depth says so', () => {
    const st = { id: 's1', type: 'metro_station', stationName: 'Mandai', coordinates: [73.857, 18.51, 0], elevation: 0 } as unknown as CityObject;
    expect(objectTip(st, { unmappedMetro: () => ({ inferred: true }), reportedDepth: () => null })?.depth).toBe(NO_OFFICIAL_STATION_DEPTH);
  });

  it('a facts file that failed its sha256 check is never used, and non-official facts are dropped on load', async () => {
    setReportedFacts([]);
    await loadReportedFacts(async () => ({ facts: [fact], sha256_ok: false }));
    expect(reportedFacts()).toEqual([]);
  });

  it('loading keeps only facts backed entirely by official sites', async () => {
    const mod = await import('../underground/reportedFacts');
    vi.resetModules();
    const fresh = await import('../underground/reportedFacts');
    await fresh.loadReportedFacts(async () => ({ facts: [fact, newsFact], sha256_ok: true }));
    expect(fresh.reportedFacts()).toEqual([fact]);
    expect(mod).toBeTruthy();
  });
});

describe('Fact updates pane: reviewer next steps are in plain words', () => {
  const CLI = /python|-m updater|migrate-official-only|\brun\b.*updater/i;
  it('withheld facts: what happens and who to ask, no command to type', () => {
    for (const n of [1, 3]) {
      const t = withheldText(n);
      expect(t).not.toMatch(CLI);
      expect(t).toContain('hidden from the app');
      expect(t).toContain('data administrator');
    }
    expect(withheldText(1)).toMatch(/^1 fact in the active version is not/);
    expect(withheldText(2)).toMatch(/^2 facts in the active version are not/);
  });
  it('service status line has no command either', () => {
    expect(runStatusText(false, null)).not.toMatch(CLI);
    expect(runStatusText(true, null)).toBe('Last run unknown (the server did not answer).');
    expect(runStatusText(false, { started_at: '2026-11-21T05:30:00', errors: [1] })).toBe('Last run 2026-11-21 05:30 UTC · 1 source error(s)');
  });
  it('the pane itself shows no command-line text', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '../../components/data/FactUpdatesPane.tsx'), 'utf8')
      .split('\n').filter(l => !/^\s*(\/\*\*|\*|\/\/)/.test(l)).join('\n');
    expect(src).not.toMatch(/python -m|migrate-official-only/);
  });
});

describe('flag labels', () => {
  it('a flag code this build does not know shows its sentence, never the raw code', () => {
    expect(flagLabel({ code: 'stale_source', detail: 'x' })).toBe('Old official source');
    expect(flagLabel({ code: 'official_may_be_outdated', detail: 'newer press reports disagree with the official page; the page may not have been updated' }))
      .toBe('Newer press reports disagree with the official page');
    expect(flagLabel({ code: 'something_new', detail: '' })).toBe('Needs a check');
  });
});
