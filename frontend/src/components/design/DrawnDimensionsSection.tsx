import React from 'react';
import type { CityObject, MetroSuperstructure } from '../../engine/objects/types';
import { assumedDimsFor } from '../../engine/rendering/standards/visualDims';

/**
 * Inspector section for structures drawn by the renderer (BUILD_VISUALS_AND_TOOLS_PLAN §A2 rule): lists every dimension
 * drawn without a source ("Drawn with assumed dimensions") and, for metro viaducts, the superstructure type (box girder
 * per Maha-Metro, or the U-girder option whose Pune dimensions are not known).
 */
export const DrawnDimensionsSection: React.FC<{ obj: CityObject; onUpdate: (field: string, value: unknown) => void }> = ({ obj, onUpdate }) => {
  const isMetro = obj.type === 'metro_line' || obj.type === 'metro_flyover';
  const sup: MetroSuperstructure = isMetro ? ((obj as { superstructure?: MetroSuperstructure }).superstructure ?? 'box_girder') : 'box_girder';
  const rows = assumedDimsFor(obj.type, { metroSuperstructure: sup === 'u_girder' ? 'u' : 'box' });
  if (!rows.length && !isMetro) return null;
  return (
    <section aria-label="Drawn dimensions" data-testid="drawn-dimensions" className="space-y-1.5">
      {isMetro && (
        <label className="flex items-center justify-between gap-2 text-label text-text-2">
          <span>Viaduct type</span>
          <select data-testid="metro-superstructure" value={sup} onChange={e => onUpdate('superstructure', e.target.value as MetroSuperstructure)}
            className="rounded-md border border-border bg-surface-2 px-1.5 h-7 text-label text-text-1">
            <option value="box_girder">Box girder (Pune Metro, Maha-Metro DPR)</option>
            <option value="u_girder">U-girder (type not confirmed)</option>
          </select>
        </label>
      )}
      {isMetro && sup === 'u_girder' && (
        <p className="text-meta text-text-3" data-testid="u-girder-note">Type not confirmed: Pune Metro uses a box girder; no official Pune U-girder drawing was found, so the trough is drawn generic.</p>
      )}
      {rows.length > 0 && (
        <details>
          <summary className="text-label text-text-2 cursor-pointer">Drawn with assumed dimensions ({rows.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {rows.map(r => (
              <li key={r.key} className="text-meta text-text-3" title={r.source}>
                {r.label}: <span className="text-text-2">{r.value}</span> · {r.status === 'unknown' ? 'not known' : 'assumed'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
