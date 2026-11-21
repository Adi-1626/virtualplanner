import { describe, expect, it } from 'vitest';
import { chainagesOf, curveElements, pointAtChainage, projectOntoLine } from '../geometry/alignment';
import { bearingDeg, stationOfVertex, tangentAt } from '../geometry/alignment/stationing';
import { lonLatFromXY, pisFromXY } from './geometryTestHelpers';

const line = lonLatFromXY([[0, 0], [100, 0], [100, 100]]).map(([lon, lat]) => [lon, lat, 0] as [number, number, number]);

describe('chainage helpers', () => {
  it('chainages, stationOfVertex', () => {
    const ch = chainagesOf(line);
    expect(ch[0]).toBe(0);
    expect(ch[1]).toBeCloseTo(100, 6);
    expect(ch[2]).toBeCloseTo(200, 6);
    expect(stationOfVertex(line, 1)).toBeCloseTo(100, 6);
    expect(stationOfVertex(line, 9)).toBeCloseTo(200, 6);
  });

  it('pointAtChainage interpolates, gives the bearing, and clamps', () => {
    const p = pointAtChainage(line, 150)!;
    const q = lonLatFromXY([[0, 0], [100, 0], [100, 100]]);
    expect(p.lon).toBeCloseTo(q[1][0], 9);
    expect(p.lat).toBeCloseTo((q[1][1] + q[2][1]) / 2, 9);
    expect(p.bearingDeg).toBeCloseTo(0, 6); // north
    expect(p.segmentIndex).toBe(1);
    expect(tangentAt(line, 50)).toBeCloseTo(90, 6); // east
    expect(pointAtChainage(line, -5)!.chainageM).toBe(0);
    expect(pointAtChainage(line, 1e9)!.chainageM).toBeCloseTo(200, 6);
    expect(pointAtChainage([line[0]], 0)).toBeNull();
  });

  it('projectOntoLine gives chainage and offset', () => {
    const pts = lonLatFromXY([[0, 0], [100, 0], [100, 100], [50, 10]]);
    const l = pts.slice(0, 3).map(([lon, lat]) => [lon, lat, 0]);
    const r = projectOntoLine(l, pts[3])!;
    expect(r.chainageM).toBeCloseTo(50, 3);
    expect(r.offsetM).toBeCloseTo(10, 3);
  });

  it('bearingDeg is clockwise from north', () => {
    const [a, b] = lonLatFromXY([[0, 0], [-10, -10]]);
    expect(bearingDeg(a, b)).toBeCloseTo(225, 3);
  });

  it('curveElements lists tangent / arc / tangent with chainages', () => {
    const pis = pisFromXY([[0, 0], [200, 0], [200, 200]], 50);
    const els = curveElements({ behaviour: 'curved', pis });
    expect(els.map(e => e.kind)).toEqual(['tangent', 'arc', 'tangent']);
    expect(els[1].startChainageM).toBeCloseTo(150, 6);
    expect(els[1].radiusM).toBe(50);
    expect(els[2].endChainageM).toBeCloseTo(300 + 25 * Math.PI, 6);
  });
});
