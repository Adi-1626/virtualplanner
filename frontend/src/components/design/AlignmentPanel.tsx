import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Spline, Lock, AlertTriangle } from 'lucide-react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { PIRow } from '../../engine/editing/AlignmentEditor';

/**
 * Inspector section "Alignment" for the selected line object (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §4.2): one row per
 * point with chainage, turn, radius (editable, exact value), tangent and arc length; design speed and superelevation cap;
 * the screening flags from checkAlignment. Every change is one undo step. Also renders the right-click menu of a PI grip.
 * Flags are SCREENING only, never a design check or approval.
 */
const m = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)} m`);
const chain = (v: number) => (v >= 1000 ? `${Math.floor(v / 1000)}+${(v % 1000).toFixed(0).padStart(3, '0')}` : `0+${v.toFixed(0).padStart(3, '0')}`);
const turn = (deg: number) => (Math.abs(deg) < 0.05 ? '0°' : `${Math.abs(deg).toFixed(1)}° ${deg > 0 ? 'L' : 'R'}`);

const subscribe = (cb: () => void) => engineInstance.alignmentEditor.onChange(cb);
const snapshot = () => engineInstance.alignmentEditor.getSnapshot();

const RadiusCell: React.FC<{ row: PIRow; angled: boolean }> = ({ row, angled }) => {
  const [text, setText] = useState(row.requestedRadiusM ? String(row.requestedRadiusM) : '');
  useEffect(() => setText(row.requestedRadiusM ? String(row.requestedRadiusM) : ''), [row.requestedRadiusM]);
  if (row.isEnd) return <span className="text-slate-500">end</span>;
  if (angled) return <span className="text-slate-400">bend</span>;
  const commit = () => {
    const t = text.trim();
    const v = t === '' ? 0 : Number(t);
    if (!Number.isFinite(v) || v < 0) { setText(row.requestedRadiusM ? String(row.requestedRadiusM) : ''); return; }
    if (v === row.requestedRadiusM) return;
    engineInstance.alignmentEditor.setRadius(row.index, v);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label={`Radius at point ${row.index + 1} (m, 0 = sharp corner)`} data-testid={`align-radius-${row.index}`}
        className="w-16 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-right tabular-nums"
        value={text} inputMode="decimal" placeholder="sharp"
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {row.radiusSource === 'auto' && row.radiusM > 0 && <span title="Automatic radius for the design speed" className="text-slate-500">↺</span>}
      {row.clamped && <span title={`Reduced to ${row.radiusM.toFixed(1)} m to fit between the points`} className="text-amber-300">→{row.radiusM.toFixed(0)}</span>}
    </span>
  );
};

export const AlignmentPanel: React.FC<{ objectId: string }> = ({ objectId }) => {
  const snap = useSyncExternalStore(subscribe, snapshot);
  if (snap.objectId !== objectId) return null;
  if (snap.editable.kind === 'none') return null;
  if (snap.editable.kind === 'locked') {
    return (
      <div data-testid="alignment-locked" className="bg-slate-950/50 p-3 rounded-lg border border-white/5 mt-3 text-sm text-slate-400 flex gap-2">
        <Lock size={14} className="shrink-0 mt-0.5" /> <span>Shape locked. {snap.editable.message}</span>
      </div>
    );
  }
  const st = snap.state!;
  const a = st.alignment;
  const sum = snap.summary;
  const angled = a.behaviour === 'angled';
  const ed = engineInstance.alignmentEditor;
  const warn = sum?.flags.filter(f => f.severity === 'warn') ?? [];
  const info = sum?.flags.filter(f => f.severity === 'info' && f.code !== 'transition-not-modelled' && f.code !== 'sharp-angle-point') ?? [];
  const transitions = sum?.rows.filter(r => r.transitionNeededM !== null) ?? [];

  return (
    <div data-testid="alignment-panel" className="bg-slate-950/50 p-3 rounded-lg border border-white/5 space-y-2 mt-3 text-sm">
      <div className="text-sm text-slate-400 uppercase font-semibold border-b border-white/5 pb-1.5 flex items-center gap-1.5">
        <Spline size={12} /> Alignment {sum?.ok ? <span className="ml-auto normal-case font-normal text-slate-500">{m(sum.lengthM)}</span> : null}
      </div>
      <p className="text-xs text-slate-500 leading-snug">
        Drag a square to move a point, a small circle to add one{angled ? '' : ', a diamond to change the radius (Shift: 5 m steps)'}. Right-click a point for more. Esc cancels a drag; Ctrl+Z undoes.
        {snap.editable.migrated && ' This object has no editable points yet: its corners become points (sharp, same shape) at the first change.'}
      </p>

      {!angled && (
        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-300">
          <label className="inline-flex items-center gap-1">Design speed
            <select data-testid="align-speed" className="bg-slate-900 border border-white/10 rounded px-1 py-0.5" value={a.designSpeedKmh ?? ''}
              onChange={e => ed.setDesignSpeed(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">not set</option>
              {[20, 30, 40, 50, 60, 65, 80, 90, 100, 120].map(v => <option key={v} value={v}>{v} km/h</option>)}
            </select>
            <span className="text-slate-500">({a.designSpeedSource === 'user' ? 'set by you' : 'class default'})</span>
          </label>
          <label className="inline-flex items-center gap-1" title="Superelevation cap used by the radius screen (IRC:86 §10.2.1)">e max
            <select data-testid="align-emax" className="bg-slate-900 border border-white/10 rounded px-1 py-0.5" value={a.eMax}
              onChange={e => ed.setEMax(Number(e.target.value) === 0.07 ? 0.07 : 0.04)}>
              <option value={0.04}>4 %</option><option value={0.07}>7 %</option>
            </select>
          </label>
        </div>
      )}

      {sum?.ok ? (
        <table className="w-full text-xs tabular-nums" data-testid="alignment-table">
          <thead><tr className="text-slate-500 text-left">
            <th className="font-normal">#</th><th className="font-normal">Ch</th><th className="font-normal">Turn</th>
            <th className="font-normal">{angled ? '' : 'R (m)'}</th>{!angled && <th className="font-normal text-right">T / arc</th>}<th />
          </tr></thead>
          <tbody>
            {sum.rows.map(r => {
              const w = r.flags.find(f => f.severity === 'warn');
              return (
                <tr key={r.index} className="border-t border-white/5 text-slate-300" data-testid={`align-row-${r.index}`}>
                  <td>{r.index + 1}</td>
                  <td>{chain(r.chainageM)}</td>
                  <td>{r.isEnd ? '' : turn(r.turnDeg)}</td>
                  <td><RadiusCell row={r} angled={angled} /></td>
                  {!angled && <td className="text-right text-slate-400">{r.radiusM > 0 ? `${r.tangentM.toFixed(0)} / ${r.arcM.toFixed(0)}` : ''}</td>}
                  <td className="text-right">
                    {w && <span title={w.message}><AlertTriangle size={12} className="inline text-amber-400" /></span>}
                    {!r.isEnd && (
                      <button type="button" aria-label={`Delete point ${r.index + 1}`} title="Delete point" disabled={a.pis.length <= 2}
                        className="ml-1 text-slate-500 hover:text-red-300 disabled:opacity-30 cursor-pointer" onClick={() => ed.deletePoint(r.index)}>×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="text-xs text-amber-300">This shape cannot be curved as stored (a U-turn at one point).</p>}

      {warn.length > 0 && (
        <ul className="space-y-1" data-testid="alignment-flags">
          {warn.map((f, i) => <li key={i} className="text-xs text-amber-300 leading-snug">⚠ {f.piIndex !== undefined ? `Point ${f.piIndex + 1}: ` : ''}{f.message}</li>)}
        </ul>
      )}
      {info.map((f, i) => <p key={i} className="text-xs text-slate-400 leading-snug">{f.message}</p>)}
      {!angled && transitions.length > 0 && (
        <p className="text-xs text-slate-500 leading-snug">
          Transition curves are not modelled yet; at this design speed the curves would need about {transitions.map(r => `${r.transitionNeededM!.toFixed(0)} m (pt ${r.index + 1})`).join(', ')} (IRC:86 §10.5.2). Screening only — not a design check or approval.
        </p>
      )}
      {!warn.length && sum?.ok && a.designSpeedKmh !== null && !angled && <p className="text-xs text-slate-500">No radius flag found (screening only, not approval).</p>}
      <AlignmentContextMenu />
    </div>
  );
};

/** Right-click menu of a PI grip on the map. */
export const AlignmentContextMenu: React.FC = () => {
  const snap = useSyncExternalStore(subscribe, snapshot);
  const menu = snap.menu;
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.('[data-alignment-menu]')) engineInstance.alignmentEditor.closeMenu(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') engineInstance.alignmentEditor.closeMenu(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc); };
  }, [menu]);
  if (!menu) return null;
  const ed = engineInstance.alignmentEditor;
  const item = 'block w-full text-left px-3 py-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
  return createPortal(
    <div data-alignment-menu role="menu" data-testid="alignment-menu"
      className="fixed z-[9500] min-w-[180px] rounded-lg border border-white/10 bg-slate-900/95 py-1 text-[13px] text-slate-100 shadow-xl"
      style={{ left: menu.x + 4, top: menu.y + 4 }}>
      <div className="px-3 py-1 text-[11px] text-slate-400">Point {menu.index + 1}{menu.isEnd ? ' (end)' : ''}</div>
      <button role="menuitem" className={item} disabled={!menu.canDelete} onClick={() => ed.deletePoint(menu.index)}>Delete point</button>
      {!menu.isEnd && menu.behaviour === 'curved' && (
        <>
          <button role="menuitem" className={item} disabled={menu.radiusM === 0} onClick={() => ed.makeSharp(menu.index)}>Make sharp corner</button>
          <button role="menuitem" className={item} onClick={() => ed.makeCurve(menu.index)}>Make curve (auto radius)</button>
        </>
      )}
    </div>,
    document.body,
  );
};
