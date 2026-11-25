import type { Viewer } from 'cesium';
import { TUNED_SUPPLY, TUNED_SUPPLY_DEFAULT_ON } from '../calibration/tunedSupply';
import type { SupplyParams } from './supplyParams';
import { SUPPLY_MODEL_DEFAULT, type SupplyModel } from './supplyConfig';
import type { BuildingPoint } from './indianSupply';
import {
  StudyAreaExplorer,
  clampRangeM,
  boundsOf,
  type Bounds,
  type DrivableObject,
  type StudyArea,
  type StudyDirection,
} from './StudyAreaExplorer';
import { roadTilesAround } from './osmCoverage';
import { cacheGetMany, cachePutMany } from '../storage/localCache';
import { OverpassCancelledError } from '../editing/OverpassClient';
import { StudyAreaVisualizer } from '../rendering/renderers/StudyAreaVisualizer';
import { DirectionArrows } from '../rendering/renderers/DirectionArrows';
import { MicroTrafficVisualizer } from '../rendering/renderers/MicroTrafficVisualizer';
import { TrafficMicroSim, STEP_S, OD_REFERENCE_LEVEL, type MicroSimMetrics, type VehicleView } from './TrafficMicroSim';
import type { TrafficSignalSource, SignalPoint } from './trafficSignals';
import { splitJunctionObjects, type JunctionEditSpec } from './junctionControl';
import { junctionApproachDeltas } from './junctionCompare';
import type { JunctionObject } from '../objects/types';

/** Simulator options for the scenario's junction objects: placed junctions as before, imported-junction edits apart (docs/OVERHAUL.md §23). */
const junctionOptions = (junctions: readonly JunctionObject[] | undefined) => {
  const { placed, edits } = splitJunctionObjects(junctions);
  return { junctions: placed, junctionEdits: edits.length ? edits : undefined };
};
import { createLiveRun, type LiveRun } from './liveTrafficRun';
import type { LiveInit } from './liveTrafficCore';
import { snapDemandPlan, contentKey, networkContentKey, demandContextKey, type SimulationContext, type DemandPlan, type DemandProvenance } from './StudyDemand';
export type { SimulationContext } from './StudyDemand';
import { fetchCountDataset, DEFAULT_COUNT_DATASET, type CountDataset } from '../calibration/observedCounts';
import { apiGet } from '../../lib/api';
import { applyNetworkCorrections, validateCorrectionLayer, type NetworkCorrectionLayer, type CorrectionReport } from './networkCorrections';
import type { RoadObject } from '../objects/types';
import { fitPlan, measureFlows, compareRows, summarize, junctionsIn, zoneFor, junctionChecks, observedFlows, type CalibrationRow, type JunctionCheck, type SimSetup } from '../calibration/calibration';
import { gehAgainst } from '../calibration/ipf';
import type { GehSummary } from '../calibration/geh';
import { fetchEstimatedTraffic, type EstimatedTrafficModel } from './EstimatedTraffic';
import { fetchDiurnalProfile, hourFactor, COUNT_HOURS, type DiurnalProfile, type DayType } from './timeOfDay';
import { compileAreaDemand, fetchCalibratedEdgeFlows, type CalibratedEdgeFlows } from './AreaDemand';
import { matchPlanToEstimates } from './AreaDemandMatch';
import { SyntheticDemandSource } from '../demand/syntheticDemandSource';
import { SYNTHETIC_DEMAND_DEFAULT_ON, SYNTHETIC_DECISION, SYNTHETIC_PARAMS, SYNTHETIC_DATASET_ID } from '../calibration/syntheticDemandDecision';
import { DEFAULT_SUPPLY } from './supplyParams';
import { roadSection, type RoadSection } from './roadSection';
import { startAnalysisJob, type RunningAnalysis } from './analysisRunner';
import { DEFAULT_ANALYSIS, CORRIDOR_RANGE_M, type AnalysisJob, type AnalysisOutput } from './analysisJob';
import { applyUrbanSpeeds, type SpeedReport } from './roadParameters';
import { compareAnalyses, type ComparisonResult, type RunInputs } from './ScenarioComparison';
import { vcColour, vcText } from './RoadAnalysis';
import { fetchScreenlines, type ScreenlineFile } from '../calibration/screenlines';
import { estimateAreaDemand, constraintsToCounts, countsBeforeAfter, type OdmeProvenance } from '../demand/odmeAssignment';
import { countsToConstraints } from '../data/odmeConstraints';
import type { EngineCountRow } from '../data/trafficData';
import type { OdmeFit, OdmeIteration, OdmeOptions } from '../demand/odme';

/**
 * Live view lifecycle: idle (stopped, nothing computing), preparing (waiting
 * for the analysis, then simulating the warm-up off screen), running, paused.
 * Stop returns to idle and releases the simulation; nothing runs while Simulate
 * is closed.
 */
export type TrafficStatus = 'idle' | 'preparing' | 'running' | 'paused';

export interface TrafficRunState {
  status: TrafficStatus;
  /** Simulated seconds per real second. */
  speed: number;
  /** Demand at the area edge as a share of the entering roads' capacity. */
  demandLevel: number;
  /** Send extra traffic through the selected roads, so they are the centre of the study. */
  focus: boolean;
  seed: number;
  metrics: MicroSimMetrics | null;
  error: string | null;
  demand: DemandProvenance | null;
  /** While preparing: what it is waiting for, and how far the warm-up has got (0-1). */
  preparing: { stage: 'analysis' | 'warmup'; progress: number } | null;
  /** Clock hour the live view's demand is for (null while idle). */
  hour: number | null;
  /** Simulated seconds of warm-up run before the live view is shown. */
  warmupS: number;
  /** The machine cannot step the live view as fast as the chosen speed: it runs slower than that (the figures stay correct). */
  behind?: boolean;
}

/** Time-of-day periods offered in the main controls (hourly detail stays under Details). */
export const DAY_PERIODS = [
  { id: 'am', label: 'Morning peak', hour: 9 },
  { id: 'midday', label: 'Midday', hour: 14 },
  { id: 'pm', label: 'Evening peak', hour: 19 },
  { id: 'night', label: 'Night', hour: 23 },
] as const;
export type DayPeriodId = (typeof DAY_PERIODS)[number]['id'];
export const periodOfHour = (hour: number): DayPeriodId | null => DAY_PERIODS.find(p => p.hour === hour)?.id ?? null;

/** The selected road at each period of the day (one analysis run per period). */
export interface TimelineState {
  status: 'idle' | 'running' | 'ready' | 'error';
  progress: number;
  rows: TimelineRow[];
  error: string | null;
  /** Network and demand the rows are for; a change makes them stale. */
  key: string | null;
  /** The network, demand or settings changed since the rows were computed: they describe another case until run again. */
  outdated?: boolean;
  /**
   * A later period started after the case had changed (it reads the network and demand in force when it starts),
   * so the rows mix two cases: outdated whatever the case now is, and never kept for Undo (docs/OVERHAUL.md §25).
   */
  mixed?: boolean;
}

/** One period of the day: its own demand (hour factor on the period's plan), its own assignment and corridor runs. */
export interface TimelineRow {
  period: DayPeriodId; label: string; hour: number;
  /** Area demand at the hour (veh/h): the plan's veh/h times hourFactor. */
  demandVph: number;
  /** Profile share at the hour over the share at referenceHour (the hour the plan represents). */
  hourFactor?: number;
  referenceHour?: number;
  /** The plan before the hour factor (veh/h), its source and land-use half of the day. */
  plannedVph?: number;
  demandSource?: string;
  landUsePeriod?: 'AM_Peak' | 'PM_Peak';
  /** Origin-destination pairs in the period's plan. */
  odPairs?: number;
  seeds?: number[];
  result: AnalysisOutput['result'] | null;
}

/** What is computing right now, for the panel and for tests: nothing should be listed while Simulate is closed or stopped. */
export interface ResourceReport { liveSim: boolean; animationFrame: boolean; warmup: boolean; analysisRunning: boolean; comparisonRunning: boolean; timelineRunning: boolean; timers: number; vehicles: number;
  /** Where the live simulation runs: true in a Web Worker, false on the main thread, null when there is none. */
  liveThreaded?: boolean | null }

export type MapOverlay = 'none' | 'select-link' | 'area-vc' | 'cause' | 'comparison';

export interface TrafficRunSnapshot {
  scenarioId: string;
  durationS: number;
  seed: number;
  demandLevel: number;
  focus: boolean;
  /** Clock hour and demand multiplier the run used. */
  hour: number;
  hourFactor: number;
  demandKey: string;
  networkKey: string;
  metrics: MicroSimMetrics;
  /** Planned demand (veh/h at the run's hour) and the road analysis of the run. */
  demandVph: number;
  analysis: AnalysisOutput;
  /** Demand, hour, seeds and duration the run actually used: a comparison checks them equal. */
  inputs: RunInputs;
  /** Edits of imported junctions the run had in force (docs/OVERHAUL.md §23); absent on older snapshots. */
  junctionEdits?: JunctionEditSpec[];
  /** Id of the backend record of this run's frozen inputs (POST /api/runs), when it was saved. */
  runId?: string | null;
}
/** Saves a run's frozen inputs with the scenario it ran on (the engine posts it to /api/runs); resolves to its id. */
export type RunRecorder = (run: { scenarioId: string; inputs: RunInputs; results: Record<string, unknown> }) => Promise<string | null>;
/** Build of the engine a run used (VITE_GIT_SHA when the build sets it; 'unknown' otherwise). */
export const ENGINE_VERSION: string = ((import.meta as any).env?.VITE_GIT_SHA as string | undefined) ?? 'unknown';
export interface TrafficComparisonState {
  baseline: TrafficRunSnapshot | null;
  current: TrafficRunSnapshot | null;
  /** Existing city (baseline) against the proposal (current), same frozen demand. */
  result: ComparisonResult | null;
  staleReason: string | null;
  running: boolean;
  progress: number;
  /** The land use (and so the demand) differs from the baseline's: a development scenario. */
  demandChanged: boolean;
  /**
   * The road analysis on show ran on a network that differs from the saved
   * baseline's (the city as edited in Build), so the panel labels it a proposal.
   */
  showingProposal: boolean;
  /** The baseline on show was saved in an earlier session and restored (when it was saved, ISO time); absent otherwise. */
  restoredAt?: string | null;
}

/**
 * A saved baseline as kept across a page reload (IndexedDB store 'sim-baselines', key: the studied roads): the run,
 * its frozen demand and inputs, and the name, lanes and direction of every road as they were (what the comparison
 * reads of the existing city's roads). Restored only for the same roads, range and direction, and never onto an
 * existing city whose network changed since.
 */
export interface StoredBaseline {
  v: 1;
  savedAt: string;
  studyKey: string;
  contextKey: string;
  seedRoadIds: string[];
  baseline: TrafficRunSnapshot;
  plan: DemandPlan;
  roads: DrivableObject[];
}
export interface BaselineStore {
  get(key: string): Promise<StoredBaseline | undefined>;
  put(key: string, value: StoredBaseline): Promise<void>;
}
export const BASELINE_STORE_VERSION = 1;
const idbBaselineStore: BaselineStore = {
  get: async key => (await cacheGetMany<StoredBaseline>('sim-baselines', [key]))[0],
  put: (key, value) => cachePutMany('sim-baselines', [[key, value]]),
};
/** What the comparison reads of a baseline road (ScenarioComparison: names, lane signature): kept small for storage. */
export const compactRoad = (r: DrivableObject): DrivableObject => {
  const sec = 'sections' in r ? r.sections?.[0] : undefined;
  // Its two ends only: the comparison reads each road's direction of travel from them (both carriageways of a divided road)
  const c = r.coordinates;
  return { id: r.id, type: r.type, name: r.name, laneCount: r.laneCount, isOneWay: r.isOneWay, ...((c?.length ?? 0) >= 2 ? { coordinates: [c[0], c[c.length - 1]] } : {}),
    ...(sec ? { sections: [{ carriagewayA: { lanes: sec.carriagewayA?.lanes }, ...(sec.carriagewayB ? { carriagewayB: { lanes: sec.carriagewayB.lanes } } : {}) }] } : {}) } as unknown as DrivableObject;
};

/** Key of a set of studied roads (order-free). */
export const seedKeyOf = (ids: readonly string[]) => [...ids].sort().join('|');

/** Road analysis of the selected section, from a fixed repeatable run. */

export interface RoadAnalysisState {
  status: 'idle' | 'running' | 'ready' | 'error';
  progress: number;
  output: AnalysisOutput | null;
  error: string | null;
  /** Settings the result is for (hour, demand options); a change re-runs it. */
  hour: number | null;
  demandVph: number | null;
  /** Network, demand and hour the output is for: kept across closing and reopening Simulate while unchanged. */
  key: string | null;
  /** The studied roads the output is for (sorted ids). A result for other roads is not shown under a new road's name. */
  seedKey?: string;
  /**
   * The output on show is for a network, demand or hour that has changed since
   * (e.g. a Build edit); its re-run is pending or running. Cleared when the new
   * result arrives (docs/OVERHAUL.md §14).
   */
  outdated?: boolean;
  /** Demand multiplier the result was computed with (the clock hour's, from the hour-of-day profile). */
  hourFactor?: number;
  /**
   * Whether the hour-of-day profile was loaded for the result. 'unavailable': it could not be loaded, so the
   * demand is the peak hour's (factor 1) whatever the clock shows (docs/OVERHAUL.md §19).
   */
  timeProfile?: 'loaded' | 'unavailable';
  /** Inputs the output was computed from (SimulationMode.runFingerprint); a baseline or proposal run with the same fingerprint reuses it. */
  fingerprint?: string;
}

/** Demand options the user can change. */
export interface DemandSettings {
  /** Include traffic crossing the area on its main roads (default on). */
  through: boolean;
  /** Hypothetical demand multiplier (null = the estimate as is). Always labelled hypothetical. */
  hypotheticalScale: number | null;
}

export const TRAFFIC_SPEEDS = [1, 5, 20] as const;
/** Traffic volume presets, as a share of the capacity of the roads leading into the area. */
export const TRAFFIC_LEVELS = [
  { label: 'Light', value: 0.05 },
  { label: 'Normal', value: 0.12 },
  { label: 'Heavy', value: 0.25 },
] as const;
export const DEFAULT_DEMAND_LEVEL = OD_REFERENCE_LEVEL;
/**
 * With focus on, the selected roads carry extra through traffic: this many
 * times the volume level, as a share of their capacity (Light 20%, Normal 48%,
 * Heavy 100%), on top of the traffic that uses them by itself.
 */
export const FOCUS_LOAD_PER_LEVEL = 4;
export const focusLoadFor = (traffic: Pick<TrafficRunState, 'focus' | 'demandLevel'>) =>
  traffic.focus ? traffic.demandLevel * FOCUS_LOAD_PER_LEVEL : 0;
export const DEFAULT_TRAFFIC_SEED = 42;
/** Distances offered for the study area, along the roads. */
export const STUDY_DISTANCES_M = [500, 1000, 2000, 3000, 5000] as const;
export const DEFAULT_STUDY_DISTANCE_M = 2000;

/** Loading OpenStreetMap roads for the part of a study area the project holds none for. */
export interface OsmRoadsState {
  status: 'idle' | 'loading' | 'error';
  /** Roads added by the last load, or null before one finishes. */
  added: number | null;
  error: string | null;
}

/** Where study areas get OSM roads the project does not hold yet. */
export interface OsmRoadSource {
  /** Makes the project hold every OSM road in `boxes` (fetching only missing ones); resolves to the number added. */
  load: (boxes: Bounds[], signal: AbortSignal) => Promise<number>;
}

/** Each map tile is checked against OpenStreetMap again after this long, for roads added there since. */
const ROAD_TILE_RECHECK_MS = 14 * 24 * 3600 * 1000;

/** Real traffic signals for the study area, from OpenStreetMap. */
export interface SignalsState {
  status: 'off' | 'loading' | 'ready' | 'error';
  /** Mapped signals in the area, once loaded. */
  count: number | null;
}

/** Calibration of the study area's demand against observed junction counts. */
export interface CalibrationState {
  datasetStatus: 'idle' | 'loading' | 'ready' | 'error';
  dataset: CountDataset | null;
  datasetError: string | null;
  /** Counted junctions inside the study area, with any reason they cannot be compared. */
  junctions: JunctionCheck[];
  rows: CalibrationRow[];
  before: GehSummary | null;
  after: GehSummary | null;
  fit: {
    iterations: number; converged: boolean; cappedTrips: number; seeds: number; seedVph: number; unreachable: number;
    factorMin: number; factorMax: number; assignedBefore: GehSummary; assignedAfter: GehSummary; demandLevel: number;
  } | null;
  status: 'idle' | 'measuring' | 'fitting' | 'error';
  progress: number;
  error: string | null;
  /** Live traffic runs on the calibrated demand. */
  applied: boolean;
  /** Simulated seconds counted per run (after the warm-up). */
  windowS: number | null;
  /** Network state at the end of each counted run, to explain low simulated flows (queues, gridlock). */
  runMetrics: { before: MicroSimMetrics | null; after: MicroSimMetrics | null };
  staleReason: string | null;
}

