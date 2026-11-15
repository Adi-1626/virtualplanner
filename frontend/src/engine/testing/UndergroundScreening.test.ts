import { describe, expect, it } from 'vitest';
import {
  STATUS_ORDER, STATUS_TEXT, SCREENING_BANNER, countsByStatus, focusBounds, forObject, groupBySeverity, highlightTargets, isStale,
  keyNumbers, pathsOf, plainSummary, screenedAsProposed,
} from '../../components/underground/conflictClasses';
import { gapCountText, groupGaps } from '../../components/underground/screeningGroups';
import { sideBLabel } from '../../lib/planningProjects';
import type { ScreeningFinding, ScreeningRun } from '../../lib/coordinationApi';

// SYNTHETIC findings (shape of POST /api/coordination/underground/screen)
const asset = (id: string, name = id) => ({
  id, name, kind: 'water', kind_label: 'Water main', layer: 'design_proposed' as const, status: 'proposed' as const, quality_level: 'design',
  certainty: 'hypothetical' as const, dataset: { id: 'design:alt' }, width_m: 0.3, crown_depth_m: 1, invert_depth_m: 1.3,
});
const finding = (id: string, status: ScreeningFinding['status'], category: ScreeningFinding['category'], pid = 'P1', other: string | null = 'R1'): ScreeningFinding => ({
  id, pair_key: `${pid}|${other}|${category}`, fingerprint: 'fp', status, status_label: STATUS_TEXT[status].label, category, title: id,
  checked: 'c', data_used: [], found: ['f'], not_checked: ['n'], next_steps: ['s'], rules: [],
  measurements: { horizontal_m: 0.8, required_horizontal_m: 3, vertical_gap_m: 0.6, required_vertical_m: 1, vertical_checkable: true, crossing: false },
  location: [73.85, 18.52], proposed: asset(pid), other: other ? { ...asset(other), layer: 'utility_record', status: 'existing' } : null,
});
const run = (findings: ScreeningFinding[]): ScreeningRun => ({
  engine_version: 'x', config_version: 'y', scenario_id: 'alt', generated_at: '2026-11-15T10:00:00Z', banner: SCREENING_BANNER, disclaimer: 'd',
  summary: { counts: countsByStatus(findings), worst_status: null, headline: '', proposed_checked: [{ ...asset('P1'), checklist: [] }, { ...asset('P2'), checklist: [] }],
    skipped: [], existing_assets_read: 0, not_checked: [], status_meaning: {} as ScreeningRun['summary']['status_meaning'] },
  layers: [], findings,
  geometries: { P1: { type: 'LineString', coordinates: [[73.85, 18.52], [73.86, 18.52]] }, R1: { type: 'Point', coordinates: [73.855, 18.52] } },
  rules_table: [], timings_ms: {},
});

