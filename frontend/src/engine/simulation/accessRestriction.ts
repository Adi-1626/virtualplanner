import type { DrivableObject } from './StudyAreaExplorer';
import { motorVehicleAccess } from '../editing/osmDrivability';

/**
 * Roads open only for local access (docs/OVERHAUL.md §17, §19): the rule the
 * area assignment and the live micro-simulation share, so a campus or gated
 * road is a through route in neither.
 */
/** OSM access values under which a road is for local access only (OSRM car profile, restricted_access_tag_list). */
export const RESTRICTED_ACCESS = new Set(['private', 'destination', 'delivery', 'customers', 'permit', 'residents']);
/**
 * Generalised cost (s) of entering a restricted road from a public one. Prohibitive, so through routes avoid
 * restricted roads whenever any public route exists; finite, so trips that start or end on one are still routed.
 * The number of entries a trip makes is then fixed by the network's layout, not by the link costs, so it is left
 * out of the reported times, the relative gap and the line search.
 */
export const RESTRICTED_ENTRY_S = 1e7;

/**
 * p17: OSM access values that close a road to public motor traffic (OSRM car profile access_tag_blacklist, less 'no',
 * which the import already drops, and less the values above): https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/car.lua.
 * OSRM does not route on them at all; here they are treated like the values above (not a through route; a trip that
 * starts or ends on one is still routed), since the trip ends inside them (cantonment / army land, ~275 km of
 * access=military roads across the p16 areas) would otherwise have no road. Before p17 they were public through routes.
 */
export const CLOSED_ACCESS = new Set(['military', 'official', 'restricted', 'agricultural', 'forestry', 'emergency', 'emergency_vehicle', 'psv', 'bus', 'taxi', 'share_taxi', 'minibus', 'foot']);

/** True for an OSM road that motor traffic may use only to reach places along it (private, destination, ..., and p17 CLOSED_ACCESS). */
export function isAccessRestricted(road: DrivableObject | undefined): boolean {
  if (road?.type !== 'road') return false;
  const tags = road.osmProvenance?.originalTags;
  if (!tags) return false;
  const access = motorVehicleAccess(tags);
  return !!access && (RESTRICTED_ACCESS.has(access) || CLOSED_ACCESS.has(access));
}
