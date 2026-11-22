/**
 * #4 Streetlights and street trees as roadside elements (docs/urbanos/DESIGN_TOOLS_P7.md §4). Data objects: one
 * element per run (count × spacing along one side of a road), with the position of every pole / tree. Their 3D
 * models are the visuals work's; Design draws a simple placeholder.
 *
 * Checks (screening): pole height and spacing by street type, IRC:86-2018 §5.8 Table 5.6 (footpath / cycle track
 * 4.5–6 m at 12–16 m; RoW ≤ 9 m 8–10 m at 25–27 m; RoW > 9 m 10–12 m at 30–33 m; no pole above 12 m; one row is
 * generally enough up to 12 m); tree pit ≥ 1 × 1 m and canopy clearance ≥ 3 m (IRC:86 §5.1.10); poles and pits outside the
 * 2 m clear walking zone (USDG §3.1); pits / pole foundations over a recorded utility → "requires investigation".
 * Tree spacing has no value in the texts read: 8 m is used and labelled assumed.
 *
 * Network effect: none (lights and trees do not change traffic in the model). Environment: trees added are counted in
 * the report; Underground: see the utility check.
 */
import type { CityObject, RoadObject, StreetElementObject, UtilityObject } from '../objects/types';
import type { RoadAnchor, RoadsideSpec } from './types';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { roadXs } from './roadXs';
import { frameAt, lengthM, pointAtChainage, projectOnLine, toLngLat } from './geom';

export type RoadsideKind = 'streetlight' | 'street_tree';

export const DEFAULT_LIGHT: Omit<RoadsideSpec, 'points'> = { poleHeightM: 10, spacingM: 30, count: 5, zone: 'furniture', pitM: null, canopyClearanceM: null };
export const DEFAULT_TREE: Omit<RoadsideSpec, 'points'> = { poleHeightM: null, spacingM: SD.treeSpacingM.value, count: 5, zone: 'furniture', pitM: SD.treePitM.value, canopyClearanceM: SD.treeCanopyClearanceM.value };

/** Offset from the centreline (m, positive) where the run stands: kerb + half the footpath, the furniture strip, or the median. */
export function runOffsetM(road: RoadObject, side: 'left' | 'right', zone: RoadsideSpec['zone']): number {
  const xs = roadXs(road);
  if (zone === 'median') return 0;
  const kerb = xs.oneWay ? xs.carriagewayM / 2 : (side === 'left' ? xs.lanesFwd : xs.lanesBwd) * xs.laneW + xs.medianM / 2;
  const park = side === 'left' ? xs.parkingLeftM : xs.parkingRightM;
  const verge = side === 'left' ? xs.vergeLeftM : xs.vergeRightM;
  const fp = side === 'left' ? xs.footpathLeftM : xs.footpathRightM;
  if (zone === 'furniture') return kerb + park + Math.max(0.5, verge / 2);
  return kerb + park + verge + Math.max(0.5, fp / 2);
}

/** Positions of the run: `count` items every `spacing` m from the anchor chainage, on the side's offset. */
export function runPoints(road: RoadObject, anchor: RoadAnchor, spec: Omit<RoadsideSpec, 'points'>): [number, number, number][] {
  const L = lengthM(road.coordinates);
  const off = runOffsetM(road, anchor.side, spec.zone) * (anchor.side === 'left' ? 1 : -1);
  const s = spec.spacingM && spec.spacingM > 0 ? spec.spacingM : 30;
  const out: [number, number, number][] = [];
  for (let i = 0; i < Math.max(1, spec.count); i++) {
    const ch = anchor.chainageM + i * s;
    if (ch > L + 1e-6) break;
    const p = pointAtChainage(road.coordinates, ch);
    if (!p) break;
    const f = frameAt(p.point);
    out.push(toLngLat(f, [-p.dir[1] * off, p.dir[0] * off]));
  }
  return out;
}

/** Table 5.6 row for the street: by the available RoW when known, else the drawn width (said so). */
export function lightingRow(road: RoadObject | null, zone: RoadsideSpec['zone']): { row: 'path' | 'small' | 'large'; widthM: number | null; fromRow: boolean } {
  if (!road) return { row: 'path', widthM: null, fromRow: false };
  const w = road.availableRowM ?? roadXs(road).drawnWidthM;
  void zone;
  return { row: w <= 9 ? 'small' : 'large', widthM: w, fromRow: road.availableRowM != null };
}

