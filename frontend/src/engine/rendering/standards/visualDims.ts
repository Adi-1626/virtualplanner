/**
 * Dimensions the renderer draws Design objects with (BUILD_VISUALS_AND_TOOLS_PLAN §A2). One place, each value with its
 * source and status, mirroring `engine/geometry/alignment/criteria.ts`.
 *
 * Status:
 * - `official`  read from a government / agency document (Maha-Metro DPR, PMC USDG, MoUD CoP);
 * - `irc-copy`  IRC text read from the Public.Resource.Org mirror (law.resource.org), unconfirmed against an IRC-issued copy;
 * - `assumed`   no source found: drawn because the structure would look wrong without it, and listed in the inspector
 *               under "Drawn with assumed dimensions";
 * - `unknown`   not found and not drawn as if known (e.g. U-girder section: drawn generic, labelled "type not confirmed").
 *
 * These are drawing values for a screening view, never a design check. Existing objects keep their stored values; only
 * defaults and the drawn details (markings, kerbs, girders, caps) come from here.
 */
export type DimStatus = 'official' | 'irc-copy' | 'assumed' | 'unknown';

export interface Dim {
  value: number;
  unit: 'm' | 'mm' | '%';
  label: string;
  source: string;
  status: DimStatus;
}

const d = (value: number, unit: Dim['unit'], label: string, source: string, status: DimStatus): Dim => ({ value, unit, label, source, status });

const IRC35 = 'IRC:35-2015 (law.resource.org copy)';
const USDG = 'PMC Urban Street Design Guidelines 2016 §3.1';
const DPR2 = 'Maha-Metro Pune Metro Phase-2 DPR, July 2024 (punemetrorail.org/download/DPR01.pdf)';

