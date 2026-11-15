import React from 'react';
import type { UndergroundAlignmentKind, UtilityType } from '../../engine/objects/types';
import { EVIDENCE_ALPHA, RECORD_COLOR, UTILITY_COLOR } from '../../engine/underground/UndergroundRenderer';
import { LAYER_LABEL, type LayerKey } from '../../engine/underground/recordsSummary';
import { ALIGNMENT_KIND_LABEL } from '../../engine/underground/alignmentGeometry';
import { METRO_STATION_LABEL, METRO_TUNNEL_LABEL } from '../../engine/underground/metroLevel';
import { UTILITY_LABEL } from '../../shell/contexts/utilityCertainty';
import { HIGHLIGHT_CSS } from './conflictHighlight';
import { ALIGNMENT_KIND_COLOR, LEGEND_COLOR } from './legendPalette';

/**
 * Colour key for everything the Underground 3D view draws (docs/urbanos/UNDERGROUND_VISUAL_FIXES.md, "Charts and legend").
 * Colours come from the renderer's exported constants (RECORD_COLOR, UTILITY_COLOR, EVIDENCE_ALPHA), the conflict
 * highlight (HIGHLIGHT_CSS) and legendPalette.ts (renderer literals, drift-tested). Line style = status, colour = type,
 * opacity = evidence (research §5). Counts are what the panel already knows; a count is left out when it is not known.
 */
export interface LegendCounts {
  /** subsurface records in the work area, per layer (summariseRecords().inArea) */
  records?: Partial<Record<LayerKey, number>>;
  /** proposed alignments in this alternative, by kind */
  alignments?: Partial<Record<UndergroundAlignmentKind, number>>;
  /** utilities drawn in this alternative, by type */
  utilities?: Partial<Record<UtilityType, number>>;
  /** OSM metro tunnel ways / underground stations whose depth is not mapped (drawn while the metro layer is on) */
  metroTunnels?: number;
  metroStations?: number;
}

const DASH = { existing: undefined, proposed: '6 3', conceptual: '1.5 3', abandoned: '12 3' } as const;

const Line: React.FC<{ color: string; dash?: string; opacity?: number; width?: number }> = ({ color, dash, opacity = 1, width = 3 }) => (
  <svg width="22" height="8" aria-hidden className="shrink-0">
    <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeOpacity={opacity} strokeWidth={width} strokeDasharray={dash} />
  </svg>
);
const Box: React.FC<{ color: string; dash?: string }> = ({ color, dash }) => (
  <svg width="22" height="10" aria-hidden className="shrink-0"><rect x="2" y="1.5" width="18" height="7" fill="none" stroke={color} strokeWidth={1.8} strokeDasharray={dash} /></svg>
);
const Tick: React.FC<{ color: string }> = ({ color }) => (
  <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="11" y1="0" x2="11" y2="10" stroke={color} strokeWidth={3} /></svg>
);

const Item: React.FC<{ swatch: React.ReactNode; label: string; count?: number; testId: string; title?: string; color: string }> = ({ swatch, label, count, testId, title, color }) => (
  <li className="flex items-center gap-1.5 min-w-0" data-testid={testId} data-color={color} title={title}>
    {swatch}
    <span className="truncate">{label}</span>
    {count !== undefined && <span className="ml-auto tabular-nums text-text-3" data-testid={`${testId}-count`}>{count.toLocaleString('en-IN')}</span>}
  </li>
);

const Group: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="flex flex-col gap-0.5">
    <div className="text-text-3 uppercase tracking-wide" style={{ fontSize: 10 }}>{title}</div>
    <ul className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>{children}</ul>
  </div>
);

const RECORD_LAYERS = ['sewer', 'storm_drain', 'water', 'power', 'gas', 'telecom', 'other_utility'] as const;
const KINDS = Object.keys(ALIGNMENT_KIND_COLOR) as UndergroundAlignmentKind[];
const UTIL_TYPES = Object.keys(UTILITY_COLOR) as UtilityType[];
const sum = (o?: Partial<Record<string, number>>) => (o ? Object.values(o).reduce<number>((s, v) => s + (v ?? 0), 0) : undefined);