const LIGHT_ROWS = {
  path: { h: ['lightPathHeightMin', 'lightPathHeightMax'], s: ['lightPathSpacingMin', 'lightPathSpacingMax'], label: 'footpath or cycle track (< 5 m)' },
  small: { h: ['lightSmallHeightMin', 'lightSmallHeightMax'], s: ['lightSmallSpacingMin', 'lightSmallSpacingMax'], label: 'street with RoW of 9 m or less' },
  large: { h: ['lightLargeHeightMin', 'lightLargeHeightMax'], s: ['lightLargeSpacingMin', 'lightLargeSpacingMax'], label: 'street with RoW of more than 9 m' },
} as const;

/** Distance from each point to the nearest utility line in the scene (m), and which. */
function nearestUtility(points: readonly [number, number, number][], objects: readonly CityObject[]): { d: number; u: UtilityObject } | null {
  let best: { d: number; u: UtilityObject } | null = null;
  for (const o of objects) {
    if (o.type !== 'utility' || o.coordinates.length < 2) continue;
    for (const p of points) {
      const pr = projectOnLine(o.coordinates, p);
      if (!pr) continue;
      const d = pr.distanceM - (o.diameterMm ? o.diameterMm / 2000 : 0);
      if (!best || d < best.d) best = { d, u: o };
    }
  }
  return best;
}