export const VISUAL_DIMS = {
  // ── Kerbs and footpaths ──────────────────────────────────────────────────────
  kerbHeight: d(0.15, 'm', 'Kerb / footpath height', `${USDG} ("maximum 150 mm above road level"); IRC:86-2018 kerb ≤ 150 mm`, 'official'),
  cycleTrackHeight: d(0.05, 'm', 'Cycle track surface height', 'app default (IRC:86 §5.3 gives 100–150 mm for a raised track; not applied)', 'assumed'),

  // ── Markings (IRC:35-2015) ────────────────────────────────────────────────────
  laneLineWidth: d(0.15, 'm', 'Lane line width (urban)', `${IRC35} §4.6.2 / note under Table 4.3`, 'irc-copy'),
  laneLineMark: d(3, 'm', 'Lane line mark length', `${IRC35} §4.7.1`, 'irc-copy'),
  laneLineGap: d(6, 'm', 'Lane line gap', `${IRC35} §4.7.1`, 'irc-copy'),
  rampLineMark: d(1.5, 'm', 'Lane line mark, one-way / ramp', `${IRC35} §4.8.1`, 'irc-copy'),
  rampLineGap: d(3, 'm', 'Lane line gap, one-way / ramp', `${IRC35} §4.8.1`, 'irc-copy'),
  centreLineWidth: d(0.15, 'm', 'Centre line width (undivided, urban)', `${IRC35} §4.6.1, white broken on normal sections`, 'irc-copy'),
  centreLineMark: d(3, 'm', 'Centre line mark length', `${IRC35} §4.6.1`, 'irc-copy'),
  centreLineGap: d(6, 'm', 'Centre line gap', `${IRC35} §4.6.1`, 'irc-copy'),
  edgeLineWidth: d(0.15, 'm', 'Edge line width (divided multi-lane)', `${IRC35} §4.5.3`, 'irc-copy'),
  edgeLineOffset: d(0.1, 'm', 'Edge line offset from kerb', 'MoUD CoP Part 3 Road Marking §(3)', 'official'),
  markingLift: d(0.02, 'm', 'Marking height above the surface (render only)', 'rendering (polygon offset substitute)', 'assumed'),

  // ── Road flyover ──────────────────────────────────────────────────────────────
  flyoverSpan: d(30, 'm', 'Flyover span (pier spacing)', 'none found (IRC:SP:90 points to IRC:SP:54, not read)', 'assumed'),
  flyoverGirderDepth: d(2.0, 'm', 'Flyover box-girder depth', 'none found', 'assumed'),
  flyoverSoffitRatio: d(0.5, 'm', 'Box-girder soffit width ÷ deck width', 'none found', 'assumed'),
  crashBarrierHeight: d(1.0, 'm', 'Crash barrier / parapet height (Jersey profile)', 'IRC:SP:90 §4.4 requires barriers "as per IRC:5" (not read); DPR2 uses 1.0 m Jersey barriers around piers', 'assumed'),
  pierCapDepth: d(1.5, 'm', 'Pier cap depth', 'none found', 'assumed'),
  pierCapLength: d(2.0, 'm', 'Pier cap length along the deck', 'none found', 'assumed'),
  retainingWallMaxHeight: d(3, 'm', 'Ramp: solid RE wall up to this deck height, spans above', 'IRC:SP:90 §7.2 (limit "as per guidelines", value not found)', 'assumed'),

  // ── Metro viaduct (Pune) ──────────────────────────────────────────────────────
  metroDeckWidth: d(8.5, 'm', 'Metro viaduct width, edge to edge', `${DPR2}, station planning ("about 8.5 m (edge to edge)")`, 'official'),
  metroTrackCentres: d(4.1, 'm', 'Track centres', `${DPR2} §5.7.1.1`, 'official'),
  metroSpan: d(28, 'm', 'Metro span (default; 13–34 m, average 25–28 m)', `${DPR2} §5.7.1.1; Maha-Metro newsletter Oct 2022`, 'official'),
  metroPierDiameter: d(2.0, 'm', 'Metro pier diameter (2.0–3.0 m)', `${DPR2} §5.7.1.2`, 'official'),
  metroPierBarrierHeight: d(1.0, 'm', 'Jersey crash barrier around a metro pier', `${DPR2} §5.7.1.2`, 'official'),
  metroPierBarrierGap: d(0.025, 'm', 'Gap between pier and its crash barrier', `${DPR2} §5.7.1.2`, 'official'),
  metroGirderDepth: d(2.0, 'm', 'Metro box-girder depth', 'not found in official sources', 'assumed'),
  metroGirderSoffit: d(4.0, 'm', 'Metro box-girder soffit width', 'only a non-official article (3.5 m); not used', 'assumed'),
  metroParapetHeight: d(1.0, 'm', 'Metro parapet height', 'not found', 'assumed'),
  metroRailAboveRoad: d(8.4, 'm', 'Minimum rail level above road', `${DPR2} §5.7.1.2`, 'official'),
  metroStationRailLevel: d(13.5, 'm', 'Rail level at elevated stations (minimum)', `${DPR2} §6.1.3`, 'official'),
  metroStationLength: d(140, 'm', 'Elevated station length', `${DPR2}`, 'official'),
  metroStationWidthIsland: d(17, 'm', 'Station concourse max width, island platform', `${DPR2} station planning norms`, 'official'),
  metroStationWidthSide: d(21, 'm', 'Station concourse max width, side platforms', `${DPR2} station planning norms`, 'official'),
  standardGauge: d(1.435, 'm', 'Track gauge (standard)', 'Pune Metro standard gauge', 'official'),
  uGirderSection: d(Number.NaN, 'm', 'U-girder section', 'no official Pune U-girder drawing found', 'unknown'),

  // ── Roadside props (indicative placement, drawn roads only) ──────────────────
  streetlightHeightNarrow: d(9, 'm', 'Streetlight pole height, RoW ≤ 9 m (8–10 m)', 'IRC:86-2018 Table 5.6', 'irc-copy'),
  streetlightSpacingNarrow: d(26, 'm', 'Streetlight spacing, RoW ≤ 9 m (25–27 m)', 'IRC:86-2018 Table 5.6', 'irc-copy'),
  streetlightHeightWide: d(11, 'm', 'Streetlight pole height, RoW > 9 m (10–12 m)', 'IRC:86-2018 Table 5.6', 'irc-copy'),
  streetlightSpacingWide: d(31, 'm', 'Streetlight spacing, RoW > 9 m (30–33 m)', 'IRC:86-2018 Table 5.6', 'irc-copy'),
  streetlightKerbOffset: d(0.6, 'm', 'Streetlight pole set back from the kerb face', 'none found', 'assumed'),
  treeSpacing: d(8, 'm', 'Street tree spacing in the verge', 'none found (IRC:86 §5.1.10 asks for a continuous tree line)', 'assumed'),
  treePitMin: d(1.0, 'm', 'Tree pit, minimum side (verge narrower than this gets no trees)', 'IRC:86-2018 §5.1.10', 'irc-copy'),

  // ── Tunnels ───────────────────────────────────────────────────────────────────
  boredTunnelDiameter: d(5.8, 'm', 'Bored tunnel internal diameter (Swargate–Katraj)', 'Pune Metro Swargate–Katraj revised DPR 2022', 'official'),
  portalHeadwallThickness: d(0.5, 'm', 'Portal headwall thickness', 'none found', 'assumed'),
  portalHeadwallWing: d(1.0, 'm', 'Portal headwall extent beyond the boat walls, each side', 'none found', 'assumed'),
  portalCopingDepth: d(0.3, 'm', 'Portal headwall coping depth', 'none found', 'assumed'),
  portalCover: d(1.0, 'm', 'Crown cover where the boat section ends at the headwall', 'none found (plan §A3.7: ~1 m)', 'assumed'),
  boatWallThickness: d(0.6, 'm', 'Boat-section retaining wall thickness', 'none found', 'assumed'),
  boatBaseThickness: d(0.6, 'm', 'Boat-section base slab thickness', 'none found', 'assumed'),
  boatParapetHeight: d(1.0, 'm', 'Boat-section / headwall parapet above ground', 'none found', 'assumed'),
  roadTunnelClearance: d(5.0, 'm', 'Road tunnel opening clear height', 'IRC:54 vertical clearance at underpasses (as used in plan §B5); no road-tunnel code (IRC:SP:91) read', 'irc-copy'),
} as const satisfies Record<string, Dim>;

