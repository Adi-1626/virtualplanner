/**
 * Z model of a drawn utility (pipe / cable), the same as an underground alignment's (research §2.1–§2.3, ASCE 75 / 38):
 * per-vertex typed depth + which part of the pipe it is to (zRef), the elevation it gives (m EGM2008) with the ground
 * level and ground model used, and — as separate fields — lifecycle status and evidence (quality level).
 *
 * Conventions
 * - Depth is metres below ground, positive down, to the vertex's zRef: 'top' = crown / top of pipe (default — cover is
 *   specified to the top of the pipe or cable: IS 1255 §6.3.2, PNGRB T4S Table 3, IRC:98-2024 draft §3.3), 'centre',
 *   or 'invert' (bottom of the bore; PMC sewer records publish inverts).
 * - null = UNKNOWN; never 0, never interpolated across.
 * - A depth taken from the typical-cover table below is a DEFAULT (isDefault), shown as "default — adjust", never as
 *   measured. Its certainty is 'hypothetical'.
 * - Legacy fields `depth` / `depthCertainty` are DERIVED here on every write and kept for the screening engine
 *   (backend/coordination/screening.py reads `depth` as the top-of-pipe depth of the whole line and `depthCertainty`
 *   'unknown' as "no depth"): depth = shallowest known top-of-pipe depth, depthCertainty = worst certainty among the
 *   vertices that give it ('unknown' when none does).
 * - Saved utilities without the new fields are migrated on read (`utilityZ`): depthCertainty 'unknown' → depth
 *   UNKNOWN; a legacy depth without certainty → hypothetical in a proposal, unknown on the base city (the same reading
 *   the screening engine already used); zRef → top; status → proposed in an alternative, unknown on the base city;
 *   evidence → user-drawn (every utility object is drawn by hand; imported records are a separate layer).
 */
import type { Certainty } from '../objects/certainty';
import type { UndergroundAlignmentObject, UtilityObject, UtilityType } from '../objects/types';
import { chainages, worstCertainty } from './alignmentGeometry';

export type UtilityZRef = 'top' | 'centre' | 'invert';
/** Lifecycle status (line style). 'unknown' only for utilities saved before status was recorded on the base city. */
export type UtilityStatus = 'existing' | 'proposed' | 'conceptual' | 'abandoned' | 'unknown';
/** How the position is known (ASCE 38 quality level), separate from status. */
export type UtilityEvidence = 'QL-A' | 'QL-B' | 'QL-C' | 'QL-D' | 'user-drawn' | 'unknown';

export interface UtilityVertexDepth {
  /** What the user typed: depth of `zRef` below ground (m, + down). null = UNKNOWN. */
  depthM: number | null;
  certainty: Certainty;
  /** The depth is the typical-cover default for the type, not an entered or measured value. */
  isDefault?: boolean;
  /** Derived: depth of the top of the pipe (m, + down); null when the depth or (for centre/invert) the diameter is unknown. */
  topDepthM?: number | null;
  /** Elevation of `zRef` (m, datum) = ground − depth; null when ground or depth is unknown. */
  elevationM?: number | null;
  datum?: 'EGM2008';
  /** Ground elevation used for the conversion (m, datum). */
  groundM?: number | null;
  /** Ground model + version used, e.g. "Copernicus GLO-30 DSM v3 (dsv_…)". */
  groundModel?: string | null;
}

export const ZREF_LABEL: Record<UtilityZRef, string> = { top: 'Top of pipe (crown)', centre: 'Centre line', invert: 'Invert (bottom of bore)' };
export const STATUS_LABEL: Record<UtilityStatus, string> = {
  proposed: 'Proposed', conceptual: 'Conceptual / illustrative', existing: 'Existing (in service)', abandoned: 'Abandoned in place', unknown: 'Unknown',
};
export const EVIDENCE_LABEL: Record<UtilityEvidence, string> = {
  'QL-A': 'QL-A · surveyed / exposed (test pit)', 'QL-B': 'QL-B · geophysically designated', 'QL-C': 'QL-C · records + surface features',
  'QL-D': 'QL-D · records only', 'user-drawn': 'User-drawn (no quality level)', unknown: 'Unknown',
};

