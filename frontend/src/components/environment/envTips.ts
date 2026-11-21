/**
 * Hover tooltips for Environment map overlays (like Underground's, docs/urbanos/UNDERGROUND_VISUAL_FIXES.md): each drawn
 * entity registers what it is, its name, one detail line and how it is known. Pure registry + id parsing (no Cesium),
 * unit-tested in src/engine/testing/EnvPlannerModel.test.ts.
 */
export interface EnvTip {
  /** What it is, e.g. "Tree · PMC census 2019". */
  type: string;
  name: string;
  detail: string;
  /** How it is known: "Measured — …" / "Modelled — …" / "Inferred — …". */
  evidence: string;
  /** Air-quality station id, so a click can open its readings. */
  stationId?: string;
}

const tips = new Map<string, EnvTip>();
export const setTip = (id: string, t: EnvTip) => { tips.set(id, t); };
export const clearTips = (prefix: string) => { for (const k of [...tips.keys()]) if (k.startsWith(prefix)) tips.delete(k); };
export const tipCount = () => tips.size;

/** Layers drawn without registered tips (lazy resolvers, OSM overlays) say here whether they have anything on the map. */
const pickables = new Set<() => boolean>();
export const registerPickable = (fn: () => boolean) => { pickables.add(fn); };
/** False when no Environment overlay is drawn: hover then skips Cesium's pick pass entirely. */
export function anythingToPick(): boolean {
  if (tips.size) return true;
  for (const f of pickables) if (f()) return true;
  return false;
}

/**
 * Lazy tips for big layers (thousands of census trees): instead of one registered tip per object, a resolver builds the
 * tip for an id under its prefix when the pointer is over it. Returns null for an id it does not know.
 */
const resolvers = new Map<string, (id: string) => EnvTip | null>();
export const setTipResolver = (prefix: string, fn: ((id: string) => EnvTip | null) | null) => {
  if (fn) resolvers.set(prefix, fn); else resolvers.delete(prefix);
};

/** Entity id of a Cesium pick result (entity or primitive with an id), else null. */
export function pickedId(p: unknown): string | null {
  const o = p as { id?: unknown } | undefined;
  const id = o?.id as { id?: unknown } | string | undefined;
  const raw = typeof id === 'object' && id !== null ? (id as { id?: unknown }).id : id;
  return typeof raw === 'string' ? raw : null;
}

/**
 * Tooltip for an entity id. Registered tips win; OSM constraint overlay ids (env_overlay_<water|heritage|railway>_…) get a
 * generic tip with the entity's name, so even features drawn before a tip was registered say what they are.
 */
export function tipFor(id: string | null, name?: string | null): EnvTip | null {
  if (!id) return null;
  const t = tips.get(id);
  if (t) return t;
  for (const [prefix, fn] of resolvers) if (id.startsWith(prefix)) { const r = fn(id); if (r) return r; }
  return osmTip(id, name);
}

/** Generic tip of an OSM constraint overlay id (env_overlay_<water|heritage|railway>_…) with the feature's name. */
export function osmTip(id: string, name?: string | null): EnvTip | null {
  const m = /^env_overlay_(water|heritage|railway)_/.exec(id);
  if (!m) return null;
  const kind = { water: 'Water body / waterway', heritage: 'Heritage place', railway: 'Railway' }[m[1] as 'water' | 'heritage' | 'railway'];
  return { type: `${kind} · OpenStreetMap`, name: name || 'Unnamed in OSM', detail: m[1] === 'heritage' ? 'Locator only: not the ASI / PMC heritage list.' : 'Presence is evidence; absence proves nothing.',
    evidence: 'Measured — mapped by OSM volunteers' };
}