export const UndergroundLegend: React.FC<{ counts?: LegendCounts; metroLayer?: { visible: boolean; onToggle: (v: boolean) => void } }> = ({ counts = {}, metroLayer }) => {
  const rec = counts.records;
  // PMC sewers and storm drains always (the reference networks); other record layers only when some are in the area
  const recordLayers = RECORD_LAYERS.filter(k => k === 'sewer' || k === 'storm_drain' || (rec?.[k] ?? 0) > 0);
  const strong = EVIDENCE_ALPHA['QL-A'], pale = EVIDENCE_ALPHA['QL-D'];
  return (
    <div className="flex flex-col gap-2 text-meta text-text-2" data-testid="ug-legend">
      <Group title="Existing records (as published)">
        {recordLayers.map(k => (
          <Item key={k} testId={`ug-legend-record-${k}`} color={RECORD_COLOR[k]} label={k === 'sewer' ? 'PMC sewers' : k === 'storm_drain' ? 'PMC storm drains' : LAYER_LABEL[k]}
            swatch={<Line color={RECORD_COLOR[k]} opacity={pale} />} count={rec ? rec[k] ?? 0 : undefined} title="Solid = existing; paler = lower quality level (QL-D or unknown)" />
        ))}
        {(rec?.borehole ?? 0) > 0 && <Item testId="ug-legend-record-borehole" color={LEGEND_COLOR.borehole} label="Boreholes (to final depth)" swatch={<Tick color={LEGEND_COLOR.borehole} />} count={rec?.borehole} />}
      </Group>
      <Group title="Metro (OpenStreetMap)">
        <Item testId="ug-legend-metro-tunnel" color={LEGEND_COLOR.metroPlanOnly} label={METRO_TUNNEL_LABEL} swatch={<Line color={LEGEND_COLOR.metroPlanOnly} dash={DASH.proposed} />} count={counts.metroTunnels}
          title="Plan position only, drawn on the surface: OSM does not map its depth" />
        <Item testId="ug-legend-metro-station" color={LEGEND_COLOR.metroPlanOnly} label={METRO_STATION_LABEL} swatch={<Box color={LEGEND_COLOR.metroPlanOnly} dash="4 2" />} count={counts.metroStations} />
        {metroLayer && (
          <li className="flex items-center gap-1.5">
            <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Shows or hides the whole metro layer (elevated and tunnel)">
              <input type="checkbox" checked={metroLayer.visible} onChange={e => metroLayer.onToggle(e.target.checked)} data-testid="ug-legend-toggle-metro" />
              Show metro layer
            </label>
          </li>
        )}
      </Group>
      <Group title="Proposed alignments (colour = kind)">
        {KINDS.map(k => (
          <Item key={k} testId={`ug-legend-alignment-${k}`} color={ALIGNMENT_KIND_COLOR[k]} label={ALIGNMENT_KIND_LABEL[k]} swatch={<Line color={ALIGNMENT_KIND_COLOR[k]} dash={DASH.proposed} width={4} />}
            count={counts.alignments ? counts.alignments[k] ?? 0 : undefined} />
        ))}
      </Group>
      <Group title="Utilities you drew (colour = type)">
        {UTIL_TYPES.map(t => (
          <Item key={t} testId={`ug-legend-utility-${t}`} color={UTILITY_COLOR[t]} label={UTILITY_LABEL[t]} swatch={<Line color={UTILITY_COLOR[t]} opacity={strong} />}
            count={counts.utilities ? counts.utilities[t] ?? 0 : undefined} />
        ))}
      </Group>
      <Group title="Line style = status">
        <Item testId="ug-legend-existing" color="currentColor" label="Existing" swatch={<Line color="currentColor" dash={DASH.existing} />} />
        <Item testId="ug-legend-proposed" color="currentColor" label="Proposed" swatch={<Line color="currentColor" dash={DASH.proposed} />} />
        <Item testId="ug-legend-conceptual" color="currentColor" label="Conceptual" swatch={<Line color="currentColor" dash={DASH.conceptual} />} />
        <Item testId="ug-legend-abandoned" color="currentColor" label="Abandoned in place" swatch={<Line color="currentColor" dash={DASH.abandoned} />} />
        <Item testId="ug-legend-unknown-depth" color={LEGEND_COLOR.unknownDepth} label="Depth unknown (on the surface)" swatch={<Line color={LEGEND_COLOR.unknownDepth} dash="4 3" />} />
      </Group>
      <Group title="Highlights">
        <Item testId="ug-legend-selected" color={LEGEND_COLOR.selected} label="Selected" swatch={<Line color={LEGEND_COLOR.selected} width={4} />} />
        <Item testId="ug-legend-flyto" color={HIGHLIGHT_CSS.other} label="Record you flew to / other asset in a finding" swatch={<Line color={HIGHLIGHT_CSS.other} width={4} />} />
        <Item testId="ug-legend-finding-proposed" color={HIGHLIGHT_CSS.proposed} label="Your object in a finding" swatch={<Line color={HIGHLIGHT_CSS.proposed} width={4} />} />
      </Group>
      <div className="text-text-3">Paler = less certain (records only, QL-D, or user-drawn). Records with no depth are drawn on the surface, never at a guessed depth.{sum(counts.records) === 0 ? ' No records listed for this area yet.' : ''}</div>
    </div>
  );
};
