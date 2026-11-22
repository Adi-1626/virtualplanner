/**
 * Renderer-side shape of a junction marking, matching `MarkingItem` from the street-design junction tool
 * (`engine/streetDesign/junctionTool.ts`, p7-tools branch). Declared structurally here so the renderer does not
 * depend on that module: any `MarkingItem[]` can be passed straight to `RenderManager.setJunctionMarkings`.
 */
export type JunctionMarkingKind = 'stop_line' | 'double_stop_line' | 'give_way_line' | 'zebra' | 'arrow' | 'stop_word' | 'give_way_triangle';

export interface JunctionMarkingInput {
  kind: JunctionMarkingKind;
  /** Plan line across the approach lanes (transverse lines, zebra centreline) or along the lane, tail → head (arrow); lng/lat/z. */
  line: readonly (readonly number[])[];
  /** Painted line width along the road (m), or the zebra's width along the road. */
  widthM: number;
  dashM: number | null;
  gapM: number | null;
  doubleGapM: number | null;
}
