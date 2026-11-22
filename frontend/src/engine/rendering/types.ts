import type { MaterialId } from './materials/materialPalette';

export interface MaterialConfig {
  type: 'solid' | 'dashed' | 'textured';
  color: string;           // Hex or RGBA string (the Schematic / legend colour; also the base of traffic tint)
  /** What the surface is made of; Realistic draws its material colour / texture. Derived from layer + colour when absent. */
  materialId?: MaterialId;
  textureUrl?: string;     // Optional texture image URL
  dashPattern?: number;    // Dash pattern spacing (for polylines)
}

export interface MeshData {
  positions: Float64Array; // Double precision for absolute ECEF Cartesian3 coordinates
  indices: Uint32Array;   // Mesh triangle indexes
  normals?: Float32Array;  // Vertex normals (optional, for lighting)
  uvs?: Float32Array;      // UV texture mappings (optional)
  material: MaterialConfig;
  layerId?: 'asphalt' | 'sidewalk' | 'curb' | 'divider' | 'building' | 'transit_deck' | 'transit_rails' | 'transit_pillars' | 'transit_station' | 'transit_utility' | 'transit_junction' | 'cycleway' | 'verge' | 'parking' | 'drainage' | 'marking' | 'transit_deck_details' | 'transit_pillars_details' | 'props';
}