export interface SimulationModeState {
  active: boolean;
  seedRoadIds: string[];
  /**
   * Studied roads deleted in the active scenario (a closure proposal), by the name they had. The study stays on them:
   * the area is mapped from the roads that joined them and Compare reports the closure (p11 user test, Baba Bhide
   * Bridge: deleting the studied road said "not part of the active scenario any more" and nothing could be compared).
   */
  closedRoads: { id: string; name: string }[];
  rangeMeters: number;
  direction: StudyDirection;
  area: StudyArea | null;
  error: string | null;
  traffic: TrafficRunState;
  osmRoads: OsmRoadsState;
  signals: SignalsState;
  comparison: TrafficComparisonState;
  selectedVehicleId: number | null;
  calibration: CalibrationState;
  /** p13: which assignment parameters run: the defaults or the tuned (estimated) set (calibration/tunedSupply.ts). */
  supplySet: 'default' | 'tuned';
  /**
   * p14: which demand the area runs on: the area estimate (AreaDemand.ts) or the SYNTHETIC land-use 4-step demand
   * (demand/syntheticDemand.ts; label synthetic, demo only, not measured). status: the synthetic model's loading state
   * (off: not requested); why: the recorded reason it is or is not the default.
   */
  demandModel: { model: 'area-estimate' | 'synthetic'; status: 'off' | 'loading' | 'ready' | 'none'; defaultOn: boolean; why: string; error: string | null };
  /** p14: the supply model of the area assignment: 'p13' (as before) or 'p14' (Indian urban roads, supplyConfig.ts; docs/urbanos/SUPPLY_P14.md). */
  supplyModel: SupplyModel;
  timeOfDay: TimeOfDayState;
  /** The road section the click stands for (both carriageways, between main junctions). */
  section: RoadSection | null;
  /** The selected road's neighbourhood: simulated vehicle by vehicle (analysis and live view). */
  corridor: StudyArea | null;
  analysis: RoadAnalysisState;
  demandSettings: DemandSettings;
  timeline: TimelineState;
  overlay: MapOverlay;
  /** Direction of the selected road highlighted on the map and in the panel: under the pointer (hover) or clicked (pinned). */
  directionFocus: { hover: number | null; pinned: number | null };
  /** Free-flow speeds used (OSM maxspeed, inherited, or urban default). */
  speeds: SpeedReport | null;
  /** Why the last run of something long was stopped (left Simulate, network changed), shown once. */
  notice: string | null;
  /** Counted roads (river bridges, PMC CMP 2008) for checking the model's volumes. */
  screenlines: ScreenlineFile | null;
  /** Calibrated central-Pune edge flows (docs/urbanos/TRAFFIC_CALIBRATION_P9.md): loading, ready (used for areas inside the window) or none (class-typical flows everywhere). */
  edgeFlows: { status: 'loading' | 'ready' | 'none'; id: string | null };
  /** City-wide estimated traffic (EstimatedTraffic.ts): loading, ready (main-road edge flows road by road) or none (class-typical flows). */
  estimatedTraffic: { status: 'loading' | 'ready' | 'none'; id: string | null; label: string | null };
  /** Demand estimated from calibration counts (ODME, docs/ODME_AND_EMISSIONS.md): opt-in; the estimate never replaces the baseline demand. */
  odme: OdmeState;
}

export interface OdmeState {
  status: 'idle' | 'running' | 'ready' | 'error';
  error: string | null;
  /** The last estimate (a demand version): provenance, fit on the calibration counts, independent check on validation counts. */
  report: OdmeRunReport | null;
  /** The user chose to run on the estimated demand (only while it is valid for the current prior and hour). */
  used: boolean;
  /** Why an estimate no longer applies (prior demand or hour changed). */
  staleReason: string | null;
}

export interface OdmeRunReport {
  provenance: OdmeProvenance;
  iterations: OdmeIteration[];
  /** Calibration counts: before/after on the assignment (fitted, so not independent evidence). */
  calibration: OdmeFit[];
  /** Validation (held-out) counts at this hour: before/after on the assignment, never fitted. */
  validation: OdmeFit[];
  skipped: { id: string; reason: string }[];
  elapsedMs: number;
}

/** Clock for the run: which hour's demand is simulated, from the real Pune hour-of-day profile. */
export interface TimeOfDayState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  profile: DiurnalProfile | null;
  /** Clock hour simulated (0-23). */
  hour: number;
  day: DayType;
  /** Which peak the observed counts (and calibrated demand) are taken to be: neither source says. */
  countPeak: 'AM' | 'PM';
  /** Demand multiplier now applied: profile[hour] / profile[count hour]. */
  factor: number;
}

const EMPTY_ANALYSIS: RoadAnalysisState = { status: 'idle', progress: 0, output: null, error: null, hour: null, demandVph: null, key: null };
const EMPTY_TIMELINE: TimelineState = { status: 'idle', progress: 0, rows: [], error: null, key: null };
/** The live view starts from the same warm-up the analysis counts from: vehicles already on the roads, in a state the model reached itself. */
export const LIVE_WARMUP_S = 300;

const EMPTY_CALIBRATION: CalibrationState = {
  datasetStatus: 'idle', dataset: null, datasetError: null, junctions: [], rows: [], before: null, after: null, fit: null,
  status: 'idle', progress: 0, error: null, applied: false, windowS: null, staleReason: null, runMetrics: { before: null, after: null },
};

/** Wait after a road edit before re-mapping, so a burst of changes maps once. */
export const DEFAULT_CORRECTION_LAYER = 'pune_west_v1';
const NETWORK_CHANGE_DEBOUNCE_MS = 250;
/** Finished analysis results kept by key (Undo/Redo of a Build edit shows them again). */
const KEPT_RESULTS = 6;
/** How often live figures reach the UI, and how often road stretches are recoloured (real ms). */
const METRICS_EVERY_MS = 500;
const RECOLOUR_EVERY_MS = 1000;

/**
 * State of Simulation mode: which roads the study area grows from, how far,
 * and the resulting area. The road network is read-only while this is active;
 * TwinCityEngine enforces that when entering and leaving.
 */
/** Demand period of a counted peak hour (the counts' AM or PM peak, as the user sets it). */
export const countPeakPeriod = (peak: 'AM' | 'PM'): 'AM_Peak' | 'PM_Peak' => (peak === 'PM' ? 'PM_Peak' : 'AM_Peak');

/**
 * Demand an analysis can run on: some trips, or none because the user switched through traffic off where the area's
 * own buildings make none (a result with every road empty, not an error: docs/OVERHAUL.md §27.7).
 */
const runnablePlan = (plan: DemandPlan | null): plan is DemandPlan =>
  !!plan && (plan.trips.length > 0 || plan.provenance.components?.throughIncluded === false);

export class SimulationMode {
  private state: SimulationModeState = {
    active: false,
    seedRoadIds: [],
    closedRoads: [],
    rangeMeters: DEFAULT_STUDY_DISTANCE_M,
    direction: 'both',
    area: null,
    error: null,
    traffic: { status: 'idle', speed: 5, demandLevel: DEFAULT_DEMAND_LEVEL, focus: false, seed: DEFAULT_TRAFFIC_SEED, metrics: null, error: null, demand: null, preparing: null, hour: null, warmupS: LIVE_WARMUP_S },
    osmRoads: { status: 'idle', added: null, error: null },
    signals: { status: 'off', count: null },
    comparison: { baseline: null, current: null, result: null, staleReason: null, running: false, progress: 0, demandChanged: false, showingProposal: false },
    selectedVehicleId: null,
    calibration: EMPTY_CALIBRATION,
    supplySet: TUNED_SUPPLY_DEFAULT_ON && TUNED_SUPPLY ? 'tuned' : 'default',
    demandModel: { model: SYNTHETIC_DEMAND_DEFAULT_ON ? 'synthetic' : 'area-estimate', status: 'off', defaultOn: SYNTHETIC_DEMAND_DEFAULT_ON, why: SYNTHETIC_DECISION.reason, error: null },
    supplyModel: SYNTHETIC_DEMAND_DEFAULT_ON ? SYNTHETIC_PARAMS.supplyModel : SUPPLY_MODEL_DEFAULT,
    timeOfDay: { status: 'idle', error: null, profile: null, hour: COUNT_HOURS.AM, day: 'weekday', countPeak: 'PM', factor: 1 },
    section: null,
    corridor: null,
    analysis: EMPTY_ANALYSIS,
    demandSettings: { through: true, hypotheticalScale: null },
    odme: { status: 'idle', error: null, report: null, used: false, staleReason: null },
    timeline: EMPTY_TIMELINE,
    overlay: 'none',
    directionFocus: { hover: null, pinned: null },
    speeds: null,
    notice: null,
    screenlines: null,
    edgeFlows: { status: 'loading', id: null },
    estimatedTraffic: { status: 'loading', id: null, label: null },
  };
  private analysisRun: RunningAnalysis | null = null;
  private analysisTimer: ReturnType<typeof setTimeout> | null = null;
  private comparisonRun: RunningAnalysis | null = null;
  private readonly signalSource: TrafficSignalSource | null;
  private signalLoad: AbortController | null = null;
  /** Signals for `signalBoundsKey`, or null to estimate them. */
  private signalPoints: SignalPoint[] | null = null;
  private signalBoundsKey = '';
  private osmLoad: AbortController | null = null;
  /** Map tiles already checked this session (or being checked); not again until the user retries. */
  private triedOsmLoads = new Set<string>();
  private listeners = new Set<() => void>();
  private readonly explorer = new StudyAreaExplorer();
  private readonly visualizer = new StudyAreaVisualizer();
  private readonly arrows = new DirectionArrows();
  /** The direction list the arrows (and the highlight index) belong to. */
  private arrowDirections: readonly unknown[] | null = null;
  /** Bumped on every road or scenario change; the explorer rebuilds its graph when it moves. */
  private revision = 0;
  private recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly trafficVisualizer = new MicroTrafficVisualizer();
  /** The live run (its simulation in a Web Worker when the browser has them; liveTrafficRun.ts). */
  private live: LiveRun | null = null;
  /** Test hook: builds the live run's worker (null: the browser's own worker, or none). */
  public liveWorkerFactory: (() => Worker) | null = null;
  private frameHandle: number | null = null;
  private lastMetricsAt = 0;
  private lastRecolourAt = 0;

  private readonly getRoads: () => DrivableObject[];
  private readonly osmSource: OsmRoadSource | null;
  private readonly getContext: () => SimulationContext;
  private baselinePlan: DemandPlan | null = null;
  private baselineContextKey = '';
  private baselineStudyKey = '';
  private comparisonGeneration = 0;
  /** Network the road analysis on show ran on, to tell the existing city from a proposal. */
  private analysisNetworkKey: string | null = null;
  /** Demand fitted to observed counts; used by live traffic while set. */
  private calibratedPlan: DemandPlan | null = null;
  /** The demand version estimated from counts (ODME) and the content key of the prior it was estimated from. */
  private odmePlan: DemandPlan | null = null;
  private planKeys = new WeakMap<DemandPlan, string>();
  private keyOfPlan(p: DemandPlan) { let k = this.planKeys.get(p); if (!k) { k = contentKey(p); this.planKeys.set(p, k); } return k; }
  private calibrationGeneration = 0;
  private readonly loadCounts: () => Promise<CountDataset>;

  /** Local OSM correction layer (backend/data/network_corrections) and whether it is applied. */
  private correctionLayer: NetworkCorrectionLayer | null = null;
  private correctionsEnabled = true;
  private lastCorrectionReport: CorrectionReport | null = null;
  /** Signal plans: Webster from critical flows, or the earlier equal split. */
  private signalTiming: 'webster' | 'equal' = 'webster';
  private roadsCache: { n: number; layer: NetworkCorrectionLayer | null; enabled: boolean; rev: number; roads: DrivableObject[] } | null = null;
  private speedReport: SpeedReport | null = null;
  private timelineRun: RunningAnalysis | null = null;
  private timelineGeneration = 0;
  /** Start was pressed before the analysis was ready: start once it is. */
  private pendingStart = false;

  constructor(getRoads: () => DrivableObject[], osmSource: OsmRoadSource | null = null, signalSource: TrafficSignalSource | null = null, getContext: () => SimulationContext = () => ({}),
    loadCounts: () => Promise<CountDataset> = () => fetchCountDataset(DEFAULT_COUNT_DATASET),
    loadCorrections: (() => Promise<unknown>) | null = () => apiGet<unknown>(`/api/network-corrections/${DEFAULT_CORRECTION_LAYER}`),
    loadScreenlines: (() => Promise<ScreenlineFile>) | null = () => fetchScreenlines()) {
    this.loadCounts = loadCounts;
    loadScreenlines?.().then(screenlines => this.setState({ screenlines })).catch(() => { /* no counts: the check is not shown */ });
    // Calibrated window edge flows: areas inside the window take their edge flows from it once loaded; until then, and
    // without the file, the class-typical flows per lane apply (state.edgeFlows says which)
    fetchCalibratedEdgeFlows().then(flows => {
      this.calibratedEdgeFlows = flows;
      this.setState({ edgeFlows: { status: 'ready', id: flows.id } });
      if (this.state.area && this.useCalibratedEdgeFlows) { this.analysisStale = true; this.scheduleAnalysis(); }
    }).catch(() => this.setState({ edgeFlows: { status: 'none', id: null } }));
    // City-wide estimated traffic (estimated, project-level, not for decisions): loaded where installed; used for main-road
    // edge flows only when useEstimatedTraffic is on (off by default: worse on the hold-out sites, TRAFFIC_ESTIMATED_P10.md §5)
    fetchEstimatedTraffic().then(model => {
      this.estimatedTraffic = model;
      this.setState({ estimatedTraffic: { status: 'ready', id: model.id, label: model.label } });
      if (this.state.area && this.useEstimatedTraffic) { this.analysisStale = true; this.scheduleAnalysis(); }
    }).catch(() => this.setState({ estimatedTraffic: { status: 'none', id: null, label: null } }));
    // Roads for the simulation: the project's roads with the correction layer (and the OSM
    // one-way implications) applied on top; the stored roads are never changed
    this.getRoads = () => {
      const raw = getRoads();
      if (this.roadsCache && this.roadsCache.n === raw.length && this.roadsCache.layer === this.correctionLayer && this.roadsCache.enabled === this.correctionsEnabled && this.roadsCache.rev === this.revision) return this.roadsCache.roads;
      const { roads, report } = applyNetworkCorrections(raw, this.correctionLayer, this.correctionsEnabled);
      this.lastCorrectionReport = report;
      // Free-flow speeds for a city (roadParameters.ts): OSM maxspeed, else a maxspeed of the same road, else an urban default
      const speeds = applyUrbanSpeeds(roads);
      this.speedReport = speeds.report;
      this.roadsCache = { n: raw.length, layer: this.correctionLayer, enabled: this.correctionsEnabled, rev: this.revision, roads: speeds.roads };
      return speeds.roads;
    };
    loadCorrections?.().then(doc => {
      this.correctionLayer = validateCorrectionLayer(doc);
      this.networkChanged();
      this.notify();
    }).catch(() => { /* no layer: OSM as imported */ });
    this.osmSource = osmSource;
    this.signalSource = signalSource;
    this.getContext = getContext;
  }

  /**
   * The roads as the analysis builds its network from them: the correction layer (and the OSM one-way
   * implications) applied when enabled, the stored roads unchanged. A Build lane edit finds its carriageway on
   * this view (roadEdits.carriagewayPieces), so "Entire carriageway" is the stretch a direction's capacity is
   * read from even where a correction reverses a way or changes it to one-way or two-way (docs/OVERHAUL.md §21).
   * Free-flow speeds, also applied for the analysis, change nothing the carriageway definition reads.
   */
  public roadView = (raw: readonly RoadObject[]): RoadObject[] =>
    applyNetworkCorrections(raw, this.correctionLayer, this.correctionsEnabled).roads as RoadObject[];

