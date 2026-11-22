/**
 * #7 Roundabouts to IRC:65-2017 (docs/urbanos/DESIGN_TOOLS_P7.md §7). Click a junction; choose urban single-lane
 * (ICD 28–40 m), double-lane (40–70 m) or mini (13–25 m, MoUD CoP Part 2 only — IRC:65 has no mini category).
 *
 * Sizes: IRC:65-2017 Table 6.1 (ICD ranges, CCW 12–8 m single-lane, 1–1.2 × entry width double-lane; assumes ≤ 4 arms at
 * 90°) and Table 6.2 (single-lane ICD 28/30/32/36/40 → island 4/8/12/18/24 m, CCW 12/11/10/9/8 m; between rows
 * interpolated, said so). Entry lane 3–4.5 m at the give-way line (§6.3.2). Splitter island ≥ 2.4 m on arterial
 * approaches (§6.4.3) — not drawn, so 'unknown'.
 *
 * Network effect: the junction becomes a roundabout in Simulate's static assignment: its approaches lose any signal
 * (mapped or edited) and get IRC:65 Table 9.1 entry capacity C = A·exp(−B·Qc) per entry lane (Indo-HCM values by ICD),
 * with the circulating flow Qc ASSUMED (600 PCU/h: the one-pass link capacities cannot feed the modelled circulating flow
 * back). The corridor micro-simulation does not model a roundabout (it keeps the junction's previous control).
 */
import type { CityObject, RoadObject, StreetElementObject } from '../objects/types';
import type { RoundaboutCategory, RoundaboutSpec } from './types';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { roadXs } from './roadXs';
import { distM } from './geom';

/** IRC:65-2017 Table 6.2 rows (single-lane): ICD → central island, CCW. */
export const IRC65_TABLE_6_2: readonly { icd: number; island: number; ccw: number }[] = [
  { icd: 28, island: 4, ccw: 12 }, { icd: 30, island: 8, ccw: 11 }, { icd: 32, island: 12, ccw: 10 }, { icd: 36, island: 18, ccw: 9 }, { icd: 40, island: 24, ccw: 8 },
];

/** IRC:65-2017 Table 9.1 (from Indo-HCM 2017): entry capacity model by ICD. */
export const IRC65_TABLE_9_1: readonly { dMin: number; dMax: number; A: number; B: number }[] = [
  { dMin: 20, dMax: 30, A: 2388, B: 0.00035 }, { dMin: 30, dMax: 40, A: 2567, B: 0.00032 },
  { dMin: 40, dMax: 50, A: 2909, B: 0.00029 }, { dMin: 50, dMax: 70, A: 2981, B: 0.00028 },
];

export const CATEGORY_RANGE: Record<RoundaboutCategory, { min: number; max: number; keys: ['rbUrbanSingleMinM', 'rbUrbanSingleMaxM'] | ['rbDoubleMinM', 'rbDoubleMaxM'] | ['rbMiniMinM', 'rbMiniMaxM'] }> = {
  urban_single: { min: SD.rbUrbanSingleMinM.value, max: SD.rbUrbanSingleMaxM.value, keys: ['rbUrbanSingleMinM', 'rbUrbanSingleMaxM'] },
  double: { min: SD.rbDoubleMinM.value, max: SD.rbDoubleMaxM.value, keys: ['rbDoubleMinM', 'rbDoubleMaxM'] },
  mini: { min: SD.rbMiniMinM.value, max: SD.rbMiniMaxM.value, keys: ['rbMiniMinM', 'rbMiniMaxM'] },
};

export const CATEGORY_LABEL: Record<RoundaboutCategory, string> = { urban_single: 'Urban single-lane (IRC:65)', double: 'Double-lane (IRC:65)', mini: 'Mini (MoUD CoP Part 2)' };

