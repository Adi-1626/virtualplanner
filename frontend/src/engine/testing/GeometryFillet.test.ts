import { describe, expect, it } from 'vitest';
import { densifyAlignment, filletAlignment, maxFittingRadius } from '../geometry/alignment';
import { arcSteps } from '../geometry/alignment/densify';
import { pisFromXY, xyIn } from './geometryTestHelpers';

const L90: [number, number][] = [[0, 0], [200, 0], [200, 200]];

describe('fillet (PI + radius)', () => {
  it('T = R·tan(Δ/2) and L = R·Δ, TC/CT/centre in place', () => {
    const pis = pisFromXY(L90); pis[1].radiusM = 50;
    const r = filletAlignment({ behaviour: 'curved', pis });
    expect(r.ok).toBe(true);
    const f = r.pis[1];
    expect(f.deflectionRad).toBeCloseTo(Math.PI / 2, 9); // + = left turn
    expect(Math.abs(f.tangentLengthM - 50 * Math.tan(f.deflectionRad / 2))).toBeLessThan(1e-9);
    expect(Math.abs(f.arcLengthM - 50 * f.deflectionRad)).toBeLessThan(1e-9);
    const [tc, ct, c] = xyIn(pis, [f.tc!, f.ct!, f.centre!], [0, 0]);
    expect(tc[0]).toBeCloseTo(150, 6); expect(tc[1]).toBeCloseTo(0, 6);
    expect(ct[0]).toBeCloseTo(200, 6); expect(ct[1]).toBeCloseTo(50, 6);
    expect(c[0]).toBeCloseTo(150, 6); expect(c[1]).toBeCloseTo(50, 6);
    expect(r.elements.map(e => e.kind)).toEqual(['tangent', 'arc', 'tangent']);
    expect(r.lengthM).toBeCloseTo(150 + 25 * Math.PI + 150, 6);
  });

  it('right turn has negative deflection and centre on the right', () => {
    const pis = pisFromXY([[0, 0], [200, 0], [200, -200]], 40);
    const f = filletAlignment({ behaviour: 'curved', pis }).pis[1];
    expect(f.deflectionRad).toBeCloseTo(-Math.PI / 2, 9);
    const [c] = xyIn(pis, [f.centre!], [0, 0]);
    expect(c[0]).toBeCloseTo(160, 6); expect(c[1]).toBeCloseTo(-40, 6);
  });

  it('tangent continuity at TC and CT (< 1e-6 rad)', () => {
    const pis = pisFromXY([[0, 0], [300, 40], [420, 260]], 120);
    const r = filletAlignment({ behaviour: 'curved', pis });
    const f = r.pis[1];
    const [p0, p1, p2, tc, ct, c] = xyIn(pis, [[pis[0].lon, pis[0].lat], [pis[1].lon, pis[1].lat], [pis[2].lon, pis[2].lat], f.tc!, f.ct!, f.centre!], [0, 0]);
    const ang = (a: number[], b: number[]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = Math.sign(f.deflectionRad);
    // arc tangent direction = radius direction rotated by ±90°
    const arcDir = (p: number[]) => ang(c, p) + (s * Math.PI) / 2;
    const diff = (x: number, y: number) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
    expect(diff(arcDir(tc), ang(p0, p1))).toBeLessThan(1e-6);
    expect(diff(arcDir(ct), ang(p1, p2))).toBeLessThan(1e-6);
  });

  it('fit rule clamps a radius that does not fit, and reports the requested value', () => {
    const pis = pisFromXY([[0, 0], [60, 0], [60, 200]], 100);
    const f = filletAlignment({ behaviour: 'curved', pis }).pis[1];
    expect(f.clamped).toBe(true);
    expect(f.requestedRadiusM).toBe(100);
    expect(f.radiusM).toBeCloseTo(60, 6);
    expect(f.tangentLengthM).toBeCloseTo(60, 6);
    expect(maxFittingRadius({ pis }, 1)).toBeCloseTo(60, 6);
    expect(maxFittingRadius({ pis }, 0)).toBe(0);
  });

  it('two curves sharing a tangent split it in proportion (T(i) + T(i+1) ≤ distance)', () => {
    const pis = pisFromXY([[0, 0], [100, 0], [100, 100], [200, 100]], 80);
    const r = filletAlignment({ behaviour: 'curved', pis });
    expect(r.pis[1].radiusM).toBeCloseTo(50, 6);
    expect(r.pis[2].radiusM).toBeCloseTo(50, 6);
    expect(r.pis[1].tangentLengthM + r.pis[2].tangentLengthM).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('a fitting radius is kept exactly (not clamped)', () => {
    const pis = pisFromXY(L90, 100);
    const f = filletAlignment({ behaviour: 'curved', pis }).pis[1];
    expect(f.clamped).toBe(false);
    expect(f.radiusM).toBe(100);
  });

  it('Δ < 0.5° gives no curve; a U-turn (≥ 179°) is refused; coincident PIs are refused', () => {
    const small = filletAlignment({ behaviour: 'curved', pis: pisFromXY([[0, 0], [100, 0], [200, 0.5]], 300) });
    expect(small.ok).toBe(true);
    expect(small.pis[1].radiusM).toBe(0);
    expect(small.pis[1].noCurveReason).toBe('small-deflection');
    const u = filletAlignment({ behaviour: 'curved', pis: pisFromXY([[0, 0], [100, 0], [0, 0.5]], 30) });
    expect(u.ok).toBe(false);
    expect(u.error).toBe('u-turn');
    expect(u.errorPiIndex).toBe(1);
    const same = filletAlignment({ behaviour: 'curved', pis: pisFromXY([[0, 0], [0, 0], [10, 0]]) });
    expect(same.error).toBe('coincident-pis');
    expect(filletAlignment({ behaviour: 'curved', pis: pisFromXY([[0, 0]]) }).error).toBe('too-few-pis');
  });
});

describe('densify', () => {
  it('R = 0 is an identity (output == input PIs), and angled ignores radii', () => {
    const pis = pisFromXY([[0, 0], [120, 30], [180, 160], [400, 170]]);
    const d = densifyAlignment({ behaviour: 'curved', pis });
    expect(d.ok).toBe(true);
    expect(d.coordinates).toEqual(pis.map(p => [p.lon, p.lat, 0]));
    const withR = pis.map(p => ({ ...p, radiusM: 80 }));
    expect(densifyAlignment({ behaviour: 'angled', pis: withR }).coordinates).toEqual(pis.map(p => [p.lon, p.lat, 0]));
    expect(d.piChainagesM[0]).toBe(0);
    expect(d.piChainagesM[3]).toBeCloseTo(d.chainagesM[d.chainagesM.length - 1], 9);
  });

  for (const R of [30, 300, 1200]) {
    it(`arc chords: sagitta ≤ 0.10 m, step ≤ 10 m, vertices on the circle (R ${R})`, () => {
      const pis = pisFromXY([[0, 0], [2000, 0], [2000, 2000]], R);
      const d = densifyAlignment({ behaviour: 'curved', pis });
      const f = d.fillet.pis[1];
      const xy = xyIn(pis, d.coordinates, [0, 0]);
      const [c] = xyIn(pis, [f.centre!], [0, 0]);
      const arcPts = xy.filter(p => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - R) < 1e-6);
      expect(arcPts.length).toBe(arcSteps(R, Math.PI / 2) + 1);
      for (let i = 0; i + 1 < arcPts.length; i++) {
        const chord = Math.hypot(arcPts[i + 1][0] - arcPts[i][0], arcPts[i + 1][1] - arcPts[i][1]);
        expect(chord).toBeLessThanOrEqual(10 + 1e-9);
        expect(R - Math.sqrt(R * R - (chord / 2) ** 2)).toBeLessThanOrEqual(0.1 + 1e-9);
      }
      // tangents keep only their end points: start, TC … CT, end
      expect(d.coordinates.length).toBe(arcPts.length + 2);
    });
  }

  it('PI chainage of a curved PI is the arc middle; total length ≈ arc-based length', () => {
    const pis = pisFromXY(L90, 50);
    const d = densifyAlignment({ behaviour: 'curved', pis });
    const L = d.chainagesM[d.chainagesM.length - 1];
    expect(Math.abs(L - d.fillet.lengthM)).toBeLessThan(0.1); // chords vs arc at sagitta 0.10 m
    expect(d.piChainagesM[1]).toBeCloseTo(150 + 12.5 * Math.PI, 1);
  });

  it('invalid geometry returns the raw PIs with ok = false', () => {
    const pis = pisFromXY([[0, 0], [100, 0], [0, 0.5]], 30);
    const d = densifyAlignment({ behaviour: 'curved', pis });
    expect(d.ok).toBe(false);
    expect(d.coordinates.length).toBe(3);
  });
});
