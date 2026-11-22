import { dim } from './visualDims';

/**
 * Cross-section profiles swept along a path by `extrudeProfile` (BUILD_VISUALS_AND_TOOLS_PLAN §A3.5).
 * Local metres: x across the path (positive to the right of travel), y up from the path point (deck top = 0).
 * `centre` is a point inside the section from which every vertex is visible (end caps are fanned from it).
 * Which values are sourced and which assumed: standards/visualDims.ts.
 */
export interface Profile2D {
  pts: [number, number][];
  centre: [number, number];
}

/**
 * Trapezoidal single-cell box girder with cantilever wings, outer silhouette (the void is not drawn).
 * Deck width W [deck-specific], depth D and soffit ratio assumed for road flyovers; for the Pune metro viaduct W = 8.5 m
 * (official), D and soffit assumed.
 */
export function boxGirderProfile(width: number, depth: number, soffit: number): Profile2D {
  const h = width / 2;
  const s = Math.min(soffit, width * 0.8) / 2;
  const wingTip = Math.min(0.3, depth * 0.15);
  const wingRoot = Math.min(0.55, depth * 0.3);
  const root = Math.max(s + 0.2, Math.min(h - 0.3, s + (h - s) * 0.45));
  return {
    pts: [[-h, 0], [h, 0], [h, -wingTip], [root, -wingRoot], [s, -depth], [-s, -depth], [-root, -wingRoot], [-h, -wingTip]],
    centre: [0, -Math.min(0.2, wingTip * 0.6)],
  };
}

/**
 * New-Jersey safety-shape barrier, symmetric (median), base 0.6 m, top 0.15 m: shape assumed (IRC:119 / IRC:5 not
 * obtainable), height from `crashBarrierHeight`.
 */
export function jerseyMedianProfile(height = dim('crashBarrierHeight')): Profile2D {
  const k = height / 0.81; // proportions of the 810 mm NJ shape
  return {
    pts: [[-0.3, 0], [0.3, 0], [0.3, 0.075 * k], [0.135, 0.33 * k], [0.075, height], [-0.075, height], [-0.135, 0.33 * k], [-0.3, 0.075 * k]],
    centre: [0, height * 0.35],
  };
}

/**
 * Parapet on a deck edge: vertical outer face, safety shape on the traffic side. `side` −1 = left edge (traffic to the
 * right of it), +1 = right edge. x is measured from the deck centre; `edge` is the edge offset (± half width).
 */
export function jerseyParapetProfile(edge: number, side: -1 | 1, height = dim('crashBarrierHeight')): Profile2D {
  const k = height / 0.81;
  const inward = -side; // toward the deck centre
  const x = (d: number) => edge + inward * d;
  const pts: [number, number][] = [[x(0), 0], [x(0.45), 0], [x(0.45), 0.075 * k], [x(0.28), 0.33 * k], [x(0.2), height], [x(0), height]];
  return { pts: side === 1 ? pts : pts.slice().reverse(), centre: [x(0.15), height * 0.35] };
}

/** Plain rectangular section (parapet wall, plinth, kerb). */
export function rectProfile(x0: number, x1: number, y0: number, y1: number): Profile2D {
  return { pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], centre: [(x0 + x1) / 2, (y0 + y1) / 2] };
}

/**
 * Generic U-girder trough for one track (option only). Pune U-girder dimensions are UNKNOWN (no official drawing):
 * drawn as a generic shape so the option can be compared, and labelled "type not confirmed" in the inspector.
 * Returned as three rectangles (floor + two webs) so it stays hollow.
 */
export function uGirderParts(centreX: number, outerWidth = 4.2, depth = 1.9, wall = 0.25, floor = 0.3): Profile2D[] {
  const h = outerWidth / 2;
  return [
    rectProfile(centreX - h, centreX + h, -depth, -depth + floor),
    rectProfile(centreX - h, centreX - h + wall, -depth, 0.9),
    rectProfile(centreX + h - wall, centreX + h, -depth, 0.9),
  ];
}
