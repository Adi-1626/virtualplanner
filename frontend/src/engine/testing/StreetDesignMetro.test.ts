import { describe, expect, it } from 'vitest';
import type { BuildingObject, CityObject, MetroFlyoverObject, MetroLineObject, RoadObject } from '../objects/types';
import { metroCorridorChecks, setbackFromCentrelineM, setbackHits, isMetroViaduct } from '../streetDesign/metroSetback';
import { SD } from '../streetDesign/sources';

const LAT0 = 18.53;
const kx = 111320 * Math.cos(LAT0 * Math.PI / 180);
type P3 = [number, number, number];
const pt = (x: number, y: number): P3 => [73.85 + x / kx, LAT0 + y / 111320, 0];
const T = '2026-11-22T00:00:00Z';
const metro = (extra: Partial<MetroLineObject> = {}): MetroLineObject => ({ id: 'm1', type: 'metro_line', name: 'Line X', layerId: 'metro', scenarioId: 'prop', createdAt: T, updatedAt: T,
  coordinates: [pt(0, 0), pt(1000, 0)], trackCount: 2, trackGauge: 1.435, deckWidth: 8.5, elevation: 12, pierSpacing: 28, ...extra });
const bld = (id: string, y0: number, extra: Partial<BuildingObject> = {}): BuildingObject => ({ id, type: 'building', name: id, layerId: 'buildings', scenarioId: 'base', createdAt: T, updatedAt: T,
  coordinates: [pt(400, y0), pt(420, y0), pt(420, y0 + 15), pt(400, y0 + 15), pt(400, y0)], usageType: 'residential', height: 15, floors: 5, population: 0,
  parkingSpaces: 0, waterDemand: 0, electricityDemand: 0, constructionYear: 2000, ...extra } as BuildingObject);
const road = (id: string, coords: P3[], extra: Partial<RoadObject> = {}): RoadObject => ({ id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', createdAt: T, updatedAt: T,
  coordinates: coords, roadClass: 'arterial', width: 14, laneCount: 4, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [], ...extra } as RoadObject);

describe('#6 metro corridor setback (Pune Metro Phase-2 DPR §5.9.2, §5.7.1.2)', () => {
  it('values come from the official DPR', () => {
    expect(SD.metroSetbackM.value).toBe(5);
    expect(SD.metroSetbackM.status).toBe('official');
    expect(SD.metroMinRailOverRoadM.value).toBe(8.4);
    // 8.5 m deck: 4.25 + 5 = 9.25 m from the centreline (the DPR also states "10 m on both sides of the centre line")
    expect(setbackFromCentrelineM(metro())).toBeCloseTo(9.25, 6);
  });

  it('flags buildings inside the setback (proposed = fail, mapped = warn) and not those outside', () => {
    const objs: CityObject[] = [metro(), bld('osm_way_1', 5, { osmId: 1 } as any), bld('drawn_b', -20 - 15 + 12), bld('osm_way_far', 30, { osmId: 2 } as any)];
    // osm_way_1 starts 5 m from the centreline; drawn_b's north edge is 8 m south (inside 9.25); far one 30 m
    const hits = setbackHits(metro(), objs);
    expect(hits.map(h => h.objectId).sort()).toEqual(['drawn_b', 'osm_way_1']);
    const checks = metroCorridorChecks(metro(), objs);
    expect(checks.find(c => c.id === 'metro-setback-proposed')?.status).toBe('fail');
    expect(checks.find(c => c.id === 'metro-setback-existing')?.status).toBe('warn');
    for (const c of checks) {
      expect(c.screening).toBe(true);
      expect(c.message).toMatch(/Screening only/);
      expect(c.message.toLowerCase()).not.toMatch(/\bsafe\b|complian/);
    }
  });

  it('no flag when the corridor is clear; tunnels are not viaducts', () => {
    const checks = metroCorridorChecks(metro(), [metro(), bld('b', 40)]);
    expect(checks.find(c => c.id === 'metro-setback')?.status).toBe('pass');
    expect(isMetroViaduct(metro({ elevation: -6 }))).toBe(false);
    expect(isMetroViaduct(metro({ tags: { tunnel: 'yes' } }))).toBe(false);
  });

  it('rail level over a crossed road below 8.4 m is flagged; a double-deck checks rail above its road deck', () => {
    const cross = road('ns', [pt(500, -200), pt(500, 200)]);
    const low = metroCorridorChecks(metro({ elevation: 7 }), [cross]);
    expect(low.find(c => c.id === 'metro-rail-over-road')?.status).toBe('fail');
    const ok = metroCorridorChecks(metro({ elevation: 12 }), [cross]);
    expect(ok.find(c => c.id === 'metro-rail-over-road')?.status).toBe('pass');
    const dd = { id: 'dd', type: 'metro_flyover', name: 'DD', layerId: 'roads', scenarioId: 'p', createdAt: T, updatedAt: T, coordinates: [pt(0, 0), pt(1000, 0)],
      roadClass: 'arterial', width: 19, laneCount: 4, laneWidth: 3.5, hasDivider: true, dividerWidth: 1, hasFootpath: false, footpathWidth: 0, speedLimit: 60, isOneWay: false,
      elevation: 6, metroElevation: 12, pierSpacing: 30 } as MetroFlyoverObject;
    expect(metroCorridorChecks(dd, []).find(c => c.id === 'metro-rail-over-deck')?.status).toBe('fail'); // 6 m < 8.4
    expect(metroCorridorChecks({ ...dd, metroElevation: 15 }, []).find(c => c.id === 'metro-rail-over-deck')?.status).toBe('pass');
  });

  it('pier in the median: too narrow = flag; wide enough = unknown (barrier base width not stated)', () => {
    const along = (median: number) => road('along', [pt(-100, 0), pt(1100, 0)], { sections: [{ startNodeIndex: 0, endNodeIndex: 1, totalRowWidth: 30, wideningPossible: false, hasMedian: median > 0, medianWidth: median } as any] });
    expect(metroCorridorChecks(metro(), [along(1.2)]).find(c => c.id === 'metro-pier-median')?.status).toBe('fail');
    expect(metroCorridorChecks(metro(), [along(3)]).find(c => c.id === 'metro-pier-median')?.status).toBe('unknown');
    expect(metroCorridorChecks(metro(), [along(0)]).find(c => c.id === 'metro-pier-median')?.status).toBe('warn');
  });
});