  /** For React's useSyncExternalStore. */
  public subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };

  public getState = (): SimulationModeState => this.state;

  /** New snapshot for subscribers when something outside the state (network layer) changed. */
  private notify() {
    this.setState({});
  }

  private setState(patch: Partial<SimulationModeState>) {
    this.state = { ...this.state, ...patch };
    this.syncArrows();
    this.listeners.forEach(cb => cb());
  }

  /**
   * The direction arrows follow the analysis on show: drawn for its
   * directions while Simulate is open and the result belongs to the selected
   * section, gone otherwise. Cheap when nothing changed (same result object).
   */
  private syncArrows() {
    const out = this.state.active ? this.state.analysis.output?.result : undefined;
    const section = this.state.section;
    const current = !!out && !!section && out.section.segmentKeys.length === section.segmentKeys.length && out.section.segmentKeys.every((k, i) => k === section.segmentKeys[i]);
    const dirs = current ? out!.directions : null;
    // A different direction list (another road, hour or proposal) may number its directions differently: start unhighlighted
    if (dirs !== this.arrowDirections) {
      this.arrowDirections = dirs;
      if (this.state.directionFocus.hover !== null || this.state.directionFocus.pinned !== null) this.state = { ...this.state, directionFocus: { hover: null, pinned: null } };
    }
    this.arrows.show(dirs);
    const f = this.state.directionFocus;
    this.arrows.setFocus(f.hover ?? f.pinned);
  }

  /** Pointer over a direction's row in the panel (null: left it). */
  public hoverDirection(index: number | null) {
    if (index !== null && !(index >= 0 && index < (this.arrowDirections?.length ?? 0))) index = null;
    if (this.state.directionFocus.hover === index) return;
    this.setState({ directionFocus: { ...this.state.directionFocus, hover: index } });
  }

  /**
   * Clicked a direction (its row, or its arrows on the map): highlights it
   * until clicked again. With `frame`, the camera flies to it, keeping its heading.
   */
  public pinDirection(index: number | null, frame = false) {
    if (index !== null && !(index >= 0 && index < (this.arrowDirections?.length ?? 0))) index = null;
    const pinned = index !== null && this.state.directionFocus.pinned === index ? null : index;
    this.setState({ directionFocus: { hover: null, pinned } });
    if (frame && pinned !== null) this.arrows.frame(pinned);
  }

  public isActive(): boolean {
    return this.state.active;
  }

  public setViewer(viewer: Viewer) {
    this.visualizer.setViewer(viewer);
    this.arrows.setViewer(viewer);
    this.trafficVisualizer.setViewer(viewer);
    if (this.state.active && this.state.area) this.visualizer.render(this.state.area, false);
  }

  public dispose() {
    this.stopAllComputation('');
    this.osmLoad?.abort();
    this.signalLoad?.abort();
    this.buildingLoad?.abort();
    this.visualizer.dispose();
    this.arrows.dispose();
    this.trafficVisualizer.dispose();
  }

  /**
   * Stops everything that computes: the live view (animation frame, warm-up,
   * simulator), the road analysis, a baseline or comparison run, the
   * time-of-day runs and pending timers. Selections and finished results are
   * kept. `why` is shown once if something was interrupted.
   */
  private stopAllComputation(why: string) {
    const interrupted: string[] = [];
    if (this.state.analysis.status === 'running') interrupted.push('the road analysis');
    if (this.state.comparison.running) interrupted.push('the comparison run');
    if (this.state.timeline.status === 'running') interrupted.push('the time-of-day runs');
    this.cancelAnalysis();
    if (this.state.analysis.status === 'running') this.setState({ analysis: { ...this.state.analysis, status: this.state.analysis.output ? 'ready' : 'idle', progress: 0 } });
    if (this.comparisonRun || this.state.comparison.running) {
      this.comparisonRun?.cancel();
      this.comparisonRun = null;
      this.comparisonGeneration++;
      this.setState({ comparison: { ...this.state.comparison, running: false, progress: 0, staleReason: why ? `The run was stopped when you ${why}. Run it again.` : this.state.comparison.staleReason } });
    }
    this.cancelTimeline();
    this.calibrationGeneration++;
    if (this.state.calibration.status === 'measuring' || this.state.calibration.status === 'fitting') this.setCalibration({ status: 'idle', progress: 0 });
    this.cancelPendingRecompute();
    this.stopTraffic();
    if (why && interrupted.length) {
      const notice = `Stopped ${interrupted.join(' and ')} when you ${why}.`;
      // Only the road analysis was stopped: the notice is moot once a current result is on show again (clearAnalysisStopNotice)
      this.analysisStopNotice = interrupted.length === 1 && interrupted[0] === 'the road analysis' ? notice : null;
      this.setState({ notice });
    }
  }
  /** The notice set when leaving Simulate stopped the road analysis alone (null otherwise). */
  private analysisStopNotice: string | null = null;
  /** A result for the current network, demand and hour is on show (kept, restored by Undo/Redo, or just landed): "stopped the road analysis" no longer applies. */
  private clearAnalysisStopNotice() {
    if (this.analysisStopNotice && this.state.notice === this.analysisStopNotice) this.setState({ notice: null });
    this.analysisStopNotice = null;
  }

  public enter() {
    if (this.state.active) return;
    this.setState({ active: true });
    // The clock's demand needs the hour-of-day profile, whichever tab is open (docs/OVERHAUL.md §19)
    void this.ensureTimeProfile();
    this.visualizer.setFocus(true);
    // Coming back to a saved selection: show it again; its analysis is kept when nothing changed (nothing restarts by itself)
    if (this.state.seedRoadIds.length > 0) this.recompute(false, false);
  }

  /** Leaving Simulate (closing the panel or switching mode) stops all computation. The selection and results stay. */
  public exit() {
    if (!this.state.active) return;
    this.stopAllComputation('left Simulate');
    this.visualizer.clear();
    this.visualizer.setFocus(false);
    this.setState({ active: false, overlay: 'none' });
  }

  /** What is computing now (nothing, once stopped or closed). */
  public resources(): ResourceReport {
    const warmup = this.live?.warming() ?? false;
    return { liveSim: this.live !== null, animationFrame: this.frameHandle !== null, warmup, analysisRunning: this.analysisRun !== null,
      comparisonRunning: this.comparisonRun !== null, timelineRunning: this.timelineRun !== null,
      timers: [this.analysisTimer, this.recomputeTimer].filter(t => t !== null).length + (warmup && !this.live?.threaded ? 1 : 0), vehicles: this.live?.vehicleCount() ?? 0,
      liveThreaded: this.live?.threaded ?? null };
  }

  public dismissNotice() { if (this.state.notice) this.setState({ notice: null }); }

  /** The drivable road under or near a clicked ground point. */
  public pickRoadAt(lng: number, lat: number, maxDistM: number): string | null {
    return this.explorer.nearestRoad(this.getRoads(), this.revision, lng, lat, maxDistM);
  }

  /**
   * A road was clicked. Plain click maps the area within the chosen distance
   * of it and starts traffic; with `additive` (Shift) the road is added to, or
   * removed from, the roads being studied.
   */
  public selectRoad(roadId: string, additive: boolean) {
    // Clicking the road already studied again changes nothing: the comparison, the analysis and the live view stay
    if (!additive && this.state.area && this.state.seedRoadIds.length === 1 && this.state.seedRoadIds[0] === roadId) return;
    this.invalidateComparison(STUDY_CHANGED.roads);
    this.cancelTimeline(true);
    // A new road: the live view stops (it belonged to the old one) and is started again by the user
    this.stopTraffic();
    this.setOverlay('none');
    if (!additive) {
      this.setState({ seedRoadIds: [roadId] });
      this.forgetOsmResult();
      this.recompute(true, true);
      return;
    }
    const seeds = this.state.seedRoadIds.includes(roadId)
      ? this.state.seedRoadIds.filter(id => id !== roadId)
      : [...this.state.seedRoadIds, roadId];
    if (seeds.length === 0) {
      this.clearSeeds();
      return;
    }
    this.setState({ seedRoadIds: seeds });
    this.recompute(false, false);
  }

  public clearSeeds() {
    this.invalidateComparison(STUDY_CHANGED.roads);
    this.cancelTimeline(true);
    this.cancelPendingRecompute();
    this.stopTraffic();
    this.visualizer.reset();
    this.cancelAnalysis();
    this.analysisNetworkKey = null;
    this.setState({ seedRoadIds: [], closedRoads: [], area: null, corridor: null, section: null, error: null, overlay: 'none', analysis: EMPTY_ANALYSIS, comparison: { ...this.state.comparison, showingProposal: false } });
    this.forgetOsmResult();
  }

  /** A finished load's message belongs to the area it was for. */
  private forgetOsmResult() {
    if (this.state.osmRoads.status !== 'loading') this.setState({ osmRoads: { status: 'idle', added: null, error: null } });
  }

  public setRange(meters: number) {
    const rangeMeters = clampRangeM(meters);
    if (rangeMeters === this.state.rangeMeters) return;
    this.invalidateComparison(STUDY_CHANGED.range);
    this.setState({ rangeMeters });
    if (this.state.seedRoadIds.length > 0) this.recompute(true, false);
  }

  public setDirection(direction: StudyDirection) {
    if (direction === this.state.direction) return;
    this.invalidateComparison(STUDY_CHANGED.direction);
    this.setState({ direction });
    if (this.state.seedRoadIds.length > 0) this.recompute(false, false);
  }

  /** Turns the local OSM correction layer on or off (re-maps the area). */
  public setNetworkCorrections(enabled: boolean) {
    if (this.correctionsEnabled === enabled) return;
    this.correctionsEnabled = enabled;
    this.networkChanged();
    this.notify();
  }

  /** Webster signal timing from critical flows, or the earlier equal split. */
  public setSignalTiming(mode: 'webster' | 'equal') {
    if (this.signalTiming === mode) return;
    this.signalTiming = mode;
    this.networkChanged();
    this.notify();
  }

  /** What the network layer is doing, for the panel. */
  public networkLayerInfo() {
    return {
      corrections: this.correctionLayer ? { id: this.correctionLayer.id, version: this.correctionLayer.version, count: this.correctionLayer.corrections.length } : null,
      correctionsEnabled: this.correctionsEnabled,
      applied: this.lastCorrectionReport?.applied.length ?? 0,
      impliedOneWay: this.lastCorrectionReport?.impliedOneWay.length ?? 0,
      impliedClass: this.lastCorrectionReport?.impliedClass.length ?? 0,
      signalTiming: this.signalTiming,
    };
  }

  /** Roads changed or the scenario switched. Re-maps the current area shortly after. */
  public networkChanged() {
    // Editing the network after saving the baseline is the intended step: only a comparison already on show (or
    // running) is out of date. "Run the comparison again" before any comparison had run read as an error.
    const c = this.state.comparison;
    this.invalidateComparison(c.result || c.running ? 'The network changed since this comparison. Press Compare to test the proposal as it is now.' : null);
    this.revision++;
    if (!this.state.active || this.state.seedRoadIds.length === 0) return;
    this.cancelPendingRecompute();
    this.recomputeTimer = setTimeout(() => {
      this.recomputeTimer = null;
      this.recompute(false, false);
    }, NETWORK_CHANGE_DEBOUNCE_MS);
  }

  public fitView() {
    if (this.state.area) this.visualizer.flyToBounds(this.state.area.bounds);
  }

  /** Brings the camera in close on the selected roads. */
  public focusView() {
    const seeds = new Set(this.state.seedRoadIds);
    this.visualizer.flyToRoad(this.getRoads().filter(r => seeds.has(r.id)).flatMap(r => r.coordinates));
  }

  /** Mapped traffic signals of the current study area, once loaded (null before, or when they could not be loaded). */
  public mappedSignalPoints(): readonly SignalPoint[] | null {
    return this.signalPoints;
  }

  public flyTo(location: [number, number, number]) {
    this.visualizer.flyToPoint(location);
  }

  public flyToBounds(bounds: Bounds) {
    this.visualizer.flyToBounds(bounds);
  }

  /** Camera on a sphere (centre, radius m) from `rangeM` away (Build's junction editor: junctionEdits.junctionFrame). */
  public flyToSphere(centre: [number, number, number], radiusM: number, rangeM: number) {
    this.visualizer.flyToSphere(centre, radiusM, rangeM);
  }

  private recompute(fly: boolean, reveal: boolean) {
    if (!this.state.active) return;
    this.analysisStale = true;
    this.cancelAnalysis();
    // A run belongs to one area and network: any change stops the live view (the user starts it again)
    this.stopTraffic();
    try {
      const roads = this.getRoads();
      const { exploreSeeds, closed, sourcePoints, sourceRoadIds } = this.studySeeds(roads);
      // A closed road's area is measured from its ends, as the baseline's was from the road: not from the whole of the roads that joined it
      const from = sourcePoints.length ? { sourcePoints, sourceRoadIds } : {};
      const area = this.explorer.explore(roads, this.revision, {
        seedRoadIds: exploreSeeds,
        rangeMeters: this.state.rangeMeters,
        direction: this.state.direction,
        ...from,
      });
      // The neighbourhood simulated vehicle by vehicle: the same network, a shorter range from the road
      const corridor = area.rangeMeters <= CORRIDOR_RANGE_M ? area : this.explorer.explore(roads, this.revision, { seedRoadIds: area.seedRoadIds, rangeMeters: CORRIDOR_RANGE_M, direction: this.state.direction, ...from });
      // Seeds deleted from the network drop out here
      const section = area.seedRoadIds.length ? roadSection(area, new Map(roads.map(r => [r.id, r])), area.seedRoadIds) : null;
      // A closed road stays the study (its baseline and name); the area and section are mapped from the roads that joined it
      this.setState({ area, corridor, error: null, seedRoadIds: closed.length ? this.state.seedRoadIds : area.seedRoadIds, closedRoads: closed, section, speeds: this.speedReport });
      // Back on the baseline's roads, range and direction: a "study changed" notice no longer applies
      const c = this.state.comparison;
      if (c.baseline && c.staleReason && STUDY_REASONS.has(c.staleReason) && this.baselineStudyKey === this.studyKey()) this.setState({ comparison: { ...c, staleReason: null } });
      // A baseline saved for this study before a page reload comes back
      this.maybeRestoreBaseline();
      // A kept result for another network or demand stays on show until its re-run lands: say so.
      // An undo back to the shown result's network (before its re-run landed) makes it current again: clear the flag.
      const shown = this.state.analysis, key = this.analysisKey();
      // A result already computed for this exact network, demand and hour (e.g. after Undo or Redo of a Build edit) comes back at once (docs/OVERHAUL.md §16)
      const kept = shown.key !== key ? this.keptResults.get(key) : undefined;
      if (kept) {
        this.analysisNetworkKey = kept.networkKey;
        this.analysisStale = false;
        this.setState({ analysis: kept.analysis, comparison: { ...this.state.comparison, showingProposal: this.showsProposal(this.state.comparison.baseline) } });
        this.clearAnalysisStopNotice();
      } else if (shown.output && shown.seedKey !== undefined && shown.seedKey !== seedKeyOf(area.seedRoadIds)) {
        // Another road's result: never shown under this road's name while its own analysis runs (p11 user test: Baba
        // Bhide Bridge showed Satara Road's 9 km/h and 163% with "the network changed since this result")
        // The run that was computing (if any) was cancelled above: 'idle', so maybeAutoStart starts this road's own run
        // (a copied 'running' left the analysis stuck at 0 %, p11 browser check)
        this.setState({ analysis: { ...EMPTY_ANALYSIS, status: 'idle' } });
      } else {
        const outdated = !!shown.output && shown.key !== key;
        if (shown.output && !!shown.outdated !== outdated) this.setState({ analysis: { ...shown, outdated } });
        if (shown.output && !outdated && shown.status === 'ready') this.clearAnalysisStopNotice();
      }
      this.refreshCountedJunctions();
      this.refreshTimelineOutdated();
      this.visualizer.render(area, reveal, new Set(section?.segmentKeys ?? []));
      // The selected road is the subject: the camera goes to it, not the whole area
      if (fly) this.focusView();
    } catch (err: any) {
      this.visualizer.clear();
      this.cancelAnalysis();
      this.analysisNetworkKey = null;
      this.setState({ area: null, corridor: null, section: null, error: err?.message || String(err), analysis: EMPTY_ANALYSIS, comparison: { ...this.state.comparison, showingProposal: false } });
    }
    this.ensureOsmRoads();
    this.ensureSignals();
    this.ensureBuildings();
    this.maybeAutoStart();
  }

  /** Name and line of each studied road as last seen in the network, so a road deleted in a proposal can still be studied. */
  private seedMemory = new Map<string, { name: string; coordinates: DrivableObject['coordinates'] }>();
  /**
   * The roads the study area is mapped from: the studied roads, with any deleted in the active scenario replaced by the
   * roads within 25 m of its ends (the roads that joined it), and the deleted ones as closed. A studied road never seen
   * in the network is left to the explorer (which reports it missing).
   */
  private studySeeds(roads: readonly DrivableObject[]): { exploreSeeds: string[]; closed: { id: string; name: string }[]; sourcePoints: number[][]; sourceRoadIds: string[] } {
    const want = this.state.seedRoadIds;
    const byId = new Map<string, DrivableObject>();
    const wanted = new Set(want);
    for (const r of roads) if (wanted.has(r.id)) byId.set(r.id, r);
    for (const [id, r] of byId) this.seedMemory.set(id, { name: r.name || '', coordinates: r.coordinates });
    const missing = want.filter(id => !byId.has(id) && this.seedMemory.has(id));
    if (!missing.length) return { exploreSeeds: want, closed: [], sourcePoints: [], sourceRoadIds: [] };
    const seeds = new Set(want.filter(id => byId.has(id)));
    const sourcePoints: number[][] = [];
    for (const id of missing) {
      const c = this.seedMemory.get(id)!.coordinates;
      for (const p of [c[0], c[c.length - 1]]) {
        sourcePoints.push([p[0], p[1]]);
        const near = this.explorer.nearestRoad(roads as DrivableObject[], this.revision, p[0], p[1], 25);
        if (near) seeds.add(near);
      }
    }
    if (!seeds.size) return { exploreSeeds: want, closed: [], sourcePoints: [], sourceRoadIds: [] };
    return { exploreSeeds: [...seeds], closed: missing.map(id => ({ id, name: this.seedMemory.get(id)!.name })), sourcePoints, sourceRoadIds: [...byId.keys()] };
  }

  /** Runs the analysis once a road has been picked and its area is fully mapped (the live view only starts on request). */
  private maybeAutoStart() {
    if (!this.state.area || this.osmLoad || this.signalLoad || this.buildingLoad || this.recomputeTimer) return; // roads, signals or (p14) buildings still arriving
    // A run in flight (or one waiting for its counts or time profile) finishes on its own. A 'running' status with
    // no run behind it (its run was cancelled by an area, scenario or road change) must not block this road's run:
    // it left Simulate at "Analysing… 22 %" for good (p11 browser check, scenario switch then road click)
    if (this.state.analysis.status === 'running' && (this.analysisRun || this.analysisStarting > 0)) return;
    // A kept result for the same network, demand and hour is not re-run (e.g. after closing and reopening Simulate)
    if (this.state.analysis.output && this.state.analysis.key === this.analysisKey()) { this.analysisStale = false; this.redrawOverlay(); return; }
    if (this.state.analysis.status !== 'ready' || this.analysisStale) { this.analysisStale = false; this.scheduleAnalysis(); }
  }
  /** The area, network or demand changed since the last analysis. */
  private analysisStale = true;
  /** runAnalysis calls waiting for counts or the time profile before their job starts. */
  private analysisStarting = 0;

  /** The last few finished results by analysis key, so Undo/Redo of an edit shows its result again without a re-run. */
  private keptResults = new Map<string, { networkKey: string | null; analysis: RoadAnalysisState }>();
  private keepResult(key: string, networkKey: string | null, analysis: RoadAnalysisState) {
    this.keptResults.delete(key);
    this.keptResults.set(key, { networkKey, analysis });
    while (this.keptResults.size > KEPT_RESULTS) this.keptResults.delete(this.keptResults.keys().next().value!);
  }

  // ── p14: building frontage for the side-friction inference ───────────────

  /** p14: OSM building centroids of the current area (null: not loaded, not covered, or the p13 model). */
  private buildingPoints: BuildingPoint[] | null = null;
  private buildingBoundsKey = '';
  private buildingLoad: AbortController | null = null;
  /** Loads the area's OSM building centroids from the backend's OSM index when the p14 supply model runs. */
  private ensureBuildings() {
    const source = this.signalSource, area = this.state.area;
    if (!source || !area || this.supplyModel !== 'p14') return;
    const b = area.bounds;
    const key = [b.minLng, b.minLat, b.maxLng, b.maxLat].map(v => v.toFixed(4)).join(',');
    if (key === this.buildingBoundsKey) return;
    this.buildingLoad?.abort();
    this.buildingBoundsKey = key;
    this.buildingPoints = null;
    const load = (this.buildingLoad = new AbortController());
    source.buildingPointsIn(b, load.signal)
      .then(points => {
        if (load !== this.buildingLoad) return;
        this.buildingPoints = points;
        const c = this.state.comparison;
        this.invalidateComparison(c.result || c.running ? 'Building frontage for the road side friction changed. Run the comparison again.' : null);
      })
      .finally(() => {
        if (load !== this.buildingLoad) return;
        this.buildingLoad = null;
        this.analysisStale = true;
        this.maybeAutoStart();
      });
  }

  // ── Real traffic signals ──────────────────────────────────────────────────

  /** Loads the mapped traffic signals for the current area (cached on this device after the first time). */
  private ensureSignals() {
    const source = this.signalSource;
    const area = this.state.area;
    if (!source || !area) return;
    const b = area.bounds;
    const key = [b.minLng, b.minLat, b.maxLng, b.maxLat].map(v => v.toFixed(4)).join(',');
    if (key === this.signalBoundsKey) return;
    this.signalLoad?.abort();
    this.signalBoundsKey = key;
    this.signalPoints = null;
    const load = (this.signalLoad = new AbortController());
    this.setState({ signals: { status: 'loading', count: null } });
    source
      .signalsIn(b, load.signal)
      .then(points => {
        if (load !== this.signalLoad) return;
        this.signalPoints = points;
        // Only a comparison on show (or running) is out of date: before any had run, "Run the comparison again" read as an
        // error on a fresh study (p11: a new road, or a closure proposal whose area is mapped from the joining roads)
        const c = this.state.comparison;
        this.invalidateComparison(c.result || c.running ? 'Mapped signals changed. Run the comparison again.' : null);
        this.setState({ signals: { status: 'ready', count: points.length } });
        // The network the stored baseline ran on may be the one with these signals (after a page reload)
        this.maybeRestoreBaseline();
      })
      .catch(() => {
        if (load !== this.signalLoad) return;
        // Signals are then estimated from the road classes; try again next time the area changes
        this.signalBoundsKey = '';
        this.setState({ signals: { status: 'error', count: null } });
      })
      .finally(() => {
        if (load !== this.signalLoad) return;
        this.signalLoad = null;
        this.maybeAutoStart();
      });
  }

  // ── OpenStreetMap roads around the study area ─────────────────────────────

  /**
   * Checks the map tiles within range of the selected roads against
   * OpenStreetMap and loads every road the project is missing there, so the
   * study runs on all the roads that exist, not just those imported earlier.
   * A tile is checked once a fortnight per device; added roads are part of
   * the network, so the area re-maps with them.
   */
  private ensureOsmRoads() {
    const source = this.osmSource;
    if (!source || this.osmLoad || !this.state.active) return;
    const seeds = this.getRoads().filter(r => this.state.seedRoadIds.includes(r.id));
    if (seeds.length === 0) return;
    const tiles = roadTilesAround(boundsOf(seeds.flatMap(r => r.coordinates)), this.state.rangeMeters).filter(t => !this.triedOsmLoads.has(t.key));
    if (tiles.length === 0) return;
    for (const t of tiles) this.triedOsmLoads.add(t.key);

    const load = (this.osmLoad = new AbortController());
    cacheGetMany<{ checkedAt: number }>('osm-road-tiles', tiles.map(t => t.key))
      .then(checked => {
        const due = tiles.filter((_, i) => !checked[i] || Date.now() - checked[i]!.checkedAt > ROAD_TILE_RECHECK_MS);
        if (due.length === 0 || load.signal.aborted) return null;
        this.setState({ osmRoads: { status: 'loading', added: null, error: null } });
        return source.load(due.map(t => t.box), load.signal).then(added => {
          const now = Date.now();
          void cachePutMany('osm-road-tiles', due.map(t => [t.key, { checkedAt: now }]));
          return added;
        });
      })
      .then(added => {
        if (added !== null) this.setState({ osmRoads: { status: 'idle', added, error: null } });
      })
      .catch(err => {
        const error = err instanceof OverpassCancelledError ? 'Loading was cancelled.' : err?.message || String(err);
        this.setState({ osmRoads: { status: 'error', added: null, error } });
      })
      .finally(() => {
        this.osmLoad = null;
        // The range may have grown meanwhile
        this.ensureOsmRoads();
        // New roads re-map the area (which starts traffic); otherwise run on what there is
        if (!this.recomputeTimer) this.maybeAutoStart();
      });
  }

  /** Tries again after a failed OSM road load. */
  public retryOsmRoads() {
    this.triedOsmLoads.clear();
    this.ensureOsmRoads();
  }

  public cancelOsmRoads() {
    this.osmLoad?.abort();
  }

  // ── Live traffic ────────────────────────────────────────────────────────────

  private setTraffic(patch: Partial<TrafficRunState>) {
    this.setState({ traffic: { ...this.state.traffic, ...patch } });
  }

  /**
   * Starts the live view of the selected road's neighbourhood. It runs on the
   * analysis's corridor demand (the same vehicles the figures come from), so
   * it waits for the analysis when that is still running. It first simulates
   * LIVE_WARMUP_S off screen, in slices, from an empty network, and then shows
   * the vehicles: the state on screen is one the model reached itself, not
   * vehicles placed by hand.
   */
  public startTraffic() {
    const area = this.state.area, corridor = this.state.corridor;
    if (!area || !corridor || this.state.traffic.status !== 'idle') return;
    const out = this.state.analysis.output;
    const fresh = out && this.state.analysis.key === this.analysisKey() && this.state.analysis.status === 'ready';
    if (!fresh) {
      // Waiting for the analysis: it provides the corridor's demand
      this.pendingStart = true;
      this.setTraffic({ status: 'preparing', preparing: { stage: 'analysis', progress: this.state.analysis.progress }, error: null });
      if (this.state.analysis.status !== 'running') { this.analysisStale = true; this.maybeAutoStart(); }
      return;
    }
    this.pendingStart = false;
    // Only the roads of the corridor's network go to the run (not the whole city): less to copy to its worker
    const all = new Map(this.getRoads().map(r => [r.id, r]));
    const roads = new Map<string, DrivableObject>();
    corridor.network.edges.forEach(e => { const r = all.get(e.roadId); if (r) roads.set(e.roadId, r); });
    const context = this.getContext();
    const plan = out.corridorPlan;
    this.setTraffic({ demand: { ...plan.provenance }, hour: this.state.analysis.hour, behind: false });
    const init: LiveInit = {
      corridor, roads, plan, warmupS: this.state.traffic.warmupS,
      options: {
        demandLevel: this.state.traffic.demandLevel, seed: this.state.traffic.seed,
        watchRoadIds: area.seedRoadIds, watchSegmentKeys: this.state.section?.segmentKeys,
        signalPoints: this.signalPoints ?? undefined, signalTiming: this.signalTiming,
        ...junctionOptions(context.junctions),
      },
    };
    let live: LiveRun;
    const mine = () => this.live === live;
    try {
      live = createLiveRun(this.liveWorkerFactory ? structuredClone(init) : init, this.state.traffic.speed, {
        progress: share => { if (mine()) this.setTraffic({ preparing: { stage: 'warmup', progress: share } }); },
        ready: metrics => {
          if (!mine()) return;
          this.setTraffic({ status: 'running', preparing: null, metrics });
          live.run();
          this.startLoop();
        },
        empty: () => {
          if (!mine()) return;
          this.live = null;
          this.visualizer.setMarkersVisible(true);
          this.setTraffic({ status: 'idle', preparing: null, error: 'No traffic is routed through this road\'s neighbourhood at this hour, so there is nothing to show.' });
        },
        metrics: (metrics, behind) => { if (mine()) this.setTraffic({ metrics, behind }); },
        error: message => { if (mine()) { this.stopTraffic(); this.setTraffic({ error: `The live view stopped: ${message}` }); } },
      }, this.liveWorkerFactory ?? undefined);
    } catch (err) {
      this.setTraffic({ status: 'idle', preparing: null, error: `The live view could not start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    this.live = live;
    this.visualizer.setMarkersVisible(false);
    this.setTraffic({ status: 'preparing', preparing: { stage: 'warmup', progress: 0 }, error: null });
    live.start();
  }

  public pauseTraffic() {
    if (this.state.traffic.status !== 'running') return;
    this.stopLoop();
    this.live?.pause();
    this.setTraffic({ status: 'paused', metrics: this.live?.metrics() ?? this.state.traffic.metrics });
  }

  public resumeTraffic() {
    if (this.state.traffic.status !== 'paused') return;
    this.setTraffic({ status: 'running' });
    this.live?.run();
    this.startLoop();
  }

  /**
   * Stops the live view and releases it: the animation frame, the warm-up and
   * the simulator go; vehicles are removed and the road colours restored.
   */
  public stopTraffic() {
    this.pendingStart = false;
    const wasRunning = this.live !== null;
    this.stopLoop();
    // Ends the worker (or the inline warm-up) and drops the simulation
    this.live?.dispose();
    this.live = null;
    if (this.state.selectedVehicleId !== null) this.setState({ selectedVehicleId: null });
    this.trafficVisualizer.clear();
    this.visualizer.setMarkersVisible(true);
    if (wasRunning && this.state.area && this.state.active) { this.visualizer.render(this.state.area, false, new Set(this.state.section?.segmentKeys ?? [])); this.redrawOverlay(); }
    const t = this.state.traffic;
    if (t.status !== 'idle' || t.metrics || t.error || t.preparing || t.behind) this.setTraffic({ status: 'idle', metrics: null, error: null, preparing: null, hour: null, behind: false });
  }

  /** Earlier name of stopTraffic. */
  public resetTraffic() { this.stopTraffic(); }

  /** Clears the vehicles and starts the live view again (a new warm-up, same seed). */
  public restartTraffic() {
    this.stopTraffic();
    this.startTraffic();
  }

  public setTrafficSpeed(speed: number) {
    this.live?.setSpeed(speed);
    this.setTraffic({ speed });
  }

  public setDemandLevel(level: number) {
    const demandLevel = Math.max(0, Math.min(1, level));
    this.invalidateComparison('Demand settings changed. Restore the baseline settings, or Save again for a new baseline.');
    this.live?.setDemand(demandLevel, focusLoadFor({ focus: this.state.traffic.focus, demandLevel }));
    this.setTraffic({ demandLevel, metrics: this.live?.metrics() ?? this.state.traffic.metrics });
  }

  /** Turns the extra through traffic on the selected roads on or off. */
  public setFocus(focus: boolean) {
    this.invalidateComparison('Focus settings changed. Restore the baseline settings, or Save again for a new baseline.');
    this.live?.setDemand(this.state.traffic.demandLevel, focusLoadFor({ focus, demandLevel: this.state.traffic.demandLevel }));
    this.setTraffic({ focus, metrics: this.live?.metrics() ?? this.state.traffic.metrics });
  }

  private studyKey() {
    // p13: the tuned (estimated) supply set is part of the study, so a baseline made with the other setting is never
    // compared against (nor restored onto) this one; the default set adds nothing, so keys of baselines saved before p13 hold
    // p14: so are the supply model (p13 adds nothing, so keys of earlier baselines hold) and the synthetic demand (the area estimate adds nothing)
    return contentKey({ roads: this.state.seedRoadIds, range: this.state.rangeMeters, direction: this.state.direction, ...(this.useTunedSupply ? { supply: 'tuned' } : {}),
      ...(this.supplyModel === 'p14' ? { model: 'p14' } : {}), ...(this.useSyntheticDemand ? { demand: 'synthetic' } : {}) });
  }

  private demandContextKey() {
    return demandContextKey(this.getContext());
  }

  private invalidateComparison(reason: string | null) {
    this.invalidateCalibration(reason ?? 'The network changed. Measure again.');
    this.comparisonGeneration++;
    if (!this.state.comparison.baseline && !this.state.comparison.running) return;
    if (this.state.comparison.running) this.comparisonRun?.cancel();
    this.setState({ comparison: { ...this.state.comparison, current: null, result: null, staleReason: reason ?? this.state.comparison.staleReason, running: false } });
  }

  /** A trial must run on the area mapped from the current roads, not one still waiting out its debounce. */
  private flushPendingRecompute() {
    if (!this.recomputeTimer) return;
    this.cancelPendingRecompute();
    this.recompute(false, false);
  }

  // ── Demand for the area ─────────────────────────────────────────────────

  /** Land-use peak the clock falls in: morning before noon, else evening. */
  private landUsePeriod(): 'AM_Peak' | 'PM_Peak' {
    return this.state.timeOfDay.hour < 12 ? 'AM_Peak' : 'PM_Peak';
  }

  private planCache: { key: string; plan: DemandPlan | null } | null = null;
  private calibratedEdgeFlows: CalibratedEdgeFlows | null = null;
  /** Use the calibrated window edge flows where they cover the area (default). Off only to cut the window itself from the prior (WindowCalibration harness). */
  public useCalibratedEdgeFlows = true;
  /**
   * p13: the tuned (estimated) supply set of the area assignment (calibration/tunedSupply.ts; docs/urbanos/VALIDATION_P13.md).
   * On by default only when it passed the project check on its hold-out records and did not worsen the official-count check;
   * otherwise an opt-in "tuned (estimated)" setting.
   */
  public useTunedSupply = TUNED_SUPPLY_DEFAULT_ON && !!TUNED_SUPPLY;
  /** Turns the tuned (estimated) supply set on or off: a saved baseline made with the other setting can no longer be compared. */
  public setTunedSupply(on: boolean) {
    const next = on && !!TUNED_SUPPLY;
    if (this.useTunedSupply === next) return;
    this.useTunedSupply = next;
    this.invalidateComparison(STUDY_CHANGED.supply);
    this.setState({ supplySet: next ? 'tuned' : 'default' });
    // Switched back to the baseline's setting (same roads, range and direction): its notice no longer applies
    const c = this.state.comparison;
    if (c.baseline && c.staleReason && STUDY_REASONS.has(c.staleReason) && this.baselineStudyKey === this.studyKey()) this.setState({ comparison: { ...c, staleReason: null } });
    if (this.state.area) { this.analysisStale = true; this.scheduleAnalysis(); }
  }
  /** p14: the supply model of the area assignment (supplyConfig.ts). SUPPLY_MODEL_DEFAULT decides the default. */
  public supplyModel: SupplyModel = SYNTHETIC_DEMAND_DEFAULT_ON ? SYNTHETIC_PARAMS.supplyModel : SUPPLY_MODEL_DEFAULT;
  /** Switches the supply model: a saved baseline made with the other model can no longer be compared. */
  public setSupplyModel(model: SupplyModel) {
    if (this.supplyModel === model) return;
    this.supplyModel = model;
    this.invalidateComparison(STUDY_CHANGED.supplyModel);
    this.setState({ supplyModel: model });
    const c = this.state.comparison;
    if (c.baseline && c.staleReason && STUDY_REASONS.has(c.staleReason) && this.baselineStudyKey === this.studyKey()) this.setState({ comparison: { ...c, staleReason: null } });
    this.buildingBoundsKey = '';
    this.ensureBuildings();
    if (this.state.area) { this.analysisStale = true; this.scheduleAnalysis(); }
  }
  /** The supply set an analysis uses now (null: the defaults). */
  public activeSupply(): SupplyParams | null {
    // p14: the synthetic demo model runs with the supply parameters it was evaluated with (the p13 tuned set is not combined with it)
    if (this.useSyntheticDemand) return SYNTHETIC_PARAMS.supply ? { ...DEFAULT_SUPPLY, ...SYNTHETIC_PARAMS.supply } : null;
    return this.useTunedSupply ? TUNED_SUPPLY : null;
  }
  /** p14: the SYNTHETIC land-use demand (demand/syntheticDemand.ts): on by default only when the recorded hold-out check passed. */
  public useSyntheticDemand = SYNTHETIC_DEMAND_DEFAULT_ON;
  private synthetic = new SyntheticDemandSource(SYNTHETIC_DATASET_ID);
  /** Switches the demand between the area estimate and the synthetic demand: a saved baseline made with the other can no longer be compared. */
  public setSyntheticDemand(on: boolean) {
    if (this.useSyntheticDemand === on) return;
    // The synthetic demo model is the demand AND the supply model it was evaluated with (p14), as one switch
    this.setSupplyModel(on ? SYNTHETIC_PARAMS.supplyModel : SUPPLY_MODEL_DEFAULT);
    this.useSyntheticDemand = on;
    this.planCache = null;
    this.invalidateComparison(STUDY_CHANGED.demand);
    this.setState({ demandModel: { ...this.state.demandModel, model: on ? 'synthetic' : 'area-estimate' } });
    const c = this.state.comparison;
    if (c.baseline && c.staleReason && STUDY_REASONS.has(c.staleReason) && this.baselineStudyKey === this.studyKey()) this.setState({ comparison: { ...c, staleReason: null } });
    // The plan now represents the clock hour (synthetic) or the land-use peak (area estimate): the hour factor follows
    this.setTimeOfDay({});
    if (on) this.ensureSynthetic();
    if (this.state.area) { this.analysisStale = true; this.scheduleAnalysis(); }
  }
  /** Loads the synthetic city model and the area's building trip ends (once each); re-runs the analysis when they arrive. */
  private ensureSynthetic(area: StudyArea | null = this.state.area) {
    if (!this.useSyntheticDemand) return;
    const s = this.synthetic;
    const done = () => {
      this.setState({ demandModel: { ...this.state.demandModel, status: s.status === 'off' ? 'loading' : s.status, error: s.error } });
      if (this.useSyntheticDemand && this.state.area && s.city && s.hasEnds(this.state.area.bounds)) { this.planCache = null; this.analysisStale = true; this.setTimeOfDay({}); this.scheduleAnalysis(); }
    };
    if (!s.city) {
      if (s.status !== 'loading') { this.setState({ demandModel: { ...this.state.demandModel, status: 'loading' } }); void s.load(SYNTHETIC_PARAMS.betaMult).then(() => { done(); this.ensureSynthetic(); }); }
      return;
    }
    if (area && !s.hasEnds(area.bounds)) void s.loadEnds(area.bounds).then(done);
  }
  /** The synthetic demand is what the area runs on now (switched on, model and trip ends loaded). */
  private syntheticInUse(area: StudyArea | null = this.state.area): boolean {
    return this.useSyntheticDemand && !this.calibratedPlan && !!area && !!this.synthetic.city && this.synthetic.hasEnds(area.bounds);
  }
  private estimatedTraffic: EstimatedTrafficModel | null = null;
  /**
   * Use the city-wide estimated traffic for main-road edge flows. OFF: tried in p10 (docs/urbanos/TRAFFIC_ESTIMATED_P10.md
   * §5) and worse on the hold-out sites than the class-typical flows, so not shipped. The dataset stays loaded (estimated,
   * project-level, not for decisions); the validation harness turns this on with VAL24_ESTIMATED=1 to re-check it.
   */
  public useEstimatedTraffic = false;
  /**
   * With the estimated traffic on (p11): the area's own trips from the estimated CMP-2024 zone land use (AreaDemand
   * estimatedLandUse) and the demand matched to the estimated main-road flows (AreaDemandMatch.ts). Separate switches so
   * the validation harness can take each part out (VAL24_EST_LANDUSE=0, VAL24_EST_MATCH=0).
   */
  public estimatedLandUse = true;
  public estimatedMatch = true;

  /**
   * The OD demand the area runs on: the counts-calibrated plan when applied,
   * else the area estimate (AreaDemand.ts: the area's own trips, trips across
   * its edge and through traffic on its main roads) for the land-use peak of
   * the clock hour; the hypothetical multiplier, if set, on top (labelled so).
   */
  public studyPlan(area: StudyArea | null = this.state.area, landUse: 'AM_Peak' | 'PM_Peak' = this.landUsePeriod(), raw = false, hour: number = this.state.timeOfDay.hour): DemandPlan | null {
    if (!area) return null;
    const settings = this.state.demandSettings;
    let plan: DemandPlan | null;
    if (this.calibratedPlan) plan = this.calibratedPlan;
    else if (this.useSyntheticDemand && this.syntheticInUse(area)) {
      // p14: the SYNTHETIC demand of the clock hour (label synthetic; never mixed with the area estimate's parts)
      const key = contentKey({ synthetic: this.synthetic.city!.id, rev: this.revision, seeds: area.seedRoadIds, range: area.rangeMeters, dir: area.direction, through: settings.through, corr: this.correctionsEnabled, hour, p: SYNTHETIC_PARAMS });
      if (this.planCache?.key !== key) {
        const roads = new Map(this.getRoads().map(r => [r.id, r]));
        const areaKey = contentKey({ rev: this.revision, seeds: area.seedRoadIds, range: area.rangeMeters, dir: area.direction, corr: this.correctionsEnabled, b: area.bounds });
        this.planCache = { key, plan: this.synthetic.plan(area, roads, hour, settings.through !== false, areaKey, SYNTHETIC_PARAMS.scale) };
      }
      plan = this.planCache.plan;
    } else {
      if (this.useSyntheticDemand) this.ensureSynthetic(area);
      const period = landUse;
      const key = contentKey({ ctx: demandContextKey({ ...this.getContext(), period }), rev: this.revision, seeds: area.seedRoadIds, range: area.rangeMeters, dir: area.direction, through: settings.through, corr: this.correctionsEnabled, edge: this.useCalibratedEdgeFlows ? this.calibratedEdgeFlows?.id ?? null : null, est: this.useEstimatedTraffic ? this.estimatedTraffic?.id ?? null : null,
        estLu: this.useEstimatedTraffic && this.estimatedLandUse, estMatch: this.useEstimatedTraffic && this.estimatedMatch, sig: this.useEstimatedTraffic && this.estimatedMatch ? this.signalPoints?.length ?? null : null });
      if (this.planCache?.key !== key) {
        const ctx = { ...this.getContext(), period };
        const roads = new Map(this.getRoads().map(r => [r.id, r]));
        const est = this.useEstimatedTraffic ? this.estimatedTraffic : null;
        let compiled = compileAreaDemand(ctx, area, roads, { through: settings.through, calibratedEdgeFlows: this.useCalibratedEdgeFlows ? this.calibratedEdgeFlows : null, estimatedTraffic: est, estimatedLandUse: !!est && this.estimatedLandUse });
        // Matched to the estimated main-road flows (estimated, project-level, not for decisions); through traffic switched
        // off is the user's what-if and is left unmatched
        if (compiled && est && this.estimatedMatch && settings.through !== false) {
          const m = matchPlanToEstimates(compiled, area, roads, est, period === 'PM_Peak' ? 19 : 9, { signalPoints: this.mappedSignalPoints() ?? undefined });
          if (m) compiled = m.plan;
        }
        this.planCache = { key, plan: compiled };
      }
      plan = this.planCache.plan;
    }
    if (!plan || raw) return plan;
    // The ODME demand version, when the user chose it and it was estimated from this very prior at this hour
    if (this.state.odme.used && this.odmePlan?.provenance.odme && this.odmePlan.provenance.odme.hour === this.state.timeOfDay.hour
      && this.odmePlan.provenance.odme.priorKey === this.keyOfPlan(plan)) plan = this.odmePlan;
    const scale = settings.hypotheticalScale;
    if (scale === null || scale === 1) return plan;
    return { trips: plan.trips.map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * scale })),
      provenance: { ...plan.provenance, source: 'hypothetical', vehiclesPerHour: plan.provenance.vehiclesPerHour * scale,
        label: `HYPOTHETICAL: ${Math.round(scale * 100)}% of the estimate below. Not observed and not forecast; for exploring what more or less traffic would do. ${plan.provenance.label}` } };
  }

  public setDemandSettings(patch: Partial<DemandSettings>) {
    const next = { ...this.state.demandSettings, ...patch };
    if (next.hypotheticalScale !== null && (!Number.isFinite(next.hypotheticalScale) || next.hypotheticalScale <= 0)) next.hypotheticalScale = null;
    this.invalidateComparison('Demand settings changed. Restore them or save a new baseline.');
    this.setState({ demandSettings: next });
    this.refreshTimelineOutdated();
    this.stopTraffic();
    this.analysisStale = true;
    this.scheduleAnalysis();
  }

  // ── Road analysis ───────────────────────────────────────────────────────

  private simOptions(): AnalysisJob['options'] {
    const traffic = this.state.traffic;
    return { demandLevel: traffic.demandLevel, seed: traffic.seed, signalPoints: this.signalPoints ?? undefined, signalTiming: this.signalTiming, ...junctionOptions(structuredClone(this.getContext().junctions)) };
  }

  private analysisJob(plan: DemandPlan, area: StudyArea, section: RoadSection, measureS: number = DEFAULT_ANALYSIS.measureS, o: { hourFactor?: number; seeds?: readonly number[] } = {}): AnalysisJob {
    const ds = this.state.calibration.dataset;
    const corridor = this.state.corridor ?? area;
    return { area, corridor, roads: new Map(structuredClone(this.getRoads()).map(r => [r.id, r])), options: this.simOptions(), supply: this.activeSupply(),
      supplyModel: this.supplyModel, buildings: this.supplyModel === 'p14' ? this.buildingPoints : undefined, plan: structuredClone(plan), section,
      ...(this.useSyntheticDemand && SYNTHETIC_PARAMS.localCostFactor ? { localCostFactor: SYNTHETIC_PARAMS.localCostFactor } : {}),
      hourFactor: o.hourFactor ?? this.state.timeOfDay.factor, seeds: o.seeds ?? this.analysisSeeds, warmupS: DEFAULT_ANALYSIS.warmupS, measureS,
      countJunctions: ds ? junctionsIn(ds, corridor.bounds) : undefined };
  }

  /**
   * Scenario generator (docs/SCENARIO_GENERATOR.md): while a batch of candidate runs uses the analysis worker, the
   * automatic re-analysis after each scenario switch is not scheduled (the batch runs each candidate through
   * runComparison on the frozen baseline inputs instead).
   */
  public suspendAutoAnalysis = false;
  /** Suspends (and cancels any pending or running) automatic road analysis, or resumes it. */
  public setAutoAnalysisSuspended(on: boolean) {
    this.suspendAutoAnalysis = on;
    if (on) this.cancelAnalysis();
  }

  /** What the generator diagnoses: the analysis on show, the area it ran on and the roads as the analysis saw them. */
  public generatorContext(): { output: AnalysisOutput; area: StudyArea; roads: Map<string, DrivableObject> } | null {
    const out = this.state.analysis.output, area = this.state.area;
    if (!out || !area || this.state.analysis.status !== 'ready' || this.state.analysis.outdated) return null;
    return { output: out, area, roads: new Map(this.getRoads().map(r => [r.id, r])) };
  }

  /** Seeds every analysis runs (results are their mean, with the spread shown). */
  public analysisSeeds: readonly number[] = DEFAULT_ANALYSIS.seeds;

  /** What an analysis result depends on: a different key means it must be re-run. */
  private analysisKey() {
    const plan = this.studyPlan();
    return contentKey({ net: this.currentNetworkKey(), study: this.studyKey(), plan: plan ? contentKey({ n: plan.trips.length, v: Math.round(plan.provenance.vehiclesPerHour), src: plan.provenance.source }) : null,
      hour: this.state.timeOfDay.hour, day: this.state.timeOfDay.day, f: this.state.timeOfDay.factor, seeds: this.analysisSeeds, settings: this.state.demandSettings,
      // A result computed without the profile is never taken for one computed with it
      profile: this.state.timeOfDay.status === 'ready',
      // Signal timing (Webster or equal split) is not part of the roads: a run under the other timing is another case (docs/OVERHAUL.md §25)
      signalTiming: this.signalTiming,
      // p14: the supply model and the building frontage it read (p13 adds nothing)
      ...(this.supplyModel === 'p14' ? { supplyModel: 'p14', buildings: this.buildingPoints?.length ?? null } : {}) });
  }

  /** Re-runs the road analysis shortly (settings settle first). */
  private scheduleAnalysis(delayMs = 500) {
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    this.analysisTimer = null;
    if (!this.state.active || !this.state.area || this.suspendAutoAnalysis) return;
    this.analysisTimer = setTimeout(() => { this.analysisTimer = null; void this.runAnalysis(); }, delayMs);
  }

  private cancelAnalysis() {
    if (this.analysisTimer) clearTimeout(this.analysisTimer);
    this.analysisTimer = null;
    this.analysisRun?.cancel();
    this.analysisRun = null;
    this.runningAnalysis = null;
  }

  /**
   * Analyses the selected section in a fixed, repeatable run (analysisJob.ts):
   * the planned demand at the clock hour, one round of route adaptation, then
   * a measured run from an empty network. Live traffic is for watching; this
   * run is what the figures in the panel come from.
   */
  public async runAnalysis(): Promise<AnalysisOutput | null> {
    this.flushPendingRecompute();
    const area = this.state.area, section = this.state.section;
    this.cancelAnalysis();
    if (!area || !section) return null;
    this.analysisStarting++;
    try {
      await this.ensureCountData().catch(() => {});
      if (this.state.timeOfDay.status !== 'ready') {
        // The hour's demand factor comes from the profile: load it first (its arrival schedules a re-run; this run is it)
        await this.ensureTimeProfile();
      }
    } finally {
      this.analysisStarting--;
    }
    // The road or area changed while this waited: this run would compute the old one under the new key. The change's
    // own start was held back while this waited (maybeAutoStart): start the run for what is selected now
    if (this.state.area !== area || this.state.section !== section) {
      if (!this.analysisRun && this.analysisStarting === 0) this.maybeAutoStart();
      return null;
    }
    // This run reads the clock, profile and demand as they are now: a re-run scheduled while it waited
    // (e.g. by the profile arriving during the count load) would only cancel it and repeat it
    if (this.analysisTimer) { clearTimeout(this.analysisTimer); this.analysisTimer = null; }
    const plan = this.studyPlan(area);
    if (!runnablePlan(plan)) {
      this.setState({ analysis: { status: 'error', progress: 0, output: null, error: 'No traffic can be estimated for this area: no roads cross its edge and it holds no buildings or zones with activity.', hour: this.state.timeOfDay.hour, demandVph: 0, key: null } });
      if (this.pendingStart) { this.pendingStart = false; this.setTraffic({ status: 'idle', preparing: null, error: 'The live view needs the analysis, which could not run here.' }); }
      return null;
    }
    const hour = this.state.timeOfDay.hour, demandVph = plan.provenance.vehiclesPerHour * this.state.timeOfDay.factor;
    const hourFactor = this.state.timeOfDay.factor, timeProfile = this.state.timeOfDay.status === 'ready' ? 'loaded' as const : 'unavailable' as const;
    const key = this.analysisKey();
    this.setState({ analysis: { ...this.state.analysis, status: 'running', progress: 0, error: null, hour, demandVph } });
    const networkKey = this.currentNetworkKey();
    const fingerprint = this.runFingerprint(plan, DEFAULT_ANALYSIS.measureS, this.analysisSeeds, hourFactor);
    const run = startAnalysisJob(this.analysisJob(plan, area, section), progress => {
      if (this.analysisRun !== run) return;
      this.setState({ analysis: { ...this.state.analysis, progress } });
      if (this.pendingStart) this.setTraffic({ preparing: { stage: 'analysis', progress } });
    });
    this.analysisRun = run;
    this.runningAnalysis = { fingerprint, promise: run.promise };
    try {
      const output = await run.promise;
      if (this.analysisRun !== run) return null;
      this.analysisRun = null;
      this.runningAnalysis = null;
      this.analysisNetworkKey = networkKey;
      const seedKey = seedKeyOf(area.seedRoadIds);
      this.keepResult(key, networkKey, { status: 'ready', progress: 1, output, error: null, hour, demandVph, key, hourFactor, timeProfile, fingerprint, seedKey });
      this.setState({ analysis: { status: 'ready', progress: 1, output, error: null, hour, demandVph, key, hourFactor, timeProfile, fingerprint, seedKey },
        comparison: { ...this.state.comparison, showingProposal: this.showsProposal(this.state.comparison.baseline) } });
      this.clearAnalysisStopNotice();
      this.redrawOverlay();
      this.maybeRestoreBaseline();
      // Start was pressed while this was running: the live view can start now
      if (this.pendingStart && this.state.traffic.status === 'preparing') { this.setTraffic({ status: 'idle' }); this.startTraffic(); }
      return output;
    } catch (err) {
      if (this.runningAnalysis?.promise === run.promise) this.runningAnalysis = null;
      if (this.analysisRun !== run) return null;
      this.analysisRun = null;
      this.setState({ analysis: { ...this.state.analysis, status: 'error', error: err instanceof Error ? err.message : String(err) } });
      if (this.pendingStart) { this.pendingStart = false; this.setTraffic({ status: 'idle', preparing: null, error: 'The live view needs the analysis, which failed.' }); }
      return null;
    }
  }

  /** Shows (or hides) where the section's traffic comes from and goes to on the map. */
  public showSelectLink(on: boolean) {
    this.setOverlay(on ? 'select-link' : 'none');
  }

  /**
   * What the map shows over the area: nothing extra, where the selected road's
   * traffic comes from and goes (select-link), how full every road is
   * (volume/capacity), the traced queue behind the road's delay, or what a
   * proposal changed. One at a time.
   */
  public setOverlay(overlay: MapOverlay) {
    if (overlay === this.state.overlay && overlay !== 'none') { this.redrawOverlay(); return; }
    this.setState({ overlay });
    this.redrawOverlay();
  }

  private redrawOverlay() {
    if (!this.state.active) return;
    const out = this.state.analysis.output?.result;
    const kind = this.state.overlay;
    this.visualizer.showSelectLink(null);
    if (kind === 'none' || !out) { this.visualizer.showOverlay(null); return; }
    if (kind === 'select-link') { this.visualizer.showOverlay(null); this.visualizer.showSelectLink(out.selectLinkVph); return; }
    if (kind === 'area-vc') {
      this.visualizer.showOverlay(key => { const vc = out.areaVc.get(key); return vc === undefined ? null : { css: vcColour(vc), alpha: vc < 0.3 ? 0.35 : 0.9 }; },
        out.areaBottlenecks.slice(0, 5).map((b, i) => ({ coordinates: b.coordinates, label: `${i + 1}. ${b.roadName} ${vcText(b.vc)}`, css: '#f43f5e' })));
      return;
    }
    if (kind === 'cause') {
      const chain = out.cause.chain;
      const keys = new Set(chain?.segmentKeys ?? []), section = new Set(out.section.segmentKeys);
      this.visualizer.showOverlay(key => section.has(key) ? { css: '#67e8f9', alpha: 1 } : keys.has(key) ? { css: '#f43f5e', alpha: 1 } : null,
        chain?.root ? [{ coordinates: [chain.root.coordinates[0], chain.root.coordinates[1], 0], label: `Queue starts here: ${chain.root.label}`, css: '#f43f5e' }] : []);
      return;
    }
    if (kind === 'comparison') {
      const c = this.state.comparison.result;
      if (!c) { this.visualizer.showOverlay(null); return; }
      const change = c.segmentChange;
      this.visualizer.showOverlay(key => { const d = change.get(key); if (d === undefined || Math.abs(d) < 0.05) return null; return { css: d < 0 ? '#34d399' : '#f43f5e', alpha: Math.min(1, 0.4 + Math.abs(d)) }; },
        [...c.newBottlenecks.map(b => ({ coordinates: b.coordinates, label: `New bottleneck: ${b.roadName}`, css: '#f43f5e' }))]);
    }
  }

  // ── Existing city against a proposal ────────────────────────────────────

  private baselineRoads: Map<string, DrivableObject> | null = null;
  private baselineStore: BaselineStore = idbBaselineStore;
  /** Storage for saved baselines (IndexedDB by default; tests give their own). */
  public setBaselineStore(store: BaselineStore) { this.baselineStore = store; }
  /** The restore attempt in progress (for tests and the panel), or null. */
  public baselineRestore: Promise<boolean> | null = null;
  private restoreTried = new Set<string>();
  /** Studies with no baseline of their own in the browser (not looked up again while another study's baseline is kept). */
  private restoreMissing = new Set<string>();

  private saveBaseline(baseline: TrafficRunSnapshot, plan: DemandPlan) {
    const seedRoadIds = [...this.state.seedRoadIds];
    const rec: StoredBaseline = { v: BASELINE_STORE_VERSION, savedAt: new Date().toISOString(), studyKey: this.baselineStudyKey, contextKey: this.baselineContextKey, seedRoadIds,
      baseline, plan, roads: [...(this.baselineRoads?.values() ?? [])].map(compactRoad) };
    this.restoreTried.add(seedKeyOf(seedRoadIds));
    this.restoreMissing.delete(rec.studyKey);
    void this.baselineStore.put(seedKeyOf(seedRoadIds), rec).catch(() => {});
  }

  /**
   * Restores a baseline saved for this study in an earlier session (after a page reload): same roads, range and
   * direction; on the scenario it ran on only when that network is unchanged. Tried once per study per session.
   */
  private maybeRestoreBaseline() {
    const c = this.state.comparison;
    const key = seedKeyOf(this.state.seedRoadIds);
    const studyKey = this.studyKey();
    if (c.running || !this.state.seedRoadIds.length) return;
    // A baseline for another study (another road, range or direction) gives way to one saved for this study: with
    // baselines saved for two roads, the second road showed the first one's baseline as 'The study roads changed since
    // the baseline' after a reload (p11 browser run: Satara Road after Baba Bhide Bridge)
    if (c.baseline && this.baselineStudyKey === studyKey) return;
    if (c.baseline ? this.restoreMissing.has(studyKey) : this.restoreTried.has(key)) return;
    this.restoreTried.add(key);
    const generation = this.comparisonGeneration, prior = c.baseline;
    this.baselineRestore = (async () => {
      const rec = await this.baselineStore.get(key).catch(() => undefined);
      if (!rec || rec.v !== BASELINE_STORE_VERSION || rec.studyKey !== studyKey) { this.restoreMissing.add(studyKey); return false; }
      // Nothing else happened meanwhile (a baseline saved, a run started, another road selected)
      const now = this.state.comparison;
      // (a change meanwhile, such as the mapped signals arriving, tries again; a baseline saved meanwhile does not)
      if (generation !== this.comparisonGeneration || now.baseline !== prior || now.running || this.studyKey() !== studyKey) { if (now.baseline === prior) this.restoreTried.delete(key); return false; }
      // The existing city it ran on has changed since: not restored (a comparison against it would not be like with like)
      // (tried again on the next change of the network: the mapped signals or roads may still be loading after a reload)
      if ((this.getContext().scenarioId ?? 'current') === rec.baseline.scenarioId && this.currentNetworkKey() !== rec.baseline.networkKey) { this.restoreTried.delete(key); return false; }
      this.baselinePlan = rec.plan;
      this.baselineRoads = new Map(rec.roads.map(r => [r.id, r]));
      this.baselineContextKey = rec.contextKey;
      this.baselineStudyKey = rec.studyKey;
      this.setState({ comparison: { baseline: rec.baseline, current: null, result: null, staleReason: null, running: false, progress: 1, demandChanged: false, showingProposal: this.showsProposal(rec.baseline), restoredAt: rec.savedAt } });
      return true;
    })();
  }

  private snapshotOf(output: AnalysisOutput, plan: DemandPlan, measureS: number): TrafficRunSnapshot {
    const traffic = this.state.traffic, context = this.getContext();
    return { scenarioId: context.scenarioId ?? 'current', durationS: measureS, seed: traffic.seed, demandLevel: traffic.demandLevel, focus: traffic.focus,
      hour: this.state.timeOfDay.hour, hourFactor: this.state.timeOfDay.factor,
      demandKey: contentKey(plan), networkKey: this.currentNetworkKey(),
      metrics: output.result.network, demandVph: plan.provenance.vehiclesPerHour * this.state.timeOfDay.factor, analysis: output,
      inputs: { demandKey: contentKey(plan), trips: plan.trips.length, plannedVph: plan.provenance.vehiclesPerHour, hour: this.state.timeOfDay.hour, hourFactor: this.state.timeOfDay.factor,
        seeds: output.result.perSeed.map(s => s.seed), measureS, warmupS: DEFAULT_ANALYSIS.warmupS, day: this.state.timeOfDay.day,
        signalTiming: this.signalTiming, signalSource: this.signalPoints ? 'mapped' : 'estimated', networkCorrections: this.correctionsEnabled,
        demandLevel: traffic.demandLevel, engineVersion: ENGINE_VERSION },
      junctionEdits: structuredClone(splitJunctionObjects(context.junctions).edits) };
  }

  /**
   * Before and after at each imported junction whose edit differs between the
   * baseline and the proposal of the comparison on show: delay and traffic per
   * approach (docs/OVERHAUL.md §23). Empty without a comparison or such edits.
   */
  public junctionComparisons(): { junctionId: string; label: string; edit: JunctionEditSpec; deltas: NonNullable<ReturnType<typeof junctionApproachDeltas>> }[] {
    const { baseline, current } = this.state.comparison;
    const net = this.state.area?.network;
    if (!baseline || !current || !net) return [];
    const before = new Map((baseline.junctionEdits ?? []).map(e => [e.junctionId, e]));
    const after = new Map((current.junctionEdits ?? []).map(e => [e.junctionId, e]));
    const ids = [...new Set([...before.keys(), ...after.keys()])].filter(id => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)));
    const out: { junctionId: string; label: string; edit: JunctionEditSpec; deltas: NonNullable<ReturnType<typeof junctionApproachDeltas>> }[] = [];
    for (const id of ids) {
      const edit = after.get(id) ?? before.get(id)!;
      const deltas = junctionApproachDeltas(net, edit, baseline.analysis.result, current.analysis.result);
      if (deltas) out.push({ junctionId: id, label: edit.label, edit, deltas });
    }
    return out;
  }

  /** Records each baseline and proposal run's frozen inputs (set by the engine; null: not recorded). */
  public runRecorder: RunRecorder | null = null;

  private async recordRun(snap: TrafficRunSnapshot, comparison?: ComparisonRunRecord): Promise<void> {
    if (!this.runRecorder) return;
    try {
      const r = snap.analysis.result;
      snap.runId = await this.runRecorder({ scenarioId: snap.scenarioId, inputs: snap.inputs,
        results: { totalVph: r.totalVph, meanTravelTimeS: r.network.meanTravelTimeS, meanDelayS: r.network.meanDelayS, completedTrips: r.network.completedTrips, ...(comparison ? { comparison } : {}) } });
    } catch (e) {
      console.warn('[SimulationMode] run inputs not recorded:', e);
    }
  }

  /**
   * The assumptions a scenario version records (docs/SCENARIOS_AND_VERSIONING.md): the frozen baseline demand (its
   * content key, when a baseline was saved), demand settings, clock hour and day, seeds, warm-up and measured
   * period, signal timing mode and where signals come from, network corrections, demand level, engine build.
   */
  public frozenAssumptions(): Record<string, unknown> {
    const t = this.state.timeOfDay, traffic = this.state.traffic;
    return {
      demandFrozen: this.baselinePlan ? contentKey(this.baselinePlan) : null,
      demandCalibrated: !!this.calibratedPlan, demandSettings: structuredClone(this.state.demandSettings),
      demandEstimatedFromCounts: this.state.odme.used && this.odmePlan?.provenance.odme ? { priorKey: this.odmePlan.provenance.odme.priorKey, datasets: this.odmePlan.provenance.odme.calibrationDatasetIds, iterations: this.odmePlan.provenance.odme.iterations, hour: this.odmePlan.provenance.odme.hour, createdAt: this.odmePlan.provenance.odme.createdAt, demandKey: contentKey(this.odmePlan) } : null,
      hour: t.hour, day: t.day, countPeak: t.countPeak, seeds: [...this.analysisSeeds],
      warmupS: DEFAULT_ANALYSIS.warmupS, measureS: DEFAULT_ANALYSIS.measureS,
      signalTiming: this.signalTiming, signalSource: this.signalPoints ? 'mapped' : 'estimated',
      networkCorrections: this.correctionsEnabled, demandLevel: traffic.demandLevel, trafficSeed: traffic.seed, engineVersion: ENGINE_VERSION,
    };
  }

  /**
   * The network key hashes every road (about 0.5 s for the full Pune network, headless): it is kept until the roads
   * (a new array after every change, see getRoads), the junction settings or the mapped signals change.
   */
  private netKeyCache: { roads: unknown; signals: unknown; junctions: string; key: string } | null = null;
  private currentNetworkKey() {
    const roads = this.getRoads(), junctions = this.getContext().junctions, signals = this.signalPoints;
    const jKey = contentKey(junctions ?? null);
    const c = this.netKeyCache;
    if (c && c.roads === roads && c.signals === signals && c.junctions === jKey) return c.key;
    const key = networkContentKey(roads, junctions, signals);
    this.netKeyCache = { roads, signals, junctions: jKey, key };
    return key;
  }

  /**
   * Everything a run's output depends on (docs/urbanos/SIMULATE_AUDIT.md): the demand's content, the network, the
   * study road and range, the hour factor, seeds, warm-up and measured window, and the simulator options. Runs with
   * the same fingerprint give the same output (the analysis is deterministic), so one is never computed twice.
   */
  private runFingerprint(plan: DemandPlan, measureS: number, seeds: readonly number[], hourFactor: number = this.state.timeOfDay.factor): string {
    const t = this.state.traffic;
    return contentKey({ plan: this.keyOfPlan(plan), net: this.currentNetworkKey(), study: this.studyKey(), section: this.state.section?.segmentKeys ?? null,
      hourFactor, seeds: [...seeds], measureS, warmupS: DEFAULT_ANALYSIS.warmupS, demandLevel: t.demandLevel, seed: t.seed, signalTiming: this.signalTiming,
      counts: this.state.calibration.dataset ? true : false });
  }
  /** Fingerprint of the road analysis now running (null when none). */
  private runningAnalysis: { fingerprint: string; promise: Promise<AnalysisOutput> } | null = null;

  /** Whether the analysis on show ran on a network other than the baseline's. */
  private showsProposal(baseline: TrafficRunSnapshot | null) {
    // Only for the study the baseline was saved on: another road's area has its own mapped signals, so its network key
    // differs from that baseline's although nothing was edited (p11: Baba Bhide Bridge in the existing city was badged
    // "Proposal" after Satara Road's baseline)
    return !!baseline && this.analysisNetworkKey !== null && this.analysisNetworkKey !== baseline.networkKey && this.baselineStudyKey === this.studyKey();
  }

  /**
   * A baseline or proposal run. The same inputs give the same output, so when the road analysis already computed (or
   * is computing) exactly this run, its output is used instead of running it again: "Save existing city" right after
   * an analysis, and Compare right after the re-analysis of the edited network, re-ran a full analysis each (143 s and
   * 94 s headless), and Compare during that re-analysis ran two analyses at once (docs/urbanos/SIMULATE_AUDIT.md).
   * Otherwise the automatic analysis is cancelled first (never two analysis jobs at once), and the run's output is
   * shown as the road analysis when it is the run that analysis would make.
   */
  private async runJob(plan: DemandPlan, measureS: number, generation: number, seeds?: readonly number[]): Promise<AnalysisOutput> {
    const area = this.state.area, section = this.state.section;
    if (!area || !section) throw new Error('Select a study road before running a trial.');
    this.comparisonRun?.cancel();
    const runSeeds = seeds ?? this.analysisSeeds;
    const fingerprint = this.runFingerprint(plan, measureS, runSeeds);
    const shown = this.state.analysis;
    if (shown.status === 'ready' && shown.output && shown.fingerprint === fingerprint) { this.lastRunReused = true; return shown.output; }
    const pending = this.runningAnalysis;
    if (pending && pending.fingerprint === fingerprint) {
      const out = await pending.promise.catch(() => null);
      if (generation !== this.comparisonGeneration) throw new Error('The project changed while the run was being captured. Run it again.');
      if (out) { this.lastRunReused = true; return out; }
    }
    this.lastRunReused = false;
    // One analysis job at a time: the automatic one is re-scheduled after this run when this run does not stand for it
    if (this.analysisRun || this.analysisTimer) {
      this.cancelAnalysis();
      this.analysisStale = true;
      if (this.state.analysis.status === 'running') this.setState({ analysis: { ...this.state.analysis, status: this.state.analysis.output ? 'ready' : 'idle', progress: 0 } });
    }
    const run = startAnalysisJob(this.analysisJob(plan, area, section, measureS, { seeds }), progress => {
      if (generation === this.comparisonGeneration) this.setState({ comparison: { ...this.state.comparison, progress } });
    });
    this.comparisonRun = run;
    try {
      const out = await run.promise;
      if (generation !== this.comparisonGeneration) throw new Error('The project changed while the run was being captured. Run it again.');
      this.adoptAsAnalysis(out, fingerprint, plan);
      return out;
    } finally {
      if (this.comparisonRun === run) this.comparisonRun = null;
      if (this.analysisStale && !this.analysisRun) this.maybeAutoStart();
    }
  }
  /** Whether the last baseline or proposal run reused an analysis output instead of running (for the panel and tests). */
  public lastRunReused = false;

  /** A baseline or proposal run that is exactly the road analysis the panel would run now becomes that analysis's result. */
  private adoptAsAnalysis(output: AnalysisOutput, fingerprint: string, plan: DemandPlan) {
    const current = this.studyPlan();
    if (!current || this.state.analysis.fingerprint === fingerprint) return;
    if (this.runFingerprint(current, DEFAULT_ANALYSIS.measureS, this.analysisSeeds) !== fingerprint) return;
    void plan;
    const key = this.analysisKey(), networkKey = this.currentNetworkKey(), t = this.state.timeOfDay;
    const analysis: RoadAnalysisState = { status: 'ready', progress: 1, output, error: null, hour: t.hour, demandVph: current.provenance.vehiclesPerHour * t.factor, key,
      hourFactor: t.factor, timeProfile: t.status === 'ready' ? 'loaded' : 'unavailable', fingerprint, seedKey: seedKeyOf(this.state.area?.seedRoadIds ?? this.state.seedRoadIds) };
    this.cancelAnalysis();
    this.analysisStale = false;
    this.analysisNetworkKey = networkKey;
    this.keepResult(key, networkKey, analysis);
    this.setState({ analysis, comparison: { ...this.state.comparison, showingProposal: this.showsProposal(this.state.comparison.baseline) } });
    this.clearAnalysisStopNotice();
    this.redrawOverlay();
  }

  /**
   * Saves the existing city as the baseline: the demand is frozen (as
   * coordinates, so it survives road edits), with the seed, volume and clock
   * hour, and the network is analysed on it.
   */
  public async captureBaseline(durationS: number = DEFAULT_ANALYSIS.measureS): Promise<TrafficRunSnapshot | null> {
    this.flushPendingRecompute();
    const generation = ++this.comparisonGeneration;
    this.setState({ comparison: { ...this.state.comparison, running: true, progress: 0, staleReason: null, result: null, current: null, demandChanged: false } });
    try {
      const area = this.state.area;
      if (!area) throw new Error('Select a study road before capturing a baseline.');
      await this.ensureCountData().catch(() => {});
      const plan = this.studyPlan(area);
      if (!plan?.trips.length) throw new Error('This study area has no OD demand to compare.');
      const duration = Number.isFinite(durationS) ? Math.max(STEP_S, Math.min(3600, durationS)) : DEFAULT_ANALYSIS.measureS;
      const contextKey = this.demandContextKey(), studyKey = this.studyKey();
      const output = await this.runJob(plan, duration, generation);
      if (generation !== this.comparisonGeneration) return null;
      const baseline = this.snapshotOf(output, plan, duration);
      void this.recordRun(baseline);
      this.baselinePlan = structuredClone(plan);
      this.baselineRoads = new Map(structuredClone(this.getRoads()).map(r => [r.id, r]));
      this.baselineContextKey = contextKey;
      this.baselineStudyKey = studyKey;
      this.setState({ comparison: { baseline, current: null, result: null, staleReason: null, running: false, progress: 1, demandChanged: false, showingProposal: this.showsProposal(baseline), restoredAt: null } });
      this.saveBaseline(baseline, this.baselinePlan);
      return baseline;
    } catch (err) {
      if (generation === this.comparisonGeneration) this.setState({ comparison: { ...this.state.comparison, current: null, staleReason: err instanceof Error ? err.message : String(err), running: false } });
      return null;
    }
  }

  /**
   * Runs the proposal (the network as it is now) on the baseline's frozen
   * demand, seed, volume and hour, and compares it with the baseline. When the
   * land use changed since the baseline, the demand is still held at the
   * baseline's unless `withNewDemand` asks for a development scenario, which
   * is labelled as such.
   */
  public async runComparison(opts: { withNewDemand?: boolean } = {}): Promise<TrafficRunSnapshot | null> {
    this.flushPendingRecompute();
    const baseline = this.state.comparison.baseline, frozen = this.baselinePlan;
    const demandChanged = !!baseline && this.baselineContextKey !== this.demandContextKey();
    let reason: string | null = null;
    if (!baseline || !frozen) reason = 'Save the existing city as a baseline before comparing.';
    else if (this.baselineStudyKey !== this.studyKey()) reason = STUDY_CHANGED.roads;
    else if (baseline.seed !== this.state.traffic.seed || baseline.demandLevel !== this.state.traffic.demandLevel || baseline.focus !== this.state.traffic.focus) reason = 'Restore the baseline seed and volume before comparing.';
    else if (baseline.hour !== this.state.timeOfDay.hour || Math.abs(baseline.hourFactor - this.state.timeOfDay.factor) > 1e-9) reason = `Set the clock back to ${String(baseline.hour).padStart(2, '0')}:00, the baseline's hour, to compare like with like.`;
    if (reason) {
      this.setState({ comparison: { ...this.state.comparison, current: null, result: null, staleReason: reason, running: false, demandChanged } });
      return null;
    }
    const generation = ++this.comparisonGeneration;
    this.setState({ comparison: { ...this.state.comparison, running: true, progress: 0, staleReason: null, demandChanged } });
    try {
      const plan = opts.withNewDemand && demandChanged ? this.studyPlan() : frozen!;
      if (!plan?.trips.length) throw new Error('The proposal has no OD demand to run.');
      // The baseline's seeds, not whatever analysisSeeds holds now: same demand, hour and seeds by construction
      const output = await this.runJob(plan, baseline!.durationS, generation, baseline!.inputs?.seeds);
      if (generation !== this.comparisonGeneration) return null;
      const current = this.snapshotOf(output, plan, baseline!.durationS);
      const result = compareAnalyses(baseline!.analysis, output, { before: this.baselineRoads ?? new Map(), after: new Map(this.getRoads().map(r => [r.id, r])) },
        { before: baseline!.demandVph, after: current.demandVph }, baseline!.inputs ? { before: baseline!.inputs, after: current.inputs, newDemand: !!opts.withNewDemand && demandChanged } : undefined,
        demandByClass(plan, baseline!.hourFactor), this.state.closedRoads.length ? { closedRoadNames: this.state.closedRoads.map(c => c.name || 'the studied road') } : undefined);
      if (demandChanged && !opts.withNewDemand) result.caveats.unshift('The land use changed since the baseline. This comparison holds the demand at the baseline\'s, so it shows the effect of the road changes alone.');
      // The proposal run is recorded with the comparison's summary, so the planning-project report (backend PDF) can print it
      void this.recordRun(current, comparisonRunRecord(result, baseline!, this.state.closedRoads.length ? this.state.seedRoadIds : this.state.area?.seedRoadIds ?? []));
      this.setState({ comparison: { ...this.state.comparison, baseline, current, result, staleReason: null, running: false, progress: 1, demandChanged } });
      return current;
    } catch (err) {
      if (generation === this.comparisonGeneration) this.setState({ comparison: { ...this.state.comparison, current: null, result: null, running: false, staleReason: err instanceof Error ? err.message : String(err) } });
      return null;
    }
  }

  // ── Time of day ──────────────────────────────────────────────────────────

  /**
   * The hour the demand plan represents: calibrated demand is the counted peak
   * hour; the area estimate is the peak of the clock's half of the day (09:00
   * before noon, 19:00 after). Used by the analysis and the time-of-day runs alike.
   */
  private referenceHour(hour: number, countPeak: 'AM' | 'PM' = this.state.timeOfDay.countPeak): number {
    // p14: a synthetic plan is the demand of the clock hour itself (directional, hourly OD): no further hour factor
    if (this.syntheticInUse()) return hour;
    return this.calibratedPlan ? COUNT_HOURS[countPeak] : COUNT_HOURS[hour < 12 ? 'AM' : 'PM'];
  }

  private setTimeOfDay(patch: Partial<TimeOfDayState>) {
    const prev = this.state.timeOfDay;
    const next = { ...prev, ...patch };
    next.factor = next.profile ? hourFactor(next.profile, next.hour, this.referenceHour(next.hour, next.countPeak), next.day) : 1;
    this.setState({ timeOfDay: next });
    if (next.day !== prev.day || next.countPeak !== prev.countPeak || next.status !== prev.status) this.refreshTimelineOutdated();
    if (next.hour !== prev.hour || next.day !== prev.day || next.factor !== prev.factor) {
      // A different hour is different demand and routes: the live view of the old hour stops; the analysis re-runs
      const wasLive = this.state.traffic.status !== 'idle';
      this.stopTraffic();
      this.analysisStale = true;
      this.scheduleAnalysis(700);
      if (wasLive) this.startTraffic();
    }
  }

  /** Loads the hour-of-day profile (once; again after an error). */
  public ensureTimeProfile(): Promise<void> {
    const t = this.state.timeOfDay;
    if (t.status === 'ready') return Promise.resolve();
    // A load in flight is shared: callers wait for it rather than run at factor 1 meanwhile
    if (t.status === 'loading' && this.timeProfileLoad) return this.timeProfileLoad;
    this.setTimeOfDay({ status: 'loading', error: null });
    const load = fetchDiurnalProfile()
      .then(profile => this.setTimeOfDay({ status: 'ready', profile }))
      .catch(err => this.setTimeOfDay({ status: 'error', error: err instanceof Error ? err.message : String(err) }))
      .finally(() => { if (this.timeProfileLoad === load) this.timeProfileLoad = null; });
    this.timeProfileLoad = load;
    return load;
  }
  private timeProfileLoad: Promise<void> | null = null;

  public setHour(hour: number) {
    this.setTimeOfDay({ hour: ((Math.round(hour) % 24) + 24) % 24 });
  }

  /** Morning peak, midday, evening peak or night: the hour that stands for the period. */
  public setPeriod(id: DayPeriodId) {
    const p = DAY_PERIODS.find(x => x.id === id);
    if (p) this.setHour(p.hour);
  }

  public setDayType(day: DayType) {
    this.setTimeOfDay({ day });
  }

  /** Which peak hour the counts represent (AM 09:00 or PM 19:00); the calibrated demand is that hour's. */
  public setCountPeak(countPeak: 'AM' | 'PM') {
    this.setTimeOfDay({ countPeak });
    // A calibrated plan represents the counted hour: relabel it (and the live demand card) with the chosen peak
    if (this.calibratedPlan) {
      const period = countPeakPeriod(countPeak);
      this.calibratedPlan = { ...this.calibratedPlan, provenance: { ...this.calibratedPlan.provenance, period } };
      const demand = this.state.traffic.demand;
      if (demand?.source === 'calibrated') this.setTraffic({ demand: { ...demand, period } });
    }
  }

  // ── The selected road through the day ─────────────────────────────────

  /**
   * Runs the analysis at each period of the day (morning peak, midday,
   * evening peak, night) on the same network, with the same seeds as the
   * analysis (docs/OVERHAUL.md §22). Each period is computed on its own: the
   * plan for its half of the day (the same one the analysis uses, calibrated
   * or hypothetical included) times its hour factor, a fresh area assignment
   * and fresh corridor runs from an empty network after a warm-up. Nothing is
   * carried over or scaled from another period. This replaces the earlier
   * "Play 24 h", which only scaled arrival rates once a simulated minute.
   */
  public async runTimeline(): Promise<boolean> {
    this.flushPendingRecompute();
    const area = this.state.area, section = this.state.section;
    if (!area || !section || !this.state.timeOfDay.profile) { await this.ensureTimeProfile(); }
    const profile = this.state.timeOfDay.profile;
    if (!area || !section || !profile) return false;
    this.cancelTimeline();
    const generation = ++this.timelineGeneration;
    const key = this.timelineKey();
    const seeds = [...this.analysisSeeds];
    const rows: TimelineRow[] = DAY_PERIODS.map(p => ({ period: p.id, label: p.label, hour: p.hour, demandVph: 0, result: null }));
    this.setState({ timeline: { status: 'running', progress: 0, rows, error: null, key, outdated: false } });
    try {
      for (let i = 0; i < DAY_PERIODS.length; i++) {
        const p = DAY_PERIODS[i];
        // This period reads the case in force now: if it is no longer the one the run started on, the rows mix two cases
        if (!this.state.timeline.mixed && this.timelineKey() !== key) this.setState({ timeline: { ...this.state.timeline, mixed: true, outdated: true } });
        const landUsePeriod = p.hour < 12 ? 'AM_Peak' as const : 'PM_Peak' as const;
        const plan = this.studyPlan(area, landUsePeriod, false, p.hour);
        if (!runnablePlan(plan)) throw new Error('No traffic can be estimated for this area.');
        const referenceHour = this.referenceHour(p.hour);
        const factor = hourFactor(profile, p.hour, referenceHour, this.state.timeOfDay.day);
        const run = startAnalysisJob(this.analysisJob(plan, area, section, DEFAULT_ANALYSIS.measureS, { hourFactor: factor, seeds }), progress => {
          if (generation === this.timelineGeneration) this.setState({ timeline: { ...this.state.timeline, progress: (i + progress) / DAY_PERIODS.length } });
        });
        this.timelineRun = run;
        const out = await run.promise;
        if (generation !== this.timelineGeneration) return false;
        rows[i] = { ...rows[i], demandVph: plan.provenance.vehiclesPerHour * factor, hourFactor: factor, referenceHour, plannedVph: plan.provenance.vehiclesPerHour,
          demandSource: plan.provenance.source, landUsePeriod, odPairs: plan.trips.length, seeds, result: out.result };
        this.setState({ timeline: { ...this.state.timeline, rows: [...rows], progress: (i + 1) / DAY_PERIODS.length } });
      }
      this.timelineRun = null;
      // A change made while the periods ran leaves rows for the case at the start: marked, and kept for an Undo back to it
      const done: TimelineState = { ...this.state.timeline, status: 'ready', progress: 1, outdated: !!this.state.timeline.mixed || key !== this.timelineKey() };
      if (!done.mixed) this.keepTimeline(done);
      this.setState({ timeline: done });
      return true;
    } catch (err) {
      if (generation !== this.timelineGeneration) return false;
      this.timelineRun = null;
      this.setState({ timeline: { ...this.state.timeline, status: 'error', error: err instanceof Error ? err.message : String(err) } });
      return false;
    }
  }

  /** What the time-of-day rows depend on (everything the analysis key holds except the clock hour). */
  private timelineKey() {
    const plan = this.studyPlan();
    return contentKey({ net: this.currentNetworkKey(), study: this.studyKey(), plan: plan ? contentKey({ n: plan.trips.length, v: Math.round(plan.provenance.vehiclesPerHour), src: plan.provenance.source }) : null,
      day: this.state.timeOfDay.day, countPeak: this.calibratedPlan ? this.state.timeOfDay.countPeak : null, seeds: this.analysisSeeds, settings: this.state.demandSettings,
      profile: this.state.timeOfDay.status === 'ready', corrections: this.correctionsEnabled, signalTiming: this.signalTiming });
  }

  /**
   * Marks the rows outdated when what they were computed for has changed, also while the periods are still
   * running (the rows that land after the change describe the case at the start of the run). Rows already
   * computed for the case now in force (Undo or Redo back to it) come back as current (docs/OVERHAUL.md §25).
   */
  private refreshTimelineOutdated() {
    const tl = this.state.timeline;
    if (!tl.key) return;
    const key = this.timelineKey();
    const kept = tl.key !== key && tl.status !== 'running' ? this.keptTimelines.get(key) : undefined;
    if (kept) { this.setState({ timeline: kept }); return; }
    if (!tl.rows.some(r => r.result)) return;
    const outdated = tl.key !== key || !!tl.mixed;
    if (!!tl.outdated !== outdated) this.setState({ timeline: { ...tl, outdated } });
  }

  /** The last few complete time-of-day runs by key, so Undo/Redo of an edit shows their rows again without a re-run. */
  private keptTimelines = new Map<string, TimelineState>();
  private keepTimeline(t: TimelineState) {
    if (!t.key) return;
    this.keptTimelines.delete(t.key);
    this.keptTimelines.set(t.key, { ...t, outdated: false });
    while (this.keptTimelines.size > 6) this.keptTimelines.delete(this.keptTimelines.keys().next().value!);
  }

  /** Stops the time-of-day runs (clear: also forget their rows). */
  public cancelTimeline(clear = false) {
    this.timelineGeneration++;
    this.timelineRun?.cancel();
    this.timelineRun = null;
    if (clear) { if (this.state.timeline.rows.length || this.state.timeline.status !== 'idle') this.setState({ timeline: EMPTY_TIMELINE }); }
    else if (this.state.timeline.status === 'running') this.setState({ timeline: { ...this.state.timeline, status: 'idle', progress: 0 } });
  }

  // ── Calibration against observed counts ──────────────────────────────────

  private setCalibration(patch: Partial<CalibrationState>) {
    this.setState({ calibration: { ...this.state.calibration, ...patch } });
  }

  /** Loads the observed count file (once; again after an error). */
  public ensureCountData(): Promise<void> {
    const c = this.state.calibration;
    if (c.datasetStatus === 'ready' || c.datasetStatus === 'loading') return Promise.resolve();
    this.setCalibration({ datasetStatus: 'loading', datasetError: null });
    return this.loadCounts()
      .then(dataset => {
        this.setCalibration({ datasetStatus: 'ready', dataset });
        this.refreshCountedJunctions();
      })
      .catch(err => this.setCalibration({ datasetStatus: 'error', datasetError: err instanceof Error ? err.message : String(err) }));
  }

  private refreshCountedJunctions() {
    const ds = this.state.calibration.dataset, area = this.state.area;
    if (!ds) return;
    const inside = area ? junctionsIn(ds, area.bounds) : [];
    this.setCalibration({ junctions: inside.map(j => ({ id: j.id, name: j.name, problem: null, arms: 0, maxCardinalErrorDeg: null })) });
  }

  private invalidateCalibration(reason: string) {
    this.calibrationGeneration++;
    const c = this.state.calibration;
    const hadResults = c.rows.length > 0 || this.calibratedPlan !== null || c.status === 'measuring' || c.status === 'fitting';
    this.calibratedPlan = null;
    this.refreshTimelineOutdated();
    if (!hadResults) return;
    this.setCalibration({ rows: [], before: null, after: null, fit: null, applied: false, status: 'idle', progress: 0, error: null, staleReason: reason });
  }

  /** The uncalibrated demand for the area: the project estimate, or frozen synthetic arrivals when there is none. */
  private basePlan(area: StudyArea): DemandPlan {
    const context = this.getContext();
    // The uncalibrated area estimate, whatever is applied now
    const applied = this.calibratedPlan;
    this.calibratedPlan = null;
    const plan = this.studyPlan(area);
    this.calibratedPlan = applied;
    if (plan?.trips.length) return plan;
    const traffic = this.state.traffic;
    const sim = new TrafficMicroSim(area, new Map(this.getRoads().map(r => [r.id, r])), {
      demandLevel: traffic.demandLevel, seed: traffic.seed, watchRoadIds: area.seedRoadIds,
      focusLoad: focusLoadFor(traffic), ...junctionOptions(context.junctions), signalPoints: this.signalPoints ?? undefined, signalTiming: this.signalTiming,
    });
    const trips = sim.getDemandTrips().flatMap(t => {
      const from = area.network.nodes.get(t.fromNodeId), to = area.network.nodes.get(t.toNodeId);
      return from && to ? [{ from: [...from.coordinates] as [number, number, number], to: [...to.coordinates] as [number, number, number], vehiclesPerHour: t.vehiclesPerHour, kind: t.kind, viaRoadId: t.viaRoadId }] : [];
    });
    return { trips, provenance: { source: 'synthetic', label: 'Synthetic capacity-based arrivals (no project OD demand here).', period: context.period ?? 'AM_Peak', vehiclesPerHour: trips.reduce((n, t) => n + t.vehiclesPerHour, 0), pairCount: trips.length } };
  }

  private simSetup(area: StudyArea): SimSetup {
    const traffic = this.state.traffic;
    const ds = this.state.calibration.dataset;
    return { area, roads: new Map(structuredClone(this.getRoads()).map(r => [r.id, r])),
      // Counted junctions are timed from their observed approach flows
      signalDesignCounts: this.signalTiming === 'webster' && ds ? junctionsIn(ds, area.bounds) : undefined,
      options: { demandLevel: traffic.demandLevel, seed: traffic.seed, watchRoadIds: area.seedRoadIds, ...junctionOptions(structuredClone(this.getContext().junctions)), signalPoints: this.signalPoints ?? undefined, signalTiming: this.signalTiming } };
  }

  private countedInArea(area: StudyArea) {
    const ds = this.state.calibration.dataset;
    if (!ds) throw new Error('The observed count file has not loaded.');
    const junctions = junctionsIn(ds, area.bounds);
    if (!junctions.length) throw new Error('No counted junction lies inside this study area.');
    return junctions;
  }

  /**
   * Runs the current (uncalibrated) demand from an empty network and compares
   * the simulated turning flows with the counts. With `fit`, then scales the
   * demand to the counts, runs that too and switches live traffic to it.
   */
  public async runCalibration(fit: boolean, opts: { warmupS?: number; measureS?: number } = {}): Promise<boolean> {
    this.flushPendingRecompute();
    await this.ensureCountData();
    const area = this.state.area;
    const generation = ++this.calibrationGeneration;
    const aborted = () => generation !== this.calibrationGeneration;
    try {
      if (!area) throw new Error('Select a study road first.');
      const junctions = this.countedInArea(area);
      const setup = this.simSetup(area);
      const base = this.basePlan(area);
      if (!base.trips.length) throw new Error('This study area has no demand to calibrate.');
      const zones = junctions.map(zoneFor);
      this.setCalibration({ status: 'measuring', progress: 0, error: null, staleReason: null });
      const before = await measureFlows(setup, base, zones, { ...opts, aborted, onProgress: p => this.setCalibration({ progress: fit ? p / 2 : p }) });
      if (aborted()) return false;
      const checks = junctionChecks(junctions, before.layouts);
      if (!fit) {
        const rows = compareRows(junctions, before.layouts, before.flows, null);
        this.setCalibration({ status: 'idle', progress: 1, junctions: checks, rows, before: summarize(rows, 'gehBefore'), after: null, fit: null, windowS: before.windowS, runMetrics: { before: before.metrics, after: null } });
        return true;
      }
      this.setCalibration({ status: 'fitting' });
      await new Promise<void>(r => setTimeout(r, 0));
      const result = fitPlan(setup, base, junctions);
      if (aborted()) return false;
      this.setCalibration({ status: 'measuring' });
      const after = await measureFlows(setup, result.plan, zones, { ...opts, aborted, onProgress: p => this.setCalibration({ progress: 0.5 + p / 2 }) });
      if (aborted()) return false;
      const rows = compareRows(junctions, before.layouts, before.flows, after.flows);
      const observed = observedFlows(junctions.filter(j => !checks.find(c => c.id === j.id)?.problem));
      const fitted = result.ipf.factors.length ? result.ipf.factors : [1];
      // The calibrated demand is the counted peak hour, whichever peak the user says the counts are
      this.calibratedPlan = { ...result.plan, provenance: { ...result.plan.provenance, period: countPeakPeriod(this.state.timeOfDay.countPeak) } };
      this.refreshTimelineOutdated();
      this.setCalibration({
        status: 'idle', progress: 1, junctions: checks, rows, before: summarize(rows, 'gehBefore'), after: summarize(rows, 'gehAfter'), windowS: after.windowS, applied: true, runMetrics: { before: before.metrics, after: after.metrics },
        fit: {
          iterations: result.ipf.iterations, converged: result.ipf.converged, cappedTrips: result.ipf.cappedTrips,
          seeds: result.seeds.length, seedVph: Math.round(result.seeds.reduce((n, s) => n + s.vehiclesPerHour, 0)), unreachable: result.unreachable.length,
          factorMin: Math.min(...fitted), factorMax: Math.max(...fitted),
          assignedBefore: gehAgainst(observed, result.ipf.before), assignedAfter: gehAgainst(observed, result.ipf.after),
          demandLevel: this.state.traffic.demandLevel,
        },
      });
      if (this.state.traffic.status !== 'idle') this.restartTraffic();
      return true;
    } catch (err) {
      if (!aborted()) this.setCalibration({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  // ── Demand estimated from calibration counts (ODME) ────────────────────────

  /** The prior the estimate starts from: the demand the area would run on without the ODME version (hypothetical scale excluded). */
  private odmePrior(area: StudyArea): DemandPlan | null {
    return this.studyPlan(area, this.landUsePeriod(), true);
  }

  /**
   * Estimates a new demand version from the Traffic Data rows given (docs/ODME_AND_EMISSIONS.md): role "calibration"
   * rows of the clock hour become constraints; "validation" rows are held out and only checked before/after on the
   * assignment. Nothing is applied: the user then chooses to use it (useOdmeDemand). Runs on the main thread.
   */
  public async estimateDemandFromCounts(rows: readonly EngineCountRow[], opts: { allowEstimated?: boolean; options?: OdmeOptions } = {}): Promise<OdmeRunReport | null> {
    this.flushPendingRecompute();
    const area = this.state.area;
    this.setState({ odme: { ...this.state.odme, status: 'running', error: null } });
    await new Promise<void>(r => setTimeout(r, 0));
    try {
      if (!area) throw new Error('Select a study road first.');
      if (this.state.timeOfDay.status !== 'ready') await this.ensureTimeProfile();
      const prior = this.odmePrior(area);
      if (!prior?.trips.length) throw new Error('This study area has no demand to adjust.');
      const t0 = Date.now(), hour = this.state.timeOfDay.hour, f = this.state.timeOfDay.factor;
      const segs = new Set(area.segments.map(x => x.key));
      const trips = snapDemandPlan(prior, area.network, 250, segs).map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * f }));
      const edgeIds = [...area.network.edges.keys()].filter(id => segs.has(id.replace(/_(fwd|bwd)$/, '')));
      const built = countsToConstraints(rows, edgeIds, { hour, allowEstimated: opts.allowEstimated });
      const calib = built.constraints;
      if (!calib.length) throw new Error(`No calibration count matches this area at ${String(hour).padStart(2, '0')}:00 (weekday). Set a dataset's role to Calibration in Traffic data.`);
      const roads = new Map(this.getRoads().map(r => [r.id, r]));
      const assignment = { signalPoints: this.signalPoints ?? undefined, junctionEdits: splitJunctionObjects(this.getContext().junctions).edits };
      const r = estimateAreaDemand({ area, roads, plan: prior, trips, constraints: calib, heldOutDatasetIds: built.heldOutDatasetIds, hour, hourFactor: f, assignment, options: opts.options });
      // Independent check on the held-out (validation) rows of the same hour: assignment before and after, never fitted
      const valRows = rows.filter(x => x.role === 'validation').map(x => ({ ...x, role: 'calibration' as const }));
      const val = countsToConstraints(valRows, edgeIds, { hour, allowEstimated: opts.allowEstimated });
      const valCounts = constraintsToCounts(val.constraints, r.problem.linkIndex).counts;
      const report: OdmeRunReport = { provenance: r.plan.provenance.odme!, iterations: r.estimate.iterations, calibration: r.estimate.fit,
        validation: countsBeforeAfter(valCounts, r.estimate.priorLoad, r.estimate.load),
        skipped: [...r.skipped, ...built.skipped.filter(x => x.row.role === 'calibration').map(x => ({ id: `${x.row.dataset_name}:${x.row.road_id ?? x.row.junction_ref}:${x.row.period}`, reason: x.reason }))],
        elapsedMs: Date.now() - t0 };
      this.odmePlan = r.plan;
      this.setState({ odme: { status: 'ready', error: null, report, used: false, staleReason: null } });
      return report;
    } catch (err) {
      this.setState({ odme: { ...this.state.odme, status: 'error', error: err instanceof Error ? err.message : String(err) } });
      return null;
    }
  }

  /** Runs (or stops running) the analysis on the estimated demand version. The baseline demand is never changed. */
  public useOdmeDemand(on: boolean) {
    const area = this.state.area;
    if (on) {
      const p = this.odmePlan?.provenance.odme;
      const prior = area ? this.odmePrior(area) : null;
      let reason: string | null = null;
      if (!p || !prior) reason = 'Estimate demand from calibration counts first.';
      else if (p.hour !== this.state.timeOfDay.hour) reason = `The estimate is for ${String(p.hour).padStart(2, '0')}:00; set the clock back or estimate again.`;
      else if (p.priorKey !== this.keyOfPlan(prior)) reason = 'The demand it was estimated from has changed (area, land use or settings). Estimate again.';
      if (reason) { this.setState({ odme: { ...this.state.odme, used: false, staleReason: reason } }); return; }
    }
    if (this.state.odme.used === on) return;
    this.invalidateComparison('The demand changed (estimated from counts on/off). Save again for a new baseline.');
    this.setState({ odme: { ...this.state.odme, used: on, staleReason: null } });
    this.refreshTimelineOutdated();
    this.stopTraffic();
    this.analysisStale = true;
    this.scheduleAnalysis();
  }

  /** The estimated demand version (for reports). */
  public getOdmePlan(): DemandPlan | null { return this.odmePlan; }

  /** Back to the uncalibrated demand. */
  public clearCalibration() {
    const wasApplied = this.calibratedPlan !== null;
    this.calibrationGeneration++;
    this.calibratedPlan = null;
    this.refreshTimelineOutdated();
    this.setCalibration({ rows: [], before: null, after: null, fit: null, applied: false, status: 'idle', progress: 0, error: null, staleReason: null });
    if (wasApplied && this.state.traffic.status !== 'idle') this.restartTraffic();
  }

  /** The calibrated plan, for reports. */
  public getCalibratedPlan(): DemandPlan | null {
    return this.calibratedPlan;
  }

  public clearBaseline() {
    this.comparisonGeneration++;
    this.baselinePlan = null;
    this.comparisonRun?.cancel();
    this.baselineRoads = null;
    this.setState({ comparison: { baseline: null, current: null, result: null, staleReason: null, running: false, progress: 0, demandChanged: false, showingProposal: false } });
  }

  public getVehicleViews(): VehicleView[] {
    const vehicles: VehicleView[] = [];
    this.live?.forEachVehicle(v => vehicles.push({ ...v }));
    return vehicles;
  }

  public inspectVehicle(id: number): VehicleView | null {
    let result: VehicleView | null = null;
    this.live?.forEachVehicle(v => { if (v.id === id) result = { ...v }; });
    return result;
  }

  public selectVehicle(id: number | null) {
    this.setState({ selectedVehicleId: id });
  }

  public pickVehicleAt(lng: number, lat: number, maxDistanceM = 8): VehicleView | null {
    let selected: VehicleView | null = null, best = maxDistanceM;
    const kx = 111320 * Math.cos(lat * Math.PI / 180);
    this.live?.forEachVehicle(v => {
      const distance = Math.hypot((v.lng - lng) * kx, (v.lat - lat) * 111320);
      if (v.opacity > .1 && distance < best) { best = distance; selected = { ...v }; }
    });
    return selected;
  }

  /**
   * The live view's animation frame: draws the run's vehicles (the worker steps on its own; the inline run steps here
   * within a budget), recolours the roads once a second and passes the figures twice a second.
   */
  private startLoop() {
    this.stopLoop();
    const frame = (now: number) => {
      const live = this.live;
      if (!live) return;
      live.advance(now);
      this.trafficVisualizer.draw(live);
      if (now - this.lastRecolourAt > RECOLOUR_EVERY_MS) {
        const ratios = live.ratios();
        if (ratios) { this.lastRecolourAt = now; this.visualizer.setSegmentSpeeds(ratios); }
      }
      if (!live.threaded && now - this.lastMetricsAt > METRICS_EVERY_MS) {
        this.lastMetricsAt = now;
        const metrics = live.metrics();
        if (metrics) this.setTraffic({ metrics, behind: live.behind() });
      }
      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  private stopLoop() {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private cancelPendingRecompute() {
    if (this.recomputeTimer) {
      clearTimeout(this.recomputeTimer);
      this.recomputeTimer = null;
    }
  }
}

/** Notices for a study change after a baseline was saved (cleared again when the study goes back to the baseline's). */
export const STUDY_CHANGED = {
  roads: 'The study roads changed since the baseline. Save again to make a baseline for these roads, or go back to the baseline\'s roads.',
  range: 'The study range changed since the baseline. Save again for a new baseline, or set the range back.',
  direction: 'The study direction changed since the baseline. Save again for a new baseline, or set the direction back.',
  supply: 'The traffic parameters changed since the baseline (defaults vs tuned, estimated). Save again for a new baseline, or switch them back.',
  demand: 'The demand changed since the baseline (area estimate vs synthetic land-use demand). Save again for a new baseline, or switch it back.',
  supplyModel: 'The road supply model changed since the baseline (p13 vs Indian urban roads, p14). Save again for a new baseline, or switch it back.',
} as const;
const STUDY_REASONS = new Set<string>(Object.values(STUDY_CHANGED));

/** Vehicles per hour by class of a plan at the clock hour (the plan's veh/h times the hour factor), largest first. */
export function demandByClass(plan: DemandPlan, hourFactor: number): { kind: string; vph: number }[] {
  const m = new Map<string, number>();
  for (const t of plan.trips) m.set(t.kind ?? 'car', (m.get(t.kind ?? 'car') ?? 0) + t.vehiclesPerHour * hourFactor);
  return [...m].map(([kind, vph]) => ({ kind, vph })).sort((a, b) => b.vph - a.vph);
}

/** The comparison summary stored with the proposal's run record (backend planning report §5 prints it). Compact by design. */
export interface ComparisonRunRecord {
  schema: 'twincity.comparison_summary/v1';
  baselineRunId: string | null;
  hour: number;
  seedRoadIds: string[];
  verdict: { overall: string; section: string; network: string; area: string; summary: string };
  confidence: { level: string; text: string };
  demandLabel: string;
  demandEstimated: boolean;
  deltas: { group: string; label: string; before: number | null; after: number | null; unit: string }[];
  roads: { road: string; vphBefore: number; vphAfter: number; vcBefore: number; vcAfter: number; speedBefore: number | null; speedAfter: number | null }[];
  junctions: { label: string; delayBefore: number | null; delayAfter: number | null; losBefore: string | null; losAfter: string | null }[];
  caveats: string[];
}
export function comparisonRunRecord(c: import('./ScenarioComparison').ComparisonResult, baseline: TrafficRunSnapshot, seedRoadIds: readonly string[]): ComparisonRunRecord {
  const r1 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const d = (group: string, xs: readonly import('./ScenarioComparison').Delta[]) => xs.map(x => ({ group, label: x.label, before: r1(x.before), after: r1(x.after), unit: x.unit }));
  const label = baseline.analysis.result.evidence.demand?.label ?? '';
  const t = c.tables;
  return {
    schema: 'twincity.comparison_summary/v1', baselineRunId: baseline.runId ?? null, hour: baseline.hour, seedRoadIds: [...seedRoadIds],
    verdict: { overall: c.verdict.overall, section: c.verdict.section, network: c.verdict.network, area: c.verdict.area, summary: c.verdict.summary },
    confidence: { level: c.confidence.level, text: c.confidence.text }, demandLabel: label, demandEstimated: /estimated/i.test(label),
    deltas: [...d('Selected road', c.section), ...d('Neighbourhood', c.network), ...d('Whole area', c.area)],
    // The 15 roads and 10 junctions that changed most (the full tables are in the HTML / CSV export)
    roads: (t?.links ?? []).slice().sort((a, b) => Math.abs(b.vphAfter - b.vphBefore) - Math.abs(a.vphAfter - a.vphBefore)).slice(0, 15)
      .map(x => ({ road: x.road, vphBefore: Math.round(x.vphBefore), vphAfter: Math.round(x.vphAfter), vcBefore: Math.round(x.vcBefore * 100) / 100, vcAfter: Math.round(x.vcAfter * 100) / 100, speedBefore: r1(x.speedBefore), speedAfter: r1(x.speedAfter) })),
    junctions: (t?.junctions ?? []).slice().sort((a, b) => Math.abs((b.delayAfter ?? 0) - (b.delayBefore ?? 0)) - Math.abs((a.delayAfter ?? 0) - (a.delayBefore ?? 0))).slice(0, 10)
      .map(x => ({ label: x.label, delayBefore: r1(x.delayBefore), delayAfter: r1(x.delayAfter), losBefore: x.losBefore, losAfter: x.losAfter })),
    caveats: c.caveats.slice(0, 8),
  };
}
