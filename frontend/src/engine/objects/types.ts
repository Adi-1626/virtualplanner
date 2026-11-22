export type CityObjectType = 'road' | 'building' | 'junction' | 'flyover' | 'utility' | 'metro_line' | 'metro_station' | 'zone' | 'gateway' | 'metro_flyover' | 'underground_alignment';

export interface BaseCityObject {
  id: string;
  type: CityObjectType;
  name: string;
  layerId: string;
  scenarioId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Certainty of individual field values (docs/urbanos/DESIGN_TOOLS_AND_HONESTY.md §4):
   * e.g. { floors: 'hypothetical' } when the value is a tool default or a design input.
   * Absent = not recorded (treat as unknown in the UI, not as measured).
   */
  valueCertainty?: Partial<Record<string, import('./certainty').Certainty>>;
}

export type RoadClassification = 'highway' | 'arterial' | 'collector' | 'local';
export type TrafficDirection = 'forward' | 'backward' | 'both';
export type ReserveType = 'future_widening' | 'utility_corridor' | 'drainage' | 'green_buffer' | 'setback' | 'unknown';
export type MeasurementSource = 'OSM' | 'satellite' | 'municipal' | 'manual' | 'surveyed';
export type MeasurementConfidence = 'unknown' | 'estimated' | 'verified' | 'surveyed';
export type InfrastructureState = 'existing' | 'proposed';

export interface RoadsideProfile {
  footpathWidth: number;
  cycleTrackWidth: number;
  vergeWidth: number;
  parkingWidth: number;
  drainageWidth: number;
}

export interface CarriagewayProfile {
  direction: TrafficDirection;
  lanes: number;
  laneWidth: number;
  leftRoadside: RoadsideProfile;
  rightRoadside: RoadsideProfile;
}

export interface ReservedSpace {
  type: ReserveType;
  width: number;
  side: 'left' | 'right';
  status: InfrastructureState;
}

export interface ProvenanceMetadata {
  originalSource: MeasurementSource;
  originalConfidence: MeasurementConfidence;
  geometryModified: boolean;
  profileModified: boolean;
  lastModifiedBy: 'importer' | 'manual';
  verificationStatus: 'unverified' | 'verified' | 'surveyed';
}

export interface OSMProvenance {
  osmId: number;
  originalTags: Record<string, string>;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  roundabout: boolean;
  /**
   * Set on a piece of a way cut at a study-area boundary ("Map Selected Area"):
   * which area and piece, and which ends were made by the cut (the road goes on
   * outside the area there).
   */
  clip?: { areaId: string; piece: number; startCut: boolean; endCut: boolean };
}

export interface RoadSectionProfile {
  startNodeIndex: number;
  endNodeIndex: number;
  totalRowWidth: number;
  wideningPossible: boolean;
  hasMedian: boolean;
  medianWidth: number;
  carriagewayA: CarriagewayProfile;
  carriagewayB?: CarriagewayProfile;
  reservedSpaces: ReservedSpace[];
  provenance: ProvenanceMetadata;
  /** The street cross-section template this profile came from, with its source (engine/crossSection, docs/urbanos/CROSS_SECTIONS.md). */
  crossSection?: import('../crossSection/apply').AppliedCrossSection;
}

export interface RoadObject extends BaseCityObject {
  type: 'road';
  /** Editable PI + radius geometry (GEOMETRY_EDITOR_DESIGN.md §3.1). Absent = legacy polyline. When present, `coordinates` is derived from it. */
  alignment?: import('../geometry/alignment/types').HorizontalAlignment;
  coordinates: [number, number, number][]; // Array of [longitude, latitude, elevation]
  sourceCoordinates?: [number, number, number][];
  sections?: RoadSectionProfile[];
  /** Right-of-way available on the ground (m), entered by the planner from a DP / survey; absent = unknown (never guessed). */
  availableRowM?: number | null;
  /** Where availableRowM came from (e.g. "DP 2017 sheet 12"), shown with the RoW check. */
  availableRowSource?: string;
  
  // Legacy fallback fields for compatibility
  roadClass: RoadClassification;
  width: number; // overall width in meters
  laneCount: number;
  laneWidth: number; // width per lane in meters
  hasDivider: boolean;
  dividerWidth: number; // width of center divider in meters
  hasFootpath: boolean;
  footpathWidth: number; // width of footpaths on each side in meters
  speedLimit: number; // km/h
  isOneWay: boolean;
  trafficCapacity: number; // vehicles per hour
  connectedJunctions: string[]; // junction object IDs
  
  // Provenance details
  osmProvenance?: OSMProvenance;
  /** Crossings drawn where the level was not certain, with the user's decision (docs/TOPOLOGY_RECONSTRUCTION.md). */
  levelCrossings?: import('../editing/levelCrossings').LevelCrossing[];
  /** Vertices this object's crossings / end junctions put into other roads (editing/addedVertices.ts): taken back when a reshape no longer uses them. */
  addedNetworkVertices?: import('../editing/addedVertices').AddedVertex[];