export function roadsideChecks(el: StreetElementObject, objects: readonly CityObject[]): SdCheck[] {
  const spec = el.roadside;
  if (!spec) return [];
  const road = (el.anchor ? objects.find(o => o.id === el.anchor!.roadId && o.type === 'road') : null) as RoadObject | null;
  const out: SdCheck[] = [];
  if (el.kind === 'streetlight') {
    const lr = lightingRow(road, spec.zone);
    const row = LIGHT_ROWS[lr.row];
    const [hMin, hMax] = row.h.map(k => SD[k].value), [sMin, sMax] = row.s.map(k => SD[k].value);
    const h = spec.poleHeightM, s = spec.spacingM;
    const rowNote = lr.widthM == null ? 'no road under the run' : `${row.label}: ${lr.fromRow ? `available RoW ${fmtM(lr.widthM)}` : `drawn width ${fmtM(lr.widthM)} (available RoW not recorded)`}`;
    out.push(sdCheck({ id: 'light-height', name: 'Pole height', status: h == null ? 'unknown' : h > SD.lightMaxPoleM.value + 1e-6 ? 'fail' : h < hMin - 1e-6 || h > hMax + 1e-6 ? 'warn' : 'pass',
      actual: h ?? null, required: hMax,
      text: h == null ? 'Pole height not entered.' : h > 12 ? `${fmtM(h)} is above the 12 m IRC:86 caps poles at.` : h < hMin || h > hMax ? `${fmtM(h)} is outside ${hMin}–${hMax} m for a ${rowNote}.` : `${fmtM(h)} — within ${hMin}–${hMax} m for a ${rowNote}.`,
      basis: basisOf(row.h[0], 'lightMaxPoleM') }));
    if (spec.count > 1) out.push(sdCheck({ id: 'light-spacing', name: 'Pole spacing', status: s == null ? 'unknown' : s > sMax + 1e-6 ? 'warn' : s < sMin - 1e-6 ? 'info' : 'pass', actual: s ?? null, required: sMax,
      text: s == null ? 'Spacing not entered.' : s > sMax ? `${fmtM(s)} is more than the ${sMin}–${sMax} m of IRC:86 Table 5.6 for a ${rowNote}.` : s < sMin ? `${fmtM(s)} is closer than ${sMin}–${sMax} m (more poles than Table 5.6 needs).` : `${fmtM(s)} — within ${sMin}–${sMax} m.`,
      basis: basisOf(row.s[0]) }));
    if (road && (lr.widthM ?? 0) > SD.lightSingleRowStreetM.value && spec.zone !== 'median') {
      const otherSide = objects.some(o => o.type === 'street_element' && o.kind === 'streetlight' && o.id !== el.id && o.anchor?.roadId === road.id && o.anchor?.side !== el.anchor?.side);
      if (!otherSide) out.push(sdCheck({ id: 'light-rows', name: 'Rows of lights', status: 'info', unit: '', actual: null, required: null,
        text: `The street is wider than 12 m: IRC:86 says one row is generally enough only up to 12 m (wider streets: lights on both sides, or dual lights on a central post). No run drawn on the other side.`,
        basis: basisOf('lightSingleRowStreetM') }));
    }
  } else {
    const pit = spec.pitM, can = spec.canopyClearanceM;
    out.push(sdCheck({ id: 'tree-pit', name: 'Tree pit', status: pit == null ? 'unknown' : pit < SD.treePitM.value - 1e-6 ? 'fail' : 'pass', actual: pit ?? null, required: SD.treePitM.value,
      text: pit == null ? 'Pit size not entered.' : pit < 1 ? `${fmtM(pit)} pit is smaller than the 1 × 1 m minimum.` : `${fmtM(pit)} × ${fmtM(pit)} — no flag against 1 × 1 m.`, basis: basisOf('treePitM') }));
    out.push(sdCheck({ id: 'tree-canopy', name: 'Canopy clearance over the footpath', status: can == null ? 'unknown' : can < SD.treeCanopyClearanceM.value - 1e-6 ? 'fail' : 'pass', actual: can ?? null, required: SD.treeCanopyClearanceM.value,
      text: can == null ? 'Canopy clearance not entered (a maintenance target, not a planting dimension).' : can < 3 ? `${fmtM(can)} is below the 3 m canopy clearance.` : `${fmtM(can)} — no flag against 3 m.`, basis: basisOf('treeCanopyClearanceM') }));
    out.push(sdCheck({ id: 'tree-spacing', name: 'Tree spacing', status: 'info', actual: spec.spacingM ?? null, required: null,
      text: `Spacing ${spec.spacingM != null ? fmtM(spec.spacingM) : 'not entered'}: no spacing value in the texts read (IRC:86 asks for a continuous tree line); the 8 m default is assumed.`, basis: basisOf('treeSpacingM') }));
  }

  // Clear walking zone (USDG 2 m)
  if (road && el.anchor && spec.zone === 'footpath') {
    const fp = el.anchor.side === 'left' ? roadXs(road).footpathLeftM : roadXs(road).footpathRightM;
    const take = el.kind === 'street_tree' ? (spec.pitM ?? SD.treePitM.value) : 0.3;
    const left = fp - take;
    out.push(sdCheck({ id: 'roadside-clear-walk', name: 'Clear walkway', status: fp <= 0 ? 'unknown' : left < SD.clearWalkM.value - 1e-6 ? 'fail' : 'pass', actual: fp > 0 ? r2(left) : null, required: SD.clearWalkM.value,
      text: fp <= 0 ? 'No footpath recorded on this side.' : left < 2 ? `In the footpath, ${el.kind === 'street_tree' ? 'the pit' : 'the pole (base assumed 0.3 m)'} leaves ${fmtM(left)} of a ${fmtM(fp)} footpath, below the 2 m clear walking zone; use the furniture strip.`
        : `${fmtM(left)} left — no flag against the 2 m clear walking zone.`,
      basis: basisOf('clearWalkM') }));
  }

  // Underground: pits / foundations over a recorded utility (screening referral, no depth or footing size is known)
  const nu = nearestUtility(spec.points, objects);
  const reach = el.kind === 'street_tree' ? (spec.pitM ?? 1) / 2 + 0.5 : 0.5;
  out.push(sdCheck({ id: 'roadside-utility', name: el.kind === 'street_tree' ? 'Tree pits over utilities' : 'Pole foundations over utilities',
    status: !nu ? 'unknown' : nu.d <= reach ? 'warn' : 'pass', actual: nu ? r2(Math.max(0, nu.d)) : null, required: reach,
    text: !nu ? 'No utility line is loaded or drawn here, so nothing was screened (absence of records is not absence of utilities).'
      : nu.d <= reach ? `${nu.u.name || 'A utility line'} (${nu.u.utilityType}) passes within ${fmtM(Math.max(0, nu.d))} of ${el.kind === 'street_tree' ? 'a pit' : 'a pole'}: requires investigation (depth of the record and the footing size are not known).`
      : `Nearest recorded utility ${fmtM(nu.d)} away — no flag within ${fmtM(reach)} (records only; footing depth unknown).`,
    basis: 'Utility records in the scene (Underground workspace); reach = half the pit + 0.5 m (assumed)' }));
  out.push(sdCheck({ id: 'roadside-model', name: 'Effect in Simulate', status: 'info', unit: '', text: 'None (lights and trees do not change traffic in the model).', basis: 'UrbanOS model scope' }));
  return out;
}

/** Re-places a run's points after its road or settings change (keeps count / spacing / side). */
export function withRunPoints(el: StreetElementObject, road: RoadObject | null): StreetElementObject {
  if (!el.roadside || !el.anchor || !road) return el;
  const points = runPoints(road, el.anchor, el.roadside);
  return { ...el, coordinates: points.length ? [points[0]] : el.coordinates, roadside: { ...el.roadside, points } };
}

/** Projected anchor of a click on a road (side from the offset sign). */
export function anchorOn(road: RoadObject, at: readonly number[]): RoadAnchor | null {
  const p = projectOnLine(road.coordinates, at);
  if (!p) return null;
  return { roadId: road.id, chainageM: r2(p.chainageM), offsetM: r2(p.offsetM), side: p.offsetM >= 0 ? 'left' : 'right' };
}