export type VisualDimKey = keyof typeof VISUAL_DIMS;

/** Value of a dimension (metres unless the unit says otherwise). */
export function dim(key: VisualDimKey): number {
  return VISUAL_DIMS[key].value;
}

/** Which drawn details of each object type use assumed (or unknown) values, for the inspector list. */
export const ASSUMED_BY_TYPE: Readonly<Record<string, readonly VisualDimKey[]>> = {
  road: ['cycleTrackHeight', 'streetlightKerbOffset', 'treeSpacing'],
  underground_alignment: ['portalHeadwallThickness', 'portalHeadwallWing', 'portalCopingDepth', 'portalCover', 'boatWallThickness', 'boatBaseThickness', 'boatParapetHeight'],
  flyover: ['flyoverSpan', 'flyoverGirderDepth', 'flyoverSoffitRatio', 'crashBarrierHeight', 'pierCapDepth', 'pierCapLength', 'retainingWallMaxHeight'],
  metro_flyover: ['flyoverGirderDepth', 'flyoverSoffitRatio', 'crashBarrierHeight', 'pierCapDepth', 'pierCapLength', 'metroGirderDepth', 'metroGirderSoffit', 'metroParapetHeight'],
  metro_line: ['metroGirderDepth', 'metroGirderSoffit', 'metroParapetHeight', 'pierCapDepth', 'pierCapLength'],
  metro_station: [],
};

/** The dimensions drawn for an object type that are not from a source: `[{label, value, source}]`. */
export function assumedDimsFor(type: string, opts?: { metroSuperstructure?: 'box' | 'u'; portal?: boolean }): { key: VisualDimKey; label: string; value: string; status: DimStatus; source: string }[] {
  const keys: VisualDimKey[] = [...(ASSUMED_BY_TYPE[type] ?? [])];
  if (opts?.metroSuperstructure === 'u' && (type === 'metro_line' || type === 'metro_flyover')) keys.push('uGirderSection');
  // roads that go below ground (tunnel or ramped approach) are drawn with a portal / boat section
  if (opts?.portal && type === 'road') keys.push(...ASSUMED_BY_TYPE.underground_alignment);
  return keys.map(key => {
    const v = VISUAL_DIMS[key] as Dim;
    return { key, label: v.label, value: Number.isFinite(v.value) ? `${v.value} ${v.unit}` : 'not known', status: v.status, source: v.source };
  });
}
