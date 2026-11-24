/**
 * Supply-side (and one demand-side) parameters of the area assignment that the p13 project-level tuning may change
 * (docs/urbanos/VALIDATION_P13.md).
 *
 * DEFAULT_SUPPLY reproduces the model exactly as it ran before p13 (the code defaults: speeds from roadParameters.ts,
 * IRC:106 mid-block capacity, Indo-HCM saturation flow, BPR 1964 alpha 0.15 / beta 4, a 120 s assumed cycle, demand as
 * compiled). A tuned set is ESTIMATED: fitted to Google Maps typical journey times and published-study counts, never to
 * the app's official count set, and only ever used when the user turns it on (or when it passed the hold-out check and
 * did not worsen the official-count check; see TUNED_SUPPLY_STATUS).
 *
 * Bounds (SUPPLY_BOUNDS) keep every parameter inside published ranges:
 * - free-flow speed factor 0.6-1.2 per IRC category: Indo-HCM 2017 (CSIR-CRRI) urban-street free-flow speeds span
 *   roughly 30-70 km/h by street class, around the 50/40/30 km/h class defaults used here;
 * - mid-block capacity factor 0.7-1.3: IRC:106-1990 design service volumes are LOS C (about 0.70 of capacity); field
 *   capacities of Indian urban arterials reported in Indo-HCM vary by about +/-30 % with side friction and lane width;
 * - signal saturation-flow factor 0.7-1.3: Indo-HCM width-based saturation flow, with the spread reported across Indian
 *   signalised approaches;
 * - BPR alpha 0.10-1.0 and beta 2-6: the range of volume-delay parameters fitted for Indian urban roads in the literature
 *   (alpha up to about 1, beta 2-5) around the 0.15/4 BPR 1964 default;
 * - assumed cycle 90-180 s: the cycle lengths of Pune's fixed-time and ATCS signals;
 * - demand scale 0.6-1.6 on the compiled study-area demand (through and local trips alike).
 */
export interface SupplyParams {
  /** Free-flow speed multiplier per IRC category: [arterial (trunk/primary), sub-arterial (secondary), collector and below]. */
  speedFactor: [number, number, number];
  /** Mid-block capacity multiplier (all classes). */
  capacityFactor: number;
  /** Stop-line saturation-flow multiplier at signalised approaches. */
  signalSatFactor: number;
  bprAlpha: number;
  bprBeta: number;
  /** Assumed cycle of mapped signals in the assignment (s). */
  cycleS: number;
  /** Multiplier on the compiled study-area demand. */
  demandScale: number;
}

export const DEFAULT_SUPPLY: Readonly<SupplyParams> = Object.freeze({
  speedFactor: [1, 1, 1] as [number, number, number], capacityFactor: 1, signalSatFactor: 1, bprAlpha: 0.15, bprBeta: 4, cycleS: 120, demandScale: 1,
});

export type SupplyKey = 'speedArterial' | 'speedSubArterial' | 'speedCollector' | 'capacityFactor' | 'signalSatFactor' | 'bprAlpha' | 'bprBeta' | 'cycleS' | 'demandScale';
export const SUPPLY_KEYS: readonly SupplyKey[] = ['speedArterial', 'speedSubArterial', 'speedCollector', 'capacityFactor', 'signalSatFactor', 'bprAlpha', 'bprBeta', 'cycleS', 'demandScale'];
export const SUPPLY_BOUNDS: Readonly<Record<SupplyKey, readonly [number, number]>> = Object.freeze({
  speedArterial: [0.6, 1.2], speedSubArterial: [0.6, 1.2], speedCollector: [0.6, 1.2], capacityFactor: [0.7, 1.3], signalSatFactor: [0.7, 1.3],
  bprAlpha: [0.1, 1.0], bprBeta: [2, 6], cycleS: [90, 180], demandScale: [0.6, 1.6],
});

/** Flat vector <-> params (the order of SUPPLY_KEYS). */
export function supplyToVector(p: Readonly<SupplyParams>): number[] {
  return [p.speedFactor[0], p.speedFactor[1], p.speedFactor[2], p.capacityFactor, p.signalSatFactor, p.bprAlpha, p.bprBeta, p.cycleS, p.demandScale];
}
export function vectorToSupply(v: readonly number[]): SupplyParams {
  const c = (k: SupplyKey, x: number) => Math.min(SUPPLY_BOUNDS[k][1], Math.max(SUPPLY_BOUNDS[k][0], x));
  return { speedFactor: [c('speedArterial', v[0]), c('speedSubArterial', v[1]), c('speedCollector', v[2])], capacityFactor: c('capacityFactor', v[3]),
    signalSatFactor: c('signalSatFactor', v[4]), bprAlpha: c('bprAlpha', v[5]), bprBeta: c('bprBeta', v[6]), cycleS: c('cycleS', v[7]), demandScale: c('demandScale', v[8]) };
}

/** True when the set changes nothing (the assignment then runs exactly the pre-p13 code path). */
export function isDefaultSupply(p: Readonly<SupplyParams> | null | undefined): boolean {
  if (!p) return true;
  const a = supplyToVector(p), b = supplyToVector(DEFAULT_SUPPLY);
  return a.every((x, i) => Math.abs(x - b[i]) < 1e-12);
}
