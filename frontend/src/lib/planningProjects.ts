/**
 * View-model logic for the Projects & Coordination workspace (docs/urbanos/PROJECTS_AND_COORDINATION_UI.md).
 * Pure functions only (no fetch, no React) so they are unit-tested in isolation.
 *
 * Honesty rules: a depth / height we do not have is `null` (= UNKNOWN), never 0; a proposal's design values are
 * `hypothetical` (design inputs), never `measured`; "no conflict within available data" is not proof of no conflict.
 */
import type { Certainty, ConflictClass, ConflictFinding, ElementInput, ElementKind, ProfilePoint, ProjectIssue, StaleVerdict } from './coordinationApi';
import type { UndergroundAlignmentObject, UtilityObject } from '../engine/objects/types';
import { ALIGNMENT_ELEMENT_KIND, ALIGNMENT_KIND_LABEL, alignmentProfile, chainages, sectionWidthM, worstCertainty } from '../engine/underground/alignmentGeometry';
import { bottomDepthFrom, utilityZ } from '../engine/underground/utilityModel';

// ── Proposal elements from an alternative's change set ───────────────────────────────────────────────────────────

/** One entry of GET /api/scenarios/{sid}/change-set. */
export interface ChangeSetEntry {
  objectId: string;
  op: 'add' | 'modify' | 'delete';
  object?: { id: string; type: string; name: string; coordinates: unknown; properties: Record<string, unknown> };
}

export interface ElementDraft {
  objectId: string;
  op: 'add' | 'modify';
  name: string;
  objectType: string;
  input: Omit<ElementInput, 'created_by'>;
  /** Why z / width are what they are (shown under "Technical details"). */
  basis: string[];
}
export interface SkippedObject { objectId: string; name: string; objectType: string; reason: string }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pos = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 ? n : null; };

/** Object types that are not physical works (demand/control objects) are not registered. */
const NOT_WORKS: Record<string, string> = {
  zone: 'demand zone (not a physical work)',
  gateway: 'traffic gateway (not a physical work)',
  junction: 'junction control edit (no own geometry to coordinate)',
};

/**
 * Maps one proposed object to a proposal element (kind, width, z range relative to ground, up positive).
 * Only values the object actually carries are used; everything else stays null = UNKNOWN.
 */
export function draftFromObject(
  entry: ChangeSetEntry, scenarioId: string, versionId: string | null,
): ElementDraft | SkippedObject {
  const o = entry.object;
  const name = o?.name || entry.objectId;
  const objectType = o?.type ?? 'unknown';
  if (entry.op === 'delete' || !o) {
    return { objectId: entry.objectId, name, objectType, reason: 'removal of an existing object (nothing new is built)' };
  }
  if (NOT_WORKS[objectType]) return { objectId: entry.objectId, name, objectType, reason: NOT_WORKS[objectType] };
  const p = o.properties ?? {};
  const basis: string[] = [];
  let kind: ElementKind = 'other';
  let width: number | null = null;
  let zMin: number | null = null;
  let zMax: number | null = null;
  let certainty: Certainty = 'hypothetical';
  let profile: ProfilePoint[] | null = null;

  switch (objectType) {
    case 'road': {
      kind = 'road';
      width = pos(p.width);
      zMax = 0;
      basis.push('At grade: top 0 m. Pavement / structure depth UNKNOWN.');
      break;
    }
    case 'flyover':
    case 'metro_flyover': {
      kind = 'flyover';
      width = pos(p.width);
      zMin = num(p.elevation);
      basis.push(zMin != null ? `Deck underside ${zMin} m (design elevation). Deck thickness, piers and foundations UNKNOWN.` : 'Deck elevation not recorded: UNKNOWN.');
      if (objectType === 'metro_flyover') basis.push('Double-deck: metro deck above the road deck; the element covers the road deck upward.');
      break;
    }
    case 'metro_line': {
      kind = 'metro_viaduct';
      width = pos(p.deckWidth) ?? pos(p.width);
      zMin = num(p.elevation);
      basis.push(zMin != null ? `Track deck at ${zMin} m (design elevation). Deck depth, piers and foundations UNKNOWN.` : 'Deck elevation not recorded: UNKNOWN.');
      break;
    }
    case 'metro_station': {
      kind = 'metro_station';
      width = pos(p.width);
      const el = num(p.elevation), h = pos(p.height);
      zMin = el;
      zMax = el != null && h != null ? el + h : null;
      basis.push(el != null ? `Platform level ${el} m${h != null ? `, height ${h} m` : ', height UNKNOWN'} (design values).` : 'Platform level not recorded: UNKNOWN.');
      break;
    }
    case 'utility': {
      kind = 'utility';
      const u = utilityDraft(o, scenarioId);
      width = u.width; zMin = u.zMin; zMax = u.zMax; certainty = u.certainty; profile = u.profile;
      basis.push(...u.basis);
      break;
    }
    case 'underground_alignment': {
      const a = alignmentDraft(o, scenarioId);
      kind = a.kind; width = a.width; zMin = a.zMin; zMax = a.zMax; certainty = a.certainty; profile = a.profile;
      basis.push(...a.basis);
      break;
    }
    case 'building': {
      kind = 'building';
      zMax = pos(p.height);
      basis.push(zMax != null ? `Height ${zMax} m (design value). Basement / foundation depth UNKNOWN.` : 'Height not recorded: UNKNOWN. Foundation depth UNKNOWN.');
      break;
    }
    default:
      basis.push(`Object type "${objectType}" has no element mapping; registered as "other" with depth UNKNOWN.`);
  }
  if (width == null) basis.push('Width UNKNOWN: detection uses the centreline and cannot rule out contact.');
  if (entry.op === 'modify') basis.push('Changes an existing object in this alternative; geometry is read from the alternative.');

  const input: Omit<ElementInput, 'created_by'> = {
    kind, name, scenario_id: scenarioId, scenario_version_id: versionId, element_ref: entry.objectId,
    width_m: width, z_min_m: zMin, z_max_m: zMax, z_ref: 'ground', ...(profile ? { profile } : {}),
    provenance: `Registered from alternative ${scenarioId}${versionId ? ` version ${versionId}` : ' (current head)'}; design values from the proposal object`,
    certainty: zMin == null && zMax == null ? 'unknown' : certainty,
  };
  return { objectId: entry.objectId, op: entry.op, name, objectType, input, basis };
}

