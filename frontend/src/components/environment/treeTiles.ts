/**
 * Tree census tiles (pure, no Cesium): which tiles of GET /api/env-data/trees/tile cover a view, how many single trees a
 * tile may return, a small LRU cache, cluster sizing and the honest "showing N of M" summary.
 *
 * A tile at grid level L is the 4 × 4 block of that level's cells (cell sizes 0.04 / 0.01 / 0.0025 / 0.000625°, the
 * census index's own grid), so a tile is 0.16 / 0.04 / 0.01 / 0.0025° wide. The server decides membership with the
 * index pipeline's cell rule, so the tiles of a level partition the census exactly: every count shown is the server's.
 * Tested in src/engine/testing/EnvTreeTiles.test.ts.
 */
export const CELL_DEG = [0.04, 0.01, 0.0025, 0.000625] as const;
export const TILE_CELLS = 4;
export const tileDeg = (level: number) => CELL_DEG[level] * TILE_CELLS;
/** A view at most this many tiles wide picks that level (so ≤ ~4 × 3 tiles are in view at 16:10). */
export const MAX_TILES_ACROSS = 3;
/** Hard cap on tiles requested for one view (a very wide or very tall view); beyond it a coarser level is used. */
export const MAX_TILES = 24;
/** Single trees per tile at the coarser levels / the finest level / a view narrower than one finest tile. */
export const POINT_CAP = 500;
export const POINT_CAP_FINE = 1500;
export const POINT_CAP_CLOSE = 5000;
export const CACHE_TILES = 120;

export interface TileRef { level: number; tx: number; ty: number; key: string; bbox: [number, number, number, number] }

/** Finest level whose tiles are at least 1 / MAX_TILES_ACROSS of the view width. */
export function levelFor(viewWidthDeg: number): number {
  let lv = 0;
  for (let i = 0; i < CELL_DEG.length; i++) if (viewWidthDeg / tileDeg(i) <= MAX_TILES_ACROSS) lv = i;
  return lv;
}

/** Single trees a tile may return at this view (the server sends clusters above it). */
export function pointCapFor(level: number, viewWidthDeg: number): number {
  if (level < CELL_DEG.length - 1) return POINT_CAP;
  return viewWidthDeg <= tileDeg(level) ? POINT_CAP_CLOSE : POINT_CAP_FINE;
}

/** Tiles covering a view box [w, s, e, n] (already clipped to the layer), finest level first, capped at MAX_TILES. */
export function tilesFor(view: number[]): { level: number; tiles: TileRef[]; cap: number } {
  const w = view[2] - view[0];
  for (let level = levelFor(w); level >= 0; level--) {
    const T = tileDeg(level);
    const x0 = Math.floor(view[0] / T), x1 = Math.floor(view[2] / T), y0 = Math.floor(view[1] / T), y1 = Math.floor(view[3] / T);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES && level > 0) continue;
    const tiles: TileRef[] = [];
    // centre tiles first so the middle of the screen fills in first
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++)
      tiles.push({ level, tx, ty, key: `${level}/${tx}/${ty}`, bbox: [tx * T, ty * T, (tx + 1) * T, (ty + 1) * T] });
    tiles.sort((a, b) => Math.hypot(a.tx - cx, a.ty - cy) - Math.hypot(b.tx - cx, b.ty - cy));
    return { level, tiles, cap: pointCapFor(level, w) };
  }
  return { level: 0, tiles: [], cap: POINT_CAP };
}

export interface TreePoint {
  id: number; lon: number; lat: number; girth_cm: number | null; height_m: number | null; canopy_dia_m: number | null;
  condition: string | null; ownership: string | null; ward: string | null; is_rare: number | null;
  botanical_name: string | null; common_name: string | null; local_name: string | null;
}
export interface TreeCluster { lon: number; lat: number; n: number }
export interface TreeTile {
  level: number; cell_deg: number; tile: [number, number]; bbox: number[]; total: number; total_exact: boolean; limit: number;
  mode: 'points' | 'clusters'; returned: number; points?: TreePoint[]; clusters?: TreeCluster[];
}

/** Least-recently-used map (tile responses): get refreshes, set evicts the oldest beyond `max`. */
export class Lru<V> {
  private m = new Map<string, V>();
  private max: number;
  constructor(max: number) { this.max = max; }
  get(k: string): V | undefined { const v = this.m.get(k); if (v !== undefined) { this.m.delete(k); this.m.set(k, v); } return v; }
  set(k: string, v: V) { this.m.delete(k); this.m.set(k, v); while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string); }
  has(k: string) { return this.m.has(k); }
  get size() { return this.m.size; }
  clear() { this.m.clear(); }
}

/** Cache key of a tile request: the same tile with a different point cap is a different answer. */
export const requestKey = (t: TileRef, cap: number) => `${t.key}@${cap}`;

/** Cluster dot size in px: grows with the log of the count, independent of the other clusters (tiles arrive one by one). */
export function clusterPx(n: number): number {
  return Math.round(Math.min(18, 5 + 2.6 * Math.log10(Math.max(1, n))) * 10) / 10;
}
export const clusterLabel = (n: number) => `${n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n} trees`;
/** Clusters below this count are drawn without a label (the tooltip still gives the count): keeps the map readable. */
export const LABEL_MIN = 300;

export interface TreeSummary { tiles: number; loaded: number; total: number; single: number; clustered: number; clusters: number; exact: boolean }

export function summarize(tiles: (TreeTile | undefined)[]): TreeSummary {
  const s: TreeSummary = { tiles: tiles.length, loaded: 0, total: 0, single: 0, clustered: 0, clusters: 0, exact: true };
  for (const t of tiles) {
    if (!t) continue;
    s.loaded++; s.total += t.total; s.exact &&= t.total_exact;
    if (t.mode === 'points') s.single += t.returned;
    else { s.clustered += t.total; s.clusters += t.clusters?.length ?? 0; }
  }
  return s;
}

/** The layer row's line: exact server counts for the drawn tiles, and what to do to see single trees. */
export function summaryText(s: TreeSummary): string {
  const f = (n: number) => n.toLocaleString();
  if (s.loaded < s.tiles) return `Loading trees: ${s.loaded} of ${s.tiles} map tiles…`;
  const area = 'in the drawn tiles (the view and a little around it)';
  if (!s.total) return `No census trees ${area}.`;
  if (!s.clustered) return `Showing all ${f(s.total)} census trees ${area} as single trees.`;
  if (!s.single) return `${f(s.total)} census trees ${area}, shown as ${f(s.clusters)} clusters with their counts. Zoom in to see single trees.`;
  return `Showing ${f(s.single)} of ${f(s.total)} census trees ${area} as single trees; the other ${f(s.clustered)} are in ` +
    `${f(s.clusters)} clusters with their counts. Zoom in to see them one by one.`;
}
