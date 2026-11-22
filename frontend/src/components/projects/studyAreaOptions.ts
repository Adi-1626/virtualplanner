import { STUDY_AREA_ROADS_PREFIX } from '../../engine/simulation/osmCoverage';

/**
 * Study areas a planner can attach to a project. "Roads loaded for a study area" boxes (area_osmroads_*) are
 * Simulate's coverage bookkeeping, not study areas. QA 2026-11-22: the project's Study area list showed 1,322 of them.
 */
export function projectStudyAreaOptions(areas: readonly { id: string; name: string }[]): { id: string; name: string }[] {
  return areas.filter(a => !a.id.startsWith(STUDY_AREA_ROADS_PREFIX)).map(a => ({ id: a.id, name: a.name }));
}