/**
 * Typical minimum cover to the top of the pipe / cable, per type (research §3). Used ONLY as a labelled default for a new
 * line ("default — adjust"); owners' own standards are not checked.
 */
export const TYPICAL_COVER: Record<UtilityType, { coverM: number; source: string }> = {
  water: { coverM: 1.0, source: 'IRC:98-2024 draft §3.3.3 (water trunk 1–6 m, service 0.6–1 m); ≥0.6 m in a road trench §3.3.1' },
  sewage: { coverM: 1.0, source: 'CPHEEO sewerage manual Ch.3: 1.0 m cover at the start of a sanitary sewer (excerpt unverified)' },
  electricity: { coverM: 0.9, source: 'IS 1255 §6.3.2: 0.9 m for 3.3–11 kV (LV 0.75 m, 22–33 kV 1.05 m)' },
  gas: { coverM: 1.0, source: 'PNGRB T4S Table 3 / Sch. 1D: 1.0 m (steel main normal cover, PE service line)' },
  fiber: { coverM: 0.6, source: 'IRC:98-2024 draft §3.3.1/§3.3.3: telecom 0.6–1 m, any service ≥0.6 m in a road trench' },
};

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Depth input: finite and ≥ 0 is kept, anything else is UNKNOWN. */
export const cleanUtilityDepth = (v: number | null | undefined): number | null => (ok(v) && v >= 0 ? v : null);
const diaM = (u: Pick<UtilityObject, 'diameterMm'>): number | null => (ok(u.diameterMm) && u.diameterMm > 0 ? u.diameterMm / 1000 : null);

/** The typical-cover default expressed as a depth to `zRef` (cover to the top + D/2 or D when the diameter is known). */
export function defaultDepthFor(type: UtilityType, zRef: UtilityZRef, diameterM: number | null): number {
  const c = TYPICAL_COVER[type].coverM;
  if (zRef === 'top' || diameterM === null) return c;
  return Math.round((c + (zRef === 'centre' ? diameterM / 2 : diameterM)) * 1000) / 1000;
}

/** Depth to the top of the pipe for a depth to `zRef`; null when it cannot be derived (no depth, or no diameter for centre/invert). */
export function topDepthFrom(depthM: number | null, zRef: UtilityZRef, diameterM: number | null): number | null {
  if (depthM === null) return null;
  if (zRef === 'top') return depthM;
  if (diameterM === null) return null;
  return Math.max(0, Math.round((depthM - (zRef === 'centre' ? diameterM / 2 : diameterM)) * 1000) / 1000);
}
/** Depth to the bottom (invert) of the pipe; null when it cannot be derived. */
export function bottomDepthFrom(depthM: number | null, zRef: UtilityZRef, diameterM: number | null): number | null {
  if (depthM === null) return null;
  if (zRef === 'invert') return depthM;
  if (diameterM === null) return null;
  return Math.round((depthM + (zRef === 'centre' ? diameterM / 2 : diameterM)) * 1000) / 1000;
}

export interface UtilityZ {
  zRef: UtilityZRef;
  status: UtilityStatus;
  evidence: UtilityEvidence;
  depths: UtilityVertexDepth[];
  diameterM: number | null;
  /** True when this object was saved before the Z model (fields derived from `depth` / `depthCertainty`). */
  migrated: boolean;
}

