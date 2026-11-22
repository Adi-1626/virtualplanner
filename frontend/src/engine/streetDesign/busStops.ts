/**
 * #3 Bus stops (docs/urbanos/DESIGN_TOOLS_P7.md §3): kerb-side, in a bay (parking strip) or a BRT median station.
 *
 * Checks (screening): 500 m – 1 km to the next stop (MoUD CoP Part 1 §5.9); ~50 m from any junction (Pune USDG); shelter
 * 10 × 1.5 m leaving the 2 m clear walking zone (USDG); no parking 50 m before / 20 m after (USDG); BRT median station
 * inner clear width ≥ 3.5 m, outer ≥ 4 m (IRC:124 §6.1), on a road with a BRT lane.
 *
 * Network effect: none. A kerb-side stop blocks the kerb lane while a bus dwells, but buses are not a separate mode in
 * the model and no Indian capacity factor was read (Indo-HCM treats a stop within 75 m of a signal as a non-base
 * condition; its factor was not transcribed). The stop is in the report with its quantities.
 */
import type { CityObject, RoadObject, StreetElementObject } from '../objects/types';
import type { BusStopSpec } from './types';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { roadXs } from './roadXs';
import { crossings, lengthM, projectOnLine } from './geom';

export const DEFAULT_BUS_STOP: BusStopSpec = { placement: 'kerb', shelterLengthM: SD.busShelterLengthM.value, shelterDepthM: SD.busShelterDepthM.value, stationInnerM: null, stationOuterM: null };

/** Chainages along `road` where another road joins or crosses it (plan, within 2 m). */
export function junctionChainages(road: RoadObject, objects: readonly CityObject[]): number[] {
  const out: number[] = [];
  const L = lengthM(road.coordinates);
  for (const o of objects) {
    if (o.id === road.id || (o.type !== 'road' && o.type !== 'flyover')) continue;
    if (o.type === 'flyover') continue; // a flyover passes over; its ramps end on roads as road ends
    const line = (o as RoadObject).coordinates;
    if (line.length < 2) continue;
    for (const end of [line[0], line[line.length - 1]]) {
      const p = projectOnLine(road.coordinates, end);
      if (p && p.distanceM <= 2) out.push(p.chainageM);
    }
    for (const x of crossings(road.coordinates, line)) out.push(x.chainageA);
  }
  // The road's own ends join the network when another road starts there (counted above); an end alone is not a junction
  return [...new Set(out.map(c => Math.round(Math.max(0, Math.min(L, c)) * 10) / 10))].sort((a, b) => a - b);
}

