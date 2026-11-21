import { describe, expect, it } from 'vitest';
import {
  CELL_DEG, clusterLabel, clusterPx, levelFor, Lru, MAX_TILES, MAX_TILES_ACROSS, POINT_CAP, POINT_CAP_CLOSE, POINT_CAP_FINE, pointCapFor, requestKey,
  summarize, summaryText, tileDeg, tilesFor, type TreeTile,
} from '../../components/environment/treeTiles';
import { sameBox, stillness, STILL_MS, wantsOnDemand, ENV_WORKSPACES } from '../../components/environment/envPerf';
import { drawable } from '../../components/environment/staticLines';
import { anythingToPick, clearTips, registerPickable, setTip, setTipResolver, tipFor } from '../../components/environment/envTips';

const tile = (over: Partial<TreeTile>): TreeTile => ({ level: 2, cell_deg: 0.0025, tile: [0, 0], bbox: [0, 0, 0.01, 0.01], total: 0, total_exact: true, limit: 500, mode: 'points', returned: 0, ...over });

describe('tree tiles: level and cap', () => {
  it('tile sizes are 4 cells of the census grid', () => {
    expect(CELL_DEG.map((_, i) => +tileDeg(i).toFixed(6))).toEqual([0.16, 0.04, 0.01, 0.0025]);
  });
  it('the finest level whose tiles are ≥ 1/3 of the view width', () => {
    expect(levelFor(0.33)).toBe(0);      // whole city
    expect(levelFor(0.1)).toBe(1);
    expect(levelFor(0.025)).toBe(2);     // Swargate from 2.5 km
    expect(levelFor(0.0075)).toBe(3);    // ~800 m wide
    expect(levelFor(0.001)).toBe(3);
    expect(levelFor(0.5)).toBe(0);      // wider than the city: coarsest tiles (MAX_TILES still bounds the count)
    for (const w of [0.2, 0.05, 0.02, 0.005, 0.002]) expect(w / tileDeg(levelFor(w))).toBeLessThanOrEqual(MAX_TILES_ACROSS + 1e-9);
  });
  it('single-tree cap per tile: 500, 1,500 at the finest level, 5,000 once the view is narrower than one fine tile', () => {
    expect(pointCapFor(1, 0.1)).toBe(POINT_CAP);
    expect(pointCapFor(3, 0.006)).toBe(POINT_CAP_FINE);
    expect(pointCapFor(3, 0.002)).toBe(POINT_CAP_CLOSE);
    expect(POINT_CAP_CLOSE).toBeLessThanOrEqual(5000);   // server's TILE_MAX_LIMIT
  });
  it('tiles cover the view, are aligned to the grid, and are capped', () => {
    const view = [73.84, 18.49, 73.865, 18.505];
    const { level, tiles, cap } = tilesFor(view);
    expect(level).toBe(2);
    expect(cap).toBe(POINT_CAP);
    const T = tileDeg(level);
    for (const t of tiles) { expect(t.bbox[0]).toBeCloseTo(t.tx * T, 12); expect(t.key).toBe(`${level}/${t.tx}/${t.ty}`); }
    const w = Math.min(...tiles.map(t => t.bbox[0])), e = Math.max(...tiles.map(t => t.bbox[2]));
    const s = Math.min(...tiles.map(t => t.bbox[1])), n = Math.max(...tiles.map(t => t.bbox[3]));
    expect(w).toBeLessThanOrEqual(view[0]); expect(e).toBeGreaterThan(view[2]); expect(s).toBeLessThanOrEqual(view[1]); expect(n).toBeGreaterThan(view[3]);
    expect(new Set(tiles.map(t => t.key)).size).toBe(tiles.length);
    // a very tall narrow view would need too many fine tiles: a coarser level is used instead
    const tall = tilesFor([73.85, 18.40, 73.851, 18.70]);
    expect(tall.tiles.length).toBeLessThanOrEqual(MAX_TILES);
    expect(tall.level).toBeLessThan(levelFor(0.001));
  });
  it('the centre tiles come first', () => {
    const { tiles } = tilesFor([73.80, 18.45, 73.90, 18.55]);
    const cx = (Math.min(...tiles.map(t => t.tx)) + Math.max(...tiles.map(t => t.tx))) / 2;
    expect(Math.abs(tiles[0].tx - cx)).toBeLessThanOrEqual(Math.abs(tiles[tiles.length - 1].tx - cx));
  });
});