/** The utility's Z model, migrating a legacy object on read (nothing is written). */
export function utilityZ(u: UtilityObject, baseScenarioId = 'base'): UtilityZ {
  const zRef: UtilityZRef = u.zRef ?? 'top';
  const dia = diaM(u);
  const onBase = (u.scenarioId ?? baseScenarioId) === baseScenarioId;
  const status: UtilityStatus = u.status ?? (onBase ? 'unknown' : 'proposed');
  const evidence: UtilityEvidence = u.evidence ?? 'user-drawn';
  let depths: UtilityVertexDepth[];
  const migrated = !Array.isArray(u.depths);
  if (!migrated) {
    depths = u.coordinates.map((_, i) => {
      const d = (u.depths as UtilityVertexDepth[])[i];
      const depthM = d ? cleanUtilityDepth(d.depthM) : null;
      return { ...(d ?? {}), depthM, certainty: depthM === null ? 'unknown' : (d?.certainty ?? 'unknown'), topDepthM: topDepthFrom(depthM, zRef, dia) };
    });
  } else {
    const legacy = u.depthCertainty === 'unknown' ? null : cleanUtilityDepth(u.depth);
    const cert: Certainty = legacy === null ? 'unknown' : (u.depthCertainty ?? (onBase ? 'unknown' : 'hypothetical'));
    depths = u.coordinates.map(() => ({ depthM: legacy, certainty: cert, topDepthM: legacy }));
  }
  return { zRef, status, evidence, depths, diameterM: dia, migrated };
}

/** Legacy summary fields the screening engine and older readers use, derived from the per-vertex depths. */
export function derivedLegacy(depths: readonly UtilityVertexDepth[], fallbackDepth: number): { depth: number; depthCertainty: Certainty } {
  const known = depths.filter(d => ok(d.topDepthM));
  if (!known.length) return { depth: ok(fallbackDepth) && fallbackDepth > 0 ? fallbackDepth : 0, depthCertainty: 'unknown' };
  return {
    depth: Math.min(...known.map(d => d.topDepthM as number)),
    depthCertainty: worstCertainty(known.map(d => d.certainty)),
  };
}

/**
 * Writes the full Z model onto a utility (new object): per-vertex depths with their derived top-of-pipe depth, zRef,
 * status, evidence, and the derived legacy `depth` / `depthCertainty` / valueCertainty.depth.
 */
export function withUtilityZ(u: UtilityObject, z: Partial<Pick<UtilityZ, 'zRef' | 'status' | 'evidence' | 'depths'>> & { diameterMm?: number | null } = {}): UtilityObject {
  const cur = utilityZ(u);
  const zRef = z.zRef ?? cur.zRef;
  const diameterMm = 'diameterMm' in z ? (ok(z.diameterMm) && (z.diameterMm as number) > 0 ? z.diameterMm as number : null) : (u.diameterMm ?? null);
  const dia = diameterMm !== null ? diameterMm / 1000 : null;
  const src = z.depths ?? cur.depths;
  const depths: UtilityVertexDepth[] = u.coordinates.map((_, i) => {
    const d = src[i] ?? { depthM: null, certainty: 'unknown' as Certainty };
    // A default is the typical cover to the TOP of the pipe: re-expressed for the stated reference (needs the diameter
    // for centre / invert; without it the top stays Unknown below)
    const depthM = d.isDefault ? defaultDepthFor(u.utilityType, zRef, dia) : cleanUtilityDepth(d.depthM);
    const next: UtilityVertexDepth = { ...d, depthM, certainty: depthM === null ? 'unknown' : d.certainty, topDepthM: topDepthFrom(depthM, zRef, dia) };
    if (depthM !== d.depthM) { delete next.elevationM; delete next.groundM; delete next.groundModel; delete next.datum; }
    if (depthM === null) delete next.isDefault;
    return next;
  });
  const legacy = derivedLegacy(depths, u.depth);
  return {
    ...u, zRef, status: z.status ?? cur.status, evidence: z.evidence ?? cur.evidence, depths, diameterMm,
    depth: legacy.depth, depthCertainty: legacy.depthCertainty,
    valueCertainty: { ...(u.valueCertainty ?? {}), depth: legacy.depthCertainty },
    updatedAt: new Date().toISOString(),
  };
}

