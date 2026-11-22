/**
 * The base map under the city model, and what happens when its source fails.
 *
 * Fallback chain (switching once per failure, never retrying in a loop):
 *   Cesium ion satellite (only when a token is configured)  →  OpenStreetMap standard tiles  →  no base map (plain ground).
 * With no ion token the chain starts at OpenStreetMap, so no request is ever sent to ion that is bound to fail (HTTP 401).
 *
 * The ground colour (`globe.baseColor`) is what shows under missing or still-loading tiles. It is a neutral earthy
 * grey-beige in Realistic and a muted neutral in Schematic; never Cesium's default navy, which under the ground
 * atmosphere reads as a bright blue sheet (looks like water, or a broken page).
 *
 * Pure logic and a tiny store; no Cesium import, so it is unit-testable. Wiring: `components/Viewport3D.tsx`.
 */
import type { VisualStyle } from '../engine/rendering/visualStyle';
import { baseImageryReason } from './baseImageryErrors';

export type BaseMapSource = 'ion' | 'osm' | 'none' | 'other';
/** Why the current source is not the first choice: no token configured, or the source before it failed. */
export type BaseMapReason = 'no-token' | 'ion-failed' | 'osm-failed' | null;
export interface BaseMapState { source: BaseMapSource; reason: BaseMapReason; otherName?: string }

/** OpenStreetMap standard tiles (https://operations.osmfoundation.org/policies/tiles/): attribution shown, max zoom 19, no bulk prefetch. */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/';
export const OSM_MAX_LEVEL = 19;
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** Failed OSM tiles in a row, with none loaded yet, after which the OSM map counts as unreachable. */
export const OSM_FAILURE_LIMIT = 8;

/** Ground under the imagery, per visual style. */
export const GROUND_COLORS: Record<VisualStyle, string> = { realistic: '#8a8a80', schematic: '#6e7072' };
export const groundColorFor = (style: VisualStyle): string => GROUND_COLORS[style] ?? GROUND_COLORS.realistic;

export function initialBaseMap(hasIonToken: boolean): BaseMapState {
  return hasIonToken ? { source: 'ion', reason: null } : { source: 'osm', reason: 'no-token' };
}

/** The next source after the current one failed. ion → OSM → none; none (and a user-picked other map) → none. */
export function afterFailure(s: BaseMapState): BaseMapState {
  if (s.source === 'ion') return { source: 'osm', reason: 'ion-failed' };
  return { source: 'none', reason: s.source === 'osm' ? 'osm-failed' : s.reason };
}

/** The Base map layer row's text: which source is active, in plain words. */
export function baseMapLabel(s: BaseMapState): string {
  switch (s.source) {
    case 'ion': return 'Satellite (Cesium ion)';
    case 'osm': return s.reason ? 'OpenStreetMap map (fallback: ion unavailable)' : 'OpenStreetMap map';
    case 'other': return s.otherName ? `${s.otherName} map` : 'Other base map';
    default: return 'No base map';
  }
}

/** Toast when a source fails, saying what is shown now. */
export function fallbackMessage(err: unknown, next: BaseMapState): string {
  const why = baseImageryReason(err);
  if (next.source === 'osm') return `Satellite imagery could not be loaded (${why}). Showing the OpenStreetMap map instead.`;
  return `The base map could not be loaded (${why}). The map is shown on plain ground; city data is unaffected.`;
}

/** The lasting note on the map, only while there is no base map at all. */
export function baseMapNotice(s: BaseMapState): string | null {
  return s.source === 'none' && s.reason ? 'No base map: satellite and OpenStreetMap tiles could not be loaded. City data is unaffected.' : null;
}

/**
 * Tile health of a tiled source (OSM): `failure()` returns true exactly once, when `limit` tiles failed and none has
 * loaded yet. After any tile has loaded, single failures are ordinary (one missing tile), never a reason to switch.
 */
export function createTileHealth(limit = OSM_FAILURE_LIMIT) {
  let loaded = false, failed = 0, gaveUp = false;
  return {
    success() { loaded = true; },
    failure(): boolean {
      if (loaded || gaveUp) return false;
      failed += 1;
      if (failed >= limit) { gaveUp = true; return true; }
      return false;
    },
    get gaveUp() { return gaveUp; },
  };
}

interface TileProviderLike {
  requestImage: (...args: never[]) => Promise<unknown> | undefined;
  errorEvent: { addEventListener(fn: (e: { retry?: boolean; error?: unknown }) => void): unknown };
}

/**
 * Hooks a tiled imagery provider (or the promise of one, as ion gives) to a tile health: one loaded tile proves the
 * source works; `limit` failed tiles before any loaded calls `onUnreachable` once. Failed tiles are not retried (no
 * retry storms against the tile server). Tile failures never reach the layer's errorEvent, hence this.
 * Returns the provider (or promise) unchanged for the picker.
 */
