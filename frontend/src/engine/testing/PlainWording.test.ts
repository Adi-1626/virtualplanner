import { describe, it, expect } from 'vitest';
import { osmUnnamedRoadName, readableRoadName, snapDescription } from '../editing/objectNames';
import { objectFromRow } from '../objects/objectRows';
import { isGenericRoadName } from '../simulation/roadSection';
import { SnapManager } from '../editing/SnapManager';
import { ObjectManager } from '../objects/ObjectManager';
import type { CityObject } from '../objects/types';

describe('plain language on screen (p5 QA: "Snap to … Vertex #6", "Secondary_link Road")', () => {
  it('unnamed OSM ways get a readable name, still recognised as generic by the traffic tools', () => {
    expect(osmUnnamedRoadName('secondary_link')).toBe('Secondary link road (unnamed)');
    expect(osmUnnamedRoadName('residential')).toBe('Residential road (unnamed)');
    expect(osmUnnamedRoadName('road')).toBe('Road (unnamed)');
    expect(isGenericRoadName('Secondary link road (unnamed)')).toBe(true);
    expect(isGenericRoadName('Secondary_link Road')).toBe(true);
    expect(isGenericRoadName('Karve Road')).toBe(false);
  });

  it('rows saved by older imports are shown in plain words; real or typed names are untouched', () => {
    const row = (name: string, tags: Record<string, string>) => ({ id: 'osm_1', type: 'road', name, layerId: 'roads', scenarioId: 'base', coordinates: [], properties: { osmProvenance: { originalTags: tags } } }) as any;
    expect(objectFromRow(row('Secondary_link Road', { highway: 'secondary_link' })).name).toBe('Secondary link road (unnamed)');
    expect(objectFromRow(row('Karve Road', { highway: 'primary', name: 'Karve Road' })).name).toBe('Karve Road');
    expect(objectFromRow(row('My service lane', { highway: 'service' })).name).toBe('My service lane');
    expect(readableRoadName('Primary Road', { highway: 'secondary' })).toBe('Primary Road');   // renamed by the user to another class word
  });

  it('snap labels never show vertex numbers or code names', () => {
    expect(snapDescription('vertex', 'Bhakti Marg', 'road')).toBe('Snap to a point on Bhakti Marg');
    expect(snapDescription('start', undefined, 'flyover')).toBe('Snap to the start of flyover');
    expect(snapDescription('t_junction', 'Karve Road', 'road')).toBe('Join Karve Road here (new T-junction)');
    const om = new ObjectManager();
    om.add({ id: 'r', type: 'road', name: 'Bhakti Marg', layerId: 'roads', scenarioId: 'base', laneCount: 2,
      coordinates: [[73.80, 18.50, 0], [73.801, 18.50, 0], [73.802, 18.50, 0], [73.803, 18.50, 0]] } as unknown as CityObject, true);
    const snap = new SnapManager(om);
    const r = snap.findSnap([73.801, 18.50, 0]);
    expect(r.description).toBe('Snap to a point on Bhakti Marg');
  });
});
