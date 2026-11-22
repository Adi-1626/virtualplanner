import React from 'react';
import { elementsTotalM, type XsElement, type XsElementKind } from '../../engine/crossSection/templates';

/** Colours of the strips (schematic). */
const FILL: Record<XsElementKind, string> = {
  footpath: '#9CA3AF',
  furniture: '#4D7C0F',
  cycle_track: '#0E7490',
  buffer: '#6B7280',
  parking: '#78716C',
  carriageway: '#334155',
  median: '#65A30D',
};
const SHORT: Record<XsElementKind, string> = { footpath: 'FP', furniture: 'MUZ', cycle_track: 'CT', buffer: 'B', parking: 'P', carriageway: 'CW', median: 'M' };

/**
 * A street cross-section as a strip diagram (left edge of the right-of-way → right edge, looking along the drawn line),
 * widths to scale. Schematic: no levels, kerbs or crossfall.
 */
export const CrossSectionDiagram: React.FC<{ elements: readonly XsElement[]; title?: string; testId?: string; compact?: boolean }> = ({ elements, title, testId, compact }) => {
  const total = elementsTotalM(elements) || 1;
  const W = 300, H = compact ? 34 : 46, barY = 4, barH = compact ? 16 : 22;
  let x = 0;
  return (
    <figure className="space-y-0.5" data-testid={testId}>
      {title && <figcaption className="text-[11px] font-semibold text-slate-400 flex justify-between"><span>{title}</span><span className="font-mono">{elementsTotalM(elements)} m</span></figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title ?? 'Cross-section'}: ${elements.map(e => `${e.label} ${e.widthM} m`).join(', ')}`}>
        {elements.map((e, i) => {
          const w = (e.widthM / total) * W;
          const x0 = x; x += w;
          const lanes = e.kind === 'carriageway' && e.lanes && e.lanes > 1 ? Array.from({ length: e.lanes - 1 }, (_, k) => x0 + (w * (k + 1)) / e.lanes!) : [];
          return (
            <g key={i}>
              <title>{`${e.label}: ${e.widthM} m${e.lanes ? ` (${e.lanes} × ${Math.round((e.widthM / e.lanes) * 100) / 100} m)` : ''}`}</title>
              <rect x={x0} y={barY} width={Math.max(0.5, w)} height={barH} fill={FILL[e.kind]} stroke="#0F172A" strokeWidth={0.6} />
              {lanes.map((lx, k) => <line key={k} x1={lx} x2={lx} y1={barY + 3} y2={barY + barH - 3} stroke="#E5E7EB" strokeWidth={0.6} strokeDasharray="2 2" />)}
              {w >= 14 && <text x={x0 + w / 2} y={barY + barH / 2 + 3} textAnchor="middle" fontSize={7} fill="#F8FAFC">{SHORT[e.kind]}</text>}
              {!compact && w >= 11 && <text x={x0 + w / 2} y={barY + barH + 10} textAnchor="middle" fontSize={7} fill="#94A3B8">{e.widthM}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
};

export const CrossSectionLegend: React.FC = () => (
  <p className="text-[10px] text-slate-500 leading-relaxed">
    FP footpath (clear walkway) · MUZ tree pits / furniture / bus stop · CT cycle track · B buffer · P parking · CW carriageway (dashes = lanes) · M median. Widths in m, left → right along the drawn direction; schematic.
  </p>
);
