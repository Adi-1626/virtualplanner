import { readableRoadName } from '../editing/objectNames';
/**
 * Backend rows ↔ city objects (POST/GET /api/objects). A row carries the fixed columns (id, type, name, layerId,
 * scenarioId, coordinates) and everything else of the object in `properties`, so nested fields such as a line's
 * `alignment` (PIs + radii) or a tunnel's `depthControls` go to the backend and come back unchanged.
 */
import type { CityObject } from './types';

export interface ObjectRow {
  id: string;
  type: string;
  name: string;
  layerId: string;
  scenarioId: string;
  coordinates: unknown;
  properties: Record<string, unknown>;
}

/** The row saved for an object (ObjectManager sends this). */
export function objectToRow(obj: CityObject): ObjectRow {
  const { id, type, name, layerId, scenarioId, coordinates, ...rest } = obj as CityObject & { coordinates: unknown };
  return { id, type, name, layerId, scenarioId, coordinates, properties: rest as Record<string, unknown> };
}

/** The object a loaded row stands for (startup load). Stored timestamps win; a row without them gets "now". */
export function objectFromRow(row: ObjectRow): CityObject {
  const now = new Date().toISOString();
  const tags = (row.properties as { osmProvenance?: { originalTags?: Record<string, string> } } | undefined)?.osmProvenance?.originalTags;
  return {
    id: row.id,
    type: row.type,
    // Older imports stored "Secondary_link Road" for an unnamed way; show it in plain words (the row is not rewritten)
    name: row.type === 'road' && tags ? readableRoadName(row.name, tags) : row.name,
    layerId: row.layerId,
    scenarioId: row.scenarioId,
    coordinates: row.coordinates,
    createdAt: now,
    updatedAt: now,
    ...row.properties,
  } as unknown as CityObject;
}
