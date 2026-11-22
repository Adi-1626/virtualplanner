/** What a road's stored profile says about its street, for the street design tools (first section profile, as the network). */
import type { CityObject, RoadObject } from '../objects/types';
import { projectOnLine, type LngLat } from './geom';

export interface RoadXs {
  lanesFwd: number;
  lanesBwd: number;
  laneW: number;
  medianM: number;
  /** Carriageway(s) plus median, kerb to kerb (m). */
  carriagewayM: number;
  /** Width of one direction's carriageway (m). */
  halfCarriagewayM: number;
  footpathLeftM: number;
  footpathRightM: number;
  /** Furniture / verge strip, cycle track, parking each side (m). */
  vergeLeftM: number;
  vergeRightM: number;
  parkingLeftM: number;
  parkingRightM: number;
  /** Total of the drawn strips (m) — not the available right-of-way. */
  drawnWidthM: number;
  oneWay: boolean;
}

export function roadXs(r: RoadObject): RoadXs {
  const sec = r.sections?.[0];
  const laneW = (sec?.carriagewayA?.laneWidth ?? r.laneWidth ?? 3.5) || 3.5;
  const total = Math.max(1, r.laneCount || 2);
  const lanesFwd = sec?.carriagewayA ? sec.carriagewayA.lanes : Math.max(1, Math.ceil(total / (r.isOneWay ? 1 : 2)));
  const lanesBwd = sec?.carriagewayB && sec.carriagewayB.lanes > 0 ? sec.carriagewayB.lanes : r.isOneWay ? 0 : Math.max(1, Math.floor(total / 2));
  const medianM = sec ? (sec.hasMedian ? sec.medianWidth ?? 0 : 0) : r.hasDivider ? r.dividerWidth ?? 0 : 0;
  const L = sec?.carriagewayA?.leftRoadside, R = (sec?.carriagewayB ?? sec?.carriagewayA)?.rightRoadside;
  const fpL = L ? L.footpathWidth : r.hasFootpath ? r.footpathWidth ?? 0 : 0;
  const fpR = R ? R.footpathWidth : r.hasFootpath ? r.footpathWidth ?? 0 : 0;
  const carriagewayM = (lanesFwd + lanesBwd) * laneW + medianM;
  const side = (s?: typeof L) => (s ? s.vergeWidth + s.cycleTrackWidth : 0);
  const vL = side(L), vR = side(R), pL = L?.parkingWidth ?? 0, pR = R?.parkingWidth ?? 0;
  return { lanesFwd, lanesBwd, laneW, medianM, carriagewayM, halfCarriagewayM: Math.max(lanesFwd, lanesBwd) * laneW, footpathLeftM: fpL, footpathRightM: fpR,
    vergeLeftM: vL, vergeRightM: vR, parkingLeftM: pL, parkingRightM: pR, drawnWidthM: carriagewayM + fpL + fpR + vL + vR + pL + pR, oneWay: !!r.isOneWay };
}

/** The nearest drawable road (type road, at grade) to a point within `maxM`, with the projection. */
export function nearestRoad(objects: readonly CityObject[], at: LngLat, maxM = 30): { road: RoadObject; chainageM: number; offsetM: number; distanceM: number; dir: [number, number] } | null {
  let best: { road: RoadObject; chainageM: number; offsetM: number; distanceM: number; dir: [number, number] } | null = null;
  for (const o of objects) {
    if (o.type !== 'road' || o.coordinates.length < 2) continue;
    // A road on a bridge / flyover level is not where a crossing or a bus stop goes
    if (o.osmProvenance && (o.osmProvenance.bridge || o.osmProvenance.tunnel)) continue;
    const p = projectOnLine(o.coordinates, at);
    if (p && p.distanceM <= maxM && (!best || p.distanceM < best.distanceM)) best = { road: o, chainageM: p.chainageM, offsetM: p.offsetM, distanceM: p.distanceM, dir: p.dir };
  }
  return best;
}
