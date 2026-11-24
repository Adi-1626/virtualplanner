import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, KeyRound } from 'lucide-react';
import { mapLegend, itemTip, type LegendGroup, type LegendItem, type Swatch } from '../engine/rendering/mapLegend';
import { cityLegend } from '../engine/rendering/cityLegend';
import { getVisualStyle, onVisualStyleChange } from '../engine/rendering/visualStyle';
import { useShellStore } from '../shell/useShellStore';
import { useMuniStore, muniLayerMeta } from './explore/municipalOverlay';
import { colorOf } from './explore/municipalModel';
import { useTerrainOverlayStore } from './explore/terrainOverlay';
import { useEnvDataOverlayStore, drawnEnvLayers } from './environment/envDataOverlayStore';
import { legendOf } from './environment/envDataModel';
import { Legend as EnvLegend } from './environment/EnvLegendView';
import { UndergroundLegend } from './underground/UndergroundLegend';

/**
 * The map key (docs/urbanos/SIM_FLOW_P12.md §8): one compact, collapsible box on the map that lists only what the map
 * shows now, in the active workspace and overlay, with units and colour scales. Groups come from the renderers
 * (engine/rendering/mapLegend.ts) and from the panels' own layer keys (municipal, terrain, environment, underground).
 * Every entry has a tooltip; hovering or tapping a symbol on the map says what it is (MapSymbolTooltip).
 */

const OPEN_KEY = 'urbanos.mapLegend.open';
const readOpen = (): boolean => {
  try { const v = localStorage.getItem(OPEN_KEY); if (v === '1' || v === '0') return v === '1'; } catch { /* private mode */ }
  return typeof window !== 'undefined' && window.innerWidth >= 1280;
};

export const SwatchIcon: React.FC<{ s: Swatch }> = ({ s }) => {
  const c = s.color, c2 = s.color2 ?? '#0f172a';
  switch (s.kind) {
    case 'line': return <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="1" y1="5" x2="21" y2="5" stroke={c} strokeWidth={4} strokeLinecap="round" /></svg>;
    case 'dash': return <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="1" y1="5" x2="21" y2="5" stroke={c} strokeWidth={3} strokeDasharray="5 3" /></svg>;
    case 'glow': return <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="2" y1="5" x2="20" y2="5" stroke={c} strokeOpacity={0.35} strokeWidth={9} strokeLinecap="round" /><line x1="2" y1="5" x2="20" y2="5" stroke={c} strokeWidth={3} strokeLinecap="round" /></svg>;
    case 'outline': return <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="2" y1="5" x2="20" y2="5" stroke={c2} strokeWidth={8} strokeLinecap="round" /><line x1="2" y1="5" x2="20" y2="5" stroke={c} strokeWidth={4} strokeLinecap="round" /></svg>;
    case 'dot': return <svg width="22" height="12" aria-hidden className="shrink-0"><circle cx="11" cy="6" r="4.5" fill={c} stroke={c2} strokeWidth={1.5} /></svg>;
    case 'ring': return <svg width="22" height="12" aria-hidden className="shrink-0"><circle cx="11" cy="6" r="4" fill="#0f172a" stroke={c} strokeWidth={2.5} /></svg>;
    case 'square': return <svg width="22" height="12" aria-hidden className="shrink-0"><rect x="6" y="1" width="10" height="10" fill={c} stroke={c2} strokeWidth={1} /></svg>;
    case 'fill': return <svg width="22" height="12" aria-hidden className="shrink-0"><rect x="2" y="2" width="18" height="8" rx="1.5" fill={c} fillOpacity={0.85} /></svg>;
    case 'arrow': return <svg width="22" height="10" aria-hidden className="shrink-0"><line x1="1" y1="5" x2="15" y2="5" stroke={c} strokeWidth={3} /><path d="M14 1 L21 5 L14 9 Z" fill={c} /></svg>;
    case 'label': return <span className="shrink-0 inline-flex min-w-[22px] justify-center rounded px-0.5 text-[9px] font-bold leading-[14px]" style={{ color: c, background: '#0f172a' }} aria-hidden>{s.text}</span>;
    case 'gradient': return <span className="shrink-0 inline-block h-2.5 w-[22px] rounded-sm" style={{ background: `linear-gradient(90deg, ${c}, ${c2})` }} aria-hidden />;
  }
};

const Row: React.FC<{ i: LegendItem }> = ({ i }) => (
  <li className="flex items-start gap-1.5 min-w-0" title={itemTip(i)} data-testid="map-legend-item" data-item={i.id}>
    <span className="mt-0.5 flex items-center"><SwatchIcon s={i.swatch} /></span>
    <span className="min-w-0"><span className="text-text-1">{i.label}</span>{i.detail && <span className="block text-text-3 leading-snug">{i.detail}</span>}</span>
  </li>
);

const EVIDENCE_WORD: Record<NonNullable<LegendGroup['evidence']>, string> = { measured: 'measured', modelled: 'modelled', inferred: 'inferred', assumed: 'assumed', estimated: 'estimated', design: 'as designed' };

