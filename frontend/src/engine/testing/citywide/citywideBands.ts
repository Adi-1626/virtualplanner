/**
 * p16 plausibility bands for the city-wide robustness harness (docs/urbanos/CITYWIDE_P16.md §3).
 *
 * Written on 2026-11-26 BEFORE any tuning run and never moved afterwards: a candidate model is judged against these, not
 * the other way round. Each band carries its source and a label: `sourced` (a published figure used as it is), `derived`
 * (a published figure carried through the model's own speed-flow curve or units, the step stated), `assumed` (an
 * engineering bar chosen for this harness, no source behind the number).
 *
 * Speed ratio = a link's time at zero flow (free running at the p14 stream free-flow speed plus uniform signal delay and
 * junction control at zero flow, the same network) / its time at the hour; 1 = free flow. Weighted by vehicle-km, so it
 * is the speed drivers in the area experience, not the speed of empty side streets.
 */

export type BandLabel = 'sourced' | 'derived' | 'assumed';
export interface Band {
  id: string; what: string; hours: 'all' | 'day' | 'night'; micro?: boolean; label: BandLabel; source: string;
  test: (m: AreaHourMetrics) => boolean | null; // null = not applicable (no data for it)
}

/** One harness row (P16Citywide.test.ts). */
export interface AreaHourMetrics {
  ok: boolean; hour: number; demandVph?: number; snappedVph?: number; unroutedVph?: number; noEdgeRouteVph?: number;
  speedRatioMedian?: number | null; speedRatioP10?: number | null; speedKmhP10?: number | null; overLenShare?: number;
  buildingEnds?: { share: number | null; vph: number };
  micro?: { corridorVph: number; measS: number; runs: { inflowVph: number; waiting0: number; waiting1: number; tripKmh: number | null; gridlockedNow: number | null }[] };
}

/** Day hours (09:00 morning peak, 14:00 midday, 19:00 evening peak) and night (23:00). */
export const isNight = (h: number) => h >= 22 || h < 6;

/** Google typical 09:00 / 23:00 speed ratio over the 28 project-check corridors (validation-v1 journey_times.csv): min 0.61 (Hinjewadi–Wakad), p10 0.67, median 0.80; TomTom Pune city Tue 09:00 / 23:00: 16.8 / 26.5 = 0.63. */
export const PEAK_MEDIAN_RATIO_MIN = 0.61;
/** Lowest corridor journey speed in the CMP-2024 speed survey (Table 2-56 text: "Journey speed varies from 8.8 kmph to 59.55 kmph"). */
export const PEAK_P10_KMH_MIN = 8.8;
/** CMP-2024 Annexure 2.6 (service-level benchmark): 9 % of key-corridor length at LoS 4 (< 15 km/h). */
export const PEAK_OVER_LEN_MAX = 0.09;
/** Indo-HCM 2017 Table 5.7 (urban multilane divided): LOS B upper bound v/c 0.45 at 76 % of FFS; p14 stream share s0 = 0.81 → 76/81. */
export const NIGHT_MEDIAN_RATIO_MIN = 0.94;
/** Indo-HCM 2017 Table 5.7: LOS C upper bound v/c 0.75 at 59 % of FFS → 59/81. */
export const NIGHT_P10_RATIO_MIN = 0.73;

