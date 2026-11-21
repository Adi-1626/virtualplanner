import { describe, expect, it } from 'vitest';
import { junctionLabel } from '../simulation/RoadAnalysis';

// Final QA 2026-11-21: a junction where only the studied road is named read
// "Queue backing up from Karve Road (junction) (its signal)" — two brackets in a row.
describe('junctionLabel', () => {
  it('reads inside a sentence when only one road name is known', () => {
    expect(junctionLabel(['Karve Road'], 'Karve Road')).toBe('a junction on Karve Road');
  });
  it('keeps the named crossings', () => {
    expect(junctionLabel(['Karve Road', 'Prabhat Path'], 'Karve Road')).toBe('Karve Road / Prabhat Path');
    expect(junctionLabel(['Prabhat Path'], 'Karve Road')).toBe('Karve Road / Prabhat Path');
    expect(junctionLabel([], 'Karve Road')).toBe('an unnamed junction');
  });
});
