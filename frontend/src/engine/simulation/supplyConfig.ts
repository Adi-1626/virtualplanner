/**
 * p14 supply model for Indian urban traffic: every number the area assignment (staticAssignment.ts, supplyModel 'p14'),
 * the corridor micro-simulation's desired speeds and the p13 project-check harness read, in one place, each with its
 * label and source (docs/urbanos/SUPPLY_P14.md).
 *
 * Labels:
 *  - 'standard'        the value is printed in the cited standard (all copies read are third-party scans or text copies;
 *                      the official documents are sold by IRC / CSIR-CRRI, so every 'standard' value is UNCONFIRMED
 *                      against the official print, see `copy`);
 *  - 'derived'         computed from standard values by a stated rule (the rule is in `note`);
 *  - 'fitted'          fitted to a standard's table (the fit is in `note`, script p14-run/fit_vdf.py);
 *  - 'international'   from a foreign manual, applied here as an assumption;
 *  - 'assumed'         a modelling assumption with no standard behind it.
 *
 * Sources (opened 2026-11-25):
 *  - Indo-HCM 2017: CSIR-CRRI, Indian Highway Capacity Manual, Dec 2017. Official page with no tables:
 *    https://crridom.gov.in/sites/default/files/files/Indo-HCM%20Snippets.pdf. Tables read from a third-party full-text
 *    copy: https://pdfcoffee.com/indo-hcm-2017pdf-pdf-free.html (UNCONFIRMED copy). Chapter 8 (unsignalised) is not in
 *    that copy; its values are as quoted by Shivashankar et al., IJRESM 4(11) 2021 pp. 150-153 (UNCONFIRMED, second-hand).
 *  - IRC:106-1990 Guidelines for Capacity of Urban Roads in Plain Areas: scan https://archive.org/details/gov.in.irc.106.1990,
 *    OCR with tesseract (pdftoppm 200 dpi) (UNCONFIRMED copy).
 *  - IRC:86-2018 Geometric Design Standards for Urban Roads and Streets: https://archive.org/details/irc-86-2018,
 *    text layer read with pdftotext (UNCONFIRMED copy).
 *  - IRC:65-2017 Table 9.1 roundabout entry capacity: as already coded in streetDesign/roundabout.ts (IRC65_TABLE_9_1).
 *  - HCM 2000 Exhibit 21-4 lane-width adjustment and Eq. 17-38 control delay, as given in T. V. Mathew, IIT Bombay NPTEL
 *    notes: https://archive.nptel.ac.in/content/storage2/courses/105101008/553_MlHway/point6/point.html and
 *    https://www.civil.iitb.ac.in/tvm/nptel/564_UnCotrl/web/web.html (international).
 */

export type SupplyLabel = 'standard' | 'derived' | 'fitted' | 'international' | 'assumed';
export interface Sourced<T> { value: T; label: SupplyLabel; source: string; note?: string }
const S = <T>(value: T, label: SupplyLabel, source: string, note?: string): Sourced<T> => ({ value, label, source, ...(note ? { note } : {}) });

/** Which supply model the area assignment runs: 'p13' = the model as it ran before p14 (IRC:106 capacities, OSM maxspeed as free-flow speed, BPR 0.15/4, no unsignalised delay); 'p14' = this file. */
export type SupplyModel = 'p13' | 'p14';

/**
 * The supply model Simulate runs by default. Stays 'p13' until the p14 model is checked against the official counts and
 * the project check (docs/urbanos/SUPPLY_P14.md §3.5); the harnesses and SimulationMode.setSupplyModel('p14') run p14.
 */
export const SUPPLY_MODEL_DEFAULT: SupplyModel = 'p13';

/** Urban road class of the p14 model (IRC:86-2018 §2 classes). */
export type UrbanClass = 'expressway' | 'arterial' | 'subArterial' | 'collector' | 'local';
/** Side-friction level (Indo-HCM 2017 §5.4.7: low / medium / high; 'none' = a base section with no frontage: flyover, bridge, ramp, motorway). */
export type FrictionClass = 'none' | 'low' | 'medium' | 'high';
export const FRICTION_ORDER: readonly FrictionClass[] = ['none', 'low', 'medium', 'high'];