export function isDraft(x: ElementDraft | SkippedObject): x is ElementDraft { return 'input' in x; }

interface ZDraft { kind: ElementKind; width: number | null; zMin: number | null; zMax: number | null; certainty: Certainty; profile: ProfilePoint[] | null; basis: string[] }
const r2 = (v: number) => Math.round(v * 100) / 100;
const coordsOf = (c: unknown): [number, number, number][] =>
  (Array.isArray(c) ? c : []).filter((x): x is number[] => Array.isArray(x) && typeof x[0] === 'number' && typeof x[1] === 'number')
    .map(x => [x[0], x[1], typeof x[2] === 'number' ? x[2] : 0]);

/**
 * A drawn tunnel / underground alignment as the Underground workspace models it (crown depth per vertex + section): the
 * per-vertex profile (chainage, top = −crown, bottom = −(crown + section height)) and its envelope. A vertex without a crown
 * depth, or an unknown section height, leaves that bound UNKNOWN (null) — never 0.
 */
export function alignmentDraft(o: NonNullable<ChangeSetEntry['object']>, scenarioId: string): ZDraft {
  const a = { ...(o.properties ?? {}), id: o.id, type: 'underground_alignment', name: o.name, scenarioId, coordinates: coordsOf(o.coordinates) } as unknown as UndergroundAlignmentObject;
  if (!a.section) a.section = { shape: 'circular', diameterM: null } as unknown as UndergroundAlignmentObject['section'];
  const kindKey = (a.alignmentKind && a.alignmentKind in ALIGNMENT_ELEMENT_KIND) ? a.alignmentKind : 'bored_tunnel';
  const prof = alignmentProfile({ ...a, alignmentKind: kindKey });
  const profile: ProfilePoint[] = prof.vertices.map(v => ({
    chainage_m: r2(v.chainageM), z_max_m: v.crownDepthM === null ? null : -v.crownDepthM, z_min_m: v.invertDepthM === null ? null : -v.invertDepthM,
  }));
  const allTop = profile.length > 0 && profile.every(q => q.z_max_m !== null);
  const allBot = profile.length > 0 && profile.every(q => q.z_min_m !== null);
  const zMax = allTop ? Math.max(...profile.map(q => q.z_max_m as number)) : null;
  const zMin = allBot ? Math.min(...profile.map(q => q.z_min_m as number)) : null;
  const width = sectionWidthM(a.section);
  const unknown = prof.unknownDepthCount;
  const basis = [
    `${ALIGNMENT_KIND_LABEL[kindKey]} drawn in Underground: crown depth at ${profile.length - unknown} of ${profile.length} points` +
      (unknown ? ` (${unknown} UNKNOWN → top of the element UNKNOWN).` : '.'),
    prof.sectionHeightM === null ? 'Section height UNKNOWN → bottom UNKNOWN.' : `Section height ${prof.sectionHeightM} m → bottom = crown + ${prof.sectionHeightM} m at each point.`,
    'The per-point profile is registered with the element, so the conflict check uses the depth at each segment, not only the envelope.',
  ];
  const certainty = zMin === null && zMax === null ? 'unknown' : worstCertainty([...prof.vertices.map(v => v.certainty), a.sectionCertainty ?? 'unknown']);
  return { kind: ALIGNMENT_ELEMENT_KIND[kindKey] as ElementKind, width, zMin, zMax, certainty, profile: profile.length > 1 ? profile : null, basis };
}

