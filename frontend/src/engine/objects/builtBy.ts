import type { CityObject } from './types';
import { isSampleObject } from './sampleObjects';

/**
 * Whether the user built this object, as opposed to it being part of the
 * imported OpenStreetMap base (roads, buildings, metro) or one of the app's
 * illustrative sample objects (fictional, never drawn by the user).
 */
export function isUserBuilt(o: CityObject): boolean {
  if (isSampleObject(o)) return false;
  if (o.id.startsWith('osm_')) return false;
  const imported = o as { osmProvenance?: unknown; osmId?: unknown; source?: string };
  return !imported.osmProvenance && imported.osmId === undefined && imported.source !== 'OSM';
}

/** Plain-language name for an object type. */
export const TYPE_LABELS: Record<CityObject['type'], string> = {
  road: 'Road',
  flyover: 'Flyover',
  metro_flyover: 'Metro + flyover',
  metro_line: 'Metro line',
  metro_station: 'Metro station',
  building: 'Building',
  junction: 'Junction',
  utility: 'Utility line',
  underground_alignment: 'Underground alignment',
  zone: 'Demand zone',
  gateway: 'Traffic gateway',
};
