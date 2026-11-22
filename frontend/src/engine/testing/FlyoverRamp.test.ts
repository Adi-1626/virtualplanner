/**
 * Grade-driven flyover ramps (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md D5, GEOMETRY_EDITOR_DESIGN.md §1.5 / §7 phase 3):
 * the ramp length comes from the deck height and the decided grade (4 % urban / 3.3 % highway, IRC:SP:90-2023 §4.13) with
 * IRC:86-2018 Table 9.2 vertical curves; the 3D profile and the desk check read the same profile; as-built flyovers keep
 * the legacy 40 m ramp.
 */
import { describe, expect, it } from 'vitest';
import { flyoverOffsetAt, flyoverRampProfile, LEGACY_RAMP_LENGTH_M, RAMP_FOOT_CLEARANCE_M, verticalCurveMin } from '../geometry/vertical/flyoverRamp';
import { applyFlyoverElevationProfile } from '../objects/flyoverHelper';
import { BridgeFeasibilityEngine, bfe_pathLengthMeters } from '../simulation/BridgeFeasibilityEngine';
import { chainagesOf } from '../geometry/alignment/stationing';
import { ObjectManager } from '../objects/ObjectManager';
import { TrafficNetworkBuilder } from '../simulation/TrafficNetworkBuilder';

type P = [number, number, number];
const north = (m: number): P => [73.85, 18.5 + m / 111000, 0];

const flyover = (id: string, lengthM: number, extra: Record<string, unknown> = {}): any => ({
  id, type: 'flyover', name: id, layerId: 'roads', scenarioId: 'base', coordinates: [north(0), north(lengthM)], roadClass: 'arterial',
  width: 12, laneCount: 4, laneWidth: 3.5, hasDivider: true, dividerWidth: 2, hasFootpath: false, footpathWidth: 0, speedLimit: 60,
  isOneWay: false, elevation: 6, pierSpacing: 30, createdAt: 'T', updatedAt: 'T', ...extra,
});

const maxGrade = (coords: P[]) => {
  const ch = chainagesOf(coords);
  let g = 0;
  for (let i = 1; i < coords.length; i++) if (ch[i] - ch[i - 1] > 0.5) g = Math.max(g, Math.abs(coords[i][2] - coords[i - 1][2]) / (ch[i] - ch[i - 1]));
  return g;
};

