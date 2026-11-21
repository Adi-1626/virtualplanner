/**
 * Map overlay for OSM-derived constraint layers (water, heritage, railway) that exist in the backend's feasibility
 * layers but have no engine renderer. Features come from GET /api/feasibility/site-data, the same data feasibility
 * screening reads, for the layers' own coverage box (GET /api/feasibility/status → layers.bbox), or the camera view
 * when no coverage box is reported. Nothing is drawn without data; a failed fetch is reported, never filled in.
 *
 * Object ids are prefixed `env_overlay_` so the engine's pick handler never treats them as city objects.
 * Performance: drawn as GPU batches (one polygon Primitive, one polyline / point / label collection per layer) instead
 * of one Entity per feature, and the three layers share one site-data request per box (it returns all three).
 */
import { create } from 'zustand';
import {
  Cartesian3, Color, ColorGeometryInstanceAttribute, GeometryInstance, LabelCollection, LabelStyle, PerInstanceColorAppearance,
  PointPrimitiveCollection, PolygonGeometry, PolygonHierarchy, Primitive, PrimitiveCollection, VerticalOrigin,
  Math as CesiumMath, type Viewer,
} from 'cesium';
import { engineInstance } from '../../engine/TwinCityEngine';
import { fetchSiteData } from '../../engine/feasibility/feasibilityApi';
import type { OsmElement } from '../../engine/feasibility/types';
import { API_BASE, trackedFetch } from '../../lib/api';
import type { OverlayKey } from './envCatalogue';
import { redactPaths } from '../../lib/redactPaths';
import { boxHolds, requestBox, WIDE_VIEW_DEG } from './envPlanner';
import { osmTip, registerPickable, setTipResolver } from './envTips';
import { ENV_WORKSPACES } from './envPerf';
import { staticLines, type StaticLine } from './staticLines';
import { useShellStore } from '../../shell/useShellStore';

export interface OverlayState {
  status: 'off' | 'loading' | 'shown' | 'error';
  /** Features drawn (as returned by the backend). */
  count: number | null;
  error: string | null;
  /** Box the features were requested for: [minLng, minLat, maxLng, maxLat]. */
  bbox: number[] | null;
  bboxFrom: 'layer coverage' | 'camera view' | null;
}

const OFF: OverlayState = { status: 'off', count: null, error: null, bbox: null, bboxFrom: null };

export const OVERLAY_STYLE: Record<OverlayKey, { label: string; css: string; color: Color }> = {
  water: { label: 'Water bodies & waterways', css: '#4FA3FF', color: Color.fromCssColorString('#4FA3FF') },
  heritage: { label: 'Heritage locators', css: '#E8B04A', color: Color.fromCssColorString('#E8B04A') },
  railway: { label: 'Railways', css: '#C9A0FF', color: Color.fromCssColorString('#C9A0FF') },
};

interface Store {
  overlays: Record<OverlayKey, OverlayState>;
  set: (k: OverlayKey, s: Partial<OverlayState>) => void;
}

export const useEnvOverlayStore = create<Store>(set => ({
  overlays: { water: OFF, heritage: OFF, railway: OFF },
  set: (k, s) => set(st => ({ overlays: { ...st.overlays, [k]: { ...st.overlays[k], ...s } } })),
}));

const sources = new Map<OverlayKey, PrimitiveCollection>();
registerPickable(() => sources.size > 0);
/** Feature names by drawn id, for the hover tooltip. */
const names = new Map<string, string | undefined>();
setTipResolver('env_overlay_', id => (names.has(id) ? osmTip(id, names.get(id)) : null));
const clearNames = (key: OverlayKey) => { for (const k of [...names.keys()]) if (k.startsWith(`env_overlay_${key}_`)) names.delete(k); };
/** One request per box serves water, heritage and railway (the endpoint returns all of them). */
const siteData = new Map<string, Promise<Awaited<ReturnType<typeof fetchSiteData>>>>();
function siteDataFor(bbox: number[]) {
  const k = bbox.map(x => x.toFixed(5)).join(',');
  let p = siteData.get(k);
  if (!p) {
    const [x0, y0] = bbox;
    // near_bbox only bounds the dense layers (buildings, roads, trees) the overlay does not use: keep it tiny.
    p = fetchSiteData(bbox, [x0, y0, x0 + 0.0001, y0 + 0.0001]);
    p.catch(() => siteData.delete(k));
    siteData.set(k, p);
    while (siteData.size > 3) siteData.delete(siteData.keys().next().value as string);
  }
  return p;
}
const requestSeq: Record<string, number> = {};