export const BANDS: readonly Band[] = [
  { id: 'R1', what: 'the area builds, its demand plan exists and the assignment runs without error', hours: 'all', label: 'assumed',
    source: 'harness requirement ("simulate anywhere in Pune")', test: m => m.ok },
  { id: 'R2', what: 'at least 98 % of the hour\'s planned vehicles get a route on the area\'s roads (unrouted + no drivable way ≤ 2 %)', hours: 'all', label: 'assumed',
    source: 'engineering bar for this harness (no published value)',
    test: m => (m.ok && m.demandVph !== undefined ? ((m.unroutedVph ?? 0) + (m.noEdgeRouteVph ?? 0)) / Math.max(1, (m.demandVph ?? 0) + (m.noEdgeRouteVph ?? 0)) <= 0.02 : null) },
  { id: 'R3', what: 'trips that start or end at a building start / end on a road node within 100 m of it (≥ 90 % of that traffic)', hours: 'all', label: 'assumed',
    source: 'engineering bar for this harness; p14 browser check measured 90-96 % within 40 m (DEMAND_P14.md §9)',
    test: m => (m.ok && m.buildingEnds && m.buildingEnds.share !== null && m.buildingEnds.vph > 0 ? m.buildingEnds.share >= 0.9 : null) },
  { id: 'N1', what: 'night: median speed ratio (vehicle-km weighted) ≥ 0.94 (LOS B or better)', hours: 'night', label: 'derived',
    source: 'Indo-HCM 2017 Table 5.7 (LOS B: v/c ≤ 0.45, 76 % of FFS) over the p14 stream share 0.81 (SUPPLY_P14.md §1.4); Google 23:00 corridor speeds ≈ p14 free-flow (22.4 vs 22.1 km/h, SUPPLY_P14.md §3.2)',
    test: m => (m.ok && m.speedRatioMedian != null ? m.speedRatioMedian >= NIGHT_MEDIAN_RATIO_MIN : null) },
  { id: 'N2', what: 'night: 10th-percentile speed ratio ≥ 0.73 (LOS C or better on 90 % of vehicle-km)', hours: 'night', label: 'derived',
    source: 'Indo-HCM 2017 Table 5.7 (LOS C: v/c ≤ 0.75, 59 % of FFS) / 0.81',
    test: m => (m.ok && m.speedRatioP10 != null ? m.speedRatioP10 >= NIGHT_P10_RATIO_MIN : null) },
  { id: 'N3', what: 'night: at most 1 % of loaded road length above v/c 1.2', hours: 'night', label: 'assumed',
    source: 'engineering bar (night demand is 1.4 % of the day, pune_hourly_profile_v1; no Pune source for night over-capacity)',
    test: m => (m.ok && m.overLenShare !== undefined ? m.overLenShare <= 0.01 : null) },
  { id: 'D1', what: 'day (09/14/19): median speed ratio ≥ 0.61', hours: 'day', label: 'sourced',
    source: 'Google typical times, 28 corridors, 09:00 vs 23:00 (validation-v1): slowest corridor 0.61, p10 0.67, median 0.80; TomTom Pune 2025 Tue 09:00/23:00 0.63',
    test: m => (m.ok && m.speedRatioMedian != null ? m.speedRatioMedian >= PEAK_MEDIAN_RATIO_MIN : null) },
  { id: 'D2', what: 'day: 10th-percentile speed (vehicle-km weighted) ≥ 8.8 km/h', hours: 'day', label: 'sourced',
    source: 'CMP-2024 (PMR) §2 speed survey, Table 2-56: journey speeds 8.8-59.55 km/h; area averages PMC 20.3, PCMC 25.4, Cantonment 22.2, PMRDA 28.1 km/h',
    test: m => (m.ok && m.speedKmhP10 != null ? m.speedKmhP10 >= PEAK_P10_KMH_MIN : null) },
  { id: 'D3', what: 'day: at most 9 % of loaded road length above v/c 1.2', hours: 'day', label: 'derived',
    source: 'CMP-2024 Annexure 2.6: 9 % of key-corridor length below 15 km/h (LoS 4); on the p14 speed-flow curve a link above v/c 1.2 runs below 0.25 of its free-flow speed (< 15 km/h for any urban class)',
    test: m => (m.ok && m.overLenShare !== undefined ? m.overLenShare <= PEAK_OVER_LEN_MAX : null) },
  { id: 'M1', what: 'micro-simulation: no front vehicle standing ≥ 180 s (gridlock) at the end of the measured window, both seeds', hours: 'all', micro: true, label: 'assumed',
    source: 'engineering bar: at a real saturated junction the queue still discharges each cycle (Indo-HCM signal cycles ≤ 180 s)',
    test: m => (m.ok && m.micro?.runs.length ? m.micro.runs.every(r => (r.gridlockedNow ?? 0) === 0) : null) },
  { id: 'M2', what: 'micro-simulation: the queue waiting to enter at the corridor edge grows by at most 10 % of the corridor inflow per hour over the measured window (both seeds)', hours: 'all', micro: true, label: 'assumed',
    source: 'engineering bar: a queue growing for the whole hour means demand above what the corridor takes (no published band)',
    test: m => (m.ok && m.micro?.runs.length ? m.micro.runs.every(r => (r.waiting1 - r.waiting0) * 3600 / Math.max(1, m.micro!.measS) <= 0.1 * Math.max(1, r.inflowVph)) : null) },
  { id: 'M3', what: 'micro-simulation: the two seeds\' corridor trip speeds within 15 % of their mean', hours: 'all', micro: true, label: 'assumed',
    source: 'engineering bar: run-to-run stability of the corridor result (the app reports the spread of its seeds)',
    test: m => {
      const r = m.micro?.runs;
      if (!m.ok || !r || r.length < 2 || r.some(x => x.tripKmh == null)) return null;
      const v = r.map(x => x.tripKmh!), mean = v.reduce((a, b) => a + b, 0) / v.length;
      return mean > 0 ? Math.max(...v.map(x => Math.abs(x - mean))) / mean <= 0.15 : null;
    } },
];

export interface BandResult { pass: boolean; failed: string[]; results: Record<string, boolean | null> }

/** Scores one area x hour: passes when every applicable band passes (a band without data does not count either way). */
export function evaluateBands(m: AreaHourMetrics): BandResult {
  const night = isNight(m.hour);
  const results: Record<string, boolean | null> = {};
  for (const b of BANDS) {
    if (b.hours === 'night' && !night) continue;
    if (b.hours === 'day' && night) continue;
    let r: boolean | null;
    try { r = b.test(m); } catch { r = false; }
    results[b.id] = r;
  }
  const failed = Object.entries(results).filter(([, r]) => r === false).map(([k]) => k);
  return { pass: failed.length === 0 && results.R1 === true, failed, results };
}
