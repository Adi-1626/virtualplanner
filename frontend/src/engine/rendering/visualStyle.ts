/**
 * Visual style of Design geometry (BUILD_VISUALS_AND_TOOLS_PLAN §A3.1).
 *
 * - `realistic` (default): lit shading with hard edges, material colours, textures by quality tier.
 * - `schematic`: the legend look (flat, UI colours), kept for legibility, printing and traffic tint.
 *
 * Persisted per browser in localStorage. Geometry does not depend on the style (meshes are shared by both), only the
 * appearance does, so switching never regenerates meshes; renderers just rebuild their primitives.
 */
export type VisualStyle = 'realistic' | 'schematic';

export const VISUAL_STYLE_KEY = 'urbanos.visualStyle';
export const DEFAULT_VISUAL_STYLE: VisualStyle = 'realistic';

type Listener = (style: VisualStyle) => void;
const listeners = new Set<Listener>();

function read(): VisualStyle {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(VISUAL_STYLE_KEY) : null;
    return v === 'schematic' || v === 'realistic' ? v : DEFAULT_VISUAL_STYLE;
  } catch {
    return DEFAULT_VISUAL_STYLE;
  }
}

let current: VisualStyle = read();

export function getVisualStyle(): VisualStyle {
  return current;
}

export function setVisualStyle(style: VisualStyle): void {
  if (style === current) return;
  current = style;
  try {
    localStorage.setItem(VISUAL_STYLE_KEY, style);
  } catch {
    // private mode: keep it for this session only
  }
  listeners.forEach(l => l(style));
}

export function toggleVisualStyle(): VisualStyle {
  setVisualStyle(current === 'realistic' ? 'schematic' : 'realistic');
  return current;
}

export function onVisualStyleChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Test hook: re-read the stored value. */
export function _reloadVisualStyleForTests(): void {
  current = read();
}
