import type { MeshData } from './types';
import type { VisualStyle } from './visualStyle';
import type { QualityTier } from './qualityTier';

/**
 * Optional detail layers that are drawn only in Realistic at Medium or High tier. Schematic is a clean legend view
 * and Low tier is the slow-hardware fallback, so street props (streetlights, trees) are left out of both.
 */
export const DETAIL_LAYERS: ReadonlySet<NonNullable<MeshData['layerId']>> = new Set(['props']);

export function detailShown(mesh: Pick<MeshData, 'layerId'>, style: VisualStyle, tier: QualityTier): boolean {
  if (!mesh.layerId || !DETAIL_LAYERS.has(mesh.layerId)) return true;
  return style === 'realistic' && tier !== 'low';
}
