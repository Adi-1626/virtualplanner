/**
 * PMC tree census on the map, drawn as GPU point batches per tile (not one Cesium Entity per tree).
 *
 * The view is covered by tiles of GET /api/env-data/trees/tile (treeTiles.ts). Each tile is fetched once (LRU cache,
 * request cancelled when the view no longer needs it) and drawn as one PointPrimitiveCollection (+ one LabelCollection
 * for cluster counts). Panning reuses tiles already drawn; leaving the workspace or hiding the layer destroys the GPU
 * batches (the small JSON cache stays, so coming back draws without a network round trip).
 * Tooltips are resolved lazily from the tile data (envTips.setTipResolver), not registered per tree.
 */
import {
  Cartesian3, Color, LabelCollection, LabelStyle, NearFarScalar, PointPrimitiveCollection, PrimitiveCollection, VerticalOrigin, type Viewer,
} from 'cesium';
import { Cancelled, envDataApi } from '../../lib/envDataApi';
import { registerPickable, setTipResolver, type EnvTip } from './envTips';
import {
  CACHE_TILES, clusterLabel, clusterPx, LABEL_MIN, Lru, requestKey, summarize, summaryText, tilesFor, type TileRef, type TreePoint, type TreeTile,
} from './treeTiles';

const TREE_COLOR = Color.fromCssColorString('#2e7d32');
const RARE_COLOR = Color.fromCssColorString('#c0ca33');
const CLUSTER_COLOR = Color.fromCssColorString('#7CFC9A').withAlpha(0.55);
const OUTLINE = Color.BLACK;
const CLUSTER_OUTLINE = Color.BLACK.withAlpha(0.7);
const lift = (lon: number, lat: number) => Cartesian3.fromDegrees(lon, lat, 2);
/** Parallel tile requests (the browser allows ~6 per host; leave room for the other layers). */
const PARALLEL = 4;

const cache = new Lru<TreeTile>(CACHE_TILES);
const inflight = new Map<string, { ctrl: AbortController; p: Promise<TreeTile> }>();
interface Drawn { req: string; tile: TreeTile; points: PointPrimitiveCollection; labels: LabelCollection | null }
const drawn = new Map<string, Drawn>();      // by tile key
let root: PrimitiveCollection | null = null;
let rootViewer: Viewer | null = null;
/** tree id → point, cluster id → cluster, for the tooltips of what is drawn now */
const treeById = new Map<number, TreePoint>();
const clusterById = new Map<string, { n: number; cell: number }>();

const treeTip = (p: TreePoint): EnvTip => ({
  type: `Tree · PMC census 2019${p.is_rare === 1 ? ' · rare' : ''}`, name: p.common_name ?? p.botanical_name ?? 'Species UNKNOWN',
  detail: `${p.botanical_name ?? 'botanical name UNKNOWN'} · girth ${p.girth_cm ?? 'UNKNOWN'} cm · height ${p.height_m ?? 'UNKNOWN'} m · ${p.condition ?? 'condition UNKNOWN'}`,
  evidence: 'Measured — 2019 survey; may have changed since',
});
setTipResolver('env_overlay_tree_', id => { const p = treeById.get(Number(id.slice('env_overlay_tree_'.length))); return p ? treeTip(p) : null; });
setTipResolver('env_overlay_treecl_', id => {
  const c = clusterById.get(id);
  return c ? { type: 'Trees · PMC census 2019', name: `${c.n.toLocaleString()} trees in this ${c.cell}° cell`, detail: 'Zoom in to see single trees with species and girth.',
    evidence: 'Measured — 2019 survey; counts as published' } : null;
});

registerPickable(() => drawn.size > 0);

function ensureRoot(v: Viewer): PrimitiveCollection {
  if (root && rootViewer === v && !root.isDestroyed()) return root;
  root = v.scene.primitives.add(new PrimitiveCollection({ destroyPrimitives: true })) as PrimitiveCollection;
  rootViewer = v;
  return root;
}