function viewer(): Viewer | null {
  const v = engineInstance.getViewer() as Viewer | null;
  return v && !v.isDestroyed() ? v : null;
}

let coverage: number[] | null | undefined;
async function coverageBbox(): Promise<number[] | null> {
  if (coverage !== undefined) return coverage;
  try {
    const r = await trackedFetch(`${API_BASE}/api/feasibility/status`);
    if (r.ok) {
      const b = (await r.json())?.layers?.bbox;
      if (Array.isArray(b) && b.length === 4) return (coverage = b);
    }
  } catch { /* unknown: the camera view is used */ }
  return null;
}

function cameraView(): number[] | null {
  const rect = viewer()?.camera.computeViewRectangle();
  return rect ? [rect.west, rect.south, rect.east, rect.north].map(CesiumMath.toDegrees) : null;
}

async function coverageBox(): Promise<{ bbox: number[]; from: OverlayState['bboxFrom'] } | null> {
  return requestBox(cameraView(), await coverageBbox());
}

let removeMove: (() => void) | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
function ensureMoveListener(v: Viewer) {
  if (removeMove) return;
  removeMove = v.camera.moveEnd.addEventListener(() => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!shownHere()) return;
      const st = useEnvOverlayStore.getState().overlays;
      const view = cameraView();
      for (const k of Object.keys(st) as OverlayKey[]) {
        const o = st[k];
        if (o.status !== 'shown' || o.bboxFrom === 'layer coverage' && (view ? view[2] - view[0] > WIDE_VIEW_DEG : true)) continue;
        if (!boxHolds(o.bbox, view)) void setOverlayVisible(k, true);
      }
    }, 500);
  });
}

// City models sit at ellipsoid height (engine/layers/LayerManager: terrain is off by default), so overlays are drawn just
// above it rather than clamped to terrain: clamped ground primitives load asynchronously and did not show in the scene.
const LIFT_M = 1.5;
const ring = (pts: { lon: number; lat: number }[]) => Cartesian3.fromDegreesArrayHeights(pts.flatMap(p => [p.lon, p.lat, LIFT_M]));

function draw(root: PrimitiveCollection, key: OverlayKey, els: OsmElement[]): number {
  const { color } = OVERLAY_STYLE[key];
  const fill = ColorGeometryInstanceAttribute.fromColor(color.withAlpha(0.35));
  const polys: GeometryInstance[] = [];
  const lines: StaticLine[] = [];
  const points = new PointPrimitiveCollection();
  const labels = new LabelCollection();
  const line = (id: string, positions: Cartesian3[], width: number) => { lines.push({ id, positions, width }); };
  let n = 0;
  for (const e of els) {
    const id = `env_overlay_${key}_${e.type}_${e.id}`;
    const name = e.tags?.name ?? e.tags?.['name:en'] ?? undefined;
    if (e.type === 'node' && e.lon !== undefined && e.lat !== undefined) {
      const position = Cartesian3.fromDegrees(e.lon, e.lat, LIFT_M);
      points.add({ id, position, pixelSize: 9, color, outlineColor: Color.BLACK, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      if (name && key === 'heritage') labels.add({ id, position, text: name, font: '12px sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY });
      names.set(id, name);
      n++;
    } else if (e.outer && e.outer.length) {
      e.outer.forEach((o, i) => {
        if (o.length < 3) return;
        polys.push(new GeometryInstance({ id: `${id}_${i}`, geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(ring(o)), height: 0.5 }), attributes: { color: fill } }));
        line(`${id}_${i}_edge`, ring(o), 2);
        names.set(`${id}_${i}`, name); names.set(`${id}_${i}_edge`, name);
      });
      n++;
    } else if (e.geometry && e.geometry.length >= 2) {
      line(id, ring(e.geometry), key === 'railway' ? 2 : 3);
      names.set(id, name);
      n++;
    } else if (e.members?.length) {
      e.members.forEach((m, i) => { if (m.geometry?.length >= 2) { line(`${id}_m${i}`, ring(m.geometry), 2); names.set(`${id}_m${i}`, name); } });
      n++;
    }
  }
  if (polys.length) root.add(new Primitive({ geometryInstances: polys, appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }) }));
  // static lines as one batched Primitive: a PolylineCollection rebuilt its draw commands on every frame (staticLines.ts)
  const linePrim = staticLines(lines, color);
  if (linePrim) root.add(linePrim);
  if (points.length) root.add(points); else points.destroy();
  if (labels.length) root.add(labels); else labels.destroy();
  return n;
}

