import type { CityObject } from '../engine/objects/types';
import { polylineLengthM } from '../engine/simulation/StudyAreaExplorer';

/** Length of a drawn line; null for areas and for single-point objects (a gateway read "Traffic gateway · 0 m", Final QA 2026-11-21). */
export const lineLength = (o: CityObject): number | null =>
  Array.isArray(o.coordinates[0]) && o.coordinates.length >= 2 && o.type !== 'building' && o.type !== 'zone' ? polylineLengthM(o.coordinates as number[][]) : null;