describe('underground screening helpers', () => {
  it('uses only the four statuses, most severe first, with no green and a fixed banner', () => {
    expect(STATUS_ORDER).toEqual(['potential_conflict', 'requires_investigation', 'insufficient_data', 'verified']);
    expect(SCREENING_BANNER).toBe('Automated screening — not an engineering assessment');
    for (const s of STATUS_ORDER) expect(STATUS_TEXT[s].color).not.toMatch(/green|#22c55e|#16a34a|--ok|--pass/i);
    const words = JSON.stringify(STATUS_TEXT).toLowerCase();
    for (const w of ['safe', 'feasible', 'construction-ready', 'passed']) expect(words).not.toContain(w);
  });

  it('counts and groups by severity, selected object first, empty groups dropped', () => {
    const fs = [finding('a', 'insufficient_data', 'clearance'), finding('b', 'potential_conflict', 'clearance', 'P2'),
      finding('c', 'potential_conflict', 'cover', 'P1', null), finding('d', 'potential_conflict', 'clearance', 'P1')];
    expect(countsByStatus(fs)).toEqual({ potential_conflict: 3, requires_investigation: 0, insufficient_data: 1, verified: 0 });
    const g = groupBySeverity(fs, 'P1');
    expect(g.map(x => x.status)).toEqual(['potential_conflict', 'insufficient_data']);
    expect(g[0].findings.map(f => f.id)).toEqual(['d', 'c', 'b']);   // P1 first; clearance before cover
    expect(forObject(fs, 'P2').map(f => f.id)).toEqual(['b']);
    expect(forObject(fs, null)).toHaveLength(4);
  });

  it('summarises in plain words and never calls an empty result a pass', () => {
    const r = run([finding('a', 'potential_conflict', 'clearance'), finding('b', 'insufficient_data', 'data_gap', 'P1', null)]);
    const s = plainSummary(r);
    expect(s).toContain('2 proposed objects checked');
    expect(s).toContain('1 potential conflict to look at first');
    expect(s).toContain('can\u2019t be judged');
    expect(plainSummary(run([]))).toContain('incomplete');
    expect(plainSummary({ summary: { ...r.summary, proposed_checked: [] } })).toContain('Nothing to check');
  });

  it('key numbers say when the vertical is not checkable', () => {
    const f = finding('a', 'insufficient_data', 'clearance');
    expect(keyNumbers(f)).toEqual(['Plan distance 0.8\u00a0m (needs 3.0\u00a0m)', 'Vertical gap 0.6\u00a0m (needs 1.0\u00a0m)']);
    f.measurements = { ...f.measurements, vertical_checkable: false, crossing: true };
    expect(keyNumbers(f)).toEqual(['Crosses in plan', 'Vertical: not checkable']);
  });

  it('highlight targets both assets and focuses on the finding location', () => {
    const r = run([finding('a', 'potential_conflict', 'clearance')]);
    const t = highlightTargets(r.findings[0], r.geometries);
    expect(t.proposed).toHaveLength(1);
    expect(t.other).toHaveLength(2);                                     // a point becomes a small cross
    expect(t.bounds.minLng).toBeLessThan(73.85);
    expect(t.bounds.maxLat - t.bounds.minLat).toBeCloseTo(120 / 111_320, 6);
    const b = focusBounds([73.85, 18.52], 10);
    expect(b.maxLng - b.minLng).toBeGreaterThan(b.maxLat - b.minLat);   // longitude degrees are shorter at 18.5°N
    expect(pathsOf({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] })).toHaveLength(1);
    expect(pathsOf(null)).toEqual([]);
  });

  it('flags results as out of date after an edit', () => {
    expect(isStale('2026-11-15T10:00:00Z', [{ updatedAt: '2026-11-15T09:00:00Z' }])).toBe(false);
    expect(isStale('2026-11-15T10:00:00Z', [{ updatedAt: '2026-11-15T10:05:00Z' }])).toBe(true);
  });

  it('names Design-drawn objects in Projects → Conflicts', () => {
    expect(sideBLabel({ b_type: 'design_object', b_ref: 'design:u1', evidence: { b: { status: 'existing', name: 'Old main' } } }))
      .toBe('Existing object drawn in Design: Old main');
  });

  it('groups Insufficient-data findings per dataset / network with a short count line', () => {
    const storm = (id: string, pid: string, crossing: boolean): ScreeningFinding => ({
      ...finding(id, 'insufficient_data', 'clearance', pid, `R${id}`),
      measurements: { horizontal_m: 0, vertical_checkable: false, crossing },
      gap_group: { key: 'vertical:storm:nodepth', label: 'PMC storm-water drains: no depth recorded — vertical clearance not checkable', unit: 'crossing or near pass' },
    });
    const gap = (id: string, pid: string): ScreeningFinding => ({
      ...finding(id, 'insufficient_data', 'data_gap', pid, null),
      gap_group: { key: 'networks:water supply', label: 'No water supply records in this area', unit: 'object' },
    });
    const legacy: ScreeningFinding = { ...finding('x', 'insufficient_data', 'clearance', 'P1', 'R9'),
      other: { ...asset('R9'), layer: 'utility_record', status: 'existing', dataset: { id: 'ssd_sewer', name: 'PMC sewer network (OpenCity mirror) — QL-D records' } } };
    const gs = groupGaps([storm('a', 'P1', true), storm('b', 'P1', false), storm('c', 'P2', true), gap('g', 'P1'), legacy]);
    expect(gs.map(g => g.key)).toEqual(['vertical:storm:nodepth', 'networks:water supply', 'vertical:ssd_sewer']);
    expect(gs[0].findings).toHaveLength(3);
    expect(gapCountText(gs[0])).toBe('3 crossings or near passes (2 cross in plan) · 2 proposed objects');
    expect(gapCountText(gs[1])).toBe('1 object');
    expect(gs[2].label).toBe('PMC sewer network: vertical clearance not checkable');   // older result without gap_group
    for (const g of gs) for (const w of ['safe', 'feasible', 'passed', 'compliant']) expect(g.label.toLowerCase()).not.toContain(w);
  });
});

describe('which drawn objects the screening checks as proposals (mirrors backend classify_objects)', () => {
  it('recorded lifecycle wins, else alternative membership', () => {
    expect(screenedAsProposed({ type: 'utility', scenarioId: 'base', status: 'proposed' }, 'alt')).toBe(true);
    expect(screenedAsProposed({ type: 'utility', scenarioId: 'alt', status: 'existing' }, 'alt')).toBe(false);
    expect(screenedAsProposed({ type: 'utility', scenarioId: 'alt', status: 'abandoned' }, 'alt')).toBe(false);
    expect(screenedAsProposed({ type: 'utility', scenarioId: 'alt', status: 'conceptual' }, 'alt')).toBe(true);
    expect(screenedAsProposed({ type: 'utility', scenarioId: 'base' }, 'alt')).toBe(false);
    expect(screenedAsProposed({ type: 'utility', scenarioId: 'base', status: 'unknown' }, 'base')).toBe(true);
    expect(screenedAsProposed({ type: 'underground_alignment', scenarioId: 'alt', lifecycle: 'existing' }, 'alt')).toBe(false);
    expect(screenedAsProposed({ type: 'metro_line', scenarioId: 'alt' }, 'alt')).toBe(false);
  });
});
