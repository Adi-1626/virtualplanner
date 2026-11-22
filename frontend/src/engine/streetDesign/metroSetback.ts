/**
 * #6 Metro corridor setback and clearance screen (docs/urbanos/DESIGN_TOOLS_P7.md §6). A check on the existing elevated
 * metro objects (Metro line, Double-deck), no new object.
 *
 * Source: Maha-Metro, Pune Metro Phase-2 DPR (July 2024), official:
 *  - §5.9.2 p. 5-80: the Phase-1 viaduct is "about 8.5 m (edge to edge)"; "a clean marginal distance / setback of about
 *    5 m is necessary from either edge of the viaduct (or 10 m on both sides of the centre line) wherein no structures are
 *    to be located";
 *  - §5.7.1.2 p. 5-62: road clearance 5.5 m beyond the crash-barrier face, "the minimum height of rail above the existing
 *    road is 8.4 m"; circular pier 2–3 m diameter with a 1.0 m high Jersey crash barrier, 25 mm gap.
 * The setback is a DPR planning distance, screened here in plan from the drawn centreline: a flag means "inside the
 * setback the DPR keeps free of structures", never an engineering clearance or a legal finding.
 */
import type { BuildingObject, CityObject, FlyoverObject, MetroFlyoverObject, MetroLineObject, RoadObject } from '../objects/types';
import { isUnmappedMetroTunnel } from '../underground/metroLevel';
import { isUserBuilt } from '../objects/builtBy';
import { SD } from './sources';
import { basisOf, fmtM, r2, sdCheck, type SdCheck } from './checks';
import { crossings, lengthM, pointAtChainage, polygonLineDistanceM, projectOnLine } from './geom';

export type MetroViaduct = MetroLineObject | MetroFlyoverObject;

/** An elevated metro object: a metro line that is not a tunnel and stands above ground, or a double-deck. */
export function isMetroViaduct(o: CityObject): o is MetroViaduct {
  if (o.type === 'metro_flyover') return true;
  if (o.type !== 'metro_line') return false;
  const m: MetroLineObject = o;
  const tunnel: boolean = isUnmappedMetroTunnel(m);
  return !tunnel && (m.elevation ?? 0) > 0;
}

/**
 * Viaduct width used for the setback: a metro line's own deck width; a double-deck stores no metro deck width, so the
 * Pune Phase-1 viaduct width (8.5 m, DPR §5.9.2) is used and said so.
 */
export function viaductWidth(m: MetroViaduct): { widthM: number; fromObject: boolean } {
  if (m.type === 'metro_line' && Number.isFinite(m.deckWidth) && m.deckWidth > 0) return { widthM: m.deckWidth, fromObject: true };
  return { widthM: SD.metroViaductWidthM.value, fromObject: false };
}

/** Distance from the centreline within which no structure is to be located: half the viaduct width + 5 m. */
export function setbackFromCentrelineM(m: MetroViaduct): number {
  return viaductWidth(m).widthM / 2 + SD.metroSetbackM.value;
}

/** Rail level above the ground (m): a metro line's stored deck height, a double-deck's metro deck height. */
export const railLevelM = (m: MetroViaduct) => (m.type === 'metro_flyover' ? m.metroElevation : m.elevation);

/** Positions of a flyover's piers in plan (first half a spacing in, then every pier spacing), as the 3D view places them. */
function pierPoints(f: FlyoverObject | MetroFlyoverObject): [number, number, number][] {
  const line = f.groundCoordinates?.length ? f.groundCoordinates : f.coordinates;
  const L = lengthM(line), s = f.pierSpacing > 0 ? f.pierSpacing : 30;
  const out: [number, number, number][] = [];
  for (let ch = s / 2; ch < L; ch += s) { const p = pointAtChainage(line, ch); if (p) out.push(p.point); }
  return out;
}

export interface SetbackHit {
  objectId: string;
  name: string;
  what: 'building' | 'flyover pier' | 'double-deck pier';
  /** Shortest plan distance to the metro centreline (m). */
  distanceM: number;
  /** Drawn in Design (a proposal or the user's own) vs imported (OpenStreetMap). */
  userBuilt: boolean;
}

