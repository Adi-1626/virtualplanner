import type { EditingMode } from './EditingEngine';

/**
 * Whether the snap marker and its label are shown for a tool. Select does not snap, and the Study area tool
 * (import_osm) draws an outline that never joins a road, so a "Snap to …" label there was misleading (DESIGN_WORKSPACE
 * known limits, 2026-11-15).
 */
export function snapPreviewWanted(mode: EditingMode): boolean {
  return mode !== 'select' && mode !== 'import_osm';
}

/** The marker of the previous tool is cleared whenever the tool changes (p5 QA: it stayed after switching tools). */
export function snapPreviewStale(previous: EditingMode | null, current: EditingMode): boolean {
  return previous !== current || !snapPreviewWanted(current);
}
