/**
 * Map overlay for OSM-derived constraint layers (water, heritage, railway) that exist in the backend's feasibility
 * layers but have no engine renderer. Features come from GET /api/feasibility/site-data, the same data feasibility
 * screening reads, for the layers' own coverage box (GET /api/feasibility/status → layers.bbox), or the camera view
 * when no coverage box is reported. Nothing is drawn without data; a failed fetch is reported, never filled in.
 *
 * Entity ids are prefixed `env_overlay_` so the engine's pick handler never treats them as city objects.
 */
import { create } from 'zustand';
import { Cartesian3, Color, CustomDataSource, HeightReference, LabelStyle, PolygonHierarchy, VerticalOrigin, Math as CesiumMath, type Viewer } from 'cesium';
import { engineInstance } from '../../engine/TwinCityEngine';
import { fetchSiteData } from '../../engine/feasibility/feasibilityApi';
import type { OsmElement } from '../../engine/feasibility/types';
import { API_BASE } from '../../lib/api';
import type { OverlayKey } from './envCatalogue';
import { redactPaths } from '../../lib/redactPaths';

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

const sources = new Map<OverlayKey, CustomDataSource>();
const requestSeq: Record<string, number> = {};

function viewer(): Viewer | null {
  const v = engineInstance.getViewer() as Viewer | null;
  return v && !v.isDestroyed() ? v : null;
}

let coverage: number[] | null | undefined;
async function coverageBbox(): Promise<number[] | null> {
  if (coverage !== undefined) return coverage;
  try {
    const r = await fetch(`${API_BASE}/api/feasibility/status`);
    if (r.ok) {
      const b = (await r.json())?.layers?.bbox;
      if (Array.isArray(b) && b.length === 4) return (coverage = b);
    }
  } catch { /* unknown: the camera view is used */ }
  return null;
}

/** Share of the view added on each side, so small pans do not refetch. */
export const VIEW_PAD = 0.5;
/** Views wider than this (degrees) request the whole coverage box: zoomed out, everything is in view anyway. */
const WIDE_VIEW_DEG = 0.35;

/**
 * Box to request: the camera view padded by VIEW_PAD on each side and clipped to the layers' coverage (the old code always
 * asked for the whole coverage box: 3.7 MB and ~1,400 polygons for water, 9 s headless, whatever the view).
 * Pure; unit-tested in EnvPlannerModel.test.ts.
 */
export function requestBox(view: number[] | null, cov: number[] | null): { bbox: number[]; from: OverlayState['bboxFrom'] } | null {
  if (!view) return cov ? { bbox: cov, from: 'layer coverage' } : null;
  const w = view[2] - view[0], h = view[3] - view[1];
  if (cov && w > WIDE_VIEW_DEG) return { bbox: cov, from: 'layer coverage' };
  const p = [view[0] - w * VIEW_PAD, view[1] - h * VIEW_PAD, view[2] + w * VIEW_PAD, view[3] + h * VIEW_PAD];
  if (!cov) return { bbox: p, from: 'camera view' };
  const c = [Math.max(p[0], cov[0]), Math.max(p[1], cov[1]), Math.min(p[2], cov[2]), Math.min(p[3], cov[3])];
  return c[0] < c[2] && c[1] < c[3] ? { bbox: c, from: 'camera view' } : null;
}

/** True when the drawn box still holds the whole view (no refetch needed). */
export function boxHolds(drawn: number[] | null, view: number[] | null): boolean {
  if (!drawn || !view) return false;
  return view[0] >= drawn[0] && view[1] >= drawn[1] && view[2] <= drawn[2] && view[3] <= drawn[3];
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

function draw(ds: CustomDataSource, key: OverlayKey, els: OsmElement[]): number {
  const { color } = OVERLAY_STYLE[key];
  let n = 0;
  for (const e of els) {
    const id = `env_overlay_${key}_${e.type}_${e.id}`;
    const name = e.tags?.name ?? e.tags?.['name:en'] ?? undefined;
    if (e.type === 'node' && e.lon !== undefined && e.lat !== undefined) {
      ds.entities.add({
        id, name,
        position: Cartesian3.fromDegrees(e.lon, e.lat),
        point: { pixelSize: 9, color, outlineColor: Color.BLACK, outlineWidth: 1.5, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: name && key === 'heritage' ? { text: name, font: '12px sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: undefined, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: undefined, scale: 1 } : undefined,
      });
      n++;
    } else if (e.outer && e.outer.length) {
      e.outer.forEach((o, i) => {
        if (o.length < 3) return;
        ds.entities.add({ id: `${id}_${i}`, name, polygon: { hierarchy: new PolygonHierarchy(ring(o)), height: 0.5, material: color.withAlpha(0.35), outline: false } });
        ds.entities.add({ id: `${id}_${i}_edge`, name, polyline: { positions: ring(o), width: 2, material: color, clampToGround: false } });
      });
      n++;
    } else if (e.geometry && e.geometry.length >= 2) {
      ds.entities.add({ id, name, polyline: { positions: ring(e.geometry), width: key === 'railway' ? 2 : 3, material: color, clampToGround: false } });
      n++;
    } else if (e.members?.length) {
      e.members.forEach((m, i) => { if (m.geometry?.length >= 2) ds.entities.add({ id: `${id}_m${i}`, name, polyline: { positions: ring(m.geometry), width: 2, material: color, clampToGround: false } }); });
      n++;
    }
  }
  return n;
}

/** Shows or hides one overlay. Showing fetches the features (once per show) and draws them. */
export async function setOverlayVisible(key: OverlayKey, visible: boolean): Promise<void> {
  const st = useEnvOverlayStore.getState();
  const v = viewer();
  if (!visible) {
    requestSeq[key] = (requestSeq[key] ?? 0) + 1;
    const ds = sources.get(key);
    if (ds && v) v.dataSources.remove(ds, true);
    sources.delete(key);
    st.set(key, OFF);
    return;
  }
  if (!v) { st.set(key, { status: 'error', error: 'The map is not ready.' }); return; }
  ensureMoveListener(v);
  const seq = (requestSeq[key] = (requestSeq[key] ?? 0) + 1);
  st.set(key, { status: 'loading', error: null, count: null });
  try {
    const cov = await coverageBox();
    if (!cov) throw new Error('The camera view is outside the area these layers cover (Pune OSM extract).');
    // near_bbox only bounds the dense layers (buildings, roads, trees) the overlay does not use: keep it tiny.
    const [x0, y0] = cov.bbox;
    const res = await fetchSiteData(cov.bbox, [x0, y0, x0 + 0.0001, y0 + 0.0001]);
    // a newer request for this layer, or a hide, superseded this one: draw nothing
    if (seq !== requestSeq[key] || useEnvOverlayStore.getState().overlays[key].status !== 'loading') return;
    const layerStatus = res.layers[key];
    if (!layerStatus?.available) throw new Error(redactPaths(layerStatus?.reason) ?? 'Layer not available');
    const prev = sources.get(key);
    if (prev) v.dataSources.remove(prev, true);
    const ds = new CustomDataSource(`env-overlay-${key}`);
    const n = draw(ds, key, res.elements[key] ?? []);
    await v.dataSources.add(ds);
    sources.set(key, ds);
    v.scene.requestRender();
    st.set(key, { status: 'shown', count: n, bbox: cov.bbox, bboxFrom: cov.from });
  } catch (e) {
    if (seq !== requestSeq[key]) return;
    st.set(key, { status: 'error', error: redactPaths(e instanceof Error ? e.message : String(e)) });
  }
}