/** Structures inside the setback of one viaduct. */
export function setbackHits(m: MetroViaduct, objects: readonly CityObject[]): SetbackHit[] {
  const line = m.coordinates;
  if (line.length < 2) return [];
  const lim = setbackFromCentrelineM(m);
  const out: SetbackHit[] = [];
  for (const o of objects) {
    if (o.id === m.id) continue;
    if (o.type === 'building') {
      const ring = (o as BuildingObject).coordinates;
      if (ring.length < 3) continue;
      const d = polygonLineDistanceM(ring, line);
      if (d <= lim + 1e-6) out.push({ objectId: o.id, name: o.name || o.id, what: 'building', distanceM: r2(d), userBuilt: isUserBuilt(o) });
    } else if (o.type === 'flyover' || (o.type === 'metro_flyover' && m.type !== 'metro_flyover')) {
      // A double-deck carries its own metro deck on its piers: they are the viaduct's piers, not a structure in its setback
      let best = Infinity;
      for (const p of pierPoints(o)) { const pr = projectOnLine(line, p); if (pr) best = Math.min(best, pr.distanceM); }
      if (best <= lim + 1e-6) out.push({ objectId: o.id, name: o.name || o.id, what: o.type === 'flyover' ? 'flyover pier' : 'double-deck pier', distanceM: r2(best), userBuilt: isUserBuilt(o) });
    }
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/** Roads (at grade) the viaduct passes over in plan, with where. */
export function roadsUnder(m: MetroViaduct, objects: readonly CityObject[]): { road: RoadObject; at: [number, number, number]; chainageM: number }[] {
  const out: { road: RoadObject; at: [number, number, number]; chainageM: number }[] = [];
  for (const o of objects) {
    if (o.type !== 'road' || o.id === m.id) continue;
    for (const x of crossings(m.coordinates, o.coordinates)) out.push({ road: o, at: x.point, chainageM: x.chainageA });
  }
  return out.sort((a, b) => a.chainageM - b.chainageM);
}

/** Median width of the road the viaduct runs along (its centre within 2 m of the road centreline for most of its length), or null. */
function medianAlong(m: MetroViaduct, objects: readonly CityObject[]): { road: RoadObject; medianM: number | null; share: number } | null {
  const line = m.coordinates;
  const L = lengthM(line);
  if (L < 1) return null;
  const n = Math.max(2, Math.min(60, Math.round(L / 20)));
  const samples = Array.from({ length: n }, (_, i) => pointAtChainage(line, (i + 0.5) * L / n)?.point).filter(Boolean) as [number, number, number][];
  let best: { road: RoadObject; share: number } | null = null;
  for (const o of objects) {
    if (o.type !== 'road') continue;
    const hit = samples.filter(p => (projectOnLine(o.coordinates, p)?.distanceM ?? Infinity) <= 2).length / samples.length;
    if (hit > 0.5 && (!best || hit > best.share)) best = { road: o, share: hit };
  }
  if (!best) return null;
  const sec = best.road.sections?.[0];
  const medianM = sec ? (sec.hasMedian ? sec.medianWidth ?? 0 : 0) : best.road.hasDivider ? best.road.dividerWidth ?? 0 : 0;
  return { road: best.road, medianM, share: best.share };
}

/** All screening checks of one elevated metro object against the scenario's objects. */
export function metroCorridorChecks(m: MetroViaduct, objects: readonly CityObject[]): SdCheck[] {
  const out: SdCheck[] = [];
  const vw = viaductWidth(m);
  const lim = setbackFromCentrelineM(m);
  const setBasis = basisOf('metroSetbackM', ...(vw.fromObject ? [] : ['metroViaductWidthM' as const]));

  // 1. Setback: 5 m clear from each viaduct edge
  const hits = setbackHits(m, objects);
  const widthNote = vw.fromObject ? `deck width ${fmtM(vw.widthM)} as drawn` : `viaduct width ${fmtM(vw.widthM)} (Pune Phase-1, DPR; the double-deck stores no metro deck width)`;
  if (!hits.length) out.push(sdCheck({ id: 'metro-setback', name: 'Structures within the 5 m metro setback', status: 'pass', actual: 0, required: lim, unit: 'm',
    text: `No building or drawn pier found within ${fmtM(lim)} of the centreline (${widthNote} / 2 + 5 m). Buildings are those loaded on the map; unmapped structures are not screened.`, basis: setBasis }));
  else {
    const proposed = hits.filter(h => h.userBuilt), existing = hits.filter(h => !h.userBuilt);
    const list = (hs: SetbackHit[]) => hs.slice(0, 5).map(h => `${h.name} (${h.what}, ${fmtM(h.distanceM)})`).join('; ') + (hs.length > 5 ? `; +${hs.length - 5} more` : '');
    if (proposed.length) out.push(sdCheck({ id: 'metro-setback-proposed', name: 'Drawn structures within the 5 m metro setback', status: 'fail', actual: proposed[0].distanceM, required: lim, unit: 'm',
      text: `${proposed.length} drawn structure(s) within ${fmtM(lim)} of the centreline, where the DPR keeps no structures: ${list(proposed)}.`, basis: setBasis }));
    if (existing.length) out.push(sdCheck({ id: 'metro-setback-existing', name: 'Mapped buildings within the 5 m metro setback', status: 'warn', actual: existing[0].distanceM, required: lim, unit: 'm',
      text: `${existing.length} mapped building(s) within ${fmtM(lim)} of the centreline (footprints from the map, positions estimated): ${list(existing)}. The alignment may need land or a shift here.`, basis: setBasis }));
  }

  // 2. Rail level over roads (8.4 m minimum rail height above the existing road)
  const rail = railLevelM(m);
  const minRail = SD.metroMinRailOverRoadM.value;
  const under = roadsUnder(m, objects);
  if (!Number.isFinite(rail)) out.push(sdCheck({ id: 'metro-rail-over-road', name: 'Rail level over roads', status: 'unknown', actual: null, required: minRail,
    text: 'The deck height is not recorded.', basis: basisOf('metroMinRailOverRoadM') }));
  else if (rail < minRail - 1e-6) out.push(sdCheck({ id: 'metro-rail-over-road', name: 'Rail level over roads', status: under.length ? 'fail' : 'warn', actual: r2(rail), required: minRail,
    text: under.length ? `Deck ${fmtM(rail)} above ground is below the 8.4 m minimum rail height above the road, and the line passes over ${under.length} road crossing(s) (first: ${under[0].road.name || under[0].road.id}). The stored deck height is taken as the rail level.`
      : `Deck ${fmtM(rail)} above ground is below the 8.4 m minimum rail height wherever it passes over a road (no drawn road crossing found). The stored deck height is taken as the rail level.`,
    basis: basisOf('metroMinRailOverRoadM') }));
  else out.push(sdCheck({ id: 'metro-rail-over-road', name: 'Rail level over roads', status: 'pass', actual: r2(rail), required: minRail,
    text: `Deck ${fmtM(rail)} — no flag against the 8.4 m minimum rail height above the road${under.length ? ` (${under.length} road crossing(s))` : ''}. Ground under the line is taken as the road level.`, basis: basisOf('metroMinRailOverRoadM') }));

  // 3. Double-deck: rail above the road deck it stands over
  if (m.type === 'metro_flyover') {
    const gap = m.metroElevation - m.elevation;
    out.push(sdCheck({ id: 'metro-rail-over-deck', name: 'Rail level above the road deck', status: gap < minRail - 1e-6 ? 'fail' : 'pass', actual: r2(gap), required: minRail,
      text: gap < minRail - 1e-6 ? `Metro deck ${fmtM(m.metroElevation)} is ${fmtM(gap)} above the road deck (${fmtM(m.elevation)}), below the 8.4 m minimum rail height above a road the DPR uses for 5.5 m road clearance.`
        : `Metro deck ${fmtM(gap)} above the road deck — no flag against the 8.4 m minimum rail height above a road.`,
      basis: basisOf('metroMinRailOverRoadM', 'metroRoadClearanceM') }));
  }

  // 4. Pier with its crash-barrier ring inside the median of the road it runs along
  const med = medianAlong(m, objects);
  const pier = SD.metroPierDiaMinM.value, gap = SD.metroPierBarrierGapM.value;
  const need = pier + 2 * gap;
  const pierBasis = basisOf('metroPierDiaMinM', 'metroPierBarrierGapM');
  if (!med) out.push(sdCheck({ id: 'metro-pier-median', name: 'Pier in the median', status: 'info', actual: null, required: need,
    text: 'The line does not run along a drawn road centreline, so the pier position in a median was not screened.', basis: pierBasis }));
  else if (med.medianM === null || med.medianM <= 0) out.push(sdCheck({ id: 'metro-pier-median', name: 'Pier in the median', status: 'warn', actual: 0, required: need,
    text: `${med.road.name || med.road.id} (the road the line runs along) has no median recorded; a single ${fmtM(pier)}–3 m pier with a crash barrier around it needs one, or another location.`, basis: pierBasis }));
  else if (med.medianM < need - 1e-6) out.push(sdCheck({ id: 'metro-pier-median', name: 'Pier in the median', status: 'fail', actual: r2(med.medianM), required: need,
    text: `Median ${fmtM(med.medianM)} of ${med.road.name || med.road.id} is narrower than the smallest pier (${fmtM(pier)}) plus the 25 mm gaps to its crash barrier (${fmtM(need)}), before the barrier itself.`, basis: pierBasis }));
  else out.push(sdCheck({ id: 'metro-pier-median', name: 'Pier in the median', status: 'unknown', actual: r2(med.medianM), required: need,
    text: `Median ${fmtM(med.medianM)} of ${med.road.name || med.road.id} holds a ${fmtM(pier)} pier with the 25 mm gaps (${fmtM(need)}); the crash barrier's base width is not given in the DPR text read, so whether the barrier ring fits is not known.`, basis: pierBasis }));
  return out;
}
