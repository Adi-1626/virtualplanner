import { describe, it, expect } from 'vitest';
import { ProceduralGeometryGenerator, streetlightRowIsWide } from '../rendering/geometry/ProceduralGeometryGenerator';
import { cumulativeLengths, pierStations, type PathPt } from '../rendering/geometry/markingPattern';
import { dim, VISUAL_DIMS } from '../rendering/standards/visualDims';
import { detailShown } from '../rendering/detailVisibility';
import type { MeshData } from '../rendering/types';
import type { RoadObject } from '../objects/types';

const M_PER_DEG = 111_320;
function straight(len: number, lat = 18.52): PathPt[] {
  return [[73.85, lat, 0], [73.85 + len / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)), lat, 0]];
}
/** Geodetic height of an ECEF point (one Bowring step). */
function heightOf(x: number, y: number, z: number): number {
  const a = 6378137.0, f = 1 / 298.257223563, e2 = 2 * f - f * f, b = a * (1 - f), ep2 = (a * a - b * b) / (b * b);
  const r = Math.hypot(x, y);
  const th = Math.atan2(z * a, r * b);
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, r - e2 * a * Math.cos(th) ** 3);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return r / Math.cos(lat) - N;
}
const maxHeight = (m: MeshData) => {
  let hi = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) hi = Math.max(hi, heightOf(m.positions[i], m.positions[i + 1], m.positions[i + 2]));
  return hi;
};
/** Distinct pole positions (east coordinate of each light's pole box), sorted. */
const lightCount = (m: MeshData) => m.positions.length / 3 / 24; // pole + arm + head, 8 vertices each

const base = { layerId: 'x', scenarioId: 'base', createdAt: '', updatedAt: '' };
const emptySide = { footpathWidth: 0, cycleTrackWidth: 0, vergeWidth: 0, parkingWidth: 0, drainageWidth: 0 };

function road(width: number, len: number, extra: Partial<RoadObject> = {}): RoadObject {
  return { ...base, id: 'r', type: 'road', name: 'r', coordinates: straight(len), roadClass: 'local', width, laneCount: 2, laneWidth: 3,
    hasDivider: false, dividerWidth: 0, hasFootpath: true, footpathWidth: 1.8, speedLimit: 40, isOneWay: false, trafficCapacity: 1200,
    connectedJunctions: [], ...extra } as unknown as RoadObject;
}
function roadWithVerge(verge: number, footpath = 1.8): RoadObject {
  const side = { ...emptySide, footpathWidth: footpath, vergeWidth: verge };
  return road(12, 100, { sections: [{ startNodeIndex: 0, endNodeIndex: 1, totalRowWidth: 12, wideningPossible: false, hasMedian: false, medianWidth: 0,
    carriagewayA: { direction: 'both', lanes: 1, laneWidth: 3.5, leftRoadside: side, rightRoadside: emptySide },
    carriagewayB: { direction: 'backward', lanes: 1, laneWidth: 3.5, leftRoadside: emptySide, rightRoadside: side } }] } as Partial<RoadObject>);
}
const gen = new ProceduralGeometryGenerator();
const lights = (r: RoadObject) => gen.generateMeshData(r).filter(m => m.layerId === 'props' && m.material.materialId === 'light_pole');
const trees = (r: RoadObject) => gen.generateMeshData(r).filter(m => m.layerId === 'props' && m.material.materialId !== 'light_pole');

