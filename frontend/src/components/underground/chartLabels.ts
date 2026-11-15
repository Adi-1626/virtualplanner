/**
 * Text helpers for the Underground Profile and Cross-section charts (docs/urbanos/UNDERGROUND_VISUAL_FIXES.md,
 * "Charts and legend"): the flat-datum ground label (never an error text or a server path) and crossing-label
 * declutter (identical labels grouped with a count, the rest staggered over a few rows, overflow counted).
 */
import type { Loadable } from './useTerrain';

export const FLAT_DATUM = {
  idle: 'Flat datum 0 m (no terrain data) — ground UNKNOWN',
  loading: 'Flat datum 0 m (loading local DEM…)',
  notLoaded: 'Flat datum 0 m (local DEM not loaded) — ground UNKNOWN',
  unreachable: 'Flat datum 0 m (terrain service unreachable) — ground UNKNOWN',
  outside: 'Flat datum 0 m (outside local DEM coverage) — ground UNKNOWN',
} as const;

/**
 * Why the chart falls back to a flat 0 m datum. The error text from /api/terrain is NOT shown: it used to carry the
 * server's data folder (C:\Users\…\derived). Only a fixed, plain reason is.
 */
export function flatDatumLabel(t: Loadable<unknown>): string {
  if (t.state === 'loading') return FLAT_DATUM.loading;
  if (t.state === 'ok') return FLAT_DATUM.outside;
  if (t.state === 'error') return isUnreachable(t.error) ? FLAT_DATUM.unreachable : FLAT_DATUM.notLoaded;
  return FLAT_DATUM.idle;
}

const isUnreachable = (error: string) => /unreachable|failed to fetch|networkerror|load failed|no answer/i.test(error);

/** Plain reason for a failed terrain lookup, for inline text in the editors ("local DEM not loaded"). */
export const terrainErrorReason = (error: string | null | undefined): string => (isUnreachable(error ?? '') ? 'terrain service unreachable' : 'local DEM not loaded');

export interface LabelInput { x: number; text: string }
export interface PlacedLabel {
  x: number; text: string; row: number;
  /** indices into the input that this label stands for (a grouped "Road ×3" has three) */
  members: number[];
}
export interface DeclutterOpts {
  /** labels whose x are closer than this (px) are one cluster: identical texts in it merge into one with a count */
  clusterPx?: number;
  /** rows available above the axis; labels that fit in none are hidden and counted */
  maxRows?: number;
  /** approximate glyph width (px) at the chart's label font size */
  charPx?: number;
  /** text-anchor used when drawing: 'start' (x is the left edge) or 'middle' */
  anchor?: 'start' | 'middle';
  /** horizontal gap kept between two labels in one row (px) */
  padPx?: number;
  /** drawable x range */
  minX?: number; maxX?: number;
}

/** "Road · depth unknown" ×3 → "Road ×3 · depth unknown" (the count sits on the object type). */
export function withCount(text: string, n: number): string {
  if (n <= 1) return text;
  const i = text.indexOf(' · ');
  return i < 0 ? `${text} ×${n}` : `${text.slice(0, i)} ×${n}${text.slice(i)}`;
}

/**
 * Group and stagger crossing labels so none overlap. Returns the labels to draw (with a row: 0 = lowest) and how many
 * input labels could not be shown (their hover titles on the chart still carry them).
 */
export function declutterLabels(items: readonly LabelInput[], opts: DeclutterOpts = {}): { labels: PlacedLabel[]; hidden: number } {
  const { clusterPx = 40, maxRows = 3, charPx = 5, anchor = 'start', padPx = 6, minX = -Infinity, maxX = Infinity } = opts;
  const order = items.map((it, i) => ({ ...it, i })).filter(it => Number.isFinite(it.x)).sort((a, b) => a.x - b.x || a.text.localeCompare(b.text));
  // 1 · clusters of nearby crossings; identical texts in a cluster become one label with a count
  const grouped: { x: number; text: string; members: number[] }[] = [];
  let cluster: typeof order = [];
  const flush = () => {
    const byText = new Map<string, typeof order>();
    for (const it of cluster) byText.set(it.text, [...(byText.get(it.text) ?? []), it]);
    for (const [text, its] of byText) {
      grouped.push({ x: its.reduce((s, it) => s + it.x, 0) / its.length, text: withCount(text, its.length), members: its.map(it => it.i) });
    }
    cluster = [];
  };
  for (const it of order) {
    if (cluster.length && it.x - cluster[cluster.length - 1].x > clusterPx) flush();
    cluster.push(it);
  }
  if (cluster.length) flush();
  grouped.sort((a, b) => a.x - b.x || b.members.length - a.members.length);
  // 2 · rows: lowest row whose last label ends before this one starts
  const rowEnd: number[] = Array.from({ length: Math.max(1, maxRows) }, () => -Infinity);
  const labels: PlacedLabel[] = [];
  let hidden = 0;
  for (const g of grouped) {
    const w = g.text.length * charPx;
    let x = g.x;
    let left = anchor === 'middle' ? x - w / 2 : x;
    // keep inside the plot
    if (left + w > maxX) { left = maxX - w; x = anchor === 'middle' ? left + w / 2 : left; }
    if (left < minX) { left = minX; x = anchor === 'middle' ? left + w / 2 : left; }
    const row = rowEnd.findIndex(end => left >= end + padPx);
    if (row < 0) { hidden += g.members.length; continue; }
    rowEnd[row] = left + w;
    labels.push({ x, text: g.text, row, members: g.members });
  }
  return { labels, hidden };
}
