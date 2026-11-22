/**
 * Placing street elements from a click (the Design tools' modes): crossings, bus stops and roadside runs snap to the
 * nearest road; a roundabout snaps to the junction at the click; a path is the drawn line. Throws an Error with a
 * plain message when the click is not usable (the caller shows it).
 */
import type { CityObject, StreetElementObject } from '../objects/types';
import type { LogicalJunction } from '../simulation/junctionGroups';
import type { BusStopPlacement, CrossingType, PathLevel, PathType, RoadsideSpec, RoundaboutCategory } from './types';
import { nearestRoad, roadXs } from './roadXs';
import { pointAtChainage, frameAt, toLngLat } from './geom';
import { anchorOn, runPoints, DEFAULT_LIGHT, DEFAULT_TREE, type RoadsideKind } from './roadside';
import { DEFAULT_ICD, roundaboutSpec } from './roundabout';
import { SD } from './sources';

export type StreetToolMode = 'place_crossing' | 'place_bus_stop' | 'place_roadside' | 'place_roundabout' | 'draw_path';
export const STREET_TOOL_MODES: readonly StreetToolMode[] = ['place_crossing', 'place_bus_stop', 'place_roadside', 'place_roundabout', 'draw_path'];
export const isStreetToolMode = (m: string): m is StreetToolMode => (STREET_TOOL_MODES as readonly string[]).includes(m);

/** Settings of the street tools (EditingEngine.streetSettings), each the next placed element's. */
export interface StreetToolSettings {
  crossingType: CrossingType;
  crossingWidthM: number;
  crossingRefuge: boolean;
  crossingRefugeWidthM: number;
  busStopPlacement: BusStopPlacement;
  roadsideKind: RoadsideKind;
  roadsideCount: number;
  roadsideSpacingM: number | null;
  roadsidePoleHeightM: number;
  roadsideZone: RoadsideSpec['zone'];
  roundaboutCategory: RoundaboutCategory;
  roundaboutIcdM: number | null;
  pathType: PathType;
  pathLevel: PathLevel;
  pathWidthM: number;
}

export const DEFAULT_STREET_SETTINGS: StreetToolSettings = {
  crossingType: 'zebra', crossingWidthM: 3, crossingRefuge: false, crossingRefugeWidthM: 1.5,
  busStopPlacement: 'kerb',
  roadsideKind: 'streetlight', roadsideCount: 5, roadsideSpacingM: null, roadsidePoleHeightM: 10, roadsideZone: 'furniture',
  roundaboutCategory: 'urban_single', roundaboutIcdM: null,
  pathType: 'footpath', pathLevel: 'ground', pathWidthM: 2.0,
};

export interface PlaceMeta { id: string; name: string; scenarioId: string; createdAt: string }

/** Where the user clicked a street tool: the scenario's objects and (for a roundabout) the junction finder. */
export interface PlaceContext {
  objects: readonly CityObject[];
  junctionAt?: (at: readonly number[]) => { junction: LogicalJunction } | null;
}

const SNAP_M = 30;

const base = (meta: PlaceMeta, kind: StreetElementObject['kind'], coordinates: [number, number, number][]): StreetElementObject => ({
  id: `se_${meta.id}`, type: 'street_element', kind, name: meta.name, layerId: 'street_elements', scenarioId: meta.scenarioId,
  createdAt: meta.createdAt, updatedAt: meta.createdAt, coordinates,
});