export const P14 = Object.freeze({
  // ── Free-flow speed ──────────────────────────────────────────────────
  /** Design speed by urban road class, plain terrain (km/h). */
  designSpeedKmh: S<Record<UrbanClass, number>>({ expressway: 80, arterial: 60, subArterial: 60, collector: 40, local: 30 }, 'standard',
    'IRC:86-2018 Table 3.1 (plain terrain)'),
  /** OSM highway value -> urban class (assumed mapping; IRC:86 classes are functional, OSM's are by importance). */
  classOfHighway: S<Record<string, UrbanClass>>({ motorway: 'expressway', trunk: 'arterial', primary: 'arterial', secondary: 'subArterial', tertiary: 'collector',
    motorway_link: 'arterial', trunk_link: 'arterial', primary_link: 'arterial', secondary_link: 'subArterial', tertiary_link: 'collector',
    unclassified: 'local', residential: 'local', living_street: 'local', service: 'local', road: 'local' }, 'assumed', 'OSM highway tag -> IRC:86 class'),
  /** Lane capacity of a base section by carriageway typology (PCU/h/lane). */
  laneCapacityPcu: S({ undivided2: 1200, divided4: 1350, divided6: 1400, divided8: 1700, divided10: 2000 }, 'standard',
    'Indo-HCM 2017 Table 5.4 (capacity of base sections of urban roads; 8- and 10-lane values only where signals are 1-3 km apart)'),
  /** Lane capacity of a multilane UNDIVIDED carriageway as a share of the divided one (Indo-HCM tabulates no such road). */
  undividedMultilaneRatio: S(3000 / 3600, 'derived', 'IRC:106-1990 Table 2, arterial: 4-lane undivided 3000 vs 4-lane divided 3600 PCU/h design service volume'),
  /** Operating speed (85th percentile of car free speeds) from lane capacity: C_lane = 20.11 V + 210.8, valid 40-80 km/h. */
  laneCapacityFromSpeed: S({ slope: 20.11, intercept: 210.8, minKmh: 40, maxKmh: 80 }, 'standard', 'Indo-HCM 2017 Eq. 5.4 / Table 5.5',
    'inverted here to give the operating speed of each typology\'s base section: (C_lane - 210.8) / 20.11; fitted on divided roads, applied to the two-lane undivided value too (assumption)'),
  /** Mean free speed of cars as a share of their 85th-percentile (operating) speed. */
  meanOfOperatingSpeed: S(0.865, 'assumed', 'normal free-speed distribution with coefficient of variation 0.15: mean = V85 / (1 + 1.036 x 0.15)'),
  /** Speed of the mixed stream at low flow as a share of the car free-flow speed (the s0 of the volume-delay fit). */
  streamShareAtLowFlow: S(0.81, 'fitted', 'Indo-HCM 2017 Table 5.7', 'fit of t/t0 = (1 + a x^b)/s0 to the LOS boundaries, see vdf'),
  /** Lane width (m) of a base section and the default where OSM gives no width. */
  baseLaneWidthM: S(3.5, 'standard', 'Indo-HCM 2017 §5.1.2 (3.5 m per lane) and IRC:86-2018 §5.4'),
  /** Default lane width of access roads to residential areas (OSM residential, living_street, service, unclassified). */
  accessRoadLaneWidthM: S(3.0, 'standard', 'IRC:86-2018 §5.4 note (i): a lower lane width of 3 m is permissible on access roads to residential areas',
    'applied to OSM residential/living_street/service/unclassified without a width tag (assumption that they are built to it)'),
  /** Reduction in free-flow speed (km/h at a 100 km/h base) by lane width (m); between rows interpolated. */
  laneWidthReduction: S<readonly [number, number][]>([[3.6, 0], [3.5, 1.0], [3.4, 2.1], [3.3, 3.1], [3.2, 5.6], [3.1, 8.1], [3.0, 10.6]], 'international',
    'HCM 2000 Exhibit 21-4 (via IIT Bombay NPTEL notes)', 'applied as a share of speed relative to the 3.5 m Indo-HCM base: (f(w) - f(3.5)) / 100; below 3.0 m held at 3.0 m'),
  // ── Side friction ────────────────────────────────────────────────────
  /** Capacity and free-flow speed factor by side-friction level. */
  frictionFactor: S<Record<FrictionClass, number>>({ none: 1, low: 0.9, medium: 0.8, high: 0.7 }, 'standard',
    'Indo-HCM 2017 Table 5.12 (adjustment factors due to access points: low < 200, medium 200-500, high > 500 vehicles entering and leaving per hour)',
    'Indo-HCM derives these from the reduction of stream speed against base sections (Annexure 5E.7) and applies them to capacity (Eq. 5.5); p14 applies the same factor to the free-flow speed. On-street parking (Tables 5.9-5.10) and bus stops (Table 5.11) are not applied separately: their presence is not mapped'),
  /** Access points (side roads joining) per km of road -> friction level: Table 5.12's entry/exit volumes at an assumed 25 veh/h per access point. */
  accessPerKm: S({ medium: 8, high: 20 }, 'assumed', 'Indo-HCM 2017 Table 5.12 classes (200 / 500 veh/h) at 25 veh/h per access point'),
  /** Buildings with a centroid within frontageM of the road, per 100 m of road -> friction level; commercial buildings per 100 m for a market frontage. */
  buildingsPer100m: S({ frontageM: 30, medium: 2, high: 6, commercialHigh: 1 }, 'assumed', 'OpenStreetMap building footprints (backend OSM index)',
    'IRC:106-1990 cl. 8.2: frontage development and parked vehicles mark sub-arterial / collector fringe conditions; the counts are assumptions'),
  // ── Speed-flow ──────────────────────────────────────────────────────
  /** Volume-delay function: t = t0 (1 + alpha x^beta) / s0 up to v/c = 1, then the tangent line (t0 here is length / FFS). */
  vdf: S({ alpha: 2.70, beta: 6.54, s0: 0.81 }, 'fitted', 'Indo-HCM 2017 Table 5.7 LOS of multilane divided urban roads (v/c 0.15/0.45/0.75/0.85/1.00 at 84/76/59/41/22 % of FFS)',
    'least squares on ln(t/t0), grid search (p14-run/fit_vdf.py): s0 0.81, alpha 2.70, beta 6.54; fitted speeds 81/80/57/42/22 % of FFS. The same Table is quoted for divided roads by Ahmed et al. (2025). IRC:106-1990 §5.3 gives about 50 % of FFS at LOS C and one-third at capacity (cross-check, not used)'),
  /** Above v/c 1 the curve continues along its tangent at 1 (linear), not the power law. */
  vdfLinearAboveCapacity: S(true, 'assumed', 'Indo-HCM gives no speed below its LOS F boundary (22 % of FFS); the power law with beta 6.5 would give 300 x free-flow time at v/c 2'),
  // ── PCU ────────────────────────────────────────────────────────────
  /** Mid-block PCU per vehicle kind (median values for divided roads, planning). */
  pcuMidblock: S<Record<string, number>>({ two_wheeler: 0.22, car: 1.0, auto: 0.90, bus: 4.60, truck: 3.90, bus_auto: 2.07 }, 'standard',
    'Indo-HCM 2017 Table 5.2 (divided roads, median: TW 0.22, car 1.00, auto 0.90, bus 4.60, two/three-axle truck 3.90, mini bus 2.07)',
    'truck = two/three-axle truck (TAT); bus_auto (shared minibus) = mini bus. Indo-HCM: "median PCU values from Table 5.2 ... for planning purposes"'),
  /** PCU per vehicle kind at signalised stop lines (Indo-HCM saturation flow is in these units). */
  pcuSignal: S<Record<string, number>>({ two_wheeler: 0.4, car: 1.0, auto: 0.5, bus: 1.6, truck: 1.6, bus_auto: 1.1 }, 'standard',
    'Indo-HCM 2017 Table 6.3 (signalised intersections: TW 0.4, auto 0.5, car 1.0, LCV 1.1, HCV 1.6, bus 1.6)', 'bus_auto = LCV value (assumption)'),
  // ── Unsignalised priority junctions ─────────────────────────────────
  /** Minor-road approach (treated as the minor-road right turn / crossing, the movement with the most conflicts). */
  unsigMinor: S({ tcBase: 3.80, fLV: 0.885, a: 1.0, b: 2.16 }, 'standard', 'Indo-HCM 2017 Chapter 8 base critical gap and capacity adjustment factors for the minor-road right turn, as quoted by IJRESM 4(11) 2021 Tables 4-5 (second-hand, unconfirmed)'),
  /** Major-road right turn. */
  unsigMajorRight: S({ tcBase: 2.70, fLV: 0.457, a: 0.8, b: 1.3 }, 'standard', 'Indo-HCM 2017 Chapter 8 (major-road right turn), as quoted by IJRESM 4(11) 2021 Tables 4-5 (second-hand, unconfirmed)'),
  /** Follow-up time as a share of the critical gap. */
  followUpShare: S(0.6, 'standard', 'Indo-HCM 2017 Chapter 8 (t_f = 0.6 t_c), as quoted by IJRESM 4(11) 2021 Table 5 and ETASR 2023 (second-hand)'),
  /** Critical gap: t_c = t_c,base + f_LV ln(P_HV), P_HV the heavy-vehicle percentage of the conflicting stream (here the share of buses and trucks in the mix). */
  heavyShareFloorPct: S(1, 'assumed', 'ln(P) is held at P >= 1 % so the critical gap never falls below its base'),
  /** Share of a major approach's flow turning right (across the opposing flow). */
  majorRightShare: S(0.15, 'assumed', 'no turning counts in the network; HCM-style major right turn delay is spread over the approach'),
  /** Analysis period of the control-delay formula (h). */
  delayPeriodH: S(0.25, 'international', 'HCM 2000 Eq. 17-38 default T = 0.25 h (IIT Bombay NPTEL notes, worked example)', 'the assignment\'s hourly flow is read as the flow rate of the peak 15 min (assumption); T = 1 h made a minor approach at v/c 3 wait about an hour'),
  /** A minor approach that only merges into one one-way carriageway (no crossing): critical gap scaled by HCM's merge / crossing ratio. */
  mergeGapRatio: S(6.2 / 7.1, 'international', 'HCM 2000 base critical gaps (two-lane major): right turn from minor (US; a merge, India\'s left turn) 6.2 s vs left turn from minor (US; a crossing) 7.1 s, IIT Bombay NPTEL notes Table 1'),
  /** Junctions where two different arterial / sub-arterial roads meet with no mapped signal are taken as signalised (OSM maps few of Pune's signals). */
  inferSignals: S({ maxCategory: 1, matchM: 35 }, 'assumed', 'p13 bias finding: mapped signals cover only part of Pune\'s signals (0-8 stop lines on 1.4-7 km routes); IRC category <= 1 = arterial / sub-arterial',
    'the corridor micro-simulation estimates signals the same way when no mapped signals are given (TrafficMicroSim: a collector or bigger road on both axes); the inferred points are passed to the micro-simulation too'),
  /** Control delay: d = 3600/c + 900 T [(x - 1) + sqrt((x - 1)^2 + 3600 x / (450 T c))] + 5 (s). */
  controlDelay: S('HCM 2000 Eq. 17-38', 'international', 'IIT Bombay NPTEL notes, Uncontrolled Intersection, eq. 9'),
  // ── Roundabouts (OSM junction=roundabout) ──────────────────────────
  /** Entry capacity per entry lane C = A exp(-B Qc) by inscribed circle diameter; ICD from the mapped ring (ring length / pi). */
  roundaboutEntry: S('IRC65_TABLE_9_1', 'standard', 'IRC:65-2017 Table 9.1 (from Indo-HCM 2017 Chapter 7), streetDesign/roundabout.ts',
    'Qc = the modelled flow on the ring piece arriving at the entry (from the previous iteration); entry delay by the same control-delay formula (HCM 2010 Eq. 21-17 has the same form)'),
  // ── Micro-simulation ────────────────────────────────────────────────
  /** The corridor micro-simulation's desired speed per link is the p14 car free-flow speed (drivers' own factors still vary it). Gap acceptance at give-way lines already uses Indo-HCM critical gaps (TrafficMicroSim.ts). */
  microDesiredSpeed: S('p14 car free-flow speed', 'derived', 'this file', 'the vehicle classes\' own speed factors (two-wheeler 1.05, auto 0.8, bus 0.85) make the mix; s0 is not applied again'),
});

/** Every parameter as a flat list (for the docs and the tests). */
export function p14ParameterTable(): { key: string; label: SupplyLabel; source: string; value: string; note?: string }[] {
  return Object.entries(P14).map(([key, p]) => ({ key, label: p.label, source: p.source, value: JSON.stringify(p.value), ...(p.note ? { note: p.note } : {}) }));
}