describe('R6 street props: IRC:86-2018 Table 5.6 streetlights', () => {
  it('table values carry the IRC source', () => {
    expect(VISUAL_DIMS.streetlightHeightNarrow.source).toMatch(/IRC:86/);
    expect(VISUAL_DIMS.streetlightSpacingWide.source).toMatch(/Table 5\.6/);
    expect(VISUAL_DIMS.streetlightKerbOffset.status).toBe('assumed');
    expect(streetlightRowIsWide(9)).toBe(false);
    expect(streetlightRowIsWide(12)).toBe(true);
  });
  it('RoW ≤ 9 m: 9 m poles every 26 m, on both footpaths', () => {
    const ls = lights(road(8, 100));
    expect(ls.length).toBe(2);
    const expected = pierStations(100, dim('streetlightSpacingNarrow')).length; // 13, 39, 65, 91
    expect(expected).toBe(4);
    for (const m of ls) {
      expect(lightCount(m)).toBe(expected);
      const h = maxHeight(m);
      expect(h).toBeGreaterThan(dim('streetlightHeightNarrow'));
      expect(h).toBeLessThan(dim('streetlightHeightNarrow') + 0.4); // + kerb 0.15 and road lift
    }
  });
  it('RoW > 9 m: 11 m poles every 31 m', () => {
    const ls = lights(road(14, 100));
    const expected = pierStations(100, dim('streetlightSpacingWide')).length; // 15.5, 46.5, 77.5
    expect(expected).toBe(3);
    for (const m of ls) {
      expect(lightCount(m)).toBe(expected);
      expect(maxHeight(m)).toBeGreaterThan(dim('streetlightHeightWide'));
      expect(maxHeight(m)).toBeLessThan(dim('streetlightHeightWide') + 0.4);
    }
  });
  it('no footpath (≤ 0.9 m): no poles; imported (OSM) roads get no props at all', () => {
    expect(lights(road(8, 100, { hasFootpath: false })).length).toBe(0);
    expect(lights(road(8, 100, { footpathWidth: 0.8 })).length).toBe(0);
    const osm = road(14, 100, { osmProvenance: { osmId: 1, originalTags: {}, layer: 0, bridge: false, tunnel: false, roundabout: false } });
    expect(gen.generateMeshData(osm).some(m => m.layerId === 'props')).toBe(false);
  });
  it('spacing follows the path length (pierStations at half a spacing, then every spacing)', () => {
    const len = cumulativeLengths(straight(200)).at(-1)!;
    const n = pierStations(len, dim('streetlightSpacingWide')).length;
    expect(lightCount(lights(road(14, 200))[0])).toBe(n);
  });
});

describe('R6 street props: trees only in verges ≥ 1 m (tree pit)', () => {
  it('verge 1.2 m: trees every 8 m on each verged side, canopy clear of 3 m', () => {
    const ts = trees(roadWithVerge(1.2));
    const trunks = ts.filter(m => m.material.materialId === 'tree_trunk');
    expect(trunks.length).toBe(2);
    const perSide = pierStations(100, dim('treeSpacing')).length;
    for (const t of trunks) expect(t.positions.length / 3 / 32).toBe(perSide); // 16-segment frustum, two rings
    const crown = ts.find(m => m.material.materialId === 'tree_canopy')!;
    let lo = Infinity;
    for (let i = 0; i < crown.positions.length; i += 3) lo = Math.min(lo, heightOf(crown.positions[i], crown.positions[i + 1], crown.positions[i + 2]));
    expect(lo).toBeGreaterThanOrEqual(2.99);
  });
  it('verge 0.8 m (narrower than a tree pit) or no verge: no trees', () => {
    expect(trees(roadWithVerge(0.8)).length).toBe(0);
    expect(trees(road(14, 100)).length).toBe(0);
  });
  it('a verge road still gets its streetlights', () => {
    expect(lights(roadWithVerge(1.2)).length).toBe(2);
  });
});

describe('R6 street props: shown only in Realistic at Medium / High', () => {
  const prop = { layerId: 'props' as const };
  it('hidden in Schematic at every tier and in Low tier', () => {
    for (const t of ['low', 'medium', 'high'] as const) expect(detailShown(prop, 'schematic', t)).toBe(false);
    expect(detailShown(prop, 'realistic', 'low')).toBe(false);
    expect(detailShown(prop, 'realistic', 'medium')).toBe(true);
    expect(detailShown(prop, 'realistic', 'high')).toBe(true);
  });
  it('other layers are unaffected', () => {
    expect(detailShown({ layerId: 'asphalt' }, 'schematic', 'low')).toBe(true);
    expect(detailShown({}, 'schematic', 'low')).toBe(true);
  });
});
