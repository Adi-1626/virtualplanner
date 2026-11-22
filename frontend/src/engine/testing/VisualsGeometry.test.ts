import { describe, it, expect } from 'vitest';
import { dashPieces, dashAll, pierStations, densify, adaptiveDensify, fitToTerrain, cumulativeLengths, movingMedian, smoothedProfileOffsets, type PathPt } from '../rendering/geometry/markingPattern';
import { VISUAL_DIMS, dim, assumedDimsFor } from '../rendering/standards/visualDims';
import { boxGirderProfile, jerseyMedianProfile } from '../rendering/standards/profiles';
import { extrudeProfile } from '../rendering/geometry/extrudeProfile';
import { ProceduralGeometryGenerator } from '../rendering/geometry/ProceduralGeometryGenerator';
import type { MetroLineObject, RoadObject, FlyoverObject } from '../objects/types';

const M_PER_DEG = 111_320;
/** Straight east-west path of `len` metres at Pune. */
function straight(len: number, lat = 18.52): PathPt[] {
  return [[73.85, lat, 0], [73.85 + len / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)), lat, 0]];
}
const lenOf = (p: PathPt[]) => cumulativeLengths(p).at(-1)!;

function ecef(lng: number, lat: number, h: number): [number, number, number] {
  const a = 6378137.0, f = 1 / 298.257223563, e2 = 2 * f - f * f;
  const L = (lng * Math.PI) / 180, B = (lat * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(B) ** 2);
  return [(N + h) * Math.cos(B) * Math.cos(L), (N + h) * Math.cos(B) * Math.sin(L), ((1 - e2) * N + h) * Math.sin(B)];
}

describe('IRC:35 marking dash pattern', () => {
  it('lane line 3 m mark / 6 m gap: 100 m → 11 dashes of 3 m, 9 m period', () => {
    const dashes = dashPieces(straight(100), dim('laneLineMark'), dim('laneLineGap'));
    expect(dashes.length).toBe(11); // starts 0, 9, …, 90; the 1 m stub at 99 m is dropped
    for (const d of dashes.slice(0, -1)) expect(lenOf(d)).toBeCloseTo(3, 1);
    // start of dash k is at 9k
    const starts = dashes.map(d => lenOf([straight(100)[0], d[0]]));
    starts.slice(0, 4).forEach((s, k) => expect(s).toBeCloseTo(9 * k, 1));
  });
  it('one-way / ramp 1.5 / 3 and phase', () => {
    const dashes = dashPieces(straight(45), 1.5, 3, 1.5);
    expect(dashes.length).toBe(10);
    expect(lenOf(dashes[0])).toBeCloseTo(1.5, 1);
  });
  it('drops a stub shorter than half a mark at the end', () => {
    expect(dashPieces(straight(10), 3, 6).length).toBe(1); // 0–3 kept; 9–10 (1 m < 1.5 m) dropped
    expect(dashPieces(straight(11), 3, 6).length).toBe(2); // 9–11 (2 m ≥ 1.5 m) kept
  });
  it('follows interior vertices (a bend inside a dash keeps the corner)', () => {
    const p: PathPt[] = [[73.85, 18.52, 0], [73.85002, 18.52, 0], [73.85002, 18.52002, 0]];
    const d = dashPieces(p, 3, 0.0001);
    expect(d.some(x => x.length === 3)).toBe(true);
  });
  it('each junction piece starts its own pattern half a gap in', () => {
    const out = dashAll([straight(20), straight(20, 18.53)], 3, 6);
    expect(out.length).toBe(4);
  });
  it('dimension values carry their sources and status', () => {
    expect(VISUAL_DIMS.laneLineWidth.value).toBe(0.15);
    expect(VISUAL_DIMS.kerbHeight.value).toBe(0.15);
    expect(VISUAL_DIMS.kerbHeight.status).toBe('official');
    expect(VISUAL_DIMS.metroDeckWidth.value).toBe(8.5);
    expect(VISUAL_DIMS.metroTrackCentres.value).toBe(4.1);
    expect(VISUAL_DIMS.flyoverSpan.status).toBe('assumed');
    for (const [k, v] of Object.entries(VISUAL_DIMS)) expect(v.source.length, k).toBeGreaterThan(3);
  });
  it('every assumed value used by a structure is listed for the inspector', () => {
    const f = assumedDimsFor('flyover').map(r => r.key);
    expect(f).toEqual(expect.arrayContaining(['flyoverSpan', 'flyoverGirderDepth', 'crashBarrierHeight']));
    for (const r of assumedDimsFor('metro_line')) expect(r.status === 'assumed' || r.status === 'unknown').toBe(true);
    expect(assumedDimsFor('metro_line', { metroSuperstructure: 'u' }).some(r => r.key === 'uGirderSection')).toBe(true);
  });
});

