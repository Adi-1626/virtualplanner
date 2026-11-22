/**
 * Sources and values of the street design tools (docs/urbanos/DESIGN_TOOLS_P7.md). Every number a tool uses is here,
 * with the document, clause, printed page and its status:
 *  - 'official'  read from a government / agency copy (PMC, MoUD/IUT, Maha-Metro);
 *  - 'irc-copy'  IRC text read from the Public.Resource.Org mirror (law.resource.org) — third-party copy, unconfirmed
 *                against an IRC-issued copy;
 *  - 'app'       a value the app already uses elsewhere (e.g. the micro-simulator's amber), not a code value;
 *  - 'assumed'   no source; a placeholder the UI shows as "assumed".
 * A value no source gives and no placeholder is used for is not here: the check that needs it says "unknown".
 * All PDFs were read with pdftotext only.
 */

export type SdStatus = 'official' | 'irc-copy' | 'app' | 'assumed';

export const SD_DOCS = {
  IRC35: { title: 'IRC:35-2015 Code of Practice for Road Markings (2nd revision)', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.035.2015.pdf', status: 'irc-copy' },
  IRC86: { title: 'IRC:86-2018 Geometric Design Standards for Urban Roads and Streets', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.086.2018.pdf', status: 'irc-copy' },
  IRC93: { title: 'IRC:93-1985 Guidelines on Design and Installation of Road Traffic Signals', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.093.1985.pdf', status: 'irc-copy' },
  IRC65: { title: 'IRC:65-2017 Guidelines for Planning and Design of Roundabouts', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.065.2017.pdf', status: 'irc-copy' },
  IRC124: { title: 'IRC:124-2017 BRT Design Guidelines for Indian Cities', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.124.2017.pdf', status: 'irc-copy' },
  IRC11: { title: 'IRC:11-2015 Recommended Practice for the Design and Layout of Cycle Tracks (1st revision)', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.011.2015.pdf', status: 'irc-copy' },
  IRC54: { title: 'IRC:54-1974 Lateral and Vertical Clearances at Underpasses for Vehicular Traffic', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.054.1974.pdf', status: 'irc-copy' },
  SP90: { title: 'IRC:SP:90-2023 Manual for Grade Separators and Elevated Structures (mirror file irc.gov.in.sp.142.2024.pdf)', url: 'https://law.resource.org/pub/in/bis/irc/irc.gov.in.sp.142.2024.pdf', status: 'irc-copy' },
  USDG: { title: 'Urban Street Design Guidelines, Pune — Pune Municipal Corporation, Version I: 2016', url: 'https://pmc.gov.in/sites/default/files/road_img/USDG_Final_July2016.pdf', status: 'official' },
  COP1: { title: 'MoUD / IUT Code of Practice for Urban Roads, Part 1: Cross Section (2012)', url: 'https://www.mohua.gov.in/ (Code of Practice, Part 1 Cross Section)', status: 'official' },
  COP2: { title: 'MoUD / IUT Code of Practice for Urban Roads, Part 2: Intersections (2012)', url: 'https://www.mohua.gov.in/ (Code of Practice, Part 2 Intersections)', status: 'official' },
  PMDPR2: { title: 'Maha-Metro, Detailed Project Report, Pune Metro Phase-2 (Line 2A/2B), July 2024', url: 'https://www.punemetrorail.org/download/DPR01.pdf', status: 'official' },
  APP: { title: 'UrbanOS (this app)', url: '', status: 'app' },
} as const;

export type SdDocKey = keyof typeof SD_DOCS;

export interface SdValue {
  value: number;
  unit: string;
  doc: SdDocKey | null;
  clause: string;
  /** Printed page (string: "5-80", "25"). */
  page: string;
  status: SdStatus;
}

const v = (value: number, unit: string, doc: SdDocKey | null, clause: string, page: string, status?: SdStatus): SdValue =>
  ({ value, unit, doc, clause, page, status: status ?? (doc ? (SD_DOCS[doc].status as SdStatus) : 'assumed') });

const STATUS_TEXT: Record<SdStatus, string> = {
  official: 'official copy',
  'irc-copy': 'IRC text, third-party copy — unconfirmed',
  app: 'app value, not from a code',
  assumed: 'assumed — no source',
};

/** "IRC:35-2015 §6.1.3, p. 32 — IRC text, third-party copy — unconfirmed". */
export function sdLabel(x: Pick<SdValue, 'doc' | 'clause' | 'page' | 'status'>): string {
  const name = x.doc ? SD_DOCS[x.doc].title.split(' ')[0].replace(/,$/, '') : 'UrbanOS';
  const doc = x.doc === 'USDG' ? 'Pune USDG 2016' : x.doc === 'COP1' ? 'MoUD CoP Part 1' : x.doc === 'COP2' ? 'MoUD CoP Part 2' : x.doc === 'PMDPR2' ? 'Pune Metro Phase-2 DPR (2024)' : name;
  return `${doc}${x.clause ? ` ${x.clause}` : ''}${x.page ? `, p. ${x.page}` : ''} — ${STATUS_TEXT[x.status]}`;
}

/** Every value used by the street design tools. */
export const SD = {
  // ── #6 Metro corridor ─────────────────────────────────────────────────────
  metroViaductWidthM: v(8.5, 'm', 'PMDPR2', '§5.9.2 ("about 8.5 m (edge to edge)", Phase-1 viaduct)', '5-80'),
  metroSetbackM: v(5, 'm', 'PMDPR2', '§5.9.2 ("setback of about 5 m … from either edge of the viaduct (or 10 m on both sides of the centre line) wherein no structures are to be located")', '5-80'),
  metroSetbackFromCentrelineM: v(10, 'm', 'PMDPR2', '§5.9.2 ("or 10 m on both sides of the centre line")', '5-80'),
  metroRoadClearanceM: v(5.5, 'm', 'PMDPR2', '§5.7.1.2 ("clearance of 5.5 m … beyond vertical plane drawn on outer face of crash barrier")', '5-62'),
  metroMinRailOverRoadM: v(8.4, 'm', 'PMDPR2', '§5.7.1.2 ("the minimum height of rail above the existing road is 8.4 m")', '5-62'),
  metroPierDiaMinM: v(2.0, 'm', 'PMDPR2', '§5.7.1.2 (circular pier "2m to 3.0 m diameter … for most of its height")', '5-62'),
  metroPierBarrierGapM: v(0.025, 'm', 'PMDPR2', '§5.7.1.2 (25 mm gap between crash barrier and pier face; barrier 1.0 m high)', '5-62'),

  // ── #1 Junction control and markings ─────────────────────────────────────
  stopLineUrbanM: v(0.2, 'm', 'IRC35', '§6.1.3 (single stop line 200 mm urban)', '32'),
  stopLineSetbackSignalM: v(1.0, 'm', 'IRC35', '§6.1.4 / §11.3.2 (at signals: zebra 1 m ahead of the primary signal, stop line another 1 m ahead of the zebra)', '32, 72'),
  stopLineBeforeZebraMinM: v(2.0, 'm', 'IRC35', '§6.1.4 / §11.3.2 (unsignalised: stop line 2–3 m before the zebra)', '32, 72'),
  stopLineBeforeZebraMaxM: v(3.0, 'm', 'IRC35', '§6.1.4 / §11.3.2', '32, 72'),
  stopLineNoZebraMinM: v(1.25, 'm', 'IRC35', '§6.1.4 (no crossing: 1.25–9 m from the carriageway edge of the intersecting road)', '32'),
  stopLineNoZebraMaxM: v(9.0, 'm', 'IRC35', '§6.1.4', '32'),
  doubleStopLineGapM: v(0.3, 'm', 'IRC35', '§6.1.7 (double stop line: two 200 mm lines 300 mm apart, with a STOP sign)', '32'),
  giveWayDashM: v(0.6, 'm', 'IRC35', '§6.2.1 (give-way: two broken 200 mm lines, 600 mm segments / 300 mm gaps, 300 mm apart)', '34'),
  giveWayGapM: v(0.3, 'm', 'IRC35', '§6.2.1', '34'),
  zebraMinWidthM: v(2.0, 'm', 'IRC35', '§11.3.5 ("in no case … less than the width of footpath subject to minimum of 2.0 m"; generally 2–4 m)', '72'),
  zebraStripeM: v(0.5, 'm', null, 'IRC:35 Table A.4 not transcribed', '', 'assumed'),
  arrowLen50M: v(3.5, 'm', 'IRC35', '§8.1.2 Table 8.1 (up to 50 km/h)', '45'),
  arrowLen100M: v(5.0, 'm', 'IRC35', '§8.1.2 Table 8.1 (51–100 km/h)', '45'),
  arrowSetbackM: v(10, 'm', null, 'arrow position on the approach not stated in the text read', '', 'assumed'),
  warrant1Major1: v(650, 'veh/h', 'IRC93', '§3 Table 2 Warrant 1 (major 1 lane, minor 1 lane; each of any 8 hours)', '25'),
  warrant1Major2: v(800, 'veh/h', 'IRC93', '§3 Table 2 Warrant 1 (major 2+ lanes)', '25'),
  warrant1Minor1: v(200, 'veh/h', 'IRC93', '§3 Table 2 Warrant 1 (minor 1 lane, higher approach, one direction)', '25'),
  warrant1Minor2: v(250, 'veh/h', 'IRC93', '§3 Table 2 Warrant 1 (minor 2+ lanes)', '25'),
  warrant2Major1: v(1000, 'veh/h', 'IRC93', '§4 Table 3 Warrant 2 (major 1 lane)', '26'),
  warrant2Major2: v(1200, 'veh/h', 'IRC93', '§4 Table 3 Warrant 2 (major 2+ lanes)', '26'),
  warrant2Minor1: v(100, 'veh/h', 'IRC93', '§4 Table 3 Warrant 2 (minor 1 lane)', '26'),
  warrant2Minor2: v(150, 'veh/h', 'IRC93', '§4 Table 3 Warrant 2 (minor 2+ lanes)', '26'),
  warrantHours: v(8, 'h', 'IRC93', '§3.1 / §4.1 ("each of any 8 hours of an average day")', '25'),

  // ── #2 Pedestrian crossings ──────────────────────────────────────────────
  refugeTriggerLengthM: v(10.5, 'm', 'IRC35', '§11.3.3 ("more than 10.5 m in one go, there shall be Refuge Island")', '72'),
  refugeMinWidthM: v(1.2, 'm', 'IRC35', '§11.3.3 (refuge island at least 1.2 m wide)', '72'),
  refugeUsdgMinM: v(1.0, 'm', 'USDG', '§4.1.2 (refuge island min 1 m; ≥ 3 m for wheelchair users)', '17'),
  refugeWheelchairM: v(3.0, 'm', 'USDG', '§4.1.2 ("Island width should be at least 3 m in order to be accessed by wheelchair users")', '17'),
  refuge4LaneM: v(3.0, 'm', 'IRC86', '§5.1.2 (roads with 4+ lanes: median pedestrian refuge of minimum 3 m waiting area)', '9'),
  raisedCrossingMinWidthM: v(3.0, 'm', 'IRC86', '§5.1.2 (raised crosswalk minimum width 3 m, ramps 1:8)', '9'),
  raisedRampSlope: v(1 / 8, '', 'IRC86', '§5.1.2 (ramps for motor vehicles slope 1:8)', '9'),
  midblockSpacingMinM: v(50, 'm', 'IRC86', '§5.1.2 ("Mid-block pedestrian crossings … range from 50-200 m")', '9'),
  midblockSpacingMaxM: v(200, 'm', 'IRC86', '§5.1.2', '9'),
  brtCrossingSpacingM: v(150, 'm', 'USDG', 'BRT lanes ("mid block crossings at every 150 m")', '12'),
  pedSignalCrossingSpacingM: v(300, 'm', 'IRC93', '§5.4 (mid-block signal: cross-walk not closer than 300 m to another established cross-walk)', '27'),
  pedSignalNoParkingM: v(75, 'm', 'IRC93', '§5.4 (kerb-side parking prohibited 75 m before and beyond the cross-walk)', '27'),
  pedWalkSpeedMps: v(1.2, 'm/s', 'IRC93', '§22.1 (pedestrian green = width / 1.2 m/s + 7 s)', '21–22'),
  pedReactionS: v(7, 's', 'IRC93', '§22.1 ("A value of seven seconds must be added")', '22'),
  pedSignalCycleS: v(60, 's', null, 'mid-block signal cycle: design input (IRC:93 §22.2: multiple of 5 s, preferably ≤ 120 s)', '', 'assumed'),
  amberS: v(3, 's', 'APP', 'micro-simulator amber (TrafficMicroSim SIGNAL_AMBER_S)', '', 'app'),
  allRedS: v(2, 's', 'APP', 'micro-simulator all-red (TrafficMicroSim SIGNAL_ALL_RED_S)', '', 'app'),
  pedWarrantPedsPerH: v(150, 'ped/h', 'IRC93', '§5.1 Warrant 3 (150 or more pedestrians per hour, each of any 8 hours)', '26–27'),
  pedWarrantVeh: v(600, 'veh/h', 'IRC93', '§5.1 Warrant 3 (600 veh/h both approaches; 1,000 with a raised median ≥ 1.5 m)', '26'),

  // ── #3 Bus stops and bus lanes ───────────────────────────────────────────
  busStopSpacingMinM: v(500, 'm', 'COP1', '§5.9 ("A minimum distance of 500 m is recommended between the bus shelters")', '27'),
  busStopSpacingMaxM: v(1000, 'm', 'COP1', '§5.9 ("should not exceed more than 1 km")', '27'),
  busStopFromJunctionM: v(50, 'm', 'USDG', 'Bus stops ("located at a distance of 50 m away from any junction")', '11'),
  busStopNoParkBeforeM: v(50, 'm', 'USDG', 'Bus stops ("Parking should be prohibited in the zone 50m before bus stop and 20m after")', '11'),
  busStopNoParkAfterM: v(20, 'm', 'USDG', 'Bus stops', '11'),
  busShelterLengthM: v(10, 'm', 'USDG', 'Bus stops ("Ideal minimum dimensions of bus stop are – 10M X 1.5M X 2.2M ht")', '11'),
  busShelterDepthM: v(1.5, 'm', 'USDG', 'Bus stops (10 × 1.5 × 2.2 m)', '11'),
  clearWalkM: v(2.0, 'm', 'USDG', '§3.1 Footpath ("clear and unobstructed minimum walking zone of 2m")', '7'),
  brtLaneM: v(3.5, 'm', 'IRC124', '§6.1 ("BRT lane for one-way movement should have a width of 3.5 m")', '36'),
  brtPassingLaneM: v(4.0, 'm', 'IRC124', '§6.1 (passing lane 4 m)', '36'),
  brtDividerM: v(0.5, 'm', 'IRC124', '§6.1 ("A divider, minimum 0.5 m wide"; at least 1 m at street crossing points)', '36'),
  brtDividerAtCrossingM: v(1.0, 'm', 'IRC124', '§6.1', '36'),
  brtStationInnerM: v(3.5, 'm', 'IRC124', '§6.1 (median station minimum inner clear width 3.5 m)', '37'),
  brtStationOuterM: v(4.0, 'm', 'IRC124', '§6.1 (outer width minimum 4 m)', '37'),
  busLaneRowMinM: v(30, 'm', 'USDG', 'BRT lanes ("Dedicated bus lanes are recommended on roads with ROW 30m and above")', '12'),
  busLaneTwoWayMinM: v(7, 'm', 'USDG', 'BRT lanes ("min 7 m undivided for 2 way bus flow")', '12'),

  // ── #4 Streetlights and street trees ─────────────────────────────────────
  lightPathHeightMin: v(4.5, 'm', 'IRC86', '§5.8 Table 5.6 (footpath or cycle track < 5 m: pole 4.5–6.0 m, spacing 12–16 m)', '16'),
  lightPathHeightMax: v(6.0, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightPathSpacingMin: v(12, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightPathSpacingMax: v(16, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightSmallHeightMin: v(8, 'm', 'IRC86', '§5.8 Table 5.6 (RoW ≤ 9 m: pole 8–10 m, spacing 25–27 m)', '16'),
  lightSmallHeightMax: v(10, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightSmallSpacingMin: v(25, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightSmallSpacingMax: v(27, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightLargeHeightMin: v(10, 'm', 'IRC86', '§5.8 Table 5.6 (RoW > 9 m: pole 10–12 m, spacing 30–33 m)', '16'),
  lightLargeHeightMax: v(12, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightLargeSpacingMin: v(30, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightLargeSpacingMax: v(33, 'm', 'IRC86', '§5.8 Table 5.6', '16'),
  lightMaxPoleM: v(12, 'm', 'IRC86', '§5.8 ("Poles shall be no higher than 12 m")', '16'),
  lightSingleRowStreetM: v(12, 'm', 'IRC86', '§5.8 ("A single row of light posts is generally sufficient for streets up to 12 m wide")', '16'),
  treePitM: v(1.0, 'm', 'IRC86', '§5.1.10 ("Tree pits, with a minimum dimension of 1 m x 1 m")', '11'),
  treeCanopyClearanceM: v(3.0, 'm', 'IRC86', '§5.1.10 ("Canopy of trees shall have a minimum clearance of 3 m from the surface of the footpath")', '11'),
  treeSpacingM: v(8, 'm', null, 'street-tree spacing: no value in the texts read (IRC:86 asks for a "continuous tree line")', '', 'assumed'),

  // ── #7 Roundabouts ───────────────────────────────────────────────────────
  rbUrbanSingleMinM: v(28, 'm', 'IRC65', '§6.1.1 Table 6.1 (urban single-lane ICD 28–40 m, CCW 12–8 m; ≤ 4 arms at 90°)', '13'),
  rbUrbanSingleMaxM: v(40, 'm', 'IRC65', '§6.1.1 Table 6.1', '13'),
  rbDoubleMinM: v(40, 'm', 'IRC65', '§6.1.1 Table 6.1 (urban/rural double-lane ICD 40–70 m; CCW 1–1.2 × entry width)', '13'),
  rbDoubleMaxM: v(70, 'm', 'IRC65', '§6.1.1 Table 6.1 (multilane rotary > 70 m)', '13'),
  rbMaxArms: v(4, 'arms', 'IRC65', '§6.1.1 (Table 6.1 assumes no more than four arms at 90°)', '12'),
  rbEntryLaneMinM: v(3.0, 'm', 'IRC65', '§6.3.2 (one lane at the give-way line not less than 3 m nor more than 4.5 m)', '13'),
  rbEntryLaneMaxM: v(4.5, 'm', 'IRC65', '§6.3.2', '13'),
  rbSplitterMinWidthM: v(2.4, 'm', 'IRC65', '§6.4.3 (urban arterial splitter island ≥ 2.4 m wide to shelter a pedestrian)', '16'),
  rbCircSingleRefM: v(3.5, 'm', 'IRC86', '§5.4 lane 3.5 m (entry width proxy for double-lane CCW = 1–1.2 × entry width)', '14'),
  rbMiniMinM: v(13, 'm', 'COP2', 'Table 2-6 (mini roundabout ICD 13–25 m, one entering lane, 25 km/h)', '30'),
  rbMiniMaxM: v(25, 'm', 'COP2', 'Table 2-6', '30'),
  rbMiniIslandMaxM: v(4, 'm', 'COP2', '§2.3.1.1.1 (mini: raised circular island less than 4 m diameter, domed ≤ 125 mm)', '30'),
  rbAssumedQcPcu: v(600, 'PCU/h', null, 'circulating flow used for entry capacity in the static assignment (the assignment cannot feed the circulating flow back)', '', 'assumed'),

  // ── #8 Standalone paths, FOB, subway ─────────────────────────────────────
  cycleOneWayMinM: v(2.0, 'm', 'IRC86', '§5.2 ("at least 2 m of clear space per direction for one-way movement and 3 m for two-way")', '12'),
  cycleTwoWayMinM: v(3.0, 'm', 'IRC86', '§5.2', '12'),
  cycleBufferM: v(0.5, 'm', 'IRC86', '§5.2 ("A buffer of 0.5 m between the cycle track and parking areas or the carriageway")', '12'),
  cycleIrc11TwoLaneMinM: v(2.2, 'm', 'IRC11', '§6.1 Table 4 (minimum 2.2 m for a two-lane cycle track; desirable 2.5–5.0 m)', '7'),
  cycleIrc11DesirableM: v(2.5, 'm', 'IRC11', '§6.1 Table 4', '7'),
  sharedPathMinM: v(3.0, 'm', 'IRC11', '§6.1 Table 4 (3–4 m for a common cycle track and footpath, not more than 40 m long)', '7'),
  footpathMinM: v(1.8, 'm', 'IRC86', '§5.1 Table 5.1 (pedestrian zone residential 1.8 m)', '7'),
  fobRampSlope: v(1 / 20, '', 'IRC86', 'Annexure I (ramps gradient 1:20 with landings)', '40'),
  subwayMinWidthM: v(2.5, 'm', 'IRC86', 'Annexure I (pedestrian and cycle subway minimum 2.5 m wide × 2.75 m clear height)', '40'),
  subwayMinHeightM: v(2.75, 'm', 'IRC86', 'Annexure I', '40'),
  subwayCombinedOneWayM: v(5.0, 'm', 'IRC86', 'Annexure I (combined cycle + pedestrian subway 5 m one-way, 6.5 m two-way)', '40'),
  subwayCombinedTwoWayM: v(6.5, 'm', 'IRC86', 'Annexure I', '40'),
  fobLiftM: v(1.5, 'm', 'IRC86', 'Annexure I (lifts on both entrances, min internal 1500 × 1500 mm; ramp/lift mandatory)', '40'),
  fobRoadClearanceM: v(5.5, 'm', 'IRC54', '§8 ("at least 5 metres. However, in urban areas, this should be increased to 5.50 metres"); current edition unknown', '8'),
  structureFootwayClearanceM: v(2.25, 'm', 'SP90', '§4.18.3 ("For foot ways and cycle tracks, a minimum vertical clearance of 2.25 m")', '36'),
} satisfies Record<string, SdValue>;

export type SdKey = keyof typeof SD;