/** New object with vertex `i`'s depth / certainty changed. A typed depth clears the default flag and drops the stale elevation. */
export function withUtilityVertexDepth(u: UtilityObject, i: number, patch: { depthM?: number | null; certainty?: Certainty }): UtilityObject {
  const z = utilityZ(u);
  if (i < 0 || i >= z.depths.length) return u;
  const depths = z.depths.map(d => ({ ...d }));
  const cur = depths[i];
  const depthM = 'depthM' in patch ? cleanUtilityDepth(patch.depthM) : cur.depthM;
  const certainty: Certainty = depthM === null ? 'unknown' : (patch.certainty ?? (cur.certainty === 'unknown' ? 'hypothetical' : cur.certainty));
  if (depthM === cur.depthM) depths[i] = { ...cur, certainty, ...(patch.certainty && patch.certainty !== 'hypothetical' ? { isDefault: false } : {}) };
  else depths[i] = { depthM, certainty };
  return withUtilityZ(u, { depths });
}

/** New object with every vertex at the same depth (typed: not a default). */
export function withAllUtilityDepths(u: UtilityObject, depthM: number | null, certainty: Certainty): UtilityObject {
  const d = cleanUtilityDepth(depthM);
  return withUtilityZ(u, { depths: u.coordinates.map(() => ({ depthM: d, certainty: d === null ? 'unknown' : certainty })) });
}

/** Type change: vertices still on the old type's default take the new type's default (typed depths are kept). */
export function withUtilityType(u: UtilityObject, type: UtilityType): UtilityObject {
  const z = utilityZ(u);
  const depths = z.depths.map(d => (d.isDefault ? { depthM: null, certainty: 'hypothetical' as Certainty, isDefault: true } : d));
  return withUtilityZ({ ...u, utilityType: type }, { depths });
}

/** Depths for a newly drawn line: the typed depth, else the type's typical cover marked as a default. */
export function initialUtilityDepths(n: number, type: UtilityType, typedDepthM: number | null, certainty: Certainty): UtilityVertexDepth[] {
  const typed = cleanUtilityDepth(typedDepthM);
  return Array.from({ length: n }, () => (typed !== null
    ? { depthM: typed, certainty: certainty === 'unknown' ? 'hypothetical' : certainty }
    : { depthM: TYPICAL_COVER[type].coverM, certainty: 'hypothetical' as Certainty, isDefault: true }));
}

/**
 * Stores, per vertex, the elevation of zRef (m EGM2008) = ground − depth with the ground level and model used. Ground null
 * = elevation null (UNKNOWN). Returns the same object when nothing changes (so callers can skip a write).
 */
export function withUtilityGroundReference(u: UtilityObject, groundM: readonly (number | null)[], groundModel: string): UtilityObject {
  if (!Array.isArray(u.depths)) return u;   // legacy objects are not rewritten just by being viewed
  let changed = false;
  const depths = u.coordinates.map((_, i) => {
    const d = (u.depths as UtilityVertexDepth[])[i] ?? { depthM: null, certainty: 'unknown' as Certainty };
    const g = groundM[i] ?? null;
    const elev = ok(d.depthM) && g !== null ? Math.round((g - d.depthM) * 100) / 100 : null;
    const next: UtilityVertexDepth = { ...d, elevationM: elev, datum: 'EGM2008', groundM: g, groundModel: g === null ? null : groundModel };
    if (d.elevationM !== next.elevationM || d.groundM !== next.groundM || (d.groundModel ?? null) !== next.groundModel || d.datum !== 'EGM2008') changed = true;
    return next;
  });
  return changed ? { ...u, depths } : u;
}