/**
 * A drawn utility with its per-point depths (engine/underground/utilityModel: depth to zRef per vertex, diameter): top of
 * pipe and bottom of pipe at every vertex, so a line that gets deeper is registered with its full depth range — not only the
 * shallowest top (the legacy `depth` summary). A typical-cover default is a hypothetical value and is named as such.
 */
export function utilityDraft(o: NonNullable<ChangeSetEntry['object']>, scenarioId: string): ZDraft {
  const u = { ...(o.properties ?? {}), id: o.id, type: 'utility', name: o.name, scenarioId, coordinates: coordsOf(o.coordinates) } as unknown as UtilityObject;
  const z = utilityZ(u);
  const ch = u.coordinates.length > 1 ? chainages(u.coordinates) : u.coordinates.map(() => 0);
  const profile: ProfilePoint[] = z.depths.map((d, i) => {
    const top = d.topDepthM ?? null;
    const bot = bottomDepthFrom(d.depthM, z.zRef, z.diameterM);
    return { chainage_m: r2(ch[i] ?? 0), z_max_m: top === null ? null : -top, z_min_m: bot === null ? null : -bot };
  });
  const allTop = profile.length > 0 && profile.every(q => q.z_max_m !== null);
  const allBot = profile.length > 0 && profile.every(q => q.z_min_m !== null);
  const zMax = allTop ? Math.max(...profile.map(q => q.z_max_m as number)) : null;
  const zMin = allBot ? Math.min(...profile.map(q => q.z_min_m as number)) : null;
  const known = z.depths.filter(d => d.depthM !== null);
  const defaults = z.depths.filter(d => d.isDefault && d.depthM !== null).length;
  const basis: string[] = [];
  if (!known.length) basis.push(z.migrated && typeof u.depth === 'number' ? `Stored depth ${u.depth} m is only a drawing placeholder: UNKNOWN.` : 'Depth not recorded: UNKNOWN.');
  else {
    basis.push(`Depth to the ${z.zRef === 'top' ? 'top of pipe' : z.zRef === 'centre' ? 'pipe centre' : 'invert'} at ${known.length} of ${z.depths.length} points` +
      (known.length < z.depths.length ? ' (the others UNKNOWN → that bound UNKNOWN).' : '.'));
    basis.push(z.diameterM === null ? 'Diameter UNKNOWN → bottom of pipe UNKNOWN.' : `Diameter ${z.diameterM} m.`);
    if (defaults) basis.push(`${defaults} point(s) use the typical-cover default for the type (hypothetical), not an entered depth.`);
    if (zMax !== null) basis.push(`Envelope: top ${zMax} m` + (zMin !== null ? `, bottom ${zMin} m.` : ', bottom UNKNOWN.'));
  }
  const certs = z.depths.filter(d => d.depthM !== null).map(d => (d.isDefault ? 'hypothetical' : d.certainty === 'unknown' ? 'hypothetical' : d.certainty) as Certainty);
  const certainty: Certainty = zMin === null && zMax === null ? 'unknown' : worstCertainty(certs.length ? certs : ['unknown']);
  return { kind: 'utility', width: z.diameterM, zMin, zMax, certainty, profile: profile.length > 1 && known.length ? profile : null, basis };
}