export function placeStreetElement(mode: StreetToolMode, points: readonly [number, number, number][], s: StreetToolSettings, ctx: PlaceContext, meta: PlaceMeta): StreetElementObject {
  const at = points[0];
  if (!at) throw new Error('Click on the map to place it.');
  if (mode === 'draw_path') {
    if (points.length < 2) throw new Error('A path needs at least 2 points — keep clicking, then double-click to finish.');
    const el = base(meta, 'path', points.map(p => [p[0], p[1], 0] as [number, number, number]));
    el.path = { pathType: s.pathType, level: s.pathLevel, widthM: s.pathWidthM, clearHeightM: null, rampGradient: s.pathLevel === 'ground' ? null : SD.fobRampSlope.value, hasLift: false, bufferM: null };
    el.valueCertainty = { widthM: 'hypothetical' };
    return el;
  }
  if (mode === 'place_roundabout') {
    const hit = ctx.junctionAt?.(at);
    if (!hit) throw new Error('Click on a junction where three or more roads meet: no junction found within 40 m.');
    const j = hit.junction;
    const armRoadIds = [...new Set([...j.approaches, ...j.exits].flatMap(a => a.roadIds))];
    const icd = s.roundaboutIcdM ?? DEFAULT_ICD[s.roundaboutCategory];
    const el = base(meta, 'roundabout', [[j.centre[0], j.centre[1], 0]]);
    el.roundabout = roundaboutSpec(s.roundaboutCategory, icd, { armRoadIds, nodeKeys: [...j.nodeKeys], armCount: j.approaches.length });
    el.name = meta.name.replace(/^New (place )?roundabout/i, `Roundabout at ${j.label}`) || meta.name;
    return el;
  }
  const near = nearestRoad(ctx.objects, at, SNAP_M);
  if (!near) throw new Error(`Click on a road: no road within ${SNAP_M} m.`);
  const road = near.road;
  const anchor = anchorOn(road, at)!;
  const xs = roadXs(road);
  if (mode === 'place_crossing') {
    const p = pointAtChainage(road.coordinates, anchor.chainageM)!;
    const el = base(meta, 'crossing', [p.point]);
    el.anchor = anchor;
    el.crossing = { crossingType: s.crossingType, widthM: Math.max(s.crossingWidthM, s.crossingType === 'raised' ? SD.raisedCrossingMinWidthM.value : 0), lengthM: null,
      refuge: s.crossingRefuge, refugeWidthM: s.crossingRefuge ? s.crossingRefugeWidthM : null, signalCycleS: null, pedsPerHour: null };
    el.valueCertainty = { widthM: 'hypothetical' };
    return el;
  }
  if (mode === 'place_bus_stop') {
    const p = pointAtChainage(road.coordinates, anchor.chainageM)!;
    const sign = anchor.side === 'left' ? 1 : -1;
    const kerb = s.busStopPlacement === 'median_brt' ? 0 : (xs.oneWay ? xs.carriagewayM / 2 : (anchor.side === 'left' ? xs.lanesFwd : xs.lanesBwd) * xs.laneW + xs.medianM / 2) + 1;
    const f = frameAt(p.point);
    const el = base(meta, 'bus_stop', [toLngLat(f, [-p.dir[1] * kerb * sign, p.dir[0] * kerb * sign])]);
    el.anchor = s.busStopPlacement === 'median_brt' ? { ...anchor, offsetM: 0 } : anchor;
    el.busStop = { placement: s.busStopPlacement, shelterLengthM: SD.busShelterLengthM.value, shelterDepthM: SD.busShelterDepthM.value,
      stationInnerM: s.busStopPlacement === 'median_brt' ? SD.brtStationInnerM.value : null, stationOuterM: s.busStopPlacement === 'median_brt' ? SD.brtStationOuterM.value : null };
    return el;
  }
  // place_roadside
  const kind = s.roadsideKind;
  const d = kind === 'streetlight' ? DEFAULT_LIGHT : DEFAULT_TREE;
  const spacing = s.roadsideSpacingM ?? (kind === 'streetlight' ? (road.availableRowM ?? xs.drawnWidthM) <= 9 ? SD.lightSmallSpacingMin.value : SD.lightLargeSpacingMin.value : SD.treeSpacingM.value);
  const spec: Omit<RoadsideSpec, 'points'> = { ...d, count: Math.max(1, Math.round(s.roadsideCount)), spacingM: spacing, zone: s.roadsideZone,
    poleHeightM: kind === 'streetlight' ? s.roadsidePoleHeightM : null };
  const pts = runPoints(road, anchor, spec);
  const el = base(meta, kind, pts.length ? [pts[0]] : [[at[0], at[1], 0]]);
  el.anchor = anchor;
  el.roadside = { ...spec, points: pts };
  el.valueCertainty = { spacingM: s.roadsideSpacingM == null && kind === 'street_tree' ? 'unknown' : 'hypothetical' };
  return el;
}
