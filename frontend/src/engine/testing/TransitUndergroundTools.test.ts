import { describe, it, expect } from 'vitest';
import { EditingEngine } from '../editing/EditingEngine';
import { ObjectManager } from '../objects/ObjectManager';
import { HistoryManager } from '../history/HistoryManager';
import { findNearestTrack } from '../objects/stationAlignment';
import { flyoverFieldUpdates } from '../editing/roadEdits';
import { activityEndpoints } from '../simulation/StudyDemand';
import type { MetroLineObject, MetroStationObject, CityObject, GatewayObject, UtilityObject, ZoneObject } from '../objects/types';
import type { TrafficNetwork, TrafficNode, TrafficEdge } from '../objects/trafficTypes';
import type { DemandZone } from '../objects/demandTypes';

/** Design tools Metro line, Double-deck, Station, Utility, Demand zone, Gateway (docs/urbanos/DESIGN_CONTROLS_TRANSIT_UNDERGROUND.md). */

// Karve Road, Pune, from near Garware College towards Nal Stop
const KARVE: [number, number, number][] = [[73.8358, 18.5110, 0], [73.8330, 18.5094, 0], [73.8295, 18.5076, 0]];

const metroLine = (over: Partial<MetroLineObject> = {}): MetroLineObject => ({
  id: 'm1', type: 'metro_line', name: 'Karve metro', layerId: 'metro', scenarioId: 'base', coordinates: KARVE,
  trackCount: 2, trackGauge: 1.435, deckWidth: 8, elevation: 12, pierSpacing: 30, createdAt: '', updatedAt: '', ...over,
} as MetroLineObject);

describe('metro station placement', () => {
  it('findNearestTrack gives the closest point on the centreline and the deck height', () => {
    const t = findNearestTrack([73.8296, 18.5080], [metroLine({ elevation: 15 })])!;
    expect(t).not.toBeNull();
    expect(t.distanceMeters).toBeGreaterThan(20);
    expect(t.distanceMeters).toBeLessThan(50);
    expect(t.deckElevation).toBe(15);
    // The point lies on the segment: distance from it to the track is 0
    expect(findNearestTrack(t.point, [metroLine()])!.distanceMeters).toBeLessThan(0.01);
    expect(findNearestTrack([73.8380, 18.5050], [metroLine()])).toBeNull();
  });

  it('a station clicked within 100 m sits on the track (centred, along it, at its deck height)', () => {
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager());
    objects.add(metroLine({ elevation: 14 }) as CityObject);
    editing.setMode('place_station');
    editing.addDrawingPoint([73.8296, 18.5080, 0]);
    editing.finalizeDrawing('base');
    const st = objects.getAll().find(o => o.type === 'metro_station') as MetroStationObject;
    expect(findNearestTrack(st.coordinates, [metroLine()])!.distanceMeters).toBeLessThan(0.01);
    expect(st.elevation).toBe(14);
    expect(st.heading).toBeCloseTo(findNearestTrack(st.coordinates, [metroLine()])!.bearing, 2);
    expect(editing.lastStationTrack?.name).toBe('Karve metro');
  });

  it('a station far from any track stays where clicked and reports no track', () => {
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager());
    objects.add(metroLine() as CityObject);
    editing.setMode('place_station');
    editing.addDrawingPoint([73.8470, 18.5300, 0]);
    editing.finalizeDrawing('base');
    const st = objects.getAll().find(o => o.type === 'metro_station') as MetroStationObject;
    expect(st.coordinates.slice(0, 2)).toEqual([73.8470, 18.5300]);
    expect(st.elevation).toBe(12);
    expect(editing.lastStationTrack).toBeNull();
  });

  it('a station near a double-deck sits on its metro deck', () => {
    const t = findNearestTrack([73.8296, 18.5080], [{ ...metroLine(), type: 'metro_flyover', metroElevation: 16 } as unknown as CityObject])!;
    expect(t.deckElevation).toBe(16);
  });
});

describe('metro line and double-deck', () => {
  it('a drawn metro line keeps its plan on the ground; height is the elevation field alone', () => {
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager());
    editing.setMode('draw_metro');
    editing.addDrawingPoint([73.8358, 18.5110, 12]);
    editing.addDrawingPoint([73.8295, 18.5076, 0]);
    editing.finalizeDrawing('base');
    const m = objects.getAll().find(o => o.type === 'metro_line') as MetroLineObject;
    expect(m.coordinates.every(c => c[2] === 0)).toBe(true);
    expect(m.elevation).toBe(12);
    expect(m.name).toBe('New metro line 1');
  });

  it('the double-deck metro deck height slider writes metroElevation (it used to be dropped)', () => {
    const dd = { type: 'metro_flyover', laneCount: 4, laneWidth: 3.5, hasDivider: true, dividerWidth: 2, hasFootpath: true, footpathWidth: 1.5, metroElevation: 12 } as unknown as CityObject;
    expect((flyoverFieldUpdates(dd, 'metroElevation', 16) as { metroElevation?: number }).metroElevation).toBe(16);
  });

  it('the double-deck road deck takes the Road class setting', () => {
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager());
    editing.roadClass = 'highway';
    editing.setMode('draw_metro_flyover');
    editing.addDrawingPoint([73.82467, 18.50613, 0]);
    editing.addDrawingPoint([73.82093, 18.51014, 0]);
    editing.finalizeDrawing('base');
    const dd = objects.getAll().find(o => o.type === 'metro_flyover') as unknown as { roadClass: string; laneCount: number; metroElevation: number };
    expect(dd.roadClass).toBe('highway');
    expect(dd.laneCount).toBe(6);
    expect(dd.metroElevation).toBe(12);
  });
});