function build(r: PrimitiveCollection, t: TileRef, tile: TreeTile, req: string): Drawn {
  const points = new PointPrimitiveCollection();
  let labels: LabelCollection | null = null;
  if (tile.mode === 'points') {
    for (const p of tile.points ?? []) {
      points.add({ id: `env_overlay_tree_${p.id}`, position: lift(p.lon, p.lat), pixelSize: 6, color: p.is_rare === 1 ? RARE_COLOR : TREE_COLOR,
        outlineColor: OUTLINE, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      treeById.set(p.id, p);
    }
  } else {
    (tile.clusters ?? []).forEach((c, i) => {
      const id = `env_overlay_treecl_${t.key.replace(/\//g, '_')}_${i}`;
      clusterById.set(id, { n: c.n, cell: tile.cell_deg });
      const pos = lift(c.lon, c.lat);
      points.add({ id, position: pos, pixelSize: clusterPx(c.n), color: CLUSTER_COLOR, outlineColor: CLUSTER_OUTLINE, outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY });
      if (c.n >= LABEL_MIN) {
        labels ??= new LabelCollection();
        labels.add({ id, position: pos, text: clusterLabel(c.n), font: '11px sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.CENTER, disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: new NearFarScalar(5e4, 1, 2e5, 0) });
      }
    });
  }
  r.add(points);
  if (labels) r.add(labels);
  return { req, tile, points, labels };
}

function unbuild(key: string, d: Drawn) {
  if (d.tile.mode === 'points') for (const p of d.tile.points ?? []) treeById.delete(p.id);
  else (d.tile.clusters ?? []).forEach((_, i) => clusterById.delete(`env_overlay_treecl_${key.replace(/\//g, '_')}_${i}`));
  if (root && !root.isDestroyed()) {
    root.remove(d.points);                     // destroyPrimitives: frees the GPU buffers now
    if (d.labels) root.remove(d.labels);
  }
  drawn.delete(key);
}

function fetchTile(t: TileRef, cap: number): Promise<TreeTile> {
  const req = requestKey(t, cap);
  const hit = cache.get(req);
  if (hit) return Promise.resolve(hit);
  const running = inflight.get(req);
  if (running) return running.p;
  const ctrl = new AbortController();
  const p = envDataApi.treeTile(t.level, t.tx, t.ty, cap, ctrl.signal)
    .then(tile => { cache.set(req, tile); return tile; })
    .finally(() => { if (inflight.get(req)?.ctrl === ctrl) inflight.delete(req); });
  inflight.set(req, { ctrl, p });
  return p;
}

/**
 * Draws the tiles covering `view` ([w,s,e,n], clipped to the census): keeps tiles already drawn, cancels requests the
 * view no longer needs, removes tiles that left it, adds the rest as they arrive. Resolves to the layer's summary line.
 * `alive()` false means a newer draw or a hide superseded this one: nothing is added after that.
 */
export async function drawTreeTiles(v: Viewer, view: number[], alive: () => boolean, onTile?: () => void): Promise<string> {
  const { tiles, cap } = tilesFor(view);
  const want = new Map(tiles.map(t => [t.key, requestKey(t, cap)]));
  const wantReq = new Set(want.values());
  for (const [req, f] of inflight) if (!wantReq.has(req)) { f.ctrl.abort(); inflight.delete(req); }
  for (const [key, d] of [...drawn]) if (want.get(key) !== d.req) unbuild(key, d);
  const r = ensureRoot(v);
  const results: (TreeTile | undefined)[] = tiles.map(t => drawn.get(t.key)?.tile);
  let next = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const i = next++;
      const t = tiles[i];
      if (drawn.has(t.key)) continue;
      const tile = await fetchTile(t, cap);
      if (!alive()) return;
      results[i] = tile;
      if (!drawn.has(t.key)) { drawn.set(t.key, build(r, t, tile, want.get(t.key)!)); onTile?.(); }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, tiles.length) }, worker));
  } catch (e) {
    if (e instanceof Cancelled || !alive()) return '';
    throw e;
  }
  return summaryText(summarize(results));
}

export function setTreeLayerShown(on: boolean) { if (root && !root.isDestroyed()) root.show = on; }

/** Removes every tree batch from the GPU and cancels requests; the JSON tile cache stays for a quick return. */
export function dropTreeLayer() {
  for (const f of inflight.values()) f.ctrl.abort();
  inflight.clear();
  for (const [key, d] of [...drawn]) unbuild(key, d);
  treeById.clear(); clusterById.clear();
  if (root && rootViewer && !rootViewer.isDestroyed() && !root.isDestroyed()) rootViewer.scene.primitives.remove(root);
  root = null; rootViewer = null;
}

/** For the headless QA. */
export function treeLayerCounts() {
  let points = 0, labels = 0;
  for (const d of drawn.values()) { points += d.points.length; labels += d.labels?.length ?? 0; }
  return { tiles: drawn.size, points, labels, cached: cache.size, inflight: inflight.size };
}