/** Top / bottom-of-pipe depth at a chainage along the utility: linear between known vertices, else null. */
export function utilityExtentAt(u: UtilityObject, chainageM: number): { topM: number | null; bottomM: number | null; certainty: Certainty } {
  const z = utilityZ(u);
  const ch = chainages(u.coordinates);
  const at = (k: 'top' | 'bottom') => (i: number) => (k === 'top' ? z.depths[i].topDepthM ?? null : bottomDepthFrom(z.depths[i].depthM, z.zRef, z.diameterM));
  const interp = (f: (i: number) => number | null): { v: number | null; i: number; j: number } => {
    if (ch.length < 2) return { v: f(0), i: 0, j: 0 };
    for (let j = 1; j < ch.length; j++) {
      if (chainageM <= ch[j] + 1e-9 || j === ch.length - 1) {
        const a = f(j - 1), b = f(j);
        const span = ch[j] - ch[j - 1];
        const t = span > 0 ? Math.min(1, Math.max(0, (chainageM - ch[j - 1]) / span)) : 0;
        if (a === null || b === null) return { v: t < 1e-6 ? a : t > 1 - 1e-6 ? b : null, i: j - 1, j };
        return { v: a + t * (b - a), i: j - 1, j };
      }
    }
    return { v: null, i: 0, j: 0 };
  };
  const top = interp(at('top')), bottom = interp(at('bottom'));
  const cert = top.v === null ? 'unknown' : worstCertainty([z.depths[top.i].certainty, z.depths[top.j].certainty]);
  return { topM: top.v, bottomM: bottom.v, certainty: cert };
}

/** Shallowest / deepest top-of-pipe depth and how many vertex depths are defaults or unknown (for lists). */
export function utilitySummary(u: UtilityObject): { minTopM: number | null; maxTopM: number | null; defaults: number; unknown: number; z: UtilityZ } {
  const z = utilityZ(u);
  const tops = z.depths.map(d => d.topDepthM).filter(ok);
  return {
    minTopM: tops.length ? Math.min(...tops) : null, maxTopM: tops.length ? Math.max(...tops) : null,
    defaults: z.depths.filter(d => d.isDefault).length, unknown: z.depths.filter(d => d.depthM === null).length, z,
  };
}

const TYPE_WORD: Record<UtilityType, string> = { water: 'Water pipe', sewage: 'Sewer', electricity: 'Power cable', gas: 'Gas pipe', fiber: 'Telecom duct' };

/**
 * The utility as a read-only alignment-shaped object, so the Profile and Cross-section draw a selected pipe with the same
 * code (and the same DSM ground) as a tunnel: crown = top of pipe, circular section of the diameter. `displayKind`
 * replaces the alignment kind label. Not stored.
 */
export function utilityAsAlignment(u: UtilityObject): UndergroundAlignmentObject & { displayKind: string } {
  const z = utilityZ(u);
  return {
    id: u.id, type: 'underground_alignment', name: u.name || 'Utility', layerId: u.layerId, scenarioId: u.scenarioId,
    coordinates: u.coordinates, alignmentKind: 'utility_trunk',
    section: { shape: 'circular', diameterM: z.diameterM }, sectionCertainty: z.diameterM === null ? 'unknown' : 'hypothetical',
    depths: z.depths.map(d => ({ crownDepthM: d.topDepthM ?? null, certainty: d.topDepthM == null ? 'unknown' : d.certainty })),
    lifecycle: z.status === 'existing' ? 'existing' : z.status === 'conceptual' ? 'conceptual' : 'proposed',
    createdAt: u.createdAt, updatedAt: u.updatedAt,
    displayKind: `${TYPE_WORD[u.utilityType] ?? 'Utility'} (${STATUS_LABEL[z.status].toLowerCase()}) · depth = top of pipe`,
  } as UndergroundAlignmentObject & { displayKind: string };
}

/** Kind label for a profile header: a utility's own label, else the alignment kind. */
export const profileKindLabel = (a: UndergroundAlignmentObject, kindLabels: Record<string, string>): string =>
  (a as { displayKind?: string }).displayKind ?? kindLabels[a.alignmentKind] ?? a.alignmentKind;