function remove(key: OverlayKey, v: Viewer | null) {
  const root = sources.get(key);
  if (root && v && !v.isDestroyed()) v.scene.primitives.remove(root);   // destroys the GPU batches
  else if (root && !root.isDestroyed()) root.destroy();
  sources.delete(key);
  clearNames(key);
}

/** Shows or hides one overlay. Showing fetches the features (once per show) and draws them. */
export async function setOverlayVisible(key: OverlayKey, visible: boolean): Promise<void> {
  const st = useEnvOverlayStore.getState();
  const v = viewer();
  if (!visible) {
    requestSeq[key] = (requestSeq[key] ?? 0) + 1;
    remove(key, v);
    st.set(key, OFF);
    v?.scene.requestRender();
    return;
  }
  if (!v) { st.set(key, { status: 'error', error: 'The map is not ready.' }); return; }
  ensureMoveListener(v);
  const seq = (requestSeq[key] = (requestSeq[key] ?? 0) + 1);
  st.set(key, { status: 'loading', error: null, count: null });
  try {
    const cov = await coverageBox();
    if (!cov) throw new Error('The camera view is outside the area these layers cover (Pune OSM extract).');
    const res = await siteDataFor(cov.bbox);
    // a newer request for this layer, or a hide, superseded this one: draw nothing
    if (seq !== requestSeq[key] || useEnvOverlayStore.getState().overlays[key].status !== 'loading' || !shownHere()) return;
    const layerStatus = res.layers[key];
    if (!layerStatus?.available) throw new Error(redactPaths(layerStatus?.reason) ?? 'Layer not available');
    remove(key, v);
    const root = new PrimitiveCollection({ destroyPrimitives: true });
    const n = draw(root, key, res.elements[key] ?? []);
    v.scene.primitives.add(root);
    sources.set(key, root);
    v.scene.requestRender();
    st.set(key, { status: 'shown', count: n, bbox: cov.bbox, bboxFrom: cov.from });
  } catch (e) {
    if (seq !== requestSeq[key]) return;
    st.set(key, { status: 'error', error: redactPaths(e instanceof Error ? e.message : String(e)) });
  }
}

/**
 * The overlays belong to Environment and Explore (the panels that toggle them): outside those workspaces their GPU
 * batches are freed (they used to stay drawn over Design / Underground / Simulate), and drawn again on return from the
 * shared site-data cache. The layers stay "on" in the panels meanwhile.
 */
const shownHere = () => ENV_WORKSPACES.has(useShellStore.getState().workspace);
useShellStore.subscribe((s, prev) => {
  if (s.workspace === prev.workspace || ENV_WORKSPACES.has(s.workspace) === ENV_WORKSPACES.has(prev.workspace)) return;
  const v = viewer();
  const st = useEnvOverlayStore.getState().overlays;
  for (const k of Object.keys(st) as OverlayKey[]) {
    if (st[k].status !== 'shown' && st[k].status !== 'loading') continue;
    if (!shownHere()) { requestSeq[k] = (requestSeq[k] ?? 0) + 1; remove(k, v); }
    else void setOverlayVisible(k, true);
  }
  v?.scene.requestRender();
});
