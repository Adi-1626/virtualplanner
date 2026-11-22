import type { Viewer } from 'cesium';
import { getQualityTier, setQualityTier, SlowFrameDetector, userPickedTier, wasAutoDropped } from './qualityTier';
import { getVisualStyle } from './visualStyle';

/**
 * Drops Realistic to the Low tier for this session when frames stay slower than 33 ms for 3 s (§A5), and says so.
 * Only while Realistic is on, only for the default tier (never over a tier the user picked), at most once per
 * session, and not in the first 10 s after start (initial data load and tile builds stall the main thread).
 */
export function startQualityWatchdog(viewer: Viewer): () => void {
  const post = (viewer?.scene as unknown as { postRender?: { addEventListener: (f: () => void) => () => void } })?.postRender;
  if (!post || typeof performance === 'undefined') return () => {};
  const detector = new SlowFrameDetector(33, 3000);
  const startedAt = performance.now();
  return post.addEventListener(() => {
    if (getVisualStyle() !== 'realistic' || getQualityTier() === 'low' || wasAutoDropped() || userPickedTier()) return;
    if (performance.now() - startedAt < 10_000) return;
    if (detector.frame(performance.now())) {
      setQualityTier('low', { auto: true });
      (window as unknown as { showToast?: (m: string, k: string) => void }).showToast?.(
        'Rendering was slow (under 30 frames a second), so Realistic switched to Low quality: no textures. Change it under Explore › Visual style.', 'info');
    }
  });
}