export function busStopChecks(el: StreetElementObject, objects: readonly CityObject[]): SdCheck[] {
  const s = el.busStop ?? DEFAULT_BUS_STOP;
  const road = (el.anchor ? objects.find(o => o.id === el.anchor!.roadId && o.type === 'road') : null) as RoadObject | null;
  const out: SdCheck[] = [];
  if (!road || !el.anchor) return [sdCheck({ id: 'bus-stop-road', name: 'Road', status: 'unknown', text: 'The stop is not on a drawn road, so nothing along the road was screened.', basis: 'UrbanOS placement' })];
  const xs = roadXs(road);
  const ch = el.anchor.chainageM;

  // Spacing to the next stop on the same road (CoP-1 §5.9: 500 m – 1 km)
  const others = objects.filter((o): o is StreetElementObject => o.type === 'street_element' && o.kind === 'bus_stop' && o.id !== el.id && o.anchor?.roadId === road.id)
    // a stop on the other side of the street serves the other direction
    .filter(o => s.placement === 'median_brt' || o.anchor!.side === el.anchor!.side)
    .map(o => Math.abs(o.anchor!.chainageM - ch)).sort((a, b) => a - b);
  const near = others[0];
  out.push(sdCheck({ id: 'bus-stop-spacing', name: 'Spacing to the next stop', unit: 'm',
    status: near == null ? 'info' : near < SD.busStopSpacingMinM.value - 1e-6 || near > SD.busStopSpacingMaxM.value + 1e-6 ? 'warn' : 'pass', actual: near == null ? null : Math.round(near), required: SD.busStopSpacingMinM.value,
    text: near == null ? 'No other stop drawn on this road in this direction; CoP Part 1 recommends 500 m – 1 km between stops. Existing PMPML stops are not loaded.'
      : near < 500 ? `${Math.round(near)} m to the next drawn stop is under the 500 m CoP Part 1 recommends (shorter is allowed near schools / offices).`
      : near > 1000 ? `${Math.round(near)} m to the next drawn stop is more than 1 km.` : `${Math.round(near)} m — within CoP Part 1's 500 m – 1 km.`,
    basis: basisOf('busStopSpacingMinM', 'busStopSpacingMaxM') }));

  // Distance from the nearest junction (USDG: ~50 m away from any junction)
  const js = junctionChainages(road, objects);
  const dj = js.length ? Math.min(...js.map(j => Math.abs(j - ch))) : null;
  out.push(sdCheck({ id: 'bus-stop-junction', name: 'Distance from the nearest junction', unit: 'm',
    status: dj == null ? 'unknown' : dj < SD.busStopFromJunctionM.value - 1e-6 ? 'warn' : 'pass', actual: dj == null ? null : Math.round(dj), required: SD.busStopFromJunctionM.value,
    text: dj == null ? 'No junction found on this road in the loaded map.' : dj < 50 ? `${Math.round(dj)} m from a junction; Pune USDG places stops about 50 m away from any junction (CoP Part 1 prefers the near side).`
      : `${Math.round(dj)} m from the nearest junction — no flag against USDG's 50 m.`,
    basis: basisOf('busStopFromJunctionM') }));

  // Shelter and the clear walking zone
  const fp = el.anchor.side === 'left' ? xs.footpathLeftM : xs.footpathRightM;
  if (s.placement === 'kerb') {
    const left = fp - s.shelterDepthM;
    out.push(sdCheck({ id: 'bus-stop-clear-walk', name: 'Clear walkway past the shelter', status: fp <= 0 ? 'unknown' : left < SD.clearWalkM.value - 1e-6 ? 'fail' : 'pass', actual: fp <= 0 ? null : r2(left), required: SD.clearWalkM.value,
      text: fp <= 0 ? 'No footpath recorded on this side, so the walkway past the shelter was not screened.'
        : left < 2 ? `A ${fmtM(s.shelterDepthM)} deep shelter on a ${fmtM(fp)} footpath leaves ${fmtM(left)}, below the 2 m clear walking zone; USDG puts the stop in the parking / furniture strip instead.`
        : `${fmtM(left)} left past the shelter — no flag against USDG's 2 m clear walking zone.`,
      basis: basisOf('clearWalkM', 'busShelterDepthM') }));
  } else if (s.placement === 'bay') {
    const strip = (el.anchor.side === 'left' ? xs.parkingLeftM + xs.vergeLeftM : xs.parkingRightM + xs.vergeRightM);
    out.push(sdCheck({ id: 'bus-stop-bay', name: 'Shelter in the parking / furniture strip', status: strip <= 0 ? 'unknown' : strip < s.shelterDepthM - 1e-6 ? 'warn' : 'pass', actual: strip > 0 ? r2(strip) : null, required: s.shelterDepthM,
      text: strip <= 0 ? 'No parking or furniture strip recorded on this side.' : strip < s.shelterDepthM ? `The ${fmtM(strip)} strip is narrower than the ${fmtM(s.shelterDepthM)} shelter.` : `${fmtM(strip)} strip holds the ${fmtM(s.shelterDepthM)} shelter; the walkway is untouched.`,
      basis: basisOf('busShelterDepthM', 'clearWalkM') }));
  } else {
    const inner = s.stationInnerM, outer = s.stationOuterM;
    out.push(sdCheck({ id: 'bus-stop-brt-station', name: 'BRT median station width', status: inner == null || outer == null ? 'unknown' : inner < SD.brtStationInnerM.value - 1e-6 || outer < SD.brtStationOuterM.value - 1e-6 ? 'fail' : 'pass',
      actual: inner ?? null, required: SD.brtStationInnerM.value,
      text: inner == null || outer == null ? 'Station widths not entered (IRC:124: inner clear ≥ 3.5 m, outer ≥ 4 m).' : `Inner ${fmtM(inner)} / outer ${fmtM(outer)} against IRC:124's 3.5 m / 4 m.`,
      basis: basisOf('brtStationInnerM', 'brtStationOuterM') }));
    if (road.busPriority?.kind !== 'brt') out.push(sdCheck({ id: 'bus-stop-brt-lane', name: 'BRT lane on the road', status: 'warn', text: `${road.name || 'This road'} has no BRT upgrade: a median station needs median bus lanes (apply BRT in the road inspector).`, basis: basisOf('brtLaneM') }));
  }

  // Parking kept clear (USDG: 50 m before, 20 m after)
  const parking = (el.anchor.side === 'left' ? xs.parkingLeftM : xs.parkingRightM) > 0;
  out.push(sdCheck({ id: 'bus-stop-parking', name: 'No-parking zone', status: parking ? 'info' : 'pass', actual: parking ? SD.busStopNoParkBeforeM.value + SD.busStopNoParkAfterM.value : 0, required: null,
    text: parking ? `This side has a parking strip: USDG keeps it clear 50 m before and 20 m after the stop (${SD.busStopNoParkBeforeM.value + SD.busStopNoParkAfterM.value} m of kerb plus the stop).` : 'No parking strip on this side.',
    basis: basisOf('busStopNoParkBeforeM', 'busStopNoParkAfterM') }));
  out.push(sdCheck({ id: 'bus-stop-model', name: 'Effect in Simulate', status: 'info', unit: '', text: 'None: buses are not a separate mode in the model and no Indian capacity factor for a kerb-side stop was read. The stop is in the report.', basis: 'UrbanOS model scope' }));
  return out;
}