describe('flyoverRampProfile', () => {
  it('6 m deck, urban 60 km/h: 150 m on the 4 % grade + 40 m vertical curve = 190 m per ramp, steepest exactly 4 %', () => {
    const p = flyoverRampProfile(6, 600, { roadClass: 'arterial', designSpeedKmh: 60 });
    expect(p.model).toBe('grade');
    expect(p.gradeLimit).toBe(0.04);
    expect(p.gradeSource).toContain('IRC:SP:90-2023 §4.13');
    expect(p.gradeLengthM).toBeCloseTo(150, 9);
    expect(p.verticalCurveM).toBe(40);
    expect(p.verticalCurveSource).toContain('IRC:86-2018 Table 9.2');
    expect(p.rampLengthM).toBeCloseTo(190, 9);
    expect(p.modelledRampM).toBeCloseTo(190, 9);
    expect(p.modelledMaxGrade).toBeCloseTo(0.04, 12);
    expect(p.withinLimit).toBe(true);
  });

  it('highway: 3.3 % → 182 m on the grade + 50 m curve (80 km/h) = 232 m', () => {
    const p = flyoverRampProfile(6, 1000, { roadClass: 'highway' });
    expect(p.gradeLimit).toBe(0.033);
    expect(p.designSpeedKmh).toBe(80);
    expect(p.rampLengthM).toBeCloseTo(6 / 0.033 + 50, 9);
  });

  it('vertical-curve length: the table row at or above the speed (longer curve), 100 km/h at most', () => {
    expect(verticalCurveMin(30).lengthM).toBe(15);
    expect(verticalCurveMin(45).lengthM).toBe(30);
    expect(verticalCurveMin(100).lengthM).toBe(60);
    expect(verticalCurveMin(120).lengthM).toBe(60);
  });

  it('the profile is continuous and smooth: 0 at the foot, the deck height on the deck, slope 0 at both ends of a ramp', () => {
    const p = flyoverRampProfile(6, 600, { designSpeedKmh: 60 });
    const H = 6, c = RAMP_FOOT_CLEARANCE_M;
    expect(flyoverOffsetAt(p, 0)).toBeCloseTo(c, 9);
    expect(flyoverOffsetAt(p, 600)).toBeCloseTo(c, 9);
    expect(flyoverOffsetAt(p, 190)).toBeCloseTo(H, 9);
    expect(flyoverOffsetAt(p, 300)).toBeCloseTo(H, 9);
    for (const s of [0, 40, 150, 190]) {
      expect(Math.abs(flyoverOffsetAt(p, s + 1e-4) - flyoverOffsetAt(p, s - 1e-4))).toBeLessThan(1e-5); // continuous
    }
    const slope = (s: number) => (flyoverOffsetAt(p, s + 0.01) - flyoverOffsetAt(p, s - 0.01)) / 0.02;
    expect(slope(0.02)).toBeLessThan(0.002);   // flat where it leaves the road
    expect(slope(189.98)).toBeLessThan(0.002); // flat where it meets the deck
    expect(slope(100)).toBeCloseTo(0.04 * (H - c) / H, 6); // on the grade (foot clearance scales it down a little)
  });

  it('a line too short for two ramps keeps the deck height and gets a steeper, failing grade — reported, not hidden', () => {
    const p = flyoverRampProfile(6, 200, { designSpeedKmh: 60 });
    expect(p.modelledRampM).toBeCloseTo(100, 9);
    expect(p.modelledMaxGrade).toBeGreaterThan(0.04);
    expect(p.withinLimit).toBe(false);
    expect(flyoverOffsetAt(p, 100)).toBeCloseTo(6, 9);
  });

  it('a low deck (H/g shorter than one curve) still gets full curves and stays within the limit', () => {
    const p = flyoverRampProfile(1, 600, { designSpeedKmh: 60 });
    expect(p.rampLengthM).toBeCloseTo(80, 9);
    expect(p.modelledMaxGrade).toBeLessThanOrEqual(0.04);
  });

  it('as-built: the legacy 40 m ramp, not judged', () => {
    const p = flyoverRampProfile(6, 600, { asBuilt: true });
    expect(p.model).toBe('legacy-40m');
    expect(p.modelledRampM).toBe(LEGACY_RAMP_LENGTH_M);
    expect(p.withinLimit).toBe(true);
    expect(flyoverOffsetAt(p, 40)).toBeCloseTo(6, 9);
  });
});

