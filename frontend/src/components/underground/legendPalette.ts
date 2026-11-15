/**
 * Colours the Underground 3D view draws, for the legend. They are exported by UndergroundRenderer.ts (one source; the
 * legend also imports RECORD_COLOR, UTILITY_COLOR and EVIDENCE_ALPHA from it directly).
 */
import { BOREHOLE_COLOR, KIND_COLOR, METRO_PLAN_COLOR, SELECTED_COLOR, UNKNOWN_DEPTH_COLOR } from '../../engine/underground/UndergroundRenderer';

/** UndergroundRenderer KIND_COLOR: proposed / existing alignment colour by kind. */
export const ALIGNMENT_KIND_COLOR = KIND_COLOR;

export const LEGEND_COLOR = {
  /** renderMetroPlanOnly: dashed purple plan line (tunnel) and dashed outline (station) */
  metroPlanOnly: METRO_PLAN_COLOR,
  /** spans whose depth is UNKNOWN, drawn dashed grey on the surface (alignments, utilities, boreholes without depth) */
  unknownDepth: UNKNOWN_DEPTH_COLOR,
  /** boreholes with a final depth */
  borehole: BOREHOLE_COLOR,
  /** the selected drawn utility's plan trace (Color.WHITE) and the selected alignment's outline */
  selected: SELECTED_COLOR,
} as const;