/** Splits a change set into registrable drafts and skipped objects; objects already registered are skipped. */
export function draftsFromChangeSet(
  changes: readonly ChangeSetEntry[], scenarioId: string, versionId: string | null,
  alreadyRegistered: ReadonlySet<string> = new Set(),
): { drafts: ElementDraft[]; skipped: SkippedObject[] } {
  const drafts: ElementDraft[] = [];
  const skipped: SkippedObject[] = [];
  for (const c of changes) {
    const d = draftFromObject(c, scenarioId, versionId);
    if (isDraft(d) && alreadyRegistered.has(`${scenarioId}:${c.objectId}`)) {
      skipped.push({ objectId: c.objectId, name: d.name, objectType: d.objectType, reason: 'already registered in this project' });
    } else if (isDraft(d)) drafts.push(d);
    else skipped.push(d);
  }
  return { drafts, skipped };
}

/**
 * The drafts the planner left ticked in "Add proposal elements". Every draft starts ticked; an unticked work is not added to
 * the project and stays a drawing of the alternative (the conflict check still compares it as a drawn object of an attached
 * alternative, not as one of this project's elements).
 */
export function chosenDrafts<T extends Pick<ElementDraft, 'objectId'>>(drafts: readonly T[], unticked: ReadonlySet<string>): T[] {
  return drafts.filter(d => !unticked.has(d.objectId));
}

// ── Conflicts ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const CLASS_ORDER: ConflictClass[] = ['conflict', 'potential_conflict', 'vertically_separated', 'unknown_no_coverage', 'no_conflict_within_available_data'];
export const CLASS_SHORT: Record<ConflictClass, string> = {
  conflict: 'Conflict',
  potential_conflict: 'Potential conflict',
  vertically_separated: 'Vertically separated',
  unknown_no_coverage: 'Unknown – no data coverage',
  no_conflict_within_available_data: 'No conflict within available data',
};
/** Classes that need a person's response. */
export const ACTIONABLE: ReadonlySet<ConflictClass> = new Set(['conflict', 'potential_conflict']);

export function groupIssuesByClass(issues: readonly ProjectIssue[]): { cls: ConflictClass; label: string; items: ProjectIssue[] }[] {
  return CLASS_ORDER
    .map(cls => ({ cls, label: CLASS_SHORT[cls], items: issues.filter(i => i.class === cls) }))
    .filter(g => g.items.length > 0);
}

export function openActionableCount(issues: readonly ProjectIssue[]): number {
  return issues.filter(i => ACTIONABLE.has(i.class) && i.status === 'open').length;
}

/** Layer names for layer-level findings (b_type "layer": b_ref is the layer id the backend checked). */
export const LAYER_NAME: Readonly<Record<string, string>> = {
  baseline_road: 'Existing roads (base city)', osm_metro: 'Existing metro (OpenStreetMap)', subsurface_utility: 'Utility records',
  building: 'Building footprints', design_object: 'Objects drawn in Design', project_element: 'Other projects\u2019 elements', geometry: 'Element geometry',
};

/**
 * Side B of a finding in words, without project names (both Underground's conflict check and Projects → Conflicts use it).
 * 'building' is returned by the backend since engine 1.1; kept out of the shared b_type union.
 */
/** A source feature id in words: GeoServer-style "pmc_storm_water_drains.631" → "#631"; other ids are kept as published. */
export function recordRef(id: string): string {
  const m = /^[a-z][a-z0-9_]*\.(\d+)$/i.exec(id.trim());
  return m ? `#${m[1]}` : id;
}

export function sideBLabel(i: Pick<ConflictFinding, 'b_type' | 'b_ref' | 'evidence'>): string {
  switch (i.b_type as string) {
    case 'project_element': return 'Other project element';
    case 'project': return 'Other project';
    case 'baseline_road': return 'Existing road (base city)';
    case 'osm_metro': {
      const b = (i.evidence?.b ?? {}) as { osm_tags?: Record<string, string> };
      const ev = (i.evidence ?? {}) as { osm_pieces?: number };
      const nm = b.osm_tags?.name;
      return `Existing metro (OpenStreetMap)${nm ? `: ${nm}` : ''}${ev.osm_pieces && ev.osm_pieces > 1 ? ` (${ev.osm_pieces} OSM pieces, nearest shown)` : ''}`;
    }
    case 'subsurface_utility': {
      const b = (i.evidence?.b ?? {}) as Record<string, unknown>;
      const t = b.utility_type === 'sewer' ? 'Sewer' : b.utility_type === 'storm_drain' ? 'Storm drain' : 'Utility';
      return b.external_id ? `${t} record ${recordRef(String(b.external_id))}` : `${t} record`;
    }
    case 'building': {
      const b = (i.evidence?.b ?? {}) as Record<string, unknown>;
      return b.source === 'osm' ? 'Existing building (OSM footprint)' : 'Possible building (ML footprint)';
    }
    case 'design_object': {
      const b = (i.evidence?.b ?? {}) as Record<string, unknown>;
      const st = b.status === 'existing' ? 'Existing' : 'Proposed';
      return `${st} object drawn in Design${b.name ? `: ${String(b.name)}` : ''}`;
    }
    case 'layer': return `Layer: ${LAYER_NAME[i.b_ref] ?? i.b_ref.replace(/_/g, ' ')}`;
    default: return i.b_ref;
  }
}

