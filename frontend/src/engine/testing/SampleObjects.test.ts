import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isSampleObject } from '../objects/sampleObjects';
import { isUserBuilt } from '../objects/builtBy';
import type { CityObject } from '../objects/types';

describe('sample objects are kept out of Simulate', () => {
  it('matches the seeded demo objects by id and name together', () => {
    expect(isSampleObject({ id: 'r1', name: 'Pune Central Boulevard' })).toBe(true);
    expect(isSampleObject({ id: 'j1', name: 'Boulevard Intersection' })).toBe(true);
    // A real road, or a sample the user renamed (adopted), is not a sample
    expect(isSampleObject({ id: 'osm_22841323', name: 'Shivaji Bridge' })).toBe(false);
    expect(isSampleObject({ id: 'r1', name: 'My new road' })).toBe(false);
  });
});

describe('the old Hinjewadi demand seed is an illustrative sample, not the city', () => {
  it('recognises rows an older build seeded, so they are excluded from demand and Simulate', () => {
    expect(isSampleObject({ id: 'b_it_infosys', name: 'Infosys Hinjawadi Campus' })).toBe(true);
    expect(isSampleObject({ id: 'zone_hinjewadi_p1', name: 'Hinjewadi Phase 1' })).toBe(true);
    expect(isSampleObject({ id: 'g_wakad', name: 'Wakad NH48 Gateway' })).toBe(true);
  });
  it('is not listed as drawn by the user', () => {
    const seeded = { id: 'b_it_infosys', name: 'Infosys Hinjawadi Campus', type: 'building', source: 'surveyed' } as unknown as CityObject;
    expect(isUserBuilt(seeded)).toBe(false);
    const drawn = { id: 'x1abc', name: 'Office block', type: 'building', source: 'manual' } as unknown as CityObject;
    expect(isUserBuilt(drawn)).toBe(true);
  });
  it('is no longer seeded on load', () => {
    const src = readFileSync(resolve(__dirname, '../TwinCityEngine.ts'), 'utf8');
    expect(src).not.toMatch(/seedPuneHinjewadiDemand|Infosys Hinjawadi Campus/);
  });
});