const GroupView: React.FC<{ g: LegendGroup; collapsed?: boolean }> = ({ g, collapsed }) => {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="space-y-1" data-testid="map-legend-group" data-group={g.id}>
      <button type="button" className="flex w-full items-center gap-1 text-left cursor-pointer" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-text-2">{g.title}</span>
        {g.evidence && <span className="text-[10px] text-text-3">{EVIDENCE_WORD[g.evidence]}</span>}
        {open ? <ChevronUp size={12} aria-hidden className="text-text-3" /> : <ChevronDown size={12} aria-hidden className="text-text-3" />}
      </button>
      {open && <>
        {g.scale && (
          <div data-testid="map-legend-scale">
            <div className="flex h-2.5 overflow-hidden rounded-sm">{g.scale.steps.map(st => <span key={st.label} className="flex-1" style={{ background: st.color }} title={st.label} />)}</div>
            <div className="flex justify-between gap-1 text-[10px] text-text-3">{g.scale.steps.map(st => <span key={st.label} className="truncate">{st.label}</span>)}</div>
            <p className="text-[10px] text-text-3">{g.scale.unit}</p>
          </div>
        )}
        {g.items.length > 0 && <ul className="space-y-0.5">{g.items.map(i => <Row key={i.id} i={i} />)}</ul>}
        {g.note && <p className="text-[10px] text-text-3 leading-snug">{g.note}</p>}
      </>}
    </section>
  );
};

/** Groups for the explore layers the panels draw (municipal records, terrain): read from their own stores. */
function useExploreGroups(): LegendGroup[] {
  const muni = useMuniStore(s => s.layers);
  const terrain = useTerrainOverlayStore();
  const out: LegendGroup[] = [];
  const shown = Object.entries(muni).filter(([, st]) => st.status === 'shown').map(([id]) => muniLayerMeta(id)).filter((m): m is NonNullable<typeof m> => !!m);
  if (shown.length) out.push({ id: 'municipal', title: 'Municipal records', order: 50, evidence: 'measured',
    items: shown.flatMap((m): LegendItem[] => m.id === 'buildings'
      ? [{ id: 'b-osm', label: 'Buildings, OpenStreetMap', swatch: { kind: 'fill' as const, color: colorOf('buildings', { source: 'osm' }) } },
        { id: 'b-google', label: 'Buildings, Google Open Buildings (inferred)', swatch: { kind: 'fill' as const, color: colorOf('buildings', { source: 'google_open_buildings_v3' }) } },
        { id: 'b-ms', label: 'Buildings, Microsoft ML (inferred)', swatch: { kind: 'fill' as const, color: colorOf('buildings', { source: 'ms_global_ml_buildings' }) } }]
      : [{ id: m.id, label: m.title, detail: `${m.publisher}${m.data_class ? ` · ${m.data_class}` : ''}`, swatch: { kind: 'line' as const, color: colorOf(m.id) } }]),
    note: 'As published by the agency; click a feature for its attributes.' });
  const m = terrain.meta;
  if (terrain.shown.slope === 'shown' && m && Array.isArray(m.overlays.slope.legend)) out.push({ id: 'terrain-slope', title: 'Terrain slope (Copernicus 30 m)', order: 51, evidence: 'measured',
    items: [], scale: { unit: 'slope, degrees (screening only: a surface model, not bare earth)', steps: m.overlays.slope.legend.map(l => ({ color: `rgba(${l.rgba[0]},${l.rgba[1]},${l.rgba[2]},${(l.rgba[3] ?? 255) / 255})`, label: l.label.replace(/deg/g, '°') })) } });
  if (terrain.shown.hillshade === 'shown' && m) out.push({ id: 'terrain-hill', title: 'Hillshade', order: 52, items: [{ id: 'hs', label: 'Shaded relief', detail: typeof m.overlays.hillshade.legend === 'string' ? m.overlays.hillshade.legend : 'light from the north-west', swatch: { kind: 'gradient', color: '#1f2937', color2: '#e5e7eb' } }] });
  return out;
}

export const MapLegend: React.FC = () => {
  const workspace = useShellStore(s => s.workspace);
  useSyncExternalStore(mapLegend.subscribe, mapLegend.getVersion);
  useEnvDataOverlayStore(s => s.overlays);
  useEnvDataOverlayStore(s => s.layers);
  const [style, setStyle] = useState(getVisualStyle);
  useEffect(() => onVisualStyleChange(setStyle), []);
  const [open, setOpenState] = useState(readOpen);
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* private mode */ } };
  const explore = useExploreGroups();
  const env = workspace === 'environment' || workspace === 'explore' ? drawnEnvLayers() : [];
  const groups = [...mapLegend.list(), ...explore].sort((a, b) => a.order - b.order);
  const city = workspace === 'underground' ? null : cityLegend(workspace, style);
  const n = groups.reduce((k, g) => k + Math.max(1, g.items.length), 0) + env.length + (workspace === 'underground' ? 1 : 0);
  return (
    <section className="uos-legend" aria-label="Map key" data-testid="map-legend" data-open={open ? 'true' : 'false'} data-workspace={workspace}>
      <button type="button" className="uos-legend-head" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="map-legend-toggle" title={open ? 'Hide the map key' : 'What the colours and symbols on the map mean'}>
        <KeyRound size={13} aria-hidden /><span className="flex-1 text-left">Map key</span>
        {!open && n > 0 && <span className="tabular-nums text-text-3" data-testid="map-legend-count">{n}</span>}
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
      </button>
      {open && (
        <div className="uos-legend-body" data-testid="map-legend-body">
          {groups.map(g => <GroupView key={g.id} g={g} />)}
          {env.map(({ layer, variant }) => { const lg = legendOf(layer, variant); return (
            <section key={layer.id} className="space-y-1" data-testid="map-legend-group" data-group={`env-${layer.id}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-2">{layer.name}</p>
              {lg ? <EnvLegend legend={lg} testId={`map-legend-env-${layer.id}`} /> : <p className="text-[10px] text-text-3">No colour key published for this layer.</p>}
            </section>); })}
          {workspace === 'underground' && <section data-testid="map-legend-group" data-group="underground"><UndergroundLegend /></section>}
          {city && <GroupView g={city} collapsed={groups.length + env.length > 0} />}
        </div>
      )}
    </section>
  );
};