/** Whether b_ref adds anything after sideBLabel (a record / footprint / road id), or only repeats the layer. */
export function sideBRefShown(i: Pick<ConflictFinding, 'b_type'>): boolean {
  return i.b_type !== 'layer' && i.b_type !== 'project';
}

/** A project's name, or a plain statement that it no longer exists (never a bare id). */
export function projectName(id: string, projectNames: Readonly<Record<string, string>>): string {
  return projectNames[id] ?? 'a deleted project';
}

/** The other project's element of a shared finding, by name when the finding recorded it. */
function otherElementName(i: ProjectIssue, thisProject: string): string | null {
  const ev = (i.evidence ?? {}) as { a?: Record<string, unknown>; b?: Record<string, unknown> };
  const side = i.raised_by_project === thisProject ? ev.b : ev.a;
  const nm = side?.name;
  return typeof nm === 'string' && nm.trim() ? nm.trim() : null;
}

/** What the other side of a finding is, in words. */
export function otherSideLabel(i: ProjectIssue, projectNames: Readonly<Record<string, string>>, thisProject: string): string {
  if (i.other_project) {
    const known = i.other_project in projectNames;
    const nm = projectName(i.other_project, projectNames);
    const el = otherElementName(i, thisProject);
    const who = known ? `Project “${nm}”` : 'A deleted project';
    const what = el ? `${who}: ${el}` : who;
    return i.raised_by_project === thisProject ? what : `${what} (raised by them)`;
  }
  return sideBLabel(i);
}

const BLD_SOURCE: Record<string, string> = { osm: 'OpenStreetMap (volunteer-mapped)', google_open_buildings_v3: 'Google Open Buildings v3 (ML)', ms_global_ml_buildings: 'Microsoft ML footprints' };

/** Source and confidence of side B for building / utility-record findings (null for other kinds): never blank, UNKNOWN when missing. */
export function otherSideEvidence(i: Pick<ProjectIssue, 'b_type' | 'evidence'>): string | null {
  const b = (i.evidence?.b ?? {}) as Record<string, unknown>;
  if ((i.b_type as string) === 'building') {
    const src = BLD_SOURCE[String(b.source)] ?? String(b.source ?? 'UNKNOWN');
    const cls = b.data_class === 'observed' ? 'observed' : b.data_class === 'inferred' ? 'inferred' : 'class UNKNOWN';
    const conf = b.confidence == null ? 'confidence UNKNOWN' : `confidence ${String(b.confidence)} (model score 0–1)`;
    const agree = b.osm_agreement === 'ml_only_candidate' ? 'not in OSM' : b.osm_agreement === 'osm' ? 'OSM' : String(b.osm_agreement ?? '');
    const h = b.height_m == null ? 'height UNKNOWN' : `height ${String(b.height_m)} m (OSM tag)`;
    return `Source: ${src} ${String(b.source_id ?? '')} · ${cls} · ${conf} · ${agree} · ${h} · foundation depth UNKNOWN`;
  }
  if (i.b_type === 'subsurface_utility' && (b.quality_level || b.source)) {
    const depth = b.z_max_m == null && b.z_min_m == null ? 'depth UNKNOWN'
      : `z ${b.z_max_m == null ? 'UNKNOWN' : Number(b.z_max_m).toFixed(2)} to ${b.z_min_m == null ? 'UNKNOWN' : Number(b.z_min_m).toFixed(2)} m${b.levels_status ? ` (${String(b.levels_status)})` : ''}`;
    return `Source: ${String(b.source ?? b.owner ?? 'imported record')} · ASCE 38 ${String(b.quality_level ?? 'QL UNKNOWN')} · ${depth}`;
  }
  return null;
}

