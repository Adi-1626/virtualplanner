import { describe, expect, it } from 'vitest';
import { osmMetroLineName } from '../editing/EditingEngine';

// Final QA 2026-11-21: an unnamed OSM crossover showed as "Metro Line 1479326197" (its way id).
describe('osmMetroLineName', () => {
  it('uses the OSM name or ref', () => {
    expect(osmMetroLineName({ name: 'Pune Metro Line 1: Purple Line' })).toBe('Pune Metro Line 1: Purple Line');
    expect(osmMetroLineName({ ref: '3' })).toBe('Metro Line 3');
  });
  it('never shows a way id for an unnamed piece', () => {
    expect(osmMetroLineName({ railway: 'subway', service: 'crossover', bridge: 'viaduct' })).toBe('Metro crossover (unnamed in OpenStreetMap)');
    expect(osmMetroLineName({ railway: 'subway' })).toBe('Metro track (unnamed in OpenStreetMap)');
  });
});