  // Set when a flyover ramp merge/weave zone reduces this road's effective capacity
  flyoverImpact?: {
    flyoverId: string;
    flyoverName: string;
    capacityReductionPercent: number;
    originalCapacity: number;
    reason: string;
  };
}

export type BuildingUsage = 'residential' | 'commercial' | 'industrial' | 'educational' | 'institutional' | 'mixed';

export type BuildingCategory =
  | 'residential'
  | 'office'
  | 'IT'
  | 'commercial'
  | 'retail'
  | 'industrial'
  | 'hospital'
  | 'school'
  | 'college'
  | 'hotel'
  | 'government'
  | 'mixed_use'
  | 'other';

export type BuildingState = 'existing' | 'under_construction' | 'proposed';

export interface BuildingActivityProfile {
  peakArrivalStart?: string;
  peakArrivalEnd?: string;
  peakDepartureStart?: string;
  peakDepartureEnd?: string;
  modeSplit?: {
    car?: number;
    twoWheeler?: number;
    bus?: number;
    metro?: number;
    walk?: number;
    other?: number;
  };
  tripGeneration?: {
    dailyTrips?: number;
    amPeakTrips?: number;
    pmPeakTrips?: number;
  };
}

export interface BuildingAccessPoints {
  mainEntrance?: [number, number, number];
  vehicleEntrance?: [number, number, number];
  serviceEntrance?: [number, number, number];
}

export interface BuildingObject extends BaseCityObject {
  type: 'building';
  coordinates: [number, number, number][]; // Polygon outer boundary [longitude, latitude, elevation]
  usageType: BuildingUsage;
  height: number; // meters
  floors: number;
  population: number;
  parkingSpaces: number;
  waterDemand: number; // Liters/day
  electricityDemand: number; // kWh/day
  constructionYear: number;

  // New persistent building planning properties
  category?: BuildingCategory;
  state?: BuildingState;
  
  // Specific capacity metrics (optional based on category)
  residents?: number;
  employees?: number;
  students?: number;
  patients?: number;
  visitorsPerDay?: number;
  parkingCapacity?: number;
  notes?: string;

  // OSM Provenance details
  osmId?: number;
  originalOsmTags?: Record<string, string>;
  source?: 'OSM' | 'manual' | 'municipal' | 'surveyed';
  originalFootprint?: [number, number, number][];
  isManuallyEdited?: boolean;

  // Traffic / Activity profiles
  activityProfile?: BuildingActivityProfile;

  // Connection points to road network
  accessPoints?: BuildingAccessPoints;
  nearestEdgeId?: string;
  accessNodeId?: string;
}

export interface JunctionObject extends BaseCityObject {
  type: 'junction';
  coordinates: [number, number, number]; // [longitude, latitude, elevation]
  connectedRoads: string[]; // Road object IDs
  hasSignals: boolean;
  signalTiming: number; // cycle length in seconds
  hasPedestrianCrossing: boolean;
  /**
   * Set on an edit of an imported (OpenStreetMap) junction as a whole: its
   * control, signal plan, priority, banned turns and lane connections,
   * matched to the network by the junction's member nodes (docs/OVERHAUL.md
   * §23). Such an object draws nothing on the map and is not a placed junction.
   */
  importedJunction?: import('../simulation/junctionControl').JunctionEditSpec;
}

export interface FlyoverObject extends BaseCityObject {
  type: 'flyover';
  /** Editable PI + radius geometry (GEOMETRY_EDITOR_DESIGN.md §3.1). Absent = legacy polyline. When present, `coordinates` is derived from it. */
  alignment?: import('../geometry/alignment/types').HorizontalAlignment;
  levelCrossings?: import('../editing/levelCrossings').LevelCrossing[];
  /** Vertices this object's crossings / end junctions put into other roads (editing/addedVertices.ts): taken back when a reshape no longer uses them. */
  addedNetworkVertices?: import('../editing/addedVertices').AddedVertex[];
  coordinates: [number, number, number][]; // Path of flyover
  roadClass: RoadClassification;
  width: number; // overall width in meters
  laneCount: number;
  laneWidth: number;
  hasDivider: boolean;
  dividerWidth: number;
  hasFootpath: boolean;
  footpathWidth: number;
  speedLimit: number;
  isOneWay: boolean;
  elevation: number; // base height of deck above terrain in meters (e.g. 6)
  pierSpacing: number; // spacing between support columns in meters (e.g. 30)
  groundCoordinates?: [number, number, number][];