// ── Staleness ────────────────────────────────────────────────────────────────────────────────────────────────────

export type StaleState = 'stale' | 'current' | 'unknown';
export function staleState(v: Pick<StaleVerdict, 'stale'> | null | undefined): StaleState {
  if (!v || v.stale === null || v.stale === undefined) return 'unknown';
  return v.stale ? 'stale' : 'current';
}

const REASON_TEXT: [RegExp, string][] = [
  [/^project_elements_changed/, 'project elements changed'],
  [/^scenario_version_superseded/, 'a newer alternative version exists'],
  [/^scenario_head_changed/, 'the alternative was edited'],
  [/^other_project_(added|changed)/, 'another project changed'],
  [/^baseline_changed/, 'the base city changed'],
  [/^clearance_rules_changed/, 'clearance rules changed'],
  [/^subsurface_data_changed/, 'subsurface records changed'],
  [/^osm_index_changed/, 'the OSM index changed'],
  [/^engine_version_changed/, 'the detection engine changed'],
  [/^alternatives_attached_changed/, 'an alternative was attached'],
  [/^infra_index_changed/, 'the building / network index changed'],
  [/^newer_scenario_version/, 'a newer alternative version exists'],
  [/^scenario_changed_since/, 'the alternative was edited'],
];
export function staleReasonText(reason: string): string {
  for (const [re, t] of REASON_TEXT) if (re.test(reason)) return t;
  return reason.replace(/_/g, ' ');
}

// ── Project cards ────────────────────────────────────────────────────────────────────────────────────────────────

export interface CardSummary { alternatives: number; elements: number; openConflicts: number; staleAssessments: number; unknownStale: number }