describe('3D profile and desk check agree', () => {
  it('a drawn flyover is modelled with the grade ramp; the check reads the same ramp and the 3D grade never passes 4 %', () => {
    const f = flyover('f1', 600);
    applyFlyoverElevationProfile(f);
    expect(f.rampProfile.model).toBe('grade');
    expect(f.rampProfile.rampLengthM).toBeCloseTo(190, 6);
    expect(maxGrade(f.coordinates)).toBeLessThanOrEqual(0.04 + 1e-9);
    const ch = chainagesOf(f.coordinates);
    f.coordinates.forEach((c: P, i: number) => { if (ch[i] >= 190 && ch[i] <= ch.at(-1)! - 190) expect(c[2]).toBeCloseTo(6, 6); });
    const r = new BridgeFeasibilityEngine().run(f.groundCoordinates, 6, 4, [], { roadClass: 'arterial', designSpeedKmh: 60 });
    expect(r.rampLengthRequired).toBe(190);
    expect(r.rampLengthAvailable.start).toBe(Math.round(f.rampProfile.modelledRampM));
    expect(r.rampProfile!.modelledMaxGrade).toBeCloseTo(f.rampProfile.modelledMaxGrade, 9);
    expect(r.checks.find(c => c.id === 'ramp_grade')!.status).toBe('pass');
  });

  it('ObjectManager screens a new flyover on the same profile it draws (fail when squeezed, with the model grade)', () => {
    const om = new ObjectManager();
    om.add(flyover('f2', 250), true);
    const f = om.getById('f2') as any;
    const res = f.feasibilityResult;
    expect(f.rampProfile.withinLimit).toBe(false);
    expect(res.checks.find((c: any) => c.id === 'ramp_grade').status).toBe('fail');
    expect(res.rampProfile.modelledMaxGrade).toBeCloseTo(f.rampProfile.modelledMaxGrade, 9);
    // the squeezed 3D ramp is as steep as the check says (the foot clearance makes the picture slightly gentler)
    expect(maxGrade(f.coordinates)).toBeLessThanOrEqual(f.rampProfile.modelledMaxGrade + 1e-9);
    expect(maxGrade(f.coordinates)).toBeGreaterThan(0.04);
  });

  it('an as-built (OSM) flyover keeps its legacy 40 m ramp shape and an information-only screen', () => {
    const om = new ObjectManager();
    om.add(flyover('osm_77', 600, { osmProvenance: { osmId: 77 } }), true);
    const f = om.getById('osm_77') as any;
    expect(f.rampProfile.model).toBe('legacy-40m');
    const ch = chainagesOf(f.coordinates);
    f.coordinates.forEach((c: P, i: number) => { if (ch[i] >= 40 && ch[i] <= ch.at(-1)! - 40) expect(c[2]).toBeCloseTo(6, 6); });
    expect(f.feasibilityResult.asBuilt).toBe(true);
    expect(f.feasibilityResult.checks.every((c: any) => c.status !== 'fail' && c.status !== 'warn')).toBe(true);
  });

  it('heights made with the legacy ramp and no stored ground line are read back to the true ground, then re-profiled', () => {
    // A flyover saved before the grade model: elevated coordinates from the legacy profile, no groundCoordinates/rampProfile
    const legacy = flyover('osm_1', 600, { osmProvenance: { osmId: 1 } });
    applyFlyoverElevationProfile(legacy);
    const stored = { ...flyover('old', 600), coordinates: legacy.coordinates.map((c: P) => [...c]) };
    applyFlyoverElevationProfile(stored);
    stored.groundCoordinates.forEach((g: P) => expect(g[2]).toBeCloseTo(0, 6));
    expect(stored.rampProfile.model).toBe('grade');
    expect(maxGrade(stored.coordinates)).toBeLessThanOrEqual(0.04 + 1e-9);
    expect(bfe_pathLengthMeters(stored.groundCoordinates)).toBeCloseTo(bfe_pathLengthMeters(legacy.groundCoordinates), 6);
  });

  it('re-applying the profile is idempotent (no double elevation)', () => {
    const f = flyover('f3', 600);
    applyFlyoverElevationProfile(f);
    const once = f.coordinates.map((c: P) => c[2]);
    applyFlyoverElevationProfile(f);
    f.coordinates.forEach((c: P, i: number) => expect(c[2]).toBeCloseTo(once[i], 9));
  });
});

describe('traffic graph: a long ramp does not join ground roads it only passes near', () => {
  it('a ramp vertex 0–3 m up within the join tolerance of a ground road is not a junction; the ends still join', () => {
    const f = flyover('f9', 600);
    applyFlyoverElevationProfile(f);
    // A ground road alongside the low part of the ramp, ~4 m east (inside the 6 m join tolerance), not touching the ends
    const east = 4 / (111000 * Math.cos((18.5 * Math.PI) / 180));
    const side = { ...flyover('g1', 0), type: 'road', coordinates: [[73.85 + east, 18.5 + 30 / 111000, 0], [73.85 + east, 18.5 + 90 / 111000, 0]], trafficCapacity: 1000, connectedJunctions: [] };
    // A ground road the flyover starts on (its end): joined
    const start = { ...flyover('g2', 0), type: 'road', coordinates: [[73.849, 18.5, 0], [73.85, 18.5, 0]], trafficCapacity: 1000, connectedJunctions: [] };
    const net = new TrafficNetworkBuilder().build([f, side, start] as any).network;
    const nodesOf = (id: string) => new Set([...net.edges.values()].filter(e => e.roadId === id).flatMap(e => [e.fromNodeId, e.toNodeId]));
    const fly = nodesOf('f9');
    expect([...nodesOf('g1')].some(n => fly.has(n))).toBe(false);
    expect([...nodesOf('g2')].some(n => fly.has(n))).toBe(true);
  });
});
