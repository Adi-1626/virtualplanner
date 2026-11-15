/**
 * OSM-imported underground metro (UNDERGROUND_AUDIT F8/F12). OpenStreetMap marks a tunnel (tunnel=yes / layer<0) but
 * never its depth, and Pune Metro stations are all tagged station=subway with no level, so the depth of an underground
 * line or station is UNKNOWN. Such objects are NOT drawn at an invented depth (the import's −6 m placeholder, or the
 * 12 m deck default for a level-0 station): they are a labelled, dashed plan line / outline on the surface.
 * The screening engine treats the line in plan through the 20 m Maha-Metro protection zone (UDCPR 14.2.1.7).
 */
import type { CityObject, MetroLineObject, MetroStationObject } from '../objects/types';
import { findNearestTrack } from '../objects/stationAlignment';

const tagsOf = (o: { tags?: Record<string, string>; originalOsmTags?: Record<string, string> }) =>
  ({ ...(o.originalOsmTags ?? {}), ...(o.tags ?? {}) }) as Record<string, string>;
const neg = (v: string | undefined) => v !== undefined && Number.isFinite(Number(v)) && Number(v) < 0;

/** An existing metro line whose tunnel depth is not mapped (OSM tunnel / negative layer, or the −6 m import placeholder). */
export function isUnmappedMetroTunnel(o: CityObject): o is MetroLineObject {
  if (o.type !== 'metro_line') return false;
  const t = tagsOf(o as MetroLineObject & { originalOsmTags?: Record<string, string> });
  return (Number.isFinite(o.elevation) && o.elevation < 0) || (!!t.tunnel && t.tunnel !== 'no') || neg(t.layer);
}

/** Within this distance of an unmapped tunnel, a level-less OSM station is treated as on that tunnel. */
export const STATION_ON_TUNNEL_M = 150;

/**
 * An existing (OSM) station that is underground or on a tunnel section but whose depth is not mapped. `inferred` = no level
 * tag on the station itself; it is on / next to a tunnel section in OSM (e.g. Swargate).
 */
export function unmappedUndergroundStation(o: CityObject, all: Iterable<CityObject>): { inferred: boolean; tunnelName?: string } | null {
  if (o.type !== 'metro_station') return null;
  const s = o as MetroStationObject & { originalOsmTags?: Record<string, string>; osmId?: number };
  const t = tagsOf(s);
  if (s.elevation < 0 || neg(t.layer) || neg(t.level) || t.location === 'underground' || (!!t.tunnel && t.tunnel !== 'no')) return { inferred: false };
  // Only imported stations with no level of their own (drawn stations keep their design platform height)
  if (!s.originalOsmTags || (s.elevation ?? 0) !== 0 || t.layer !== undefined || t.bridge) return null;
  const tunnels = [...all].filter(isUnmappedMetroTunnel);
  const near = tunnels.length ? findNearestTrack(s.coordinates, tunnels, STATION_ON_TUNNEL_M) : null;
  return near ? { inferred: true, tunnelName: near.trackName } : null;
}

export const METRO_TUNNEL_LABEL = 'Metro tunnel — depth not mapped';
export const METRO_STATION_LABEL = 'Underground station — depth not mapped';
