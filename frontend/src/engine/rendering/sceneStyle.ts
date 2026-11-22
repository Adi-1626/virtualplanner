import type { Viewer } from 'cesium';
import type { VisualStyle } from './visualStyle';

/**
 * Scene-wide settings per visual style: Realistic turns on FXAA so the hard edges of decks, kerbs and piers stay crisp
 * without the cost of MSAA (BUILD_VISUALS_AND_TOOLS_PLAN §A5, Medium tier). Schematic leaves the scene as it was.
 * Guarded: the unit-test viewer mock has no post-process stages.
 */
export function applySceneStyle(viewer: Viewer, style: VisualStyle): void {
  const fxaa = (viewer?.scene as unknown as { postProcessStages?: { fxaa?: { enabled: boolean } } })?.postProcessStages?.fxaa;
  if (fxaa) fxaa.enabled = style === 'realistic';
}