describe('pier spacing and subdivision', () => {
  it('piers at half a span, then every span', () => {
    expect(pierStations(100, 30)).toEqual([15, 45, 75]);
    expect(pierStations(28 * 4, 28)).toEqual([14, 42, 70, 98]);
    expect(pierStations(0, 30)).toEqual([]);
    expect(pierStations(100, 0)).toEqual([]);
  });
  it('densify keeps every segment ≤ max length and the end points', () => {
    const p = straight(123);
    const d = densify(p, 5);
    const cum = cumulativeLengths(d);
    for (let i = 1; i < cum.length; i++) expect(cum[i] - cum[i - 1]).toBeLessThanOrEqual(5.0001);
    expect(d.length).toBe(Math.ceil(123 / 5) + 1);
    expect(d[0]).toEqual(p[0]);
    expect(d.at(-1)![0]).toBeCloseTo(p[1][0], 12);
  });
  it('moving median removes a single spike (canopy bump)', () => {
    const g = [10, 10, 10, 18, 10, 10, 10];
    const cum = [0, 5, 10, 15, 20, 25, 30];
    expect(movingMedian(g, cum, 15)[3]).toBe(10);
  });
  it('smoothed profile never buries the road more than 0.3 m below a genuine slope', () => {
    const g = [10, 10, 10, 11.2, 11.2, 11.2, 10, 10];
    const cum = [0, 5, 10, 15, 20, 25, 30, 35];
    const off = smoothedProfileOffsets(g, cum, 30, 0.3);
    off.forEach((o, i) => expect(g[i] + o).toBeGreaterThanOrEqual(g[i] - 0.3 - 1e-9));
  });
  it('a narrow bump far above the median (DSM canopy / roof) is bridged', () => {
    const g = [10, 10, 10, 18, 10, 10, 10];
    const cum = [0, 5, 10, 15, 20, 25, 30];
    expect(g[3] + smoothedProfileOffsets(g, cum, 30)[3]).toBe(10);
  });
});

describe('terrain fit', () => {
  it('adaptive subdivision adds nothing on flat ground and splits a hill to ≤ 5 m', () => {
    const p = straight(400);
    expect(adaptiveDensify(p, () => 560, 5, 0.2, 1000).length).toBe(2);
    // a 6 m hump 30 m wide in the middle of the segment
    const x0 = p[0][0], x1 = p[1][0];
    const hill = (lng: number) => { const t = (lng - x0) / (x1 - x0) * 400 - 200; return 560 + 6 * Math.exp(-(t * t) / (2 * 15 * 15)); };
    const d = adaptiveDensify(p, lng => hill(lng), 5, 0.2, 1000);
    const cum = cumulativeLengths(d);
    expect(d.length).toBeGreaterThan(10);
    // every segment is either ≤ 5 m (rounded by halving) or its chord is within 0.2 m of the ground at its midpoint
    for (let i = 1; i < d.length; i++) {
      const L = cum[i] - cum[i - 1];
      const mid = hill((d[i][0] + d[i - 1][0]) / 2);
      const chord = (hill(d[i][0]) + hill(d[i - 1][0])) / 2;
      expect(L <= 6.3 || Math.abs(mid - chord) <= 0.2).toBe(true);
    }
  });
  it('long flat segments are still split at maxSeg so the profile has stations', () => {
    expect(adaptiveDensify(straight(200), () => 0, 5, 0.2, 60).length).toBeGreaterThanOrEqual(5);
  });
  it('fitted profile bridges a canopy spike instead of riding over it', () => {
    const p = straight(120);
    const x0 = p[0][0], x1 = p[1][0];
    const g = (lng: number) => { const t = (lng - x0) / (x1 - x0) * 120; return Math.abs(t - 60) < 4 ? 570 : 560; };
    const f = fitToTerrain(p, g);
    const top = Math.max(...f.map(q => g(q[0]) + q[2]));
    expect(top).toBeLessThan(562);
  });
});