  // Populated by BridgeFeasibilityEngine at creation time
  feasibilityResult?: import('../simulation/BridgeFeasibilityEngine').FeasibilityResult;
  // IDs of surface RoadObjects whose capacity was reduced due to this flyover's ramps
  surfaceRoadIds?: string[];
}

export interface MetroLineObject extends BaseCityObject {
  type: 'metro_line';
  /** Editable PI + radius geometry (GEOMETRY_EDITOR_DESIGN.md §3.1). Absent = legacy polyline. When present, `coordinates` is derived from it. */
  alignment?: import('../geometry/alignment/types').HorizontalAlignment;
  coordinates: [number, number, number][]; // Path of elevated rail tracks
  trackCount: number; // e.g. 1 or 2
  trackGauge: number; // in meters (default 1.435)
  deckWidth: number; // overall width in meters (e.g. 8.0)
  elevation: number; // height of track deck above terrain (e.g. 12)
  pierSpacing: number; // column spacing (default 30)
  status?: 'operational' | 'under_construction';
  tags?: Record<string, string>;
}

export interface MetroStationObject extends BaseCityObject {
  type: 'metro_station';
  coordinates: [number, number, number]; // Location [longitude, latitude, elevation]
  stationName: string;
  length: number; // in meters (default 140)
  width: number; // in meters (default 20)
  height: number; // in meters (default 8)
  elevation: number; // platform floor level above ground (e.g. 12)
  capacity: number; // passenger capacity
  heading?: number; // degrees clockwise from north along the platform's long axis (default 0)
  alignToTrack?: boolean; // follow the nearest metro track within 100 m (default true)
}

export type UtilityType = 'water' | 'electricity' | 'sewage' | 'gas' | 'fiber';

export interface UtilityObject extends BaseCityObject {
  type: 'utility';
  /** Editable PI + radius geometry (GEOMETRY_EDITOR_DESIGN.md §3.1). Absent = legacy polyline. When present, `coordinates` is derived from it. */
  alignment?: import('../geometry/alignment/types').HorizontalAlignment;
  coordinates: [number, number, number][]; // Path or line of utility piping/cables
  utilityType: UtilityType;
  /**
   * DERIVED (engine/underground/utilityModel.ts): shallowest known top-of-pipe depth, m below ground. Kept for the screening
   * engine and older readers; the source of truth is `depths` + `zRef`. Absent `depths` = a legacy object (migrated on read).
   */
  depth: number;
  capacity: number; // capacity units
  /** DERIVED: worst certainty of the vertices giving `depth`. 'unknown' means no top-of-pipe depth is known (depth is a placeholder). */
  depthCertainty?: import('./certainty').Certainty;
  /** Internal/nominal diameter in mm; null/absent = unknown (never 0). */
  diameterMm?: number | null;
  /** Per-vertex typed depth (to zRef), certainty, default flag, elevation + ground reference. Same order as coordinates. */
  depths?: import('../underground/utilityModel').UtilityVertexDepth[];
  /** Typed depths at the alignment PIs (one per PI) when `alignment` is set; `depths` is then derived by chainage (§3.4). */
  depthControls?: import('../underground/utilityModel').UtilityVertexDepth[];
  /** Which part of the pipe the typed depths are to (absent = top of pipe). */
  zRef?: import('../underground/utilityModel').UtilityZRef;
  /** Lifecycle status, separate from evidence. */
  status?: import('../underground/utilityModel').UtilityStatus;
  /** How the position is known (ASCE 38 QL-A..D, user-drawn, unknown). */
  evidence?: import('../underground/utilityModel').UtilityEvidence;
}

export interface MetroFlyoverObject extends BaseCityObject {
  type: 'metro_flyover';
  /** Editable PI + radius geometry (GEOMETRY_EDITOR_DESIGN.md §3.1). Absent = legacy polyline. When present, `coordinates` is derived from it. */
  alignment?: import('../geometry/alignment/types').HorizontalAlignment;
  levelCrossings?: import('../editing/levelCrossings').LevelCrossing[];
  /** Vertices this object's crossings / end junctions put into other roads (editing/addedVertices.ts): taken back when a reshape no longer uses them. */
  addedNetworkVertices?: import('../editing/addedVertices').AddedVertex[];
  coordinates: [number, number, number][]; // Path of double-decker corridor
  roadClass: RoadClassification;
  width: number; // overall width of flyover deck (e.g. 19)
  laneCount: number;
  laneWidth: number;
  hasDivider: boolean;
  dividerWidth: number;
  hasFootpath: boolean;
  footpathWidth: number;
  speedLimit: number;
  isOneWay: boolean;
  elevation: number; // middle deck height above ground (e.g. 6)
  metroElevation: number; // top deck height above ground (e.g. 12)
  pierSpacing: number; // central column spacing (e.g. 30)
  groundCoordinates?: [number, number, number][];

