import type { ConflictClass, GeoJsonGeometry, ScreeningCategory, ScreeningFinding, ScreeningRun, ScreeningStatus } from '../../lib/coordinationApi';

/** Legacy project-detection classes (COORDINATION_AND_SUBSURFACE §3), most severe first. Never shown as "clear". */
export const CLASS_ORDER: ConflictClass[] = ['conflict', 'potential_conflict', 'vertically_separated', 'no_conflict_within_available_data', 'unknown_no_coverage'];
export const CLASS_TEXT: Record<ConflictClass, { label: string; color: string; hint: string }> = {
  conflict: { label: 'Conflict', color: 'var(--fail, #ef4444)', hint: 'Footprints overlap (or are within a set clearance) and the vertical ranges overlap.' },
  potential_conflict: { label: 'Potential conflict', color: 'var(--warn, #f59e0b)', hint: 'Close in plan, but a depth or width is UNKNOWN, so it cannot be excluded.' },
  vertically_separated: { label: 'Vertically separated', color: 'var(--estimated, #38bdf8)', hint: 'Vertical gap between known ranges; adequacy is UNKNOWN unless a vertical clearance rule is set.' },
  no_conflict_within_available_data: { label: 'No conflict within available data', color: 'var(--text-2, #A9B3C1)', hint: 'Only what is in the covered datasets was checked. Not proof of no conflict.' },
  unknown_no_coverage: { label: 'Unknown — no data coverage', color: 'var(--unknown, #94a3b8)', hint: 'The layer has no data here (e.g. no utility records with a stated coverage). Not a pass.' },
};

// ── underground screening (docs/urbanos/UNDERGROUND_CHECKS.md) ──────────────────────────────────────────────────────

/**
 * Whether the screening engine checks this drawn object as a proposal (same rule as backend screening.classify_objects):
 * the recorded lifecycle wins (utility `status`, alignment `lifecycle`: proposed / conceptual → proposal; existing /
 * abandoned → existing obstacle); without one, objects of the active alternative are proposals, and in the base city
 * every drawn alignment / utility is.
 */
export function screenedAsProposed(o: { type: string; scenarioId?: string; status?: string; lifecycle?: string }, activeScenarioId: string): boolean {
  if (o.type !== 'underground_alignment' && o.type !== 'utility') return false;
  const lc = o.type === 'utility' ? o.status : o.lifecycle;
  if (lc === 'proposed' || lc === 'conceptual') return true;
  if (lc === 'existing' || lc === 'abandoned') return false;
  return activeScenarioId === 'base' || (o.scenarioId ?? 'base') === activeScenarioId;
}

export const SCREENING_BANNER = 'Automated screening — not an engineering assessment';

/** Most severe first. 'verified' is set only by a person recording field evidence. No green anywhere. */
export const STATUS_ORDER: ScreeningStatus[] = ['potential_conflict', 'requires_investigation', 'insufficient_data', 'verified'];
export const STATUS_TEXT: Record<ScreeningStatus, { label: string; color: string; hint: string }> = {
  potential_conflict: { label: 'Potential conflict', color: 'var(--fail, #ef4444)',
    hint: 'With the data as recorded the two assets are closer than the rule allows, or overlap. Confirm on site before redesigning.' },
  requires_investigation: { label: 'Requires investigation', color: 'var(--warn, #f59e0b)',
    hint: 'Close to a limit within the data\u2019s accuracy, inside the Metro 20 m zone, or a case with no Indian numeric rule.' },
  insufficient_data: { label: 'Insufficient data', color: 'var(--unknown, #94a3b8)',
    hint: 'A depth, datum, size or whole dataset is missing, so nothing can be concluded. This is not a pass.' },
  verified: { label: 'Verified', color: 'var(--estimated, #60a5fa)',
    hint: 'A person recorded field evidence (trial pit / exposed-asset survey) for this pair and neither asset changed since.' },
};

export const CATEGORY_LABEL: Record<ScreeningCategory, string> = {
  clearance: 'Clearance', metro: 'Metro', cover: 'Cover / depth', buildings: 'Buildings', watercourse: 'Nalla / river',
  groundwater: 'Groundwater', geology: 'Ground conditions', data_gap: 'Missing data',
};

export function countsByStatus(findings: readonly Pick<ScreeningFinding, 'status'>[]): Record<ScreeningStatus, number> {
  const out = { potential_conflict: 0, requires_investigation: 0, insufficient_data: 0, verified: 0 } as Record<ScreeningStatus, number>;
  for (const f of findings) out[f.status] = (out[f.status] ?? 0) + 1;
  return out;
}

export interface FindingGroup { status: ScreeningStatus; label: string; findings: ScreeningFinding[] }

/** Findings grouped by status, most severe group first; inside a group, the selected object's first, then by title. Empty groups dropped. */
export function groupBySeverity(findings: readonly ScreeningFinding[], firstObjectId?: string | null): FindingGroup[] {
  return STATUS_ORDER.map(status => ({
    status, label: STATUS_TEXT[status].label,
    findings: findings.filter(f => f.status === status).sort((a, b) =>
      Number(b.proposed.id === firstObjectId) - Number(a.proposed.id === firstObjectId)
      || categoryRank(a.category) - categoryRank(b.category)),
  })).filter(g => g.findings.length > 0);
}

const CATEGORY_ORDER: ScreeningCategory[] = ['metro', 'clearance', 'cover', 'buildings', 'watercourse', 'groundwater', 'geology', 'data_gap'];
const categoryRank = (c: ScreeningCategory) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 99 : i; };

