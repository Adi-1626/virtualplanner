import type { Viewer } from 'cesium';
import type { VisualStyle } from './visualStyle';
import { getGroundField } from '../terrain/groundHeight';

/**
 * Scene-wide settings per visual style: Realistic turns on FXAA so the hard edges of decks, kerbs and piers stay crisp
 * without the cost of MSAA (BUILD_VISUALS_AND_TOOLS_PLAN §A5, Medium tier). Schematic leaves the scene as it was.
 * Guarded: the unit-test viewer mock has no post-process stages.
 */
export function applySceneStyle(viewer: Viewer, style: VisualStyle): void {
  const fxaa = (viewer?.scene as unknown as { postProcessStages?: { fxaa?: { enabled: boolean } } })?.postProcessStages?.fxaa;
  if (fxaa) fxaa.enabled = style === 'realistic';
  // Terrain on + Realistic: the scene depth-tests against the terrain, so parts below the ground (cuts, tunnel
  // approaches, the 0.3 m the smoothed road profile may dip) are hidden instead of drawing over the hillside.
  // Schematic keeps buried items visible, as before (§A4.5). Re-applied whenever the ground changes (RenderManager.clear).
  const globe = (viewer?.scene as unknown as { globe?: { depthTestAgainstTerrain: boolean } })?.globe;
  if (globe) globe.depthTestAgainstTerrain = style === 'realistic' && getGroundField() !== null;
}