export function watchTileHealth<P>(provider: P, onUnreachable: (err: unknown) => void, limit = OSM_FAILURE_LIMIT): P {
  const health = createTileHealth(limit);
  const hook = (p: TileProviderLike) => {
    if (!p || typeof p.requestImage !== 'function' || !p.errorEvent) return;
    const request = p.requestImage.bind(p);
    p.requestImage = ((...args: never[]) => {
      const r = request(...args);
      r?.then(() => health.success(), () => {});
      return r;
    }) as TileProviderLike['requestImage'];
    p.errorEvent.addEventListener(e => {
      e.retry = false;
      if (health.failure()) onUnreachable(e.error ?? {});
    });
  };
  const maybe = provider as unknown as { then?: unknown };
  if (maybe && typeof maybe.then === 'function') (provider as unknown as Promise<TileProviderLike>).then(hook, () => {});
  else hook(provider as unknown as TileProviderLike);
  return provider;
}

// --- store: the active base map, read by the layer row ---------------------------------------------------------------

type Listener = (s: BaseMapState) => void;
let state: BaseMapState = { source: 'none', reason: null };
const listeners = new Set<Listener>();
export const getBaseMapState = (): BaseMapState => state;
export function setBaseMapState(s: BaseMapState): void {
  if (s.source === state.source && s.reason === state.reason && s.otherName === state.otherName) return;
  state = s;
  listeners.forEach(l => l(s));
}
export function onBaseMapState(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

// --- controller: drives the base-layer picker down the chain ---------------------------------------------------------

interface ErrorEventLike { addEventListener(fn: (err: unknown) => void): unknown }
interface LayerLike { errorEvent?: ErrorEventLike; isBaseLayer?: () => boolean }
export interface LayerCollectionLike { length: number; get(i: number): LayerLike; layerAdded: { addEventListener(fn: (layer: LayerLike) => void): () => void } }
export interface PickerLike { selectedImagery: unknown }
interface GlobeLike { showGroundAtmosphere: boolean }

export interface FallbackOptions<M> {
  layers: LayerCollectionLike;
  picker: PickerLike;
  /** The picker models: the ion ones (empty without a token) and the OSM one. */
  ionModels: M[];
  osmModel: M;
  hasIonToken: boolean;
  globe: GlobeLike;
  notify: (message: string) => void;
}

/**
 * Watches the base layer (and each one the picker puts in its place). When it fails, the picker is switched once to the
 * next source; when there is none left the base layer is removed (a failed layer that stays keeps the globe from
 * drawing at all) and ground atmosphere is turned off so the plain ground shows its own colour. `tilesUnreachable()` is
 * called by the OSM provider's tile health (tile failures do not reach the layer's errorEvent). `pickerChanged(model)`
 * keeps the state in step when the user picks another map. Returns the controls and the unsubscribe.
 */
export function installBaseMapFallback<M>(o: FallbackOptions<M>) {
  const atmosphere = o.globe.showGroundAtmosphere;
  let current: LayerLike | null = null;
  let switching = false;
  const sourceOf = (m: unknown): BaseMapState => {
    if (m === undefined || m === null) return { source: 'none', reason: state.source === 'none' ? state.reason : null };
    if (m === o.osmModel) return { source: 'osm', reason: state.source === 'osm' ? state.reason : o.hasIonToken ? null : 'no-token' };
    if ((o.ionModels as unknown[]).includes(m)) return { source: 'ion', reason: null };
    return { source: 'other', reason: null, otherName: (m as { name?: string }).name?.replace(/\u00ad/g, '') };
  };
  const goTo = (next: BaseMapState, err: unknown) => {
    switching = true;
    setBaseMapState(next);
    o.notify(fallbackMessage(err, next));
    o.picker.selectedImagery = next.source === 'osm' ? o.osmModel : undefined;
    o.globe.showGroundAtmosphere = next.source === 'none' ? false : atmosphere;
    switching = false;
  };
  const fail = (err: unknown) => {
    const s = getBaseMapState();
    if (s.source === 'none') return;
    goTo(afterFailure(s), err);
  };
  const watch = (layer: LayerLike) => {
    if (!layer?.errorEvent || layer === current) return;
    current = layer;
    layer.errorEvent.addEventListener(err => { if (current !== layer) return; current = null; fail(err); }); // one failure per layer
  };
  setBaseMapState(sourceOf(o.picker.selectedImagery));
  if (o.layers.length > 0) watch(o.layers.get(0));
  const stop = o.layers.layerAdded.addEventListener(layer => { if (layer?.isBaseLayer?.()) watch(layer); });
  return {
    /** The tiles of the current source never load (the provider itself was created fine). */
    tilesUnreachable(source: 'ion' | 'osm', err: unknown = {}) { if (getBaseMapState().source === source) { current = null; fail(err); } },
    pickerChanged(m: unknown) {
      if (switching) return;
      const s = sourceOf(m);
      setBaseMapState(s);
      o.globe.showGroundAtmosphere = s.source === 'none' ? false : atmosphere;
    },
    dispose() { stop(); current = null; },
  };
}
