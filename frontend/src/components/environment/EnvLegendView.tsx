/**
 * The colour key of one Environment data layer (ramp or categories). Kept free of Cesium and of the overlay renderer so
 * the map key (components/MapLegend.tsx) and its tests can import it without loading the map.
 */
import React from 'react';
import type { EnvLegend } from '../../lib/envDataApi';
import { rampCss } from './envDataModel';

export const Legend: React.FC<{ legend: EnvLegend; testId?: string; unitNote?: string }> = ({ legend, testId, unitNote }) => {
  if (legend.type === 'ramp') {
    const s = legend.stops;
    return (
      <div className="space-y-0.5" data-testid={testId}>
        <p className="text-meta text-text-2">{legend.label}</p>
        <div className="h-2.5 rounded-sm border border-white/10" style={{ background: rampCss(s) }} aria-hidden />
        <div className="flex justify-between text-meta text-text-3 tabular-nums"><span>≤ {s[0].value} {legend.unit}</span><span>≥ {s[s.length - 1].value} {legend.unit}</span></div>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5" data-testid={testId} data-units={unitNote ?? ''}>
      {legend.items.map(i => (
        <li key={i.label} className="flex items-center gap-1.5 text-meta text-text-2">
          <span className={legend.type === 'line' ? 'inline-block h-0.5 w-3' : 'inline-block h-2.5 w-2.5 rounded-sm'} style={{ background: i.color }} aria-hidden />{i.label}
        </li>
      ))}
      {unitNote && <li className="col-span-2 text-meta text-text-3">{unitNote}</li>}
    </ul>
  );
};
