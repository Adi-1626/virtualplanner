/**
 * #8 Standalone footpaths, cycle tracks, shared paths, foot-over-bridges (FOB) and subways
 * (docs/urbanos/DESIGN_TOOLS_P7.md §8). A drawn line with a type and a level.
 *
 * Checks (screening): cycle track ≥ 2 m one-way / 3 m two-way and 0.5 m buffer (IRC:86 §5.2); IRC:11 two-lane minimum
 * 2.2 m, desirable 2.5–5 m, shared footpath + cycle track 3–4 m for ≤ 40 m (Table 4); footpath ≥ 1.8 m (IRC:86 Table 5.1)
 * and 2 m clear (USDG); FOB / subway "discouraged … increase the walking distance" (IRC:86 §5.1.9, Annexure I), ramp
 * 1:20 and a lift mandatory, subway ≥ 2.5 m × 2.75 m (5 / 6.5 m when combined with cycles); FOB clear height over the
 * road ≥ 5.5 m urban (IRC:54 §8); footway / cycle clearance under any structure ≥ 2.25 m (IRC:SP:90 §4.18.3).
 * IRC:103 (pedestrian facilities, 2022) was not obtainable (catalogue + drafts only): its ramp and stair values stay
 * unknown.
 *
 * Network effect: none — pedestrians and cyclists are not modelled; said so. A subway is sent to the Underground
 * utilities check as a box (when one is near); a FOB's piers are not modelled.
 */
import type { CityObject, StreetElementObject, UtilityObject } from '../objects/types';
import type { PathSpec } from './types';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { crossings, lengthM, projectOnLine } from './geom';

export const DEFAULT_PATH: PathSpec = { pathType: 'footpath', level: 'ground', widthM: 2.0, clearHeightM: null, rampGradient: null, hasLift: false, bufferM: null };

export const PATH_LABEL: Record<PathSpec['pathType'], string> = { footpath: 'Footpath', cycle_one_way: 'Cycle track (one-way)', cycle_two_way: 'Cycle track (two-way)', shared: 'Shared footpath + cycle track' };
export const LEVEL_LABEL: Record<PathSpec['level'], string> = { ground: 'At ground level', fob: 'Foot-over-bridge (FOB)', subway: 'Subway' };

