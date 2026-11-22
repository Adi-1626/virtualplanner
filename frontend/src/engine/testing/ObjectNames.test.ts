import { describe, it, expect } from 'vitest';
import { nearestStreetName, newObjectName, middleOf } from '../editing/objectNames';
import { EditingEngine } from '../editing/EditingEngine';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import type { CityObject } from '../objects/types';

describe('meaningful default names for new objects (p5 QA: "Road opj4")', () => {
  const karve = { name: 'Karve Road', coordinates: [[73.8300, 18.5080], [73.8400, 18.5080]] };
  it('uses the nearest named street within 150 m, else a running number', () => {
    expect(nearestStreetName([73.835, 18.5085], [karve])).toBe('Karve Road');           // ~55 m away
    expect(nearestStreetName([73.835, 18.5200], [karve])).toBeNull();                   // ~1.3 km away
    expect(newObjectName('arterial road', 'Karve Road', new Set())).toBe('New arterial road near Karve Road');
    expect(newObjectName('arterial road', 'Karve Road', new Set(['New arterial road near Karve Road']))).toBe('New arterial road near Karve Road (2)');
    expect(newObjectName('arterial road', null, new Set(['New arterial road 1']))).toBe('New arterial road 2');
    expect(middleOf([[0, 0], [2, 2]])).toEqual([1, 1]);
  });

  it('a road drawn beside an OSM street is named after it, never after its random id', () => {
    const om = new ObjectManager();
    om.add({ id: 'osm_1', type: 'road', name: 'Karve Road', layerId: 'roads', scenarioId: 'base', coordinates: [[73.8300, 18.5080, 0], [73.8400, 18.5080, 0]],
      roadClass: 'arterial', laneCount: 4, osmProvenance: { osmId: 1, originalTags: { name: 'Karve Road', highway: 'primary' }, layer: 0, bridge: false, tunnel: false, roundabout: false } } as unknown as CityObject, true);
    const editing = new EditingEngine(om, new HistoryManager(om));
    editing.roadClass = 'collector';
    editing.setMode('draw_road');
    editing.addDrawingPoint([73.8350, 18.5084, 0]);
    editing.addDrawingPoint([73.8352, 18.5095, 0]);
    editing.finalizeDrawing('base');
    const drawn = om.getAll().find(o => o.type === 'road' && o.id !== 'osm_1')!;
    expect(drawn.name).toBe('New collector road near Karve Road');
    expect(drawn.name).not.toMatch(new RegExp(drawn.id.slice(0, 4)));
  });
});