export function cardSummary(args: {
  links: readonly { entity_type: string }[] | undefined;
  elements: number;
  issues: readonly ProjectIssue[];
  stale: { runs: { stale: boolean | null }[]; assessments: { stale: boolean | null }[]; coordination_runs: { stale: boolean | null }[] } | null;
}): CardSummary {
  const all = args.stale ? [...args.stale.runs, ...args.stale.assessments, ...args.stale.coordination_runs.slice(0, 1)] : [];
  return {
    alternatives: (args.links ?? []).filter(l => l.entity_type === 'scenario').length,
    elements: args.elements,
    openConflicts: openActionableCount(args.issues),
    staleAssessments: all.filter(v => v.stale === true).length,
    unknownStale: all.filter(v => v.stale === null).length,
  };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────────────────────────────────────────

/** Bounds of a GeoJSON geometry (lng/lat), or null. */
export function geometryBounds(g: { type: string; coordinates: unknown } | null | undefined): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  if (!g) return null;
  const pts: number[][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') pts.push(c as number[]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  if (!pts.length) return null;
  return {
    minLng: Math.min(...pts.map(p => p[0])), minLat: Math.min(...pts.map(p => p[1])),
    maxLng: Math.max(...pts.map(p => p[0])), maxLat: Math.max(...pts.map(p => p[1])),
  };
}

/** "−6.0 to −5.4 m", "top 0 m · bottom UNKNOWN", "UNKNOWN". */
export function zRangeText(zMin: number | null, zMax: number | null): string {
  const f = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (zMin == null && zMax == null) return 'Depth UNKNOWN';
  if (zMin != null && zMax != null) return `${f(zMin)} to ${f(zMax)} m`;
  return zMin != null ? `bottom ${f(zMin)} m · top UNKNOWN` : `top ${f(zMax as number)} m · bottom UNKNOWN`;
}

// ── Project list (many projects) ────────────────────────────────────────────────────────────────────────────────────

export type ProjectSort = 'newest' | 'name' | 'open_conflicts';
export interface ListableProject { id: string; name: string; status: string; created_by: string; area: string | null; open_conflicts: number | null; created_at: string }

/** Filter by a free-text query (name, study area, creator; case-insensitive) and a status, then sort. Pure. */
export function filterProjects<T extends ListableProject>(ps: readonly T[], query: string, status: string, sort: ProjectSort): T[] {
  const q = query.trim().toLowerCase();
  const out = ps.filter(p => (!status || p.status === status)
    && (!q || p.name.toLowerCase().includes(q) || (p.area ?? '').toLowerCase().includes(q) || p.created_by.toLowerCase().includes(q)));
  const cmp: Record<ProjectSort, (a: T, b: T) => number> = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    name: (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    // not checked (null) sorts after any checked count; ties newest first
    open_conflicts: (a, b) => ((b.open_conflicts ?? -1) - (a.open_conflicts ?? -1)) || b.created_at.localeCompare(a.created_at),
  };
  return [...out].sort(cmp[sort]);
}

/** Open-conflict text for a card: a number only when a check involves the project; never "0" for "not checked". */
export function openConflictText(checked: boolean, open: number | null): string {
  if (!checked || open === null) return 'conflicts: not checked';
  return `${open} open conflict${open === 1 ? '' : 's'}`;
}

// ── Get started ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StartStep { id: 'name' | 'create' | 'attach' | 'elements' | 'check' | 'export'; label: string; done: boolean }

/** The first-use path, ticked from what the project already has (no project = only the first two steps can be done). */
export function startSteps(s: { user: string; project?: { alternatives: number; elements: number; checked: boolean; exported: boolean } | null }): StartStep[] {
  const p = s.project ?? null;
  return [
    { id: 'name', label: 'Enter your name (it is recorded with every change)', done: !!s.user.trim() },
    { id: 'create', label: 'Create a project for one planning activity', done: !!p },
    { id: 'attach', label: 'Attach the alternative you drew in Design', done: !!p && p.alternatives > 0 },
    { id: 'elements', label: 'Add its proposal elements (roads, tunnels, utilities …) to the project', done: !!p && p.elements > 0 },
    { id: 'check', label: 'Run the conflict check against other agencies\u2019 projects and the city data', done: !!p && p.checked },
    { id: 'export', label: 'Export the report or the conflict summary (Reports)', done: !!p && p.exported },
  ];
}

// ── Activity timeline ───────────────────────────────────────────────────────────────────────────────────────────────

/** Plain words for one audit event of the project timeline. */
export function activityText(e: { entity_type: string; action: string; label: string; changed_fields: string[] | null }): string {
  const f = e.changed_fields ?? [];
  if (e.entity_type === 'coordination_conflict' && e.action === 'update') {
    return `Finding response recorded${f.length ? ` (${f.filter(x => x.startsWith('status')).map(x => x.replace('status_', '')).join(', ') || f.join(', ')})` : ''}`;
  }
  if (e.entity_type === 'coordination_conflict' && e.action === 'create') return `Finding recorded by a conflict check — ${e.label.replace(/_/g, ' ')}`;
  if (e.entity_type === 'coordination_run' && e.action === 'create') return 'Conflict check run';
  if (e.entity_type === 'coordination_run' && e.action === 'delete') return `Conflict-check results deleted — ${e.label}`;
  if (e.entity_type === 'project' && e.action === 'update') {
    const parts = [f.includes('status') && 'status', f.includes('preferred_scenario_id') && 'preferred alternative',
      f.includes('name') && 'name', f.includes('description') && 'purpose', f.some(x => x === 'area_id' || x.endsWith('_lon') || x.endsWith('_lat')) && 'study area']
      .filter(Boolean) as string[];
    return `Project ${parts.length ? parts.join(', ') : 'details'} changed`;
  }
  if (e.entity_type === 'project' && e.action === 'delete') return `Project deleted${e.label ? ` — ${e.label}` : ''}`;
  const ENTITY: Record<string, string> = {
    project: 'Project', project_link: 'Attachment', decision: 'Decision', project_report: 'Report', scenario: 'Alternative', scenario_change: 'Alternative edit',
    scenario_version: 'Alternative version', run: 'Simulation run', dataset: 'Traffic dataset', assessment: 'Feasibility screening', review: 'Review',
    document: 'Investigation document', proposal_element: 'Proposal element', subsurface_dataset: 'Subsurface dataset', clearance_rule: 'Clearance rule',
  };
  const ACTION: Record<string, string> = { create: 'added', update: 'changed', delete: 'removed', export: 'exported' };
  const ent = ENTITY[e.entity_type] ?? e.entity_type.replace(/_/g, ' ');
  const act = e.entity_type === 'project' && e.action === 'create' ? 'created' : (ACTION[e.action] ?? e.action);
  return `${ent} ${act}${e.label ? ` — ${e.label}` : ''}${f.length && e.action === 'update' ? ` (${f.join(', ')})` : ''}`;
}