/** One plain sentence for the top of the result, for someone who is not an engineer. */
export function plainSummary(run: Pick<ScreeningRun, 'summary'>, findings?: readonly ScreeningFinding[], scopeName?: string | null): string {
  const c = findings ? countsByStatus(findings) : run.summary.counts;
  const n = run.summary.proposed_checked.length;
  if (n === 0) return 'Nothing to check yet: draw an underground alignment or a utility in this alternative.';
  const parts: string[] = [];
  if (c.potential_conflict) parts.push(`${c.potential_conflict} potential conflict${c.potential_conflict === 1 ? '' : 's'} to look at first`);
  if (c.requires_investigation) parts.push(`${c.requires_investigation} need${c.requires_investigation === 1 ? 's' : ''} investigation or a permission`);
  if (c.insufficient_data) parts.push(`${c.insufficient_data} can\u2019t be judged because data is missing`);
  if (c.verified) parts.push(`${c.verified} verified on site`);
  // Scoped to one object ("Show findings for"): say so, so the sentence and the status badges below count the same findings
  const objs = scopeName ? `${scopeName} (1 of the ${n} proposed object${n === 1 ? '' : 's'} checked)` : `${n} proposed object${n === 1 ? '' : 's'} checked`;
  return parts.length ? `${objs}: ${parts.join(', ')}.` : `${objs}: nothing was flagged in the available data (which is incomplete \u2014 see what wasn\u2019t checked).`;
}

const m = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}\u00a0m` : null);

/** The one or two numbers that matter for a finding, in words. */
export function keyNumbers(f: Pick<ScreeningFinding, 'category' | 'measurements'>): string[] {
  const x = f.measurements;
  const out: string[] = [];
  if (f.category === 'clearance' || f.category === 'metro') {
    out.push(x.crossing ? 'Crosses in plan' : `Plan distance ${m(x.horizontal_m) ?? 'unknown'}${x.required_horizontal_m ? ` (needs ${m(x.required_horizontal_m)})` : ''}`);
    if (x.vertical_checkable === false) out.push('Vertical: not checkable');
    else if (x.vertical_gap_m !== null && x.vertical_gap_m !== undefined) out.push(`Vertical gap ${m(x.vertical_gap_m)}${x.required_vertical_m ? ` (needs ${m(x.required_vertical_m)})` : ''}`);
    else out.push('Vertical gap unknown');
  } else if (f.category === 'cover') {
    if (m(x.crown_min_m)) out.push(`Cover ${m(x.crown_min_m)}`);
  } else if (f.category === 'buildings') {
    out.push(`${x.buildings_in_zone} building${x.buildings_in_zone === 1 ? '' : 's'} within ${m(x.zone_m)}`);
  } else if (f.category === 'groundwater') {
    if (m(x.shallowest_water_m)) out.push(`Water ${m(x.shallowest_water_m)} below ground`);
    if (m(x.deepest_asset_m)) out.push(`asset to ${m(x.deepest_asset_m)}`);
  }
  return out;
}

/** Coordinate paths ([lon, lat][]) of a GeoJSON geometry, for highlighting. A point becomes a small cross. */
export function pathsOf(g: GeoJsonGeometry | { type: string; coordinates: unknown } | null | undefined): [number, number][][] {
  if (!g) return [];
  const c = g.coordinates as unknown;
  switch (g.type) {
    case 'Point': {
      const [x, y] = c as [number, number];
      const d = 0.00006;
      return [[[x - d, y], [x + d, y]], [[x, y - d], [x, y + d]]];
    }
    case 'LineString': return [c as [number, number][]];
    case 'MultiLineString': case 'Polygon': return c as [number, number][][];
    case 'MultiPolygon': return (c as [number, number][][][]).flat();
    default: return [];
  }
}

export interface LonLatBounds { minLng: number; minLat: number; maxLng: number; maxLat: number }

/** Camera box around the finding's location (± halfM metres), so a long alignment does not zoom the camera out to its whole length. */
export function focusBounds(loc: readonly [number, number], halfM = 60): LonLatBounds {
  const dLat = halfM / 111_320;
  const dLng = halfM / (111_320 * Math.cos((loc[1] * Math.PI) / 180));
  return { minLng: loc[0] - dLng, minLat: loc[1] - dLat, maxLng: loc[0] + dLng, maxLat: loc[1] + dLat };
}

/** What a click on a finding highlights: the proposed object, the other asset (or listed buildings), and where to look. */
export function highlightTargets(f: ScreeningFinding, geometries: ScreeningRun['geometries']): { proposed: [number, number][][]; other: [number, number][][]; bounds: LonLatBounds } {
  const other = f.other ? pathsOf(geometries[f.other.id]) : (f.buildings ?? []).slice(0, 25).flatMap(b => pathsOf(geometries[b.id]));
  return { proposed: pathsOf(geometries[f.proposed.id]), other, bounds: focusBounds(f.location) };
}

/** Whether a Design object changed after the run (then the result is out of date). */
export function isStale(runAt: string, objects: readonly { updatedAt?: string }[]): boolean {
  const t = new Date(runAt).getTime();
  return objects.some(o => o.updatedAt !== undefined && new Date(o.updatedAt).getTime() > t);
}

/** Findings for one proposed object, or all. */
export function forObject(findings: readonly ScreeningFinding[], objectId: string | null): ScreeningFinding[] {
  return objectId ? findings.filter(f => f.proposed.id === objectId) : [...findings];
}

export const RULE_TYPE_LABEL: Record<string, string> = {
  normative: 'Normative', draft_guideline: 'Draft guideline', rule_of_thumb: 'Rule of thumb', international: 'International (comparison)',
  no_norm: 'No Indian norm', user_override: 'User override',
};
export const DIM_LABEL: Record<string, string> = { H: 'Horizontal', V: 'Vertical', '3D': '3D (any direction)' };
