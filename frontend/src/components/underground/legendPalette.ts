/**
 * Colours the Underground 3D view draws that UndergroundRenderer.ts keeps as private literals (it exports RECORD_COLOR,
 * UTILITY_COLOR and EVIDENCE_ALPHA, which the legend imports directly). Copied here for the legend only; the test
 * UndergroundLegend.test.ts reads UndergroundRenderer.ts and fails if any of these drift from what it draws.
 * Follow-up for the renderer owner: export these from the renderer (or import them from here) so there is one source.
 */
import type { UndergroundAlignmentKind } from '../../engine/objects/types';

/** UndergroundRenderer KIND_COLOR: proposed / existing alignment colour by kind. */
export const ALIGNMENT_KIND_COLOR: Record<UndergroundAlignmentKind, string> = {
  bored_tunnel: '#f59e0b', underground_metro: '#a855f7', cut_and_cover: '#f97316', utility_trunk: '#22d3ee', storm_drain: '#22c55e',
};

export const LEGEND_COLOR = {
  /** renderMetroPlanOnly: dashed purple plan line (tunnel) and dashed outline (station) */
  metroPlanOnly: '#a855f7',
  /** spans whose depth is UNKNOWN, drawn dashed grey on the surface (alignments, utilities, boreholes without depth) */
  unknownDepth: '#94a3b8',
  /** boreholes with a final depth */
  borehole: '#eab308',
  /** the selected drawn utility's plan trace (Color.WHITE) and the selected alignment's outline */
  selected: '#ffffff',
} as const;
