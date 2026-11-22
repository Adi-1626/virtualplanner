import { describe, expect, it } from 'vitest';
import { projectStudyAreaOptions } from '../../components/projects/studyAreaOptions';

describe('project study-area list (QA 2026-11-22: 1,322 "Roads loaded for a study area" entries)', () => {
  it('leaves out Simulate road-coverage boxes, keeps drawn study areas', () => {
    const areas = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `area_osmroads_${i}`, name: 'Roads loaded for a study area', extra: 1 })),
      { id: 'area_abc', name: 'Panchratna Chowk study area', extra: 2 },
    ];
    expect(projectStudyAreaOptions(areas)).toEqual([{ id: 'area_abc', name: 'Panchratna Chowk study area' }]);
  });
});
