import { describe, it, expect } from 'vitest';
import { chainageNote, lineLength, LENGTH_DEFINITION } from '../../components/drawnWorks';
import type { CityObject } from '../objects/types';

describe('one length definition for drawn lines (p5 QA: 438 m vs 431 m)', () => {
  const road = { id: 'r', type: 'road', coordinates: [[73.8, 18.5, 0], [73.8, 18.5 + 438 / 110574, 0]] } as unknown as CityObject;
  it('the shown length is the stored centreline', () => {
    expect(Math.round(lineLength(road)!)).toBe(438);
    expect(LENGTH_DEFINITION).toMatch(/Centreline/);
    // the same measure as the shape editor's chainage (no 0.7 % north-south bias)
    expect(Math.abs(lineLength(road)! - 438)).toBeLessThan(0.5);
  });
  it('a shorter design chainage is a note, not a second length', () => {
    expect(chainageNote(438, 431)).toBe('Design chainage runs 0–431 m; the other 7 m join the ends to the roads they meet.');
    expect(chainageNote(438, 437.6)).toBeNull();
    expect(chainageNote(null, 431)).toBeNull();
  });
});
