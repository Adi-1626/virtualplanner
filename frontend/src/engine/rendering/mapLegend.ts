/**
 * What the map shows, for the map key (components/MapLegend.tsx, docs/urbanos/SIM_FLOW_P12.md §8). Each renderer that
 * draws symbols on the map publishes a group while its symbols are on show and clears it when they go, so the key lists
 * only what is visible now. Groups hold plain data (no Cesium, no React), so they are testable and drift-checked against
 * the renderers' own colour constants.
 *
 * Pick descriptions: a renderer can also say what a picked map symbol is (hover / tap tooltip, MapSymbolTooltip.tsx).
 */

/** How the symbol looks in the key. */
export type SwatchKind = 'line' | 'dash' | 'glow' | 'dot' | 'ring' | 'square' | 'label' | 'arrow' | 'fill' | 'gradient' | 'outline' | 'marker';
/** 'marker': a dot with its map label beside it (the label shows when zoomed in). */
export interface Swatch {
  kind: SwatchKind;
  color: string;
  /** Second colour (gradient end, outline of a dot). */
  color2?: string;
  /** Text drawn in the swatch for a map label (IN, OUT…). */
  text?: string;
}

/** What kind of value a symbol carries (the honesty labels used across UrbanOS). */
export type Evidence = 'measured' | 'modelled' | 'inferred' | 'assumed' | 'estimated' | 'design';

export interface LegendItem {
  id: string;
  label: string;
  /** One plain sentence: what it is and how to read it (also the tooltip). */
  detail?: string;
  swatch: Swatch;
}

export interface LegendGroup {
  /** Stable id of the source (one group per source; a new set replaces it). */
  id: string;
  title: string;
  items: LegendItem[];
  /** A colour scale read left to right (e.g. load bands), with its unit. */
  scale?: { unit: string; steps: { color: string; label: string }[] };
  evidence?: Evidence;
  note?: string;
  /** Lower comes first. */
  order: number;
}

type Listener = () => void;

export interface PickTip { title: string; text: string }
/** Resolves a picked map object (Cesium's pick result) to a description, or null when it is not this source's symbol. */
export type PickResolver = (picked: unknown) => PickTip | null;

class MapLegendRegistry {
  private groups = new Map<string, LegendGroup>();
  private resolvers = new Map<string, PickResolver>();
  private listeners = new Set<Listener>();
  private version = 0;

  /** Publishes (or with null clears) a source's group. Unchanged content does not notify. */
  set(id: string, group: Omit<LegendGroup, 'id'> | null) {
    const prev = this.groups.get(id);
    if (!group) {
      if (!prev) return;
      this.groups.delete(id);
    } else {
      const next = { ...group, id };
      if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
      this.groups.set(id, next);
    }
    this.version++;
    this.listeners.forEach(l => l());
  }

  get(id: string): LegendGroup | undefined { return this.groups.get(id); }

  /** The groups on show, in order. */
  list(): LegendGroup[] { return [...this.groups.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)); }

  getVersion = () => this.version;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  setResolver(id: string, r: PickResolver | null) { if (r) this.resolvers.set(id, r); else this.resolvers.delete(id); }
  /** The first description a source gives for this pick. */
  describe(picked: unknown): PickTip | null {
    for (const r of this.resolvers.values()) {
      try { const t = r(picked); if (t) return t; } catch { /* a resolver that cannot read this pick is not its source */ }
    }
    return null;
  }

  /** Tests only. */
  _reset() { this.groups.clear(); this.resolvers.clear(); this.version++; this.listeners.forEach(l => l()); }
}

export const mapLegend = new MapLegendRegistry();

/** The tooltip text of an item. */
export const itemTip = (i: LegendItem) => (i.detail ? `${i.label}: ${i.detail}` : i.label);

/** Group order: what the planner is working on first, the base city last. */
export const LEGEND_ORDER = { roundTrip: 5, simOverlay: 10, simDirections: 12, simLive: 15, simStudy: 20, highlight: 25, design: 30, junctions: 35, street: 40, demand: 45, explore: 50, environment: 55, underground: 60, city: 90 } as const;

/**
 * Map-symbol tooltips show only with the Select tool. While a drawing or placing tool is active a click places a
 * point, so a tooltip would sit under the cursor and a tapped one would take Esc away from cancelling the drawing.
 */
export const mapTipsAllowed = (editingMode: string | null | undefined): boolean => !editingMode || editingMode === 'select';

/** The description a picked object carries (a marker's `id.legendTip`, an entity's `properties.legendTip`), else the registered resolvers'. */
export function tipFromPick(picked: unknown): PickTip | null {
  const id = (picked as { id?: unknown } | undefined)?.id as Record<string, unknown> | undefined;
  if (id && typeof id === 'object') {
    const own = (id as { legendTip?: PickTip }).legendTip;
    if (own && typeof own.title === 'string') return own;
    const bag = (id as { properties?: { legendTip?: { getValue?: () => unknown } | PickTip } }).properties?.legendTip;
    const v = bag && typeof (bag as { getValue?: unknown }).getValue === 'function' ? (bag as { getValue: () => unknown }).getValue() : bag;
    if (v && typeof (v as PickTip).title === 'string') return v as PickTip;
  }
  return mapLegend.describe(picked);
}
