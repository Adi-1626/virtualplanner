import React, { useEffect, useRef, useState } from 'react';
import { Cartesian2, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';
import { engineInstance } from '../../engine/TwinCityEngine';
import { undergroundRenderer } from '../../engine/underground/UndergroundRenderer';
import { objectTip, pickObjectId, pickRecordId, recordTip, type HoverTip } from '../../engine/underground/hoverInfo';
import { isUnmappedMetroTunnel, unmappedUndergroundStation } from '../../engine/underground/metroLevel';
import type { CityObject } from '../../engine/objects/types';

/** Minimum time between two picks while the mouse moves (ms), and the move (px) below which no new pick is made. */
export const HOVER_THROTTLE_MS = 120;
const HOVER_MIN_MOVE_PX = 3;

const rawId = (p: unknown): unknown => {
  const o = p as { id?: { id?: unknown } | unknown } | undefined;
  const id = o?.id as { id?: unknown } | string | undefined;
  return typeof id === 'object' && id !== null ? (id as { id?: unknown }).id : id;
};

/** Tooltip for one picked thing, or null when it is not an underground asset. */
function tipOf(p: unknown): HoverTip | null {
  const raw = rawId(p);
  const recId = pickRecordId(raw);
  if (recId) {
    const r = undergroundRenderer.getRecord(recId);
    return r ? recordTip(r, undergroundRenderer.getDatasetName(r.dataset_id)) : null;
  }
  const id = pickObjectId(raw);
  const o = id ? engineInstance.objects.getById(id) : undefined;
  if (!o) return null;
  return objectTip(o, {
    unmappedMetro: (x: CityObject) => (isUnmappedMetroTunnel(x) ? { inferred: false } : unmappedUndergroundStation(x, engineInstance.objects.getAll())),
  });
}

/**
 * Hover tooltips on the Underground map (records, drawn pipes, alignments, metro tunnels and stations): mouse move only,
 * no click. One `scene.pick` per throttled move; a drill pick (4 deep) only when the top object is not an underground
 * asset (a pipe under a building). Nothing is picked while a mouse button is held (camera drag) or a draw tool is on.
 */
export const HoverTooltip: React.FC = () => {
  const [tip, setTip] = useState<{ t: HoverTip; x: number; y: number } | null>(null);
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
    const run = () => {
      pending = null;
      if (!pos || dragging || v.isDestroyed()) return;
      if (engineInstance.editing.getMode() !== 'select') { setTip(null); return; }
      last.current = { x: pos.x, y: pos.y, at: performance.now() };
      let t: HoverTip | null = null;
      try {
        const top = v.scene.pick(pos);
        t = top ? tipOf(top) : null;
        if (!t && top) {
          for (const p of v.scene.drillPick(pos, 4)) { t = tipOf(p); if (t) break; }
        }
      } catch { t = null; }
      const r = canvas.getBoundingClientRect();
      setTip(t ? { t, x: r.left + pos.x, y: r.top + pos.y } : null);
    };
    handler.setInputAction((m: { endPosition: Cartesian2 }) => {
      if (dragging) return;
      pos = Cartesian2.clone(m.endPosition);
      const L = last.current;
      if (Math.hypot(pos.x - L.x, pos.y - L.y) < HOVER_MIN_MOVE_PX) return;
      if (pending !== null) return;
      pending = window.setTimeout(run, Math.max(0, HOVER_THROTTLE_MS - (performance.now() - L.at)));
    }, ScreenSpaceEventType.MOUSE_MOVE);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      handler.destroy();
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
    };
  }, []);
  if (!tip) return null;
  const left = Math.min(tip.x + 14, window.innerWidth - 300);
  const top = Math.min(tip.y + 14, window.innerHeight - 110);
  return (
    <div role="tooltip" data-testid="ug-hover-tip" className="pointer-events-none fixed z-50 max-w-[288px] rounded-md border border-border bg-surface-2/95 px-2.5 py-1.5 text-meta text-text-1 shadow-lg"
      style={{ left, top }}>
      <div className="text-text-2" data-testid="ug-hover-type">{tip.t.type}</div>
      <div className="font-semibold" data-testid="ug-hover-name">{tip.t.name}</div>
      <div className="tabular-nums" data-testid="ug-hover-depth">{tip.t.depth}</div>
      <div className="text-text-3" data-testid="ug-hover-status">{tip.t.status}</div>
    </div>
  );
};
