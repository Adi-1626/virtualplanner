import type { MaterialId } from './materialPalette';

/**
 * Detail-texture atlas (BUILD_VISUALS_AND_TOOLS_PLAN §A3.3): `public/textures/urbanos-detail-atlas.jpg`, 2048², 4 × 4
 * slots of 512 px (496 px tile + 8 px wrapped gutter). Each slot is a luminance detail map normalised to mean 0.5,
 * built from CC0 ambientCG materials by `public/textures/build_atlas.py` (asset ids and licence:
 * `public/textures/ASSET_LICENCES.md`). The shader multiplies the detail (× 2) with the per-instance colour, so the
 * material colour, traffic tint and selection colour all still apply; textures only add surface grain.
 */
export const ATLAS_URL = 'textures/urbanos-detail-atlas.jpg';
export const ATLAS_SIZE = 2048;
export const ATLAS_SLOT = 512;
export const ATLAS_GUTTER = 8;

/** Slot index → CC0 source asset and real-world repeat (metres per tile; assumed rendering values). */
export const ATLAS_SLOTS = [
  { assetId: 'Asphalt031', label: 'asphalt', tileM: 4 },
  { assetId: 'Concrete034', label: 'smooth concrete', tileM: 3 },
  { assetId: 'Concrete046', label: 'cast concrete (panels)', tileM: 3 },
  { assetId: 'PavingStones130', label: 'pavers', tileM: 1.6 },
  { assetId: 'Grass004', label: 'grass', tileM: 3 },
  { assetId: 'Ground037', label: 'soil / verge', tileM: 4 },
  { assetId: 'Metal032', label: 'metal', tileM: 1 },
  { assetId: 'Plaster001', label: 'plaster', tileM: 3 },
  { assetId: 'Concrete047A', label: 'rough concrete', tileM: 3 },
] as const;

/** Material → atlas slot; -1 = untextured (markings, glass, drawn utilities keep a clean colour). */
export const MATERIAL_SLOT: Record<MaterialId, number> = {
  asphalt: 0,
  asphalt_deck: 0,
  cycle_track: 0,
  concrete_deck: 1,
  concrete_barrier: 1,
  kerb_stone: 8,
  concrete_pier: 2,
  retaining_wall: 2,
  tunnel_lining: 2,
  paver_footpath: 3,
  grass_verge: 4,
  soil: 5,
  steel_rail: 6,
  pipe: -1,
  building_plaster: 7,
  building_roof: 8,
  drain: 8,
  track_plinth: 8,
  marking_white: -1,
  marking_yellow: -1,
  glass: -1,
};