/** Central island and circulatory width for an ICD: Table 6.2 (interpolated between rows) or the double-lane / mini rule. */
export function roundaboutSizes(category: RoundaboutCategory, icdM: number, entryLanes = category === 'double' ? 2 : 1): { islandM: number; circulatoryM: number; how: string } {
  if (category === 'urban_single') {
    const t = IRC65_TABLE_6_2;
    const d = Math.max(t[0].icd, Math.min(t[t.length - 1].icd, icdM));
    const k = Math.max(0, t.findIndex((r, i) => i < t.length - 1 && d >= r.icd && d <= t[i + 1].icd));
    const a = t[k], b = t[Math.min(k + 1, t.length - 1)];
    const f = b.icd === a.icd ? 0 : (d - a.icd) / (b.icd - a.icd);
    const exact = t.some(r => r.icd === d);
    return { islandM: r2(a.island + f * (b.island - a.island)), circulatoryM: r2(a.ccw + f * (b.ccw - a.ccw)), how: exact ? 'IRC:65 Table 6.2' : 'IRC:65 Table 6.2, interpolated between rows' };
  }
  if (category === 'double') {
    // CCW 1–1.2 × entry width (Table 6.1); entry width from 3.5 m lanes (IRC:65 §6.3.2: 3–3.5 m at multilane entries) — 1.1 × used
    const ccw = r2(1.1 * entryLanes * SD.rbCircSingleRefM.value);
    return { islandM: r2(Math.max(0, icdM - 2 * ccw)), circulatoryM: ccw, how: 'IRC:65 Table 6.1: CCW 1–1.2 × entry width (1.1 × 2 lanes of 3.5 m used)' };
  }
  // Mini: island under 4 m (CoP Part 2); the rest is circulatory carriageway
  const island = Math.min(SD.rbMiniIslandMaxM.value - 0.5, Math.max(1, icdM / 6));
  return { islandM: r2(island), circulatoryM: r2((icdM - island) / 2), how: 'MoUD CoP Part 2 (mini: island < 4 m); island size assumed' };
}

/** IRC:65 Table 9.1 entry capacity (PCU/h per entry lane) at a circulating flow (PCU/h). Null outside 20–70 m. */
export function entryCapacityPcu(icdM: number, qcPcu: number): number | null {
  const row = IRC65_TABLE_9_1.find(r => icdM > r.dMin - 1e-9 && icdM <= r.dMax + 1e-9);
  return row ? Math.round(row.A * Math.exp(-row.B * qcPcu)) : null;
}

export const DEFAULT_ICD: Record<RoundaboutCategory, number> = { urban_single: 32, double: 50, mini: 20 };

