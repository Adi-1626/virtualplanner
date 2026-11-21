/**
 * Hover tooltips on Environment overlays (trees, tree clusters, air stations, flow paths, OSM water / heritage / railway,
 * the screening footprint), like Underground's: mouse move only, throttled, one `scene.pick` (a drill pick of 6 when the
 * top object is not an Environment overlay). Clicking an air-quality station opens its readings under Records.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Cartesian2, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import { engineInstance } from '../../engine/TwinCityEngine';
import { anythingToPick, pickedId, tipFor, type EnvTip } from './envTips';
import { useEnvFocus } from './envFocus';

const THROTTLE_MS = 120;
const DRILL = 4;

function tipAt(v: { scene: { pick: (p: Cartesian2) => unknown; drillPick: (p: Cartesian2, n: number) => unknown[] } }, pos: Cartesian2): EnvTip | null {
  const one = (p: unknown) => { const id = pickedId(p); return id ? tipFor(id, (p as { id?: { name?: string } }).id?.name ?? null) : null; };
  const top = v.scene.pick(pos);
  let t = top ? one(top) : null;
  // an overlay under a building or a road: look a few objects deeper (each extra level is another pick pass)
  if (!t && top) for (const p of v.scene.drillPick(pos, DRILL)) { t = one(p); if (t) break; }
  return t;
}

export const EnvHoverTooltip: React.FC = () => {
  const [tip, setTip] = useState<{ t: EnvTip; x: number; y: number; right: number; bottom: number } | null>(null);
  const last = useRef({ x: -99, y: -99, at: 0 });
  useEffect(() => {
    const v = engineInstance.getViewer?.();
    if (!v) return;
    const canvas = v.scene.canvas as HTMLCanvasElement;
    const handler = new ScreenSpaceEventHandler(canvas);
    let pending: number | null = null;
    let pos: Cartesian2 | null = null;
    let dragging = false;
    const down = () => { dragging = true; setTip(null); };
    const up = () => { dragging = false; };
    const leave = () => { pos = null; setTip(null); };
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', leave);
    // no pick passes while the camera moves (a pick re-renders the scene): only once it has stopped
    let moving = false;
    const offCam = v.camera.changed.addEventListener(() => setTip(null));
    const offStart = v.camera.moveStart.addEventListener(() => { moving = true; setTip(null); });
    const offEnd = v.camera.moveEnd.addEventListener(() => { moving = false; });
    const run = () => {
      pending = null;
      if (!pos || dragging || moving || v.isDestroyed()) return;
      if (!anythingToPick()) { setTip(null); return; }
      if (engineInstance.editing.getMode() !== 'select') { setTip(null); return; }
      last.current = { x: pos.x, y: pos.y, at: performance.now() };
      const t0 = performance.now();
      let t: EnvTip | null = null;
      try { t = tipAt(v, pos); } catch { t = null; }
      const st = ((window as unknown as { __envHoverMs?: number[] }).__envHoverMs ??= []);
      st.push(Math.round(performance.now() - t0)); if (st.length > 50) st.shift();
      const r = canvas.getBoundingClientRect();
      setTip(t ? { t, x: r.left + pos.x, y: r.top + pos.y, right: r.right, bottom: r.bottom } : null);
    };
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      if (dragging) return;
      pos = Cartesian2.clone(m.endPosition);
      const L = last.current;
      if (Math.hypot(pos.x - L.x, pos.y - L.y) < 3 || pending !== null) return;
      pending = window.setTimeout(run, Math.max(0, THROTTLE_MS - (performance.now() - L.at)));
    }, ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((c: { position: Cartesian2 }) => {
      if (engineInstance.editing.getMode() !== 'select' || !anythingToPick()) return;
      let t: EnvTip | null = null;
      try { t = tipAt(v, c.position); } catch { t = null; }
      if (t?.stationId) useEnvFocus.getState().focusStation(t.stationId);
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      handler.destroy();
      offCam(); offStart(); offEnd();
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, []);
  if (!tip) return null;
  // keep the tooltip over the map: side panels sit above it, so flip it left / up near the canvas edges
  const left = tip.x + 14 + 290 > tip.right ? Math.max(0, tip.x - 14 - 290) : tip.x + 14;
  const top = tip.y + 14 + 110 > tip.bottom ? Math.max(0, tip.y - 14 - 110) : tip.y + 14;
  return (
    <div role="tooltip" data-testid="env-hover-tip" className="pointer-events-none fixed z-50 max-w-[288px] rounded-md border border-border bg-surface-2/95 px-2.5 py-1.5 text-meta text-text-1 shadow-lg"
      style={{ left, top }}>
      <div className="text-text-2" data-testid="env-hover-type">{tip.t.type}</div>
      <div className="font-semibold" data-testid="env-hover-name">{tip.t.name}</div>
      <div data-testid="env-hover-detail">{tip.t.detail}</div>
      <div className="text-text-3" data-testid="env-hover-evidence">{tip.t.evidence}</div>
    </div>
  );
};
