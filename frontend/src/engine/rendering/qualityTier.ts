/**
 * Rendering quality tiers (BUILD_VISUALS_AND_TOOLS_PLAN §A5). Medium is the default.
 * - low:    lit material colours, no textures, no FXAA (weak GPUs; automatic fallback);
 * - medium: + CC0 detail-texture atlas, FXAA;
 * - high:   + MSAA 4× (where the browser supports WebGL 2 multisampling).
 * Auto-drop: if the mean frame time stays above 33 ms (under 30 fps) for 3 s while Realistic is on, the tier drops to
 * Low for the session and the user is told; a tier the user picked stays persisted in localStorage.
 */
export type QualityTier = 'low' | 'medium' | 'high';
export const QUALITY_KEY = 'urbanos.qualityTier';
export const DEFAULT_QUALITY: QualityTier = 'medium';

type Listener = (t: QualityTier, auto: boolean) => void;
const listeners = new Set<Listener>();

function read(): QualityTier {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(QUALITY_KEY) : null;
    return v === 'low' || v === 'medium' || v === 'high' ? v : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

let tier: QualityTier = read();
let autoDropped = false;

export const getQualityTier = (): QualityTier => tier;
export const wasAutoDropped = (): boolean => autoDropped;

export function setQualityTier(t: QualityTier, opts: { auto?: boolean } = {}): void {
  if (t === tier) return;
  tier = t;
  autoDropped = !!opts.auto;
  if (!opts.auto) {
    try { localStorage.setItem(QUALITY_KEY, t); } catch { /* session only */ }
  }
  listeners.forEach(l => l(t, !!opts.auto));
}

export function onQualityTierChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether the user has picked a tier (stored); the automatic drop only applies to the default. */
export function userPickedTier(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(QUALITY_KEY) !== null; } catch { return false; }
}

export function _reloadQualityForTests(): void {
  tier = read();
  autoDropped = false;
}

/**
 * Frame-time watchdog: feed it frame timestamps (ms); it reports true once frames have averaged slower than
 * `maxFrameMs` over a continuous `windowMs`. Pure, so it is unit-tested without a GPU.
 */
export class SlowFrameDetector {
  private start: number | null = null;
  private frames = 0;
  private last: number | null = null;
  private maxFrameMs: number;
  private windowMs: number;
  constructor(maxFrameMs = 33, windowMs = 3000) {
    this.maxFrameMs = maxFrameMs;
    this.windowMs = windowMs;
  }
  /** Returns true when the tier should drop. */
  frame(now: number): boolean {
    if (this.last === null) { this.last = now; this.start = now; this.frames = 0; return false; }
    const dt = now - this.last;
    this.last = now;
    // A pause (tab hidden, requestRenderMode idle) is not slowness: restart the window. A single long frame
    // (250 ms – 1 s) is a main-thread stall (tile rebuild, data load), not GPU cost: skip it without counting it
    if (dt > 1000) { this.start = now; this.frames = 0; return false; }
    if (dt > 250) { this.start = (this.start as number) + dt; return false; }
    this.frames++;
    const elapsed = now - (this.start as number);
    if (elapsed >= this.windowMs) {
      const mean = elapsed / this.frames;
      this.start = now;
      this.frames = 0;
      return mean > this.maxFrameMs;
    }
    return false;
  }
}