describe('structural profiles', () => {
  it('box girder: deck width at the top, soffit at the bottom', () => {
    const p = boxGirderProfile(8.5, 2.0, 4.0);
    const xs = p.pts.map(q => q[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8.5);
    const bottom = p.pts.filter(q => q[1] === -2.0).map(q => q[0]);
    expect(Math.max(...bottom) - Math.min(...bottom)).toBeCloseTo(4.0);
  });
  it('extruded profile spans the section across the path', () => {
    const r = extrudeProfile(straight(30), jerseyMedianProfile(1.0), ecef, 0);
    const n = jerseyMedianProfile(1.0).pts.length;
    expect(r.positions.length / 3).toBe(2 * n + 2); // two stations + 2 cap centres
    expect(r.indices.length / 3).toBe(n * 2 + 2 * n);
    // vertical extent = 1.0 m: distance between the base and top vertex at station 0
    const P = (k: number) => r.positions.slice(k * 3, k * 3 + 3);
    const h = Math.hypot(...[0, 1, 2].map(i => P(4)[i] - P(1)[i]));
    expect(h).toBeGreaterThan(0.9);
  });
});

const base = { layerId: 'x', scenarioId: 'base', createdAt: '', updatedAt: '' };

describe('generator output (dimensions applied)', () => {
  const gen = new ProceduralGeometryGenerator();
  it('undivided road: white broken centre line, no yellow, kerbs 0.15 m', () => {
    const road = { ...base, id: 'r', type: 'road', name: 'r', coordinates: straight(90), roadClass: 'arterial', width: 14, laneCount: 4, laneWidth: 3.5,
      hasDivider: false, dividerWidth: 0, hasFootpath: true, footpathWidth: 2, speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [] } as unknown as RoadObject;
    const meshes = gen.generateMeshData(road);
    const marks = meshes.filter(m => m.layerId === 'marking');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every(m => m.material.materialId === 'marking_white')).toBe(true);
    // dashed: centre line over 90 m → 10 dashes × 4 vertices
    expect(marks.some(m => m.material.type === 'dashed')).toBe(true);
  });
  it('metro line: rails 4.1 m apart (track centres) at standard gauge, box girder 8.5 m', () => {
    const m = { ...base, id: 'm', type: 'metro_line', name: 'm', coordinates: straight(60), elevation: 12, trackCount: 2 } as unknown as MetroLineObject;
    const meshes = gen.generateMeshData(m);
    const rails = meshes.filter(x => x.layerId === 'transit_rails');
    expect(rails.length).toBe(4);
    // lateral offsets: project rail centroid on the north direction (path runs east)
    const north = (mesh: typeof rails[number]) => {
      let z = 0; for (let i = 2; i < mesh.positions.length; i += 3) z += mesh.positions[i];
      return z / (mesh.positions.length / 3);
    };
    const zs = rails.map(north).sort((a, b) => a - b);
    const cosLat = Math.cos((18.52 * Math.PI) / 180);
    const across = (dz: number) => dz / cosLat; // ECEF z change ≈ north offset × cos(lat)
    expect(across(zs[1] - zs[0])).toBeCloseTo(1.435, 1);
    expect(across((zs[2] + zs[3]) / 2 - (zs[0] + zs[1]) / 2)).toBeCloseTo(4.1, 1);
    const girder = meshes.find(x => x.layerId === 'transit_deck')!;
    let lo = Infinity, hi = -Infinity;
    for (let i = 2; i < girder.positions.length; i += 3) { lo = Math.min(lo, girder.positions[i]); hi = Math.max(hi, girder.positions[i]); }
    expect(across(hi - lo)).toBeGreaterThan(8.3); // 8.5 m deck (+ vertical depth contributes a little)
  });
  it('metro piers every 28 m by default with caps and barrier rings', () => {
    const m = { ...base, id: 'm', type: 'metro_line', name: 'm', coordinates: straight(112), elevation: 12, trackCount: 2 } as unknown as MetroLineObject;
    const meshes = gen.generateMeshData(m);
    const shafts = meshes.filter(x => x.layerId === 'transit_pillars');
    expect(shafts.length).toBe(4 * 2); // 4 piers × (shaft + flared head)
  });
  it('flyover: box girder deck, Jersey barriers, no amber stripe, piers at 30 m (assumed)', () => {
    const f = { ...base, id: 'f', type: 'flyover', name: 'f', coordinates: straight(120).map(p => [p[0], p[1], 8] as PathPt),
      groundCoordinates: straight(120), roadClass: 'arterial', width: 10, laneCount: 2, laneWidth: 3.5, hasDivider: true, dividerWidth: 1,
      hasFootpath: false, footpathWidth: 0, speedLimit: 60, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [] } as unknown as FlyoverObject;
    const meshes = gen.generateMeshData(f);
    expect(meshes.some(m => m.material.color === '#f59e0b')).toBe(false);
    expect(meshes[0].material.materialId).toBe('asphalt_deck'); // tint goes to the driving surface
    expect(meshes.filter(m => m.layerId === 'transit_pillars').length).toBe(4); // 15, 45, 75, 105
  });
});
