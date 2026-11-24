import React, { useEffect, useRef, useState } from 'react';
import { ScreenSpaceEventHandler, ScreenSpaceEventType, type Cartesian2 } from 'cesium';
import { engineInstance } from '../engine/TwinCityEngine';
import { mapTipsAllowed, tipFromPick, type PickTip } from '../engine/rendering/mapLegend';
import { useShellStore } from '../shell/useShellStore';

/**
 * What a map symbol is, on hover (mouse) or tap (touch), for the symbols the map key lists (docs/urbanos/SIM_FLOW_P12.md
 * §8): study-area markers and stretches, IN/OUT labels, network checks, overlays' markers, gateways, zones, street
 * elements. Underground and Environment keep their own richer tooltips, so this one is off there.
 */

const THROTTLE_MS = 120;
const OWN_TOOLTIPS = new Set(['underground', 'environment']);
/** A drawing or placing tool is active: no tooltips (a click places a point, Esc cancels the drawing). */
const drawing = () => { try { return !mapTipsAllowed(engineInstance.editing?.getMode?.()); } catch { return false; } };

export const MapSymbolTooltip: React.FC = () => {
  const workspace = useShellStore(s => s.workspace);
  const [tip, setTip] = useState<{ t: PickTip; x: number; y: number; sticky: boolean } | null>(null);
  const last = useRef(0);
  const off = OWN_TOOLTIPS.has(workspace);
  useEffect(() => {
    setTip(null);
    if (off) return;
    const v = engineInstance.getViewer?.();
    if (!v || v.isDestroyed()) return;
    const canvas = v.scene.canvas as HTMLCanvasElement;
    const handler = new ScreenSpaceEventHandler(canvas);
    let dragging = false, hideTimer: ReturnType<typeof setTimeout> | null = null;
    const at = (pos: Cartesian2, sticky: boolean) => {
      if (drawing()) { setTip(null); return; }
      let picked: unknown;
      try { picked = v.scene.pick(pos); } catch { picked = undefined; }
      const t = picked ? tipFromPick(picked) : null;
      const r = canvas.getBoundingClientRect();
      setTip(t ? { t, x: r.left + pos.x, y: r.top + pos.y, sticky } : null);
      if (hideTimer) clearTimeout(hideTimer);
      if (t && sticky) hideTimer = setTimeout(() => setTip(null), 4000);
    };
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      if (dragging) return;
      const now = performance.now();
      if (now - last.current < THROTTLE_MS) return;
      last.current = now;
      at(e.endPosition, false);
    }, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((e: { position: Cartesian2 }) => at(e.position, true), ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(() => { dragging = true; setTip(null); }, ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(() => { dragging = false; }, ScreenSpaceEventType.LEFT_UP);
    const leave = () => setTip(null);
    canvas.addEventListener('mouseleave', leave);
    return () => { handler.destroy(); canvas.removeEventListener('mouseleave', leave); if (hideTimer) clearTimeout(hideTimer); };
  }, [off]);
  // Esc closes a tapped (sticky) tooltip only: the study, the drawing and the selection stay. A hover tooltip leaves
  // Esc to the map (cancel a drawing, clear the selection), since it goes as soon as the pointer moves anyway.
  const shown = !!tip && tip.sticky && !off;
  useEffect(() => {
    if (!shown) return;
    // With a drawing tool active the tooltip goes and Esc is left to the drawing (cancel it)
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.defaultPrevented) return; setTip(null); if (!drawing()) e.preventDefault(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown]);
  if (!tip || off || drawing()) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 280);
  const top = Math.min(tip.y + 14, window.innerHeight - 90);
  return (
    <div role="tooltip" data-testid="map-symbol-tooltip" className="uos-map-tip" style={{ left, top }}>
      <p className="font-semibold text-text-1">{tip.t.title}</p>
      <p className="text-text-2">{tip.t.text}</p>
    </div>
  );
};
