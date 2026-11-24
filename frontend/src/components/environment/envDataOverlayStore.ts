/**
 * State of the Environment data overlays (on / loading / shown / error per layer, chosen variant), and which layers are
 * drawn now. Kept free of Cesium so panels, the map key (components/MapLegend.tsx) and unit tests can read it without
 * loading the renderer (envDataOverlay.ts writes it).
 */
import { create } from 'zustand';
import type { EnvDataLayer } from '../../lib/envDataApi';
import { useShellStore } from '../../shell/useShellStore';
import { ENV_WORKSPACES } from './envPerf';

export interface EnvDataOverlayState {
  status: 'off' | 'loading' | 'shown' | 'error';
  variant: string | null;
  bbox: number[] | null;
  bboxFrom: 'camera view' | 'layer bounds' | null;
  message: string | null;
  error: string | null;
}
export const OFF: EnvDataOverlayState = { status: 'off', variant: null, bbox: null, bboxFrom: null, message: null, error: null };

interface Store {
  overlays: Record<string, EnvDataOverlayState>;
  /** Layers switched on (their catalogue rows), whatever their load status. */
  layers: Record<string, EnvDataLayer>;
  set: (id: string, s: Partial<EnvDataOverlayState>) => void;
}
export const useEnvDataOverlayStore = create<Store>(set => ({
  overlays: {},
  layers: {},
  set: (id, s) => set(st => ({ overlays: { ...st.overlays, [id]: { ...(st.overlays[id] ?? OFF), ...s } } })),
}));
export const overlayState = (id: string): EnvDataOverlayState => useEnvDataOverlayStore.getState().overlays[id] ?? OFF;

/** Records a layer as switched on (its row) or off (null). */
export function setDrawnEnvLayer(id: string, layer: EnvDataLayer | null): void {
  useEnvDataOverlayStore.setState(st => {
    if (layer) return st.layers[id] === layer ? st : { layers: { ...st.layers, [id]: layer } };
    if (!(id in st.layers)) return st;
    const { [id]: _gone, ...rest } = st.layers;
    void _gone;
    return { layers: rest };
  });
}

/** The environmental layers drawn now (on, shown, and in a workspace that shows them), for the map key. */
export function drawnEnvLayers(): { layer: EnvDataLayer; variant: string | null }[] {
  if (!ENV_WORKSPACES.has(useShellStore.getState().workspace)) return [];
  return Object.values(useEnvDataOverlayStore.getState().layers)
    .filter(l => overlayState(l.id).status === 'shown')
    .map(l => ({ layer: l, variant: overlayState(l.id).variant }));
}
