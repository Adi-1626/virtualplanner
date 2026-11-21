/**
 * Projects workspace refinement (docs/urbanos/PROJECTS_AUDIT.md, 2026-11-21): drawn tunnels and per-point utilities registered
 * with their real depth range, shared findings with deleted projects / element names, the project list for many projects,
 * the get-started path, the Activity wording and the UI states (name missing, decision recorded). Values SYNTHETIC.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  activityText, draftFromObject, draftsFromChangeSet, filterProjects, isDraft, openConflictText, otherSideLabel, projectName,
  staleReasonText, startSteps, type ChangeSetEntry,
} from '../../lib/planningProjects';
import type { ProjectIssue, ProjectSummary } from '../../lib/coordinationApi';
import { ProjectList } from '../../components/projects/ProjectList';
import { GetStarted } from '../../components/projects/GetStarted';
import { ActivityTab } from '../../components/projects/RecordsTabs';
import { OverviewTab } from '../../components/projects/OverviewTab';
import type { ProjectBundle } from '../../components/projects/projectData';

// three vertices 100 m apart along a parallel (~0.000948° of longitude at 18.5° N)
const C3 = [[73.8, 18.5, 0], [73.800948, 18.5, 0], [73.801896, 18.5, 0]];
const entry = (type: string, properties: Record<string, unknown>, coordinates: unknown = C3, id = `${type}_1`): ChangeSetEntry =>
  ({ objectId: id, op: 'add', object: { id, type, name: `SYNTHETIC ${type}`, coordinates, properties } });

describe('drawn proposals are registered with their real depth range (A4)', () => {
  it('a drawn tunnel is a tunnel with a per-point profile, not "other" with depth UNKNOWN', () => {
    const d = draftFromObject(entry('underground_alignment', {
      alignmentKind: 'bored_tunnel', section: { shape: 'circular', diameterM: 6 }, sectionCertainty: 'estimated',
      depths: [{ crownDepthM: 12, certainty: 'estimated' }, { crownDepthM: 18, certainty: 'estimated' }, { crownDepthM: 15, certainty: 'hypothetical' }],
    }), 'scn_a', null);
    if (!isDraft(d)) throw new Error('expected a draft');
    expect(d.input.kind).toBe('tunnel');
    expect([d.input.z_max_m, d.input.z_min_m, d.input.width_m]).toEqual([-12, -24, 6]);   // shallowest crown … deepest invert (18 + 6)
    expect(d.input.certainty).toBe('hypothetical');                                         // the worst of the points
    expect(d.input.profile?.map(p => [p.z_max_m, p.z_min_m])).toEqual([[-12, -18], [-18, -24], [-15, -21]]);
    expect(d.input.profile?.[2].chainage_m).toBeGreaterThan(195);
    expect(d.input.profile?.[2].chainage_m).toBeLessThan(205);
  });
  it('a tunnel point without a crown depth leaves the top UNKNOWN (never 0); an unknown section leaves the bottom UNKNOWN', () => {
    const d = draftFromObject(entry('underground_alignment', {
      alignmentKind: 'underground_metro', section: { shape: 'box', widthM: null, heightM: null }, sectionCertainty: 'unknown',
      depths: [{ crownDepthM: 14, certainty: 'estimated' }, { crownDepthM: null, certainty: 'unknown' }, { crownDepthM: 16, certainty: 'estimated' }],
    }), 's', null);
    if (!isDraft(d)) throw new Error('expected a draft');
    expect(d.input.kind).toBe('metro_tunnel');
    expect([d.input.z_max_m, d.input.z_min_m, d.input.width_m]).toEqual([null, null, null]);
    expect(d.input.profile?.[1]).toMatchObject({ z_max_m: null, z_min_m: null });
    expect(d.basis.join(' ')).toMatch(/1 UNKNOWN/);
  });
  it('a utility drawn deeper along its length keeps the full range (not just the shallowest top)', () => {
    const d = draftFromObject(entry('utility', {
      utilityType: 'sewage', diameterMm: 450, zRef: 'top', status: 'proposed', depth: 1.5, depthCertainty: 'estimated',
      depths: [{ depthM: 1.5, certainty: 'estimated' }, { depthM: 2.5, certainty: 'estimated' }, { depthM: 3.0, certainty: 'estimated', isDefault: true }],
    }), 's', null);
    if (!isDraft(d)) throw new Error('expected a draft');
    expect([d.input.z_max_m, d.input.z_min_m, d.input.width_m]).toEqual([-1.5, -3.45, 0.45]);
    expect(d.input.certainty).toBe('hypothetical');                                         // one point is the typical-cover default
    expect(d.input.profile).toHaveLength(3);
    expect(d.basis.join(' ')).toMatch(/1 point\(s\) use the typical-cover default/);
  });
  it('a utility depth to the invert without a diameter: top UNKNOWN, bottom known', () => {
    const d = draftFromObject(entry('utility', { utilityType: 'water', zRef: 'invert', depths: [{ depthM: 2, certainty: 'measured' }, { depthM: 2, certainty: 'measured' }, { depthM: 2, certainty: 'measured' }] }), 's', null);
    if (!isDraft(d)) throw new Error('expected a draft');
    expect([d.input.z_max_m, d.input.z_min_m, d.input.width_m, d.input.certainty]).toEqual([null, -2, null, 'measured']);
  });
  it('the change set maps tunnels and utilities, and still skips zones and removals', () => {
    const { drafts, skipped } = draftsFromChangeSet([
      entry('underground_alignment', { alignmentKind: 'cut_and_cover', section: { shape: 'box', widthM: 10, heightM: 7 }, depths: [{ crownDepthM: 3 }, { crownDepthM: 3 }, { crownDepthM: 3 }] }),
      entry('zone', {}, C3, 'z1'), { objectId: 'del', op: 'delete' },
    ], 's', null);
    expect(drafts.map(d => d.input.kind)).toEqual(['tunnel']);
    expect(drafts[0].input).toMatchObject({ z_max_m: -3, z_min_m: -10, width_m: 10 });
    expect(skipped.map(x => x.objectId).sort()).toEqual(['del', 'z1']);
  });
});

const issue = (o: Partial<ProjectIssue>): ProjectIssue => ({
  id: 'f', run_id: 'r', project_a_id: 'pA', element_a_id: 'eA', segment_a: 0, b_type: 'project_element', project_b_id: 'pB', b_ref: 'eB', segment_b: 0,
  class: 'potential_conflict', class_label: '', horizontal_distance_m: 0, vertical_gap_m: null, certainty: 'unknown', reasons: [], permission_triggers: [],
  evidence: { a: { name: 'SYNTHETIC tunnel' }, b: { name: 'SYNTHETIC water main' } }, status: 'open', status_by: null, status_note: null, status_at: null,
  status_carried_from: null, created_at: '', raised_by_project: 'pA', other_project: 'pB', run_stale: null, ...o,
});

describe('shared findings name the other project and its element (A11, A12)', () => {
  it('names the other element; a deleted project is said in words, never as a bare id', () => {
    expect(otherSideLabel(issue({}), { pB: 'Water supply 2030' }, 'pA')).toBe('Project “Water supply 2030”: SYNTHETIC water main');
    // seen from B: the other project is A, which raised it; its element is side A of the finding
    expect(otherSideLabel(issue({ other_project: 'pA' }), { pA: 'Metro' }, 'pB')).toBe('Project “Metro”: SYNTHETIC tunnel (raised by them)');
    const gone = otherSideLabel(issue({}), {}, 'pA');
    expect(gone).toBe('A deleted project: SYNTHETIC water main');
    expect(gone).not.toContain('pB');
    expect(projectName('prj_x', {})).toBe('a deleted project');
  });
  it('an OSM metro finding names the line and says when several OSM pieces were merged', () => {
    expect(otherSideLabel(issue({ b_type: 'osm_metro', other_project: null, b_ref: 'osm_way_1', evidence: { b: { osm_tags: { name: 'Pune Metro Line 1: Purple Line' } }, osm_pieces: 2 } }), {}, 'pA'))
      .toBe('Existing metro (OpenStreetMap): Pune Metro Line 1: Purple Line (2 OSM pieces, nearest shown)');
  });
  it('explains the new stale reasons in plain words', () => {
    expect(staleReasonText('alternatives_attached_changed')).toBe('an alternative was attached');
    expect(staleReasonText('infra_index_changed')).toBe('the building / network index changed');
  });
});

const summary = (o: Partial<ProjectSummary>): ProjectSummary => ({
  id: 'p', name: 'SYNTHETIC', status: 'draft', created_by: 'A', created_at: '2026-11-20T10:00:00Z', area: null, has_bbox: false, alternatives: 0,
  links: 0, elements: 0, checked: false, open_conflicts: null, last_check: null, link_counts: {}, decisions: 0, traffic_runs: 0, last_exports: {}, findings: null, ...o,
});

describe('project list for many projects (A9)', () => {
  const ps = [
    summary({ id: 'a', name: 'Karve Road flyover', area: 'Kothrud', created_by: 'Asha', open_conflicts: 2, checked: true, created_at: '2026-11-01T00:00:00Z' }),
    summary({ id: 'b', name: 'Swargate tunnel', status: 'under_study', created_by: 'Ravi', created_at: '2026-11-10T00:00:00Z' }),
    summary({ id: 'c', name: 'aundh storm drain', area: 'Aundh', created_by: 'Asha', open_conflicts: 0, checked: true, created_at: '2026-11-05T00:00:00Z' }),
  ];
  it('filters by name, area or person and by status; sorts by name, newest or open conflicts (not checked last)', () => {
    expect(filterProjects(ps, 'asha', '', 'name').map(p => p.id)).toEqual(['c', 'a']);
    expect(filterProjects(ps, 'kothrud', '', 'newest').map(p => p.id)).toEqual(['a']);
    expect(filterProjects(ps, '', 'under_study', 'newest').map(p => p.id)).toEqual(['b']);
    expect(filterProjects(ps, '', '', 'newest').map(p => p.id)).toEqual(['b', 'c', 'a']);
    expect(filterProjects(ps, '', '', 'open_conflicts').map(p => p.id)).toEqual(['a', 'c', 'b']);
  });
  it('a card never shows 0 open conflicts for a project nobody checked', () => {
    expect(openConflictText(false, null)).toBe('conflicts: not checked');
    expect(openConflictText(true, 0)).toBe('0 open conflicts');
    expect(openConflictText(true, 1)).toBe('1 open conflict');
    const html = renderToStaticMarkup(createElement(ProjectList, { projects: [ps[1], ps[2]], onOpen: () => {} }));
    expect(html).toContain('conflicts: not checked');
    expect(html).toContain('0 open conflicts');
    expect(html).toContain('No study area');
  });
});

describe('get started (A15)', () => {
  it('ticks the steps from what the project has', () => {
    expect(startSteps({ user: '', project: null }).filter(s => s.done)).toHaveLength(0);
    const s = startSteps({ user: 'A', project: { alternatives: 1, elements: 0, checked: false, exported: false } });
    expect(s.map(x => [x.id, x.done])).toEqual([['name', true], ['create', true], ['attach', true], ['elements', false], ['check', false], ['export', false]]);
  });
  it('the card says what a project is and that nothing here approves anything; create needs a name', () => {
    const html = renderToStaticMarkup(createElement(GetStarted, { user: '', onCreate: () => {} }));
    expect(html).toContain('Nothing here approves anything');
    expect(html).toMatch(/data-testid="start-create"[^>]*disabled|disabled[^>]*data-testid="start-create"/);
    expect(html).toContain('Enter your name above first');
  });
});

describe('Activity wording (A7)', () => {
  it('a response is a response; a check is a check; a finding insert is not called a response', () => {
    expect(activityText({ entity_type: 'coordination_conflict', action: 'update', label: 'potential_conflict', changed_fields: ['status', 'status_by', 'status_note'] })).toMatch(/^Finding response recorded/);
    expect(activityText({ entity_type: 'coordination_conflict', action: 'create', label: 'potential_conflict', changed_fields: null })).toBe('Finding recorded by a conflict check — potential conflict');
    expect(activityText({ entity_type: 'coordination_run', action: 'create', label: '', changed_fields: null })).toBe('Conflict check run');
    expect(activityText({ entity_type: 'project', action: 'update', label: 'X', changed_fields: ['name', 'description'] })).toBe('Project name, purpose changed');
    expect(activityText({ entity_type: 'project', action: 'create', label: 'X', changed_fields: null })).toBe('Project created — X');
  });
  it('the tab says how many finding rows are not listed one by one', () => {
    const html = renderToStaticMarkup(createElement(ActivityTab, { events: [{ id: 1, at: '2026-11-21T10:00:00Z', actor: 'A', actor_source: 'request_field', action: 'create', entity_type: 'coordination_run', entity_id: 'r', parent_type: 'project', parent_id: 'p', label: '', changed_fields: null, before_hash: null, after_hash: null }], hiddenFindings: 70 }));
    expect(html).toContain('70 finding rows written by conflict checks are not listed one by one');
    expect(html).toContain('Conflict check run');
  });
});

const bundle = (o: Partial<ProjectBundle['project']> = {}): ProjectBundle => ({
  project: { id: 'p', name: 'SYNTHETIC project', description: '', area_id: null, bbox: null, baseline_id: 'base', baseline_fingerprint: 'x', status: 'draft', status_label: 'Draft',
    created_by: 'A', created_at: '2026-11-21T00:00:00Z', link_count: 0, links: [], decisions: [], baseline_changed_since_created: false, ...o },
  events: [], linkable: null, elements: [], issues: [], stale: null, projectNames: { p: 'SYNTHETIC project' }, partialErrors: [], findingInsertsHidden: 0,
});

describe('Overview states (A5, A6, A10, A14)', () => {
  const render = (b: ProjectBundle, who: string) => renderToStaticMarkup(createElement(OverviewTab, { b, who, act: async () => {}, reload: () => {}, goTab: () => {}, onDeleted: () => {} }));
  it('without a name the status, edit and delete controls are disabled and say why', () => {
    const html = render(bundle(), '');
    expect(html).toMatch(/<fieldset disabled=""[^>]*data-testid="status-control"/);
    expect(html).toContain('Enter your name on the project list to change the status');
    expect(html).toMatch(/data-testid="edit-project"[^>]*disabled|disabled[^>]*data-testid="edit-project"/);
  });
  it('a project with a recorded decision cannot be deleted (decisions are append-only)', () => {
    const html = render(bundle({ status: 'decision_recorded', decisions: [{ id: 'd', seq: 1, decision_text: 'x', decided_by: 'O', role: '', organisation: '', scenario_id: null, scenario_version_id: null, evidence_refs: [], supersedes: null, created_at: '', kind: 'planning_decision_recorded_in_tool', kind_label: '', is_statutory_approval: false }] }), 'A');
    expect(html).toContain('data-testid="delete-blocked"');
    expect(html).not.toContain('data-testid="delete-project"');
  });
  it('report links are plain links (no button inside a link) and the next steps are shown until the first check', () => {
    const html = render(bundle(), 'A');
    expect(html).not.toMatch(/<a [^>]*data-testid="export-pdf"[^>]*>\s*<button/);
    expect(html).toContain('data-testid="next-steps"');
    expect(html).toContain('data-testid="delete-project"');
  });
});