describe('tree tiles: summary is the server counts, never an estimate', () => {
  it('all single trees / all clusters / mixed', () => {
    const pts = tile({ total: 120, returned: 120, mode: 'points' });
    const cl = tile({ total: 4_000, mode: 'clusters', clusters: [{ lon: 0, lat: 0, n: 3_000 }, { lon: 0, lat: 0, n: 1_000 }] });
    expect(summaryText(summarize([pts, pts]))).toMatch(/^Showing all 240 census trees/);
    expect(summaryText(summarize([cl]))).toMatch(/^4,000 census trees .* shown as 2 clusters .*Zoom in/);
    const mixed = summarize([pts, cl]);
    expect(mixed).toMatchObject({ total: 4_120, single: 120, clustered: 4_000, clusters: 2, exact: true });
    expect(summaryText(mixed)).toMatch(/^Showing 120 of 4,120 census trees .* the other 4,000 are in 2 clusters/);
    expect(summaryText(summarize([pts, undefined]))).toMatch(/^Loading trees: 1 of 2/);
    expect(summaryText(summarize([tile({})]))).toMatch(/^No census trees/);
  });
  it('the total is the sum of tile totals (no client-side counting)', () => {
    const ts = [tile({ total: 7, returned: 7 }), tile({ total: 500_001, mode: 'clusters', clusters: [{ lon: 0, lat: 0, n: 500_001 }] })];
    expect(summarize(ts).total).toBe(500_008);
  });
});

describe('tree tiles: cache and drawing helpers', () => {
  it('LRU keeps the most recently used', () => {
    const c = new Lru<number>(2);
    c.set('a', 1); c.set('b', 2); expect(c.get('a')).toBe(1); c.set('c', 3);
    expect(c.has('a')).toBe(true); expect(c.has('b')).toBe(false); expect(c.size).toBe(2);
  });
  it('a tile asked with another cap is another request', () => {
    const t = tilesFor([73.84, 18.49, 73.865, 18.505]).tiles[0];
    expect(requestKey(t, 500)).not.toBe(requestKey(t, 1500));
  });
  it('cluster size grows with the count and is bounded', () => {
    expect(clusterPx(1)).toBe(5);
    expect(clusterPx(100)).toBeGreaterThan(clusterPx(10));
    expect(clusterPx(1e7)).toBe(18);
    expect(clusterLabel(950)).toBe('950 trees'); expect(clusterLabel(1250)).toBe('1.3k trees'); expect(clusterLabel(36783)).toBe('37k trees');
  });
});

describe('render on demand and redraw guards', () => {
  it('only in Environment, never while a simulation animates', () => {
    expect(wantsOnDemand('environment', false)).toBe(true);
    expect(wantsOnDemand('environment', true)).toBe(false);
    for (const w of ['design', 'underground', 'simulate', 'explore', 'projects']) expect(wantsOnDemand(w, false)).toBe(false);
    expect([...ENV_WORKSPACES].sort()).toEqual(['environment', 'explore']);
  });
  it('same box within 1 % of its size', () => {
    const a = [73.8, 18.5, 73.9, 18.6];
    expect(sameBox(a, [73.8005, 18.5, 73.9, 18.6])).toBe(true);
    expect(sameBox(a, [73.81, 18.5, 73.91, 18.6])).toBe(false);
    expect(sameBox(a, null)).toBe(false);
  });
});

describe('lazy tooltips', () => {
  it('a resolver answers for its prefix; pick is skipped when nothing is drawn', () => {
    clearTips('');
    let drawn = false;
    registerPickable(() => drawn);
    expect(anythingToPick()).toBe(false);
    drawn = true; expect(anythingToPick()).toBe(true); drawn = false;
    setTipResolver('env_overlay_tree_', id => (id === 'env_overlay_tree_7' ? { type: 'Tree', name: 'Neem', detail: '', evidence: 'Measured' } : null));
    expect(tipFor('env_overlay_tree_7')?.name).toBe('Neem');
    expect(tipFor('env_overlay_tree_8')).toBeNull();
    setTip('env_overlay_aq_1', { type: 'Air', name: 'Karve Rd', detail: '', evidence: 'Measured' });
    expect(anythingToPick()).toBe(true);
    clearTips('env_overlay_aq_');
    setTipResolver('env_overlay_tree_', null);
    expect(tipFor('env_overlay_tree_7')).toBeNull();
  });
});

describe('hover guard: camera stillness from the view matrix (no moveEnd needed)', () => {
  it('is still at start, not still right after a change, still again after STILL_MS without changes', () => {
    const mat = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];
    let m = mat(0);
    let t = 1000;
    const still = stillness(() => m, () => t);
    expect(still()).toBe(true);
    m = mat(5);
    expect(still()).toBe(false);                 // first sample after a move
    t += STILL_MS - 1; expect(still()).toBe(false);
    t += 1; expect(still()).toBe(true);          // no moveEnd event involved
    m = mat(6); t += 1000;
    expect(still()).toBe(false);
  });
});

describe('static lines: which lines can be batched', () => {
  it('needs two positions that are not all the same point', () => {
    const p = (x: number) => ({ x, y: 0, z: 0 });
    expect(drawable([])).toBe(false);
    expect(drawable([p(1)])).toBe(false);
    expect(drawable([p(1), p(1), p(1)])).toBe(false);
    expect(drawable([p(1), p(2)])).toBe(true);
    expect(drawable([p(1), p(1), p(3)])).toBe(true);
  });
});
