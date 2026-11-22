/**
 * Street design → Simulate (docs/urbanos/BUILD_PROPAGATION.md, DESIGN_TOOLS_P7.md "Downstream"). Simulate reads roads;
 * street elements reach it by riding on the roads they act on, as `streetEffects` on a COPY of the road (the stored road
 * is never changed), so the network key, the stale marker, the proposal / Base split and Undo all follow automatically:
 *  - bus lane / BRT (road.busPriority): one general-traffic lane fewer per listed direction (busLane.ts);
 *  - signalised mid-block crossing: a two-phase signal on the road's links through the crossing (crossings.ts);
 *  - roundabout: its junction's approaches lose their signal and get IRC:65 entry capacity (roundabout.ts).
 * Zebra / raised crossings, bus stops, lights, trees and paths change nothing in the model (each tool says why).
 */
import type { CityObject, RoadObject, StreetElementObject } from '../objects/types';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { isDrivable } from '../simulation/StudyAreaExplorer';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';
import { isSampleObject } from '../objects/sampleObjects';
import { roadForGeneralTraffic, lanesTaken } from './busLane';
import { midblockSignal } from './crossings';
import { SD } from './sources';

export interface MidblockSignalEffect { elementId: string; point: [number, number]; gC: number; cycleS: number }
export interface RoundaboutEffect { elementId: string; nodeKeys: string[]; icdM: number; entryLanes: number; qcPcu: number }

export interface StreetEffects {
  busLanesTaken?: { fwd: number; bwd: number };
  midblockSignals?: MidblockSignalEffect[];
  roundabouts?: RoundaboutEffect[];
}

export const isStreetElement = (o: CityObject): o is StreetElementObject => o.type === 'street_element';

/** The roads with the street elements' effects on copies; roads without any are returned as they are (same object). */
export function applyStreetDesign<T extends DrivableObject>(roads: readonly T[], elements: readonly StreetElementObject[]): T[] {
  const byRoad = new Map<string, StreetEffects>();
  const add = (id: string, f: (e: StreetEffects) => void) => { const e = byRoad.get(id) ?? {}; f(e); byRoad.set(id, e); };
  const roadById = new Map(roads.map(r => [r.id, r]));
  for (const el of elements) {
    if (el.kind === 'crossing' && el.crossing?.crossingType === 'signalised' && el.anchor) {
      const road = roadById.get(el.anchor.roadId);
      if (!road || road.type !== 'road') continue;
      const t = midblockSignal(el.crossing, road as RoadObject);
      if (t) add(road.id, e => { (e.midblockSignals ??= []).push({ elementId: el.id, point: [el.coordinates[0][0], el.coordinates[0][1]], gC: t.gC, cycleS: t.cycleS }); });
    } else if (el.kind === 'roundabout' && el.roundabout) {
      const rb = el.roundabout;
      const eff: RoundaboutEffect = { elementId: el.id, nodeKeys: [...rb.nodeKeys], icdM: rb.icdM, entryLanes: rb.entryLanes, qcPcu: SD.rbAssumedQcPcu.value };
      for (const id of rb.armRoadIds) if (roadById.has(id)) add(id, e => { (e.roundabouts ??= []).push(eff); });
    }
  }
  return roads.map(r => {
    let out: T = r;
    if (r.type === 'road' && r.busPriority) {
      out = roadForGeneralTraffic(r) as T;
      const eff = byRoad.get(r.id) ?? {};
      eff.busLanesTaken = lanesTaken(r.busPriority);
      byRoad.set(r.id, eff);
    }
    const eff = byRoad.get(r.id);
    if (!eff) return out;
    return { ...out, streetEffects: eff } as T;
  });
}

/**
 * The roads Simulate gets for a scenario: its view (base ⊕ its changes), drivable, without the illustrative sample
 * objects, with the street elements' effects. TwinCityEngine hands this to SimulationMode (which then applies the
 * network corrections and urban speeds).
 */
export function simulationRoads(all: readonly CityObject[], scenarioId: string): DrivableObject[] {
  const view = filterObjectsForScenario(all as CityObject[], scenarioId).filter(o => !isSampleObject(o));
  return applyStreetDesign(view.filter(isDrivable), view.filter(isStreetElement));
}
