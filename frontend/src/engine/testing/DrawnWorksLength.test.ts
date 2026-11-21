import { describe, expect, it } from 'vitest';
import type { CityObject } from '../objects/types';
import { lineLength } from '../../components/drawnWorks';

describe('drawn works: line length', () => {
  it('has no length for a single-point gateway (was "0 m")', () => {
    expect(lineLength({ id: 'g', type: 'gateway', coordinates: [[73.8, 18.5, 0]] } as unknown as CityObject)).toBeNull();
  });
  it('measures a road', () => {
    const l = lineLength({ id: 'r', type: 'road', coordinates: [[73.8, 18.5, 0], [73.801, 18.5, 0]] } as unknown as CityObject);
    expect(l).toBeGreaterThan(100); expect(l).toBeLessThan(110);
  });
});