describe('utility, zone and gateway', () => {
  it('a utility keeps depth, depth certainty and diameter from the tool settings', () => {
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager());
    editing.setMode('draw_utility');
    editing.utilityType = 'sewage'; editing.utilityDepthM = 2.4; editing.utilityDiameterMm = 600; editing.utilityDepthCertainty = 'estimated';
    editing.addDrawingPoint([73.8300, 18.5060, 0]);
    editing.addDrawingPoint([73.8335, 18.5080, 0]);
    editing.finalizeDrawing('base');
    const u = objects.getAll().find(o => o.type === 'utility') as UtilityObject;
    expect([u.utilityType, u.layerId, u.depth, u.depthCertainty, u.diameterMm]).toEqual(['sewage', 'sewage_util', 2.4, 'estimated', 600]);
    expect(editing.lastAddedId).toBe(u.id);
  });

  it('a demand zone feeds the trip model with its residents and jobs (AM peak)', () => {
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager());
    editing.zonePopulation = 8000; editing.zoneEmployment = 3000;
    editing.setMode('draw_zone');
    for (const p of [[73.8272, 18.5042], [73.8328, 18.5042], [73.8328, 18.5088], [73.8272, 18.5088]]) editing.addDrawingPoint([p[0], p[1], 0]);
    editing.finalizeDrawing('base');
    const z = objects.getAll().find(o => o.type === 'zone') as ZoneObject;
    const dz = { id: z.id, name: z.name, boundaryPolygon: z.coordinates, totalPopulation: z.totalPopulation, totalEmployment: z.totalEmployment, landUseMix: z.landUseMix, gateways: [], provenance: z.provenance } as DemandZone;
    const am = activityEndpoints({ zones: [dz], period: 'AM_Peak' });
    const out = am.origins.find(o => o.id === z.id)!.flow, inn = am.destinations.find(o => o.id === z.id)!.flow;
    expect(out).toBeGreaterThan(0);
    expect(inn).toBeGreaterThan(0);
    // Twice the residents, twice the AM outflow
    const am2 = activityEndpoints({ zones: [{ ...dz, totalPopulation: 16000 }], period: 'AM_Peak' });
    expect(am2.origins.find(o => o.id === z.id)!.flow).toBeCloseTo(out * 2, 6);
  });

  it('a gateway snaps to the nearest ground node, never a flyover deck node above it', () => {
    const nodes = new Map<string, TrafficNode>([
      ['deck', { id: 'deck', coordinates: [73.82130, 18.50970, 6], incomingSegments: [], outgoingSegments: [], hasSignals: false, allowedMovements: [] } as unknown as TrafficNode],
      ['ground', { id: 'ground', coordinates: [73.82150, 18.50990, 0], incomingSegments: [], outgoingSegments: ['e'], hasSignals: false, allowedMovements: [] } as unknown as TrafficNode],
    ]);
    const edges = new Map<string, TrafficEdge>([['e', { id: 'e', roadId: 'paud', fromNodeId: 'ground', toNodeId: 'deck', coordinates: [], length: 30, lanes: 2, direction: 'forward', speedLimit: 40, capacity: 1800 } as unknown as TrafficEdge]]);
    const network: TrafficNetwork = { nodes, edges };
    const objects = new ObjectManager();
    const editing = new EditingEngine(objects, new HistoryManager(), () => network);
    editing.setMode('draw_gateway');
    editing.addDrawingPoint([73.82130, 18.50970, 0]);
    editing.finalizeDrawing('base');
    const g = objects.getAll().find(o => o.type === 'gateway') as GatewayObject;
    expect(g.connectedNodeId).toBe('ground');
    expect(editing.lastGatewaySnap!.movedM).toBeGreaterThan(20);
  });

  it('a gateway without a loaded road network explains why instead of saying "too far"', () => {
    const editing = new EditingEngine(new ObjectManager(), new HistoryManager(), () => null);
    editing.setMode('draw_gateway');
    editing.addDrawingPoint([73.82130, 18.50970, 0]);
    expect(() => editing.finalizeDrawing('base')).toThrow(/still loading/);
  });
});

describe('track height change and the stations on it', () => {
  it('raising the track and the station following it is one Undo step, also while a slider is dragged', () => {
    const objects = new ObjectManager();
    const history = new HistoryManager(objects);
    const line = metroLine() as CityObject;
    const station = { id: 's1', type: 'metro_station', name: 'Nal Stop', layerId: 'metro', scenarioId: 'base', coordinates: [KARVE[1][0], KARVE[1][1], 0],
      stationName: 'Nal Stop', length: 140, width: 20, height: 8, elevation: 12, capacity: 5000, heading: 0, alignToTrack: true, createdAt: '', updatedAt: '' } as unknown as CityObject;
    objects.add(line); objects.add(station);
    // Two slider ticks: 12 -> 14 -> 16 m (as PropertiesPanel.handleUpdateField records them)
    for (const h of [14, 16]) {
      const l = objects.getById('m1')!, s = objects.getById('s1')!;
      history.recordUpdates([{ before: l, after: { ...l, elevation: h } as CityObject }, { before: s, after: { ...s, elevation: h } as CityObject }], 'Update elevation', 'm1:elevation');
      objects.update('m1', { elevation: h } as Partial<CityObject>);
      objects.update('s1', { elevation: h } as Partial<CityObject>);
    }
    expect(history.getUndoStackCount()).toBe(1);
    history.undo();
    expect((objects.getById('m1') as MetroLineObject).elevation).toBe(12);
    expect((objects.getById('s1') as MetroStationObject).elevation).toBe(12);
    history.redo();
    expect((objects.getById('m1') as MetroLineObject).elevation).toBe(16);
    expect((objects.getById('s1') as MetroStationObject).elevation).toBe(16);
  });
});