export function roundaboutChecks(el: StreetElementObject, objects: readonly CityObject[]): SdCheck[] {
  const rb = el.roundabout;
  if (!rb) return [];
  const out: SdCheck[] = [];
  const range = CATEGORY_RANGE[rb.category];
  out.push(sdCheck({ id: 'rb-icd', name: 'Inscribed circle diameter', status: rb.icdM < range.min - 1e-6 || rb.icdM > range.max + 1e-6 ? 'fail' : 'pass', actual: r2(rb.icdM), required: range.min,
    text: `${fmtM(rb.icdM)} against ${range.min}–${range.max} m for ${CATEGORY_LABEL[rb.category]}${rb.category === 'mini' ? ' (IRC:65 has no mini category; CoP Part 2 only)' : ''}.`, basis: basisOf(...range.keys) }));
  const want = roundaboutSizes(rb.category, rb.icdM, rb.entryLanes);
  const islandOff = Math.abs(rb.islandM - want.islandM) > 0.5, ccwOff = Math.abs(rb.circulatoryM - want.circulatoryM) > 0.5;
  out.push(sdCheck({ id: 'rb-island', name: 'Central island and circulatory width', status: islandOff || ccwOff ? 'warn' : rb.category === 'urban_single' ? 'pass' : 'info', actual: r2(rb.islandM), required: want.islandM,
    text: `Island ${fmtM(rb.islandM)} / circulatory ${fmtM(rb.circulatoryM)}; ${want.how} gives ${fmtM(want.islandM)} / ${fmtM(want.circulatoryM)}${rb.category === 'urban_single' && rb.icdM <= 28 ? ' (a truck apron is desirable at the smallest island)' : ''}.`,
    basis: rb.category === 'urban_single' ? `${basisOf('rbUrbanSingleMinM')} Table 6.2` : rb.category === 'double' ? basisOf('rbDoubleMinM', 'rbEntryLaneMinM') : basisOf('rbMiniIslandMaxM') }));
  out.push(sdCheck({ id: 'rb-arms', name: 'Number of arms', status: rb.armCount > SD.rbMaxArms.value ? 'warn' : rb.armCount < 3 ? 'warn' : 'pass', actual: rb.armCount, required: SD.rbMaxArms.value, unit: 'arms',
    text: rb.armCount > 4 ? `${rb.armCount} arms: IRC:65 Table 6.1 sizes assume no more than four arms at 90°.` : rb.armCount < 3 ? `${rb.armCount} arm(s) found at the clicked point: a roundabout normally joins three or more.` : `${rb.armCount} arms — within Table 6.1's assumption of up to four.`,
    basis: basisOf('rbMaxArms') }));
  const avail = rb.availableDiameterM;
  out.push(sdCheck({ id: 'rb-fit', name: 'Fits the space at the junction', status: avail == null ? 'unknown' : avail < rb.icdM - 1e-6 ? 'fail' : 'pass', actual: avail ?? null, required: r2(rb.icdM),
    text: avail == null ? 'Available diameter at the junction (from the DP / survey) not entered, so the fit was not screened.' : avail < rb.icdM ? `ICD ${fmtM(rb.icdM)} needs more than the available ${fmtM(avail)}.` : `ICD ${fmtM(rb.icdM)} fits the available ${fmtM(avail)}.`,
    basis: 'Planner entry (DP / survey)' }));
  // Entry lane width from the arm roads' lane widths (IRC:65 §6.3.2: 3–4.5 m at the give-way line)
  const arms = rb.armRoadIds.map(id => objects.find(o => o.id === id && o.type === 'road') as RoadObject | undefined).filter(Boolean) as RoadObject[];
  const lw = arms.map(r => roadXs(r).laneW);
  if (lw.length) {
    const bad = lw.filter(w => w < SD.rbEntryLaneMinM.value - 1e-6 || w > SD.rbEntryLaneMaxM.value + 1e-6);
    out.push(sdCheck({ id: 'rb-entry-lane', name: 'Entry lane width', status: bad.length ? 'warn' : 'pass', actual: r2(Math.min(...lw)), required: SD.rbEntryLaneMinM.value,
      text: bad.length ? `${bad.length} arm(s) with lanes outside 3–4.5 m at the give-way line (approach lane width used; entry flare not drawn).` : `Approach lanes ${[...new Set(lw.map(r2))].join(' / ')} m — within 3–4.5 m (entry flare not drawn).`,
      basis: basisOf('rbEntryLaneMinM', 'rbEntryLaneMaxM') }));
  }
  out.push(sdCheck({ id: 'rb-splitter', name: 'Splitter islands', status: 'unknown', actual: null, required: SD.rbSplitterMinWidthM.value,
    text: 'Splitter islands are not drawn: IRC:65 asks for kerbed splitters on every approach, ≥ 2.4 m wide (8–10 m²) on arterial approaches to shelter a pedestrian.', basis: basisOf('rbSplitterMinWidthM') }));
  const pedNear = objects.some(o => o.type === 'street_element' && o.kind === 'crossing' && o.anchor && rb.armRoadIds.includes(o.anchor.roadId) && distM(o.coordinates[0], el.coordinates[0]) < rb.icdM / 2 + 40);
  out.push(sdCheck({ id: 'rb-crossings', name: 'Pedestrian crossings on the arms', status: pedNear ? 'pass' : 'info', unit: '', actual: null, required: null,
    text: pedNear ? 'A drawn crossing is on an arm near the roundabout.' : 'No crossing drawn on the arms: IRC:65 notes pedestrians get no priority at a roundabout; zebras on the splitters may be considered (§6.11).', basis: 'IRC:65-2017 §6.11 — IRC text, third-party copy — unconfirmed' }));
  const cap = entryCapacityPcu(rb.icdM, SD.rbAssumedQcPcu.value);
  out.push(sdCheck({ id: 'rb-model', name: 'Effect in Simulate', status: 'info', actual: cap, required: null, unit: 'PCU/h/lane',
    text: cap == null ? `ICD ${fmtM(rb.icdM)} is outside IRC:65 Table 9.1 (20–70 m): the assignment gives its approaches no roundabout capacity (signals removed only).`
      : `Approaches lose any signal; entry capacity ${cap} PCU/h per entry lane (IRC:65 Table 9.1, Qc assumed ${SD.rbAssumedQcPcu.value} PCU/h). The corridor micro-simulation does not model roundabouts.`,
    basis: basisOf('rbAssumedQcPcu') + '; IRC:65-2017 §9 Table 9.1, p. 35 — IRC text, third-party copy — unconfirmed' }));
  return out;
}

/** A spec for a category and ICD, island and CCW from the size rule. */
export function roundaboutSpec(category: RoundaboutCategory, icdM: number, at: { armRoadIds: string[]; nodeKeys: string[]; armCount?: number }, availableDiameterM: number | null = null): RoundaboutSpec {
  const entryLanes = category === 'double' ? 2 : 1;
  const s = roundaboutSizes(category, icdM, entryLanes);
  return { category, icdM, islandM: s.islandM, circulatoryM: s.circulatoryM, armRoadIds: at.armRoadIds, armCount: at.armCount ?? at.armRoadIds.length, nodeKeys: at.nodeKeys, availableDiameterM, entryLanes };
}
