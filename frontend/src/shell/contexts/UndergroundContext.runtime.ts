import { engineInstance } from '../../engine/TwinCityEngine';
import { isAlignment } from '../../engine/underground/alignmentFactory';
import { undergroundView } from '../../engine/underground/UndergroundView';
import { undergroundRenderer } from '../../engine/underground/UndergroundRenderer';
import { useShellStore } from '../useShellStore';
import { renderManagerInstance } from '../../engine/rendering/RenderManager';
import { depthsOf, sectionHeightM } from '../../engine/underground/alignmentGeometry';
import type { MetroStationObject, UtilityObject } from '../../engine/objects/types';
import { isUnmappedMetroTunnel, unmappedUndergroundStation } from '../../engine/underground/metroLevel';
import { resolveStationHeading } from '../../engine/objects/stationAlignment';

// ---- runtime: underground view while the workspace is open; alignments always drawn -----------------------------
let runtimeStarted = false;
/** Surface buildings under X-ray: faint translucent shells, so buried objects drawn through the ground stay readable. */
export const XRAY_BUILDING_OPACITY = 0.15;
/** Wires the globe view state to the workspace and keeps the 3D alignments in step with the model. Idempotent. */
export function startUndergroundRuntime() {
  if (runtimeStarted || typeof window === 'undefined') return;
  runtimeStarted = true;
  const viewer = () => engineInstance.getViewer?.() ?? null;
  const redraw = () => {
    const v = viewer();
    if (!v) return;
    undergroundRenderer.attach(v);
    const sel = engineInstance.selection.getSelection()[0] ?? null;
    const all = engineInstance.objects.getAll();
    undergroundRenderer.renderAlignments(all.filter(isAlignment), sel);
    // Drawn utilities: always in Underground; in other workspaces only when their utility layer is shown
    const inUg = useShellStore.getState().workspace === 'underground';
    // Existing metro with an unmapped depth: plan-only, labelled, in every workspace while the metro layer is shown
    const metroOn = engineInstance.layers.isVisible('metro');
    const lines = metroOn ? all.filter(isUnmappedMetroTunnel) : [];
    const stations = metroOn ? all.flatMap(o => {
      const u = o.type === 'metro_station' ? unmappedUndergroundStation(o, all) : null;
      return u ? [{ s: o as MetroStationObject, heading: resolveStationHeading(o as MetroStationObject, all).heading, inferred: u.inferred }] : [];
    }) : [];
    undergroundRenderer.renderMetroPlanOnly(lines, stations);
    undergroundRenderer.renderUtilities(all.filter((o): o is UtilityObject => o.type === 'utility' && (inUg || engineInstance.layers.isVisible(o.layerId))), sel);
    syncCutaway();
  };
  const syncView = (ws: string) => { if (ws === 'underground') undergroundView.enter(viewer()); else undergroundView.leave(); };
  // Cutaway pit (local see-through window) and X-ray building fade follow the view settings
  const syncCutaway = () => {
    const v = viewer();
    if (!v) return;
    undergroundRenderer.attach(v);
    const on = undergroundView.isActive();
    const st = undergroundView.getSettings();
    const rect = on && !st.xray && st.groundOpacity < 1 ? undergroundView.effectiveRectangle() : null;
    // floor 10 m below the deepest drawn tunnel invert (at least CUTAWAY_DEPTH_M)
    const deepest = engineInstance.objects.getAll().filter(isAlignment)
      .flatMap(a => depthsOf(a).map(d => (d.crownDepthM ?? 0) + (sectionHeightM(a.section) ?? 0)));
    undergroundRenderer.renderCutaway(rect, Math.max(0, ...deepest) + 10);
    renderManagerInstance.setTypeOpacityCap('building', on && st.xray ? XRAY_BUILDING_OPACITY : null);
  };
  undergroundView.onChange(syncCutaway);
  engineInstance.objects.onChange(redraw);
  engineInstance.scenarios.onChange(redraw);
  engineInstance.selection.onChange(redraw);
  engineInstance.layers.onChange(redraw);
  useShellStore.subscribe((s, prev) => { if (s.workspace !== prev.workspace) { syncView(s.workspace); redraw(); } });
  // The viewer is created after the shell module loads: catch up once it exists
  const wait = window.setInterval(() => {
    if (!viewer()) return;
    window.clearInterval(wait);
    redraw();
    syncView(useShellStore.getState().workspace);
  }, 250);
}

