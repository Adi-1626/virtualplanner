import type { EditingMode } from '../../engine/editing/EditingEngine';

/**
 * Where a tool's settings open: the Study area tool's settings sit in the column under the palette ('inline'), because
 * drawing an area means clicking anywhere on the map and the floating panel took the first corner click (p5 QA F8);
 * the other tools keep the popover beside the palette; Select has none.
 */
export function settingsPlacement(mode: EditingMode): 'inline' | 'popover' | 'none' {
  return mode === 'select' ? 'none' : mode === 'import_osm' ? 'inline' : 'popover';
}
