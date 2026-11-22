/**
 * Street elements drawn in Design (docs/urbanos/DESIGN_TOOLS_P7.md): pedestrian crossings, bus stops, streetlights,
 * street trees, roundabouts and standalone paths (footpath / cycle track / FOB / subway). One object type
 * ('street_element') with a kind, stored like every other city object, so proposal copy-on-write, undo/redo and
 * save/reload apply unchanged. Rendering beyond a simple placeholder is the visuals work's (this module emits data).
 */

export type StreetElementKind = 'crossing' | 'bus_stop' | 'streetlight' | 'street_tree' | 'roundabout' | 'path';

/** Where an element sits on a road: the road's id, chainage along its centreline from its first vertex, side. */
export interface RoadAnchor {
  roadId: string;
  chainageM: number;
  /** Signed offset of the click from the centreline (+ left of the road's drawn direction). */
  offsetM: number;
  side: 'left' | 'right';
}

export type CrossingType = 'zebra' | 'raised' | 'signalised';

export interface CrossingSpec {
  crossingType: CrossingType;
  /** Width of the crossing along the road (m). */
  widthM: number;
  /** Length across the carriageway to be crossed (m), from the road's lanes when drawn; null = unknown. */
  lengthM: number | null;
  /** A refuge island in the middle and its width along the crossing (m). */
  refuge: boolean;
  refugeWidthM: number | null;
  /** Mid-block signal cycle (s), design input; null = the assumed default. */
  signalCycleS?: number | null;
  /** Pedestrians per hour on the crossing, when the user has a count; null = unknown (never assumed). */
  pedsPerHour?: number | null;
}

export type BusStopPlacement = 'kerb' | 'bay' | 'median_brt';

export interface BusStopSpec {
  placement: BusStopPlacement;
  shelterLengthM: number;
  shelterDepthM: number;
  /** BRT median station: inner clear width and outer width (m). */
  stationInnerM?: number | null;
  stationOuterM?: number | null;
}

export interface RoadsideSpec {
  /** Streetlight pole height (m), tree canopy clearance (m). */
  poleHeightM?: number | null;
  /** Spacing to the next light / tree on the same side when placed as a run (m). */
  spacingM?: number | null;
  /** Number of items in the run (1 = a single light / tree). */
  count: number;
  /** Tree pit size (m, square), canopy clearance above the footpath (m). */
  pitM?: number | null;
  canopyClearanceM?: number | null;
  /** Placement on the cross-section: footpath, furniture / tree zone, median. */
  zone: 'footpath' | 'furniture' | 'median';
  /** Positions of each item in the run (filled on placement). */
  points: [number, number, number][];
}

export type RoundaboutCategory = 'urban_single' | 'double' | 'mini';

export interface RoundaboutSpec {
  category: RoundaboutCategory;
  /** Inscribed circle diameter (m). */
  icdM: number;
  /** Central island diameter (m). */
  islandM: number;
  /** Circulatory carriageway width (m). */
  circulatoryM: number;
  /** Arms meeting at the roundabout (from the roads at the clicked junction). */
  armRoadIds: string[];
  armCount: number;
  /** Network node keys (rounded positions) of the junction it replaces, for the network model. */
  nodeKeys: string[];
  /** Available right-of-way diameter at the junction (m), entered by the planner; null = unknown. */
  availableDiameterM?: number | null;
  /** Entry lanes per arm (1 single-lane, 2 double-lane). */
  entryLanes: number;
}

export type PathType = 'footpath' | 'cycle_one_way' | 'cycle_two_way' | 'shared';
export type PathLevel = 'ground' | 'fob' | 'subway';

export interface PathSpec {
  pathType: PathType;
  level: PathLevel;
  widthM: number;
  /** FOB: deck clear height over the road (m); subway: clear height (m). */
  clearHeightM?: number | null;
  /** FOB / subway: ramp gradient (rise / run), lift provided. */
  rampGradient?: number | null;
  hasLift?: boolean;
  /** Buffer to the carriageway (m) for a cycle track beside a road; null = not beside a road / unknown. */
  bufferM?: number | null;
}
