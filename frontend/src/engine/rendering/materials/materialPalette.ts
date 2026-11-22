import type { MeshData } from '../types';

/**
 * Material ids and their Realistic colours (BUILD_VISUALS_AND_TOOLS_PLAN §A3.3).
 *
 * Colours are tones toward Pune materials (grey bituminous carriageway, light concrete decks and piers, grey interlocking
 * pavers on footpaths). The tones are a rendering choice, **assumed**, not measured. Schematic keeps each mesh's own
 * legend colour (`material.color`). The atlas slot (texture) of each material is in `textureAtlas.ts`.
 */
export type MaterialId =
  | 'asphalt'
  | 'asphalt_deck'
  | 'concrete_deck'
  | 'concrete_pier'
  | 'concrete_barrier'
  | 'kerb_stone'
  | 'paver_footpath'
  | 'cycle_track'
  | 'grass_verge'
  | 'soil'
  | 'drain'
  | 'marking_white'
  | 'marking_yellow'
  | 'steel_rail'
  | 'track_plinth'
  | 'retaining_wall'
  | 'tunnel_lining'
  | 'glass'
  | 'building_plaster'
  | 'building_roof'
  | 'pipe';

export const MATERIAL_COLORS: Record<MaterialId, string> = {
  asphalt: '#424448',
  asphalt_deck: '#3c3e41',
  concrete_deck: '#b9b6ae',
  concrete_pier: '#c4c0b7',
  concrete_barrier: '#cfccc4',
  kerb_stone: '#9d9a93',
  paver_footpath: '#8a837b',
  cycle_track: '#7a4f45', // red-tinted surfacing (assumed; Pune cycle tracks vary)
  grass_verge: '#5f7a3e',
  soil: '#8a7458',
  drain: '#5d5b57',
  marking_white: '#eeeeea',
  marking_yellow: '#e2b636',
  steel_rail: '#8b9096',
  track_plinth: '#9e9a92',
  retaining_wall: '#b3afa6',
  tunnel_lining: '#a7a49d',
  glass: 'rgba(170,200,215,0.55)',
  building_plaster: '#d6cfc2',
  building_roof: '#a59e94',
  pipe: '#6b7280',
};

/** Legend colour → material, for meshes that do not name their material (older generator paths). */
const BY_COLOR: Record<string, MaterialId> = {
  '#e2e8f0': 'marking_white',
  '#eab308': 'marking_yellow',
  '#f59e0b': 'marking_yellow',
  '#a5f3fc': 'steel_rail',
  '#78909c': 'retaining_wall',
  '#a8b3c1': 'concrete_deck',
  '#c0cad4': 'concrete_deck',
  '#94a3b8': 'concrete_deck',
  '#111827': 'asphalt_deck',
  '#0a0f1a': 'asphalt_deck',
  'rgba(56, 189, 248, 0.55)': 'glass',
  'rgba(56, 189, 248, 0.35)': 'glass',
};

/** Layer-specific overrides (`layer|colour`), checked before BY_COLOR. */
const BY_LAYER_COLOR: Record<string, MaterialId> = {
  'transit_station|#1e293b': 'steel_rail',
};

const BY_LAYER: Record<string, MaterialId> = {
  asphalt: 'asphalt',
  sidewalk: 'paver_footpath',
  curb: 'kerb_stone',
  divider: 'kerb_stone',
  marking: 'marking_white',
  cycleway: 'cycle_track',
  verge: 'grass_verge',
  parking: 'asphalt',
  drainage: 'drain',
  building: 'building_plaster',
  transit_deck: 'concrete_deck',
  transit_deck_details: 'concrete_barrier',
  transit_rails: 'steel_rail',
  transit_pillars: 'concrete_pier',
  transit_pillars_details: 'concrete_pier',
  transit_station: 'glass',
  transit_utility: 'pipe',
  transit_junction: 'asphalt',
};

export function materialOf(mesh: Pick<MeshData, 'material' | 'layerId'>): MaterialId {
  if (mesh.material.materialId) return mesh.material.materialId;
  const c = mesh.material.color.toLowerCase();
  const byLayerColor = BY_LAYER_COLOR[`${mesh.layerId ?? ''}|${c}`];
  if (byLayerColor) return byLayerColor;
  const byColor = BY_COLOR[c];
  // A marking-coloured mesh on a deck layer is a marking; a pale mesh on the road layer is not
  if (byColor) return byColor;
  return BY_LAYER[mesh.layerId ?? ''] ?? 'concrete_deck';
}

/** Colour a mesh is drawn with in a style. Selection / traffic tint override this at the instance level. */
export function styleColor(mesh: Pick<MeshData, 'material' | 'layerId'>, style: 'realistic' | 'schematic'): string {
  if (style === 'schematic') return mesh.material.color;
  // Drawn utilities keep the Underground legend colour (utility kind) in both styles: it is information, not decoration
  if (mesh.layerId === 'transit_utility') return mesh.material.color;
  // Translucent legend colours (station canopies, glass) keep their alpha in Realistic too
  const m = materialOf(mesh);
  return MATERIAL_COLORS[m];
}
