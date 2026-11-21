import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { DrawReadoutData } from '../../engine/editing/drawConstraints';

/**
 * Live readout while a line is drawn (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §4.1): segment length, bearing, turn at the
 * last point, its radius (auto / typed / sharp, reduced to fit), the typed value being entered, and the screening flags
 * for that curve from checkAlignment. Every flag is screening only — never a design check or approval.
 */
const fmtM = (m: number | null) => (m === null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const fmtDeg = (d: number | null) => (d === null ? '—' : `${Math.round(d)}°`);

const CONSTRAINT_LABEL: Record<DrawReadoutData['constraint'], string | null> = {
  none: null, network: 'snapped to road', 'angle-absolute': '15° snap', 'angle-relative': '15° from last segment', typed: 'typed', guide: 'continues the road',
};

export const DrawReadout: React.FC = () => {
  const [data, setData] = useState<DrawReadoutData | null>(null);

  useEffect(() => {
    const { editing } = engineInstance;
    let frame: number | null = null;
    const refresh = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setData(editing.isAlignableDrawing() ? editing.getDrawReadout() : null);
      });
    };
    const offReadout = editing.onReadoutChange(refresh);
    const offChange = editing.onChange(refresh);
    refresh();
    return () => {
      offReadout();
      offChange?.();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  if (!data) return null;
  const t = data.typed;
  const typing = t.text !== '' || t.field !== 'length' || t.lengthM !== null || t.bearingDeg !== null;
  const turn = data.deflectionDeg === null ? null : `${Math.abs(Math.round(data.deflectionDeg))}° ${data.deflectionDeg >= 0 ? 'left' : 'right'}`;
  let radius: string | null = null;
  if (data.deflectionDeg !== null && Math.abs(data.deflectionDeg) >= 0.5) {
    if (data.radiusSource === 'sharp') radius = data.behaviour === 'angled' ? 'bend (no curve)' : 'sharp corner';
    else if (data.radiusM !== null) radius = `R ${data.radiusSource === 'auto' ? '↺ ' : ''}${fmtM(data.radiusM)}${data.clamped ? ` (asked ${fmtM(data.requestedRadiusM)}, reduced to fit)` : ''}`;
  }
  const warn = data.flags.filter(f => f.severity === 'warn');
  const info = data.flags.filter(f => f.severity === 'info' && f.code !== 'transition-not-modelled');
  const constraint = CONSTRAINT_LABEL[data.constraint];

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="draw-readout"
      className="fixed left-1/2 -translate-x-1/2 top-16 z-[9000] pointer-events-none max-w-[min(640px,92vw)] rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2 text-[12px] text-slate-100 shadow-xl"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
        <span title="Length of the current segment">{fmtM(data.lengthM)}</span>
        <span title="Direction, clockwise from north">{fmtDeg(data.bearingDeg)}</span>
        {turn && <span title="Turn at the last point">Δ {turn}</span>}
        {radius && <span title="Curve radius at the last point (↺ = automatic for the design speed)">{radius}</span>}
        <span className="text-slate-400" title="Total length so far">Σ {fmtM(data.totalLengthM)}</span>
        {constraint && <span className="text-cyan-300 font-sans">{constraint}</span>}
      </div>
      {typing && (
        <div className="mt-1 font-mono text-amber-200" data-testid="draw-readout-typed">
          {t.field === 'radius' ? 'Radius' : t.field === 'bearing' ? 'Direction' : 'Length'}: {t.text || '…'}{t.field === 'bearing' ? '°' : ' m'}
          <span className="ml-2 font-sans text-slate-400">Enter applies · Tab switches · Esc clears</span>
        </div>
      )}
      {warn.map((f, i) => (
        <div key={`w${i}`} className="mt-1 text-amber-300" data-testid="draw-readout-flag">⚠ {f.message}</div>
      ))}
      {warn.length === 0 && info.map((f, i) => (
        <div key={`i${i}`} className="mt-1 text-slate-400">{f.message}</div>
      ))}
      <div className="mt-1 text-[11px] text-slate-500 font-sans">
        Shift 15° · Alt+Shift 15° from last · type a length · R radius · Ctrl+click sharp corner · Backspace undo point · Enter / double-click finish
      </div>
    </div>,
    document.body,
  );
};

export default DrawReadout;