  // Populated by BridgeFeasibilityEngine at creation time
  feasibilityResult?: import('../simulation/BridgeFeasibilityEngine').FeasibilityResult;
  surfaceRoadIds?: string[];
}

export type CityObject = RoadObject | BuildingObject | JunctionObject | FlyoverObject | UtilityObject | MetroLineObject | MetroStationObject | ZoneObject | GatewayObject | MetroFlyoverObject | UndergroundAlignmentObject;

/** What an underground alignment is (docs/urbanos/UNDERGROUND_WORKSPACE.md). Planning geometry only, no design. */
export type UndergroundAlignmentKind = 'bored_tunnel' | 'underground_metro' | 'cut_and_cover' | 'utility_trunk' | 'storm_drain';

/** Cross-section entered by the user. Dimensions in metres (outer extent); null = UNKNOWN (never 0). */
export type UndergroundSection =
  | { shape: 'circular'; diameterM: number | null }
  | { shape: 'box'; widthM: number | null; heightM: number | null };

/** Depth at one plan vertex: crown (top of structure) below ground in metres, positive down. null = UNKNOWN. */
export interface UndergroundVertexDepth {
  /** What the user typed: depth of the crown below ground (m, + down). null = UNKNOWN. */
  crownDepthM: number | null;
  certainty: import('./certainty').Certainty;
  /**
   * Absolute elevation of `zRef` (m, in `datum`), derived from the typed depth and the ground model at the time
   * (research §2.3: keep the elevation, the typed depth and the ground model + version used to convert it).
   * null/absent = not converted (ground UNKNOWN there or not yet sampled).
   */
  elevationM?: number | null;
  /** Vertical datum of elevationM / groundM. */
  datum?: 'EGM2008';
  /** Which part of the cross-section elevationM is (the typed depth is always to the crown). */
  zRef?: 'crown' | 'centre' | 'invert';
  /** Ground elevation used for the conversion (m, datum). */
  groundM?: number | null;
  /** Ground model + version used, e.g. "Copernicus GLO-30 DSM v3 (dsv_…)". */
  groundModel?: string | null;
}

/** Lifecycle status (line style), separate from evidence/certainty (opacity). Absent = proposed. */
export type UndergroundLifecycle = 'proposed' | 'conceptual' | 'existing';

/**
 * A buried linear structure drawn on the ground (plan polyline) with a depth per vertex and a typical cross-section.
 * Ground is a flat datum (no DEM in the repo), so depths are relative to that datum. Stored like every other city
 * object, so scenario copy-on-write, versions and undo apply.
 */
export interface UndergroundAlignmentObject extends BaseCityObject {
  type: 'underground_alignment';
  /** Editable PI + radius geometry (GEOMETRY_EDITOR_DESIGN.md §3.1). Absent = legacy polyline. When present, `coordinates` is derived from it. */
  alignment?: import('../geometry/alignment/types').HorizontalAlignment;
  coordinates: [number, number, number][]; // plan vertices on the ground (z ignored)
  alignmentKind: UndergroundAlignmentKind;
  section: UndergroundSection;
  sectionCertainty: import('./certainty').Certainty;
  /** One entry per coordinate (same order). */
  depths: UndergroundVertexDepth[];
  /** Typed depths at the alignment PIs (one per PI) when `alignment` is set; `depths` is then derived by chainage (§3.4). */
  depthControls?: UndergroundVertexDepth[];
  /** Proposed (default), conceptual / illustrative, or existing (entered from records). */
  lifecycle?: UndergroundLifecycle;
}

export interface ZoneObject extends BaseCityObject {
  type: 'zone';
  coordinates: [number, number, number][]; // Boundary polygon coordinates
  totalPopulation: number;
  totalEmployment: number;
  landUseMix: {
    residential: number; // percentage (0 to 100)
    commercial: number;
    industrial: number;
    educational: number;
  };
  gateways: string[]; // Associated Gateway IDs
  provenance: {
    source: 'estimated' | 'synthetic' | 'observed' | 'survey' | 'hypothetical';
    confidence: number;
    updatedAt: string;
  };
}

export interface GatewayObject extends BaseCityObject {
  type: 'gateway';
  coordinates: [number, number, number][]; // Single gateway coordinate: [[lon, lat, alt]]
  connectedNodeId: string;
  inboundFlows: Record<string, number>; // TimePeriod -> flow (vehicles/hr)
  outboundFlows: Record<string, number>;
  modeSplit: {
    car: number;
    twoWheeler: number;
    bus: number;
    metro: number;
    walking: number;
    other: number;
  };
  provenance: {
    source: 'estimated' | 'synthetic' | 'observed' | 'survey' | 'hypothetical';
    confidence: number;
    updatedAt: string;
  };
}

export interface Area {
  id: string;
  name: string;
  polygonCoordinates: [number, number, number][]; // Array of [longitude, latitude, elevation]
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  createdAt: string;
}