export function pathChecks(el: StreetElementObject, objects: readonly CityObject[]): SdCheck[] {
  const p = el.path ?? DEFAULT_PATH;
  const out: SdCheck[] = [];
  const L = lengthM(el.coordinates);
  const w = p.widthM;

  // Width by type
  if (p.pathType === 'footpath') {
    out.push(sdCheck({ id: 'path-width', name: 'Footpath width', status: w < SD.footpathMinM.value - 1e-6 ? 'fail' : w < SD.clearWalkM.value - 1e-6 ? 'warn' : 'pass', actual: r2(w), required: SD.clearWalkM.value,
      text: w < 1.8 ? `${fmtM(w)} is below IRC:86's 1.8 m pedestrian zone.` : w < 2 ? `${fmtM(w)} meets IRC:86 1.8 m but not USDG's 2 m clear walking zone.` : `${fmtM(w)} — no flag against 1.8 m (IRC:86) / 2 m (USDG).`,
      basis: basisOf('footpathMinM', 'clearWalkM') }));
  } else if (p.pathType === 'shared') {
    out.push(sdCheck({ id: 'path-width', name: 'Shared path width', status: w < SD.sharedPathMinM.value - 1e-6 ? 'fail' : L > 40 ? 'warn' : 'pass', actual: r2(w), required: SD.sharedPathMinM.value,
      text: w < 3 ? `${fmtM(w)} is below the 3 m IRC:11 gives a common cycle track and footpath.`
        : L > 40 ? `${fmtM(w)} meets 3 m, but IRC:11 allows a common cycle track and footpath for not more than 40 m (this one is ${Math.round(L)} m).` : `${fmtM(w)} over ${Math.round(L)} m — no flag against IRC:11 (3–4 m, ≤ 40 m).`,
      basis: basisOf('sharedPathMinM') }));
  } else {
    const two = p.pathType === 'cycle_two_way';
    const irc86 = two ? SD.cycleTwoWayMinM.value : SD.cycleOneWayMinM.value;
    out.push(sdCheck({ id: 'path-width', name: 'Cycle track width', status: w < (two ? SD.cycleIrc11TwoLaneMinM.value : irc86) - 1e-6 ? 'fail' : w < irc86 - 1e-6 || w < SD.cycleIrc11DesirableM.value - 1e-6 ? 'warn' : 'pass',
      actual: r2(w), required: irc86,
      text: `${fmtM(w)} against IRC:86's ${irc86} m ${two ? 'two-way' : 'one-way'} cycle track${two ? ' (IRC:11: 2.2 m minimum for two lanes)' : ''} and IRC:11's desirable 2.5–5 m.`,
      basis: basisOf(two ? 'cycleTwoWayMinM' : 'cycleOneWayMinM', 'cycleIrc11TwoLaneMinM', 'cycleIrc11DesirableM') }));
    if (p.level === 'ground') out.push(sdCheck({ id: 'path-buffer', name: 'Buffer to the carriageway', status: p.bufferM == null ? 'unknown' : p.bufferM < SD.cycleBufferM.value - 1e-6 ? 'fail' : 'pass', actual: p.bufferM ?? null, required: SD.cycleBufferM.value,
      text: p.bufferM == null ? 'Buffer not entered (needed where the track runs beside a carriageway or parking).' : p.bufferM < 0.5 ? `${fmtM(p.bufferM)} is below the 0.5 m buffer.` : `${fmtM(p.bufferM)} — no flag against 0.5 m.`,
      basis: basisOf('cycleBufferM') }));
  }

  // Grade separation
  if (p.level !== 'ground') {
    out.push(sdCheck({ id: 'path-grade-separated', name: 'Grade-separated crossing', status: 'warn', unit: '', actual: null, required: null,
      text: `IRC:86: foot-over-bridges and subways "increase the walking distance … and therefore discouraged"; Pune USDG: consider them only as a last option and never at intersections. Compare with an at-grade crossing (Crossing tool).`,
      basis: basisOf('fobRampSlope') }));
    const g = p.rampGradient;
    out.push(sdCheck({ id: 'path-ramp', name: 'Ramp and lift', status: g == null && !p.hasLift ? 'unknown' : (g != null && g > SD.fobRampSlope.value + 1e-9) || !p.hasLift ? 'warn' : 'pass', actual: g != null ? r2(1 / g) : null, required: 20, unit: '1:n',
      text: `${g != null ? `Ramp 1:${r2(1 / g)}` : 'Ramp gradient not entered'}; lift ${p.hasLift ? 'provided' : 'not provided'}. IRC:86 Annexure I: ramp 1:20 with landings, a ramp or lift is mandatory, lifts at both entrances (≥ 1.5 × 1.5 m). IRC:103 stair / ramp values: not obtainable (unknown).`,
      basis: basisOf('fobRampSlope', 'fobLiftM') }));
  }
  if (p.level === 'subway') {
    const combined = p.pathType !== 'footpath';
    const minW = combined ? (p.pathType === 'cycle_two_way' || p.pathType === 'shared' ? SD.subwayCombinedTwoWayM.value : SD.subwayCombinedOneWayM.value) : SD.subwayMinWidthM.value;
    const h = p.clearHeightM;
    out.push(sdCheck({ id: 'path-subway-size', name: 'Subway width and height', status: w < minW - 1e-6 || (h != null && h < SD.subwayMinHeightM.value - 1e-6) ? 'fail' : h == null ? 'unknown' : 'pass',
      actual: r2(w), required: minW,
      text: `Width ${fmtM(w)} against ${minW} m${combined ? ' (combined cycle + pedestrian subway)' : ''}; clear height ${h != null ? fmtM(h) : 'not entered'} against 2.75 m.`,
      basis: basisOf('subwayMinWidthM', 'subwayMinHeightM', 'subwayCombinedOneWayM', 'subwayCombinedTwoWayM') }));
    // Underground: utilities the subway crosses (records only; depths of both often unknown)
    const hits = objects.filter((o): o is UtilityObject => o.type === 'utility' && o.coordinates.length >= 2 && (crossings(el.coordinates, o.coordinates).length > 0
      || el.coordinates.some(c => (projectOnLine(o.coordinates, c)?.distanceM ?? Infinity) <= w / 2)));
    const anyUtil = objects.some(o => o.type === 'utility');
    out.push(sdCheck({ id: 'path-subway-utilities', name: 'Utilities crossed by the subway', status: hits.length ? 'warn' : anyUtil ? 'pass' : 'unknown', actual: hits.length, required: null, unit: 'lines',
      text: hits.length ? `${hits.length} recorded utility line(s) cross the subway (${hits.slice(0, 3).map(u => `${u.name || u.utilityType}`).join(', ')}): requires investigation / diversion study. Run the Underground check for depths.`
        : anyUtil ? 'No recorded utility line crosses it (records only).' : 'No utility records loaded here: not screened (absence of records is not absence of utilities).',
      basis: 'Utility records in the scene (Underground workspace)' }));
  }
  if (p.level === 'fob') {
    const h = p.clearHeightM;
    out.push(sdCheck({ id: 'path-fob-clearance', name: 'Clearance over the road', status: h == null ? 'unknown' : h < SD.fobRoadClearanceM.value - 1e-6 ? 'fail' : 'pass', actual: h ?? null, required: SD.fobRoadClearanceM.value,
      text: h == null ? 'Clear height over the road not entered.' : h < 5.5 ? `${fmtM(h)} is below the 5.5 m IRC:54 gives for urban areas (5 m elsewhere).` : `${fmtM(h)} — no flag against 5.5 m (IRC:54, urban).`,
      basis: basisOf('fobRoadClearanceM') }));
    const roads = objects.filter(o => o.type === 'road' && crossings(el.coordinates, o.coordinates).length > 0).length;
    out.push(sdCheck({ id: 'path-fob-roads', name: 'Roads crossed', status: roads ? 'info' : 'warn', actual: roads, required: null, unit: 'roads',
      text: roads ? `The FOB spans ${roads} drawn road(s).` : 'The FOB does not cross any drawn road.', basis: 'Plan geometry' }));
  }
  // Under a structure (flyover / metro / double-deck deck over the path)
  if (p.level === 'ground') {
    const over = objects.filter(o => (o.type === 'flyover' || o.type === 'metro_flyover' || o.type === 'metro_line') && crossings(el.coordinates, o.coordinates).length > 0);
    if (over.length) {
      const lowest = Math.min(...over.map(o => (o as { elevation?: number }).elevation ?? NaN).filter(Number.isFinite));
      out.push(sdCheck({ id: 'path-under-structure', name: 'Clearance under a structure', status: !Number.isFinite(lowest) ? 'unknown' : lowest - 2 < SD.structureFootwayClearanceM.value ? 'warn' : 'pass',
        actual: Number.isFinite(lowest) ? r2(lowest) : null, required: SD.structureFootwayClearanceM.value,
        text: Number.isFinite(lowest) ? `Passes under ${over.length} structure(s); lowest deck ${fmtM(lowest)} above ground (deck depth not known, 2 m assumed) against 2.25 m for footways / cycle tracks.` : 'Deck height not recorded.',
        basis: basisOf('structureFootwayClearanceM') }));
    }
  }
  out.push(sdCheck({ id: 'path-model', name: 'Effect in Simulate', status: 'info', unit: '', actual: null, required: null,
    text: 'None: pedestrians and cyclists are not modelled (no mode shift, no walk / cycle times). The path is in the report with its length.', basis: 'UrbanOS model scope' }));
  return out;
}
