import type { LegendGroup } from './mapLegend';
import { LEGEND_ORDER } from './mapLegend';
import { MATERIAL_COLORS } from './materials/materialPalette';
import type { VisualStyle } from './visualStyle';

/**
 * The city model's key (roads, decks, metro, buildings, props), as the active visual style draws it
 * (ProceduralGeometryGenerator: Schematic colours; materialPalette.ts: Realistic tones). The 3D city is always on the
 * map, so this group is listed in every workspace that shows it (Underground has its own key).
 */

/** Schematic (legend) colours of the city meshes (ProceduralGeometryGenerator literals; drift-tested). */
export const SCHEMATIC_CITY_COLORS = {
  road: '#2b313b', laneLine: '#e2e8f0', edgeLine: '#eab308', deck: '#94a3b8', deckAsphalt: '#111827',
  metroBeam: '#1e3a5f', metroParapet: '#1d4ed8', metroViaduct: '#1e293b', rail: '#a5f3fc',
  buildingCommercial: '#38bdf8', buildingIndustrial: '#f59e0b', buildingOther: '#64748b', tree: '#166534', pole: '#94a3b8',
} as const;
export const SELECTION_CITY_COLOR = '#00ffff';

export function cityLegend(workspace: string, style: VisualStyle): LegendGroup {
  const r = style === 'realistic', m = MATERIAL_COLORS, s = SCHEMATIC_CITY_COLORS;
  const items: LegendGroup['items'] = [
    { id: 'road', label: 'Road', detail: 'carriageway; lanes and width as mapped or as drawn', swatch: { kind: 'line', color: r ? m.asphalt : s.road } },
    { id: 'lane-line', label: 'Lane and centre lines', swatch: { kind: 'dash', color: r ? m.marking_white : s.laneLine } },
    { id: 'edge-line', label: 'Edge line of a divided road', swatch: { kind: 'line', color: r ? m.marking_yellow : s.edgeLine } },
    { id: 'deck', label: 'Flyover or bridge deck', detail: 'on piers; ramps down to the road', swatch: { kind: 'outline', color: r ? m.asphalt_deck : s.deckAsphalt, color2: r ? m.concrete_deck : s.deck } },
    { id: 'metro', label: 'Elevated metro viaduct', swatch: { kind: 'outline', color: r ? m.steel_rail : s.rail, color2: r ? m.concrete_deck : s.metroViaduct } },
    { id: 'double-deck', label: 'Double-deck (road over metro)', detail: 'road deck on top, metro deck below', swatch: { kind: 'outline', color: r ? m.concrete_deck : s.metroParapet, color2: r ? m.concrete_pier : s.metroBeam } },
    ...(r
      ? [{ id: 'building', label: 'Building', detail: 'footprint and height as recorded; estimated where not recorded', swatch: { kind: 'fill' as const, color: m.building_plaster } }]
      : [{ id: 'b-com', label: 'Building, commercial', swatch: { kind: 'fill' as const, color: s.buildingCommercial } },
        { id: 'b-ind', label: 'Building, industrial', swatch: { kind: 'fill' as const, color: s.buildingIndustrial } },
        { id: 'b-other', label: 'Building, residential or other', swatch: { kind: 'fill' as const, color: s.buildingOther } }]),
    { id: 'tree', label: 'Street tree', swatch: { kind: 'dot', color: r ? m.tree_canopy : s.tree } },
    { id: 'pole', label: 'Streetlight', swatch: { kind: 'square', color: r ? m.light_pole : s.pole } },
    ...(workspace === 'design' || workspace === 'explore' ? [{ id: 'selected', label: 'Selected object', swatch: { kind: 'line' as const, color: SELECTION_CITY_COLOR } }] : []),
  ];
  return {
    id: 'city', title: `City model (${r ? 'realistic' : 'schematic'} style)`, order: LEGEND_ORDER.city, items,
    note: r ? 'Material tones are a rendering choice (assumed), not measured. Switch to Schematic in the style menu for flat key colours.' : 'Flat key colours; buildings by recorded use.',
  };
}
