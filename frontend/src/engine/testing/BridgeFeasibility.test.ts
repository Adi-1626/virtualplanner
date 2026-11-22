import { describe, it, expect } from 'vitest';
import { BridgeFeasibilityEngine, bfe_pathLengthMeters, isAsBuiltFlyover, maxRampGrade, MIN_FLAT_DECK_LABEL } from '../simulation/BridgeFeasibilityEngine';
import type { RoadObject } from '../objects/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRoad(
  id: string,
  name: string,
  coords: [number, number, number][],
  opts: Partial<RoadObject> = {}
): RoadObject {
  return {
    id, type: 'road', name,
    layerId: 'roads', scenarioId: 'base',
    coordinates: coords,
    roadClass: 'arterial', width: 19,
    laneCount: 4, laneWidth: 3.5,
    hasDivider: true, dividerWidth: 3.5,
    hasFootpath: true, footpathWidth: 1.5,
    speedLimit: 60, isOneWay: false,
    trafficCapacity: 2000,
    connectedJunctions: [],
    createdAt: '', updatedAt: '',
    ...opts,
  } as RoadObject;
}

function mToLatDeg(m: number): number { return m / 111000; }
function mToLonDeg(m: number, lat: number): number {
  return m / (111000 * Math.cos((lat * Math.PI) / 180));
}

// Shared coordinate layout:
// Flyover runs NORTH 500m from BASE_ORIGIN (two 190 m ramps at 4 % with 20 m vertical-curve halves + a 50 m deck fit).
// Approach roads START at the flyover endpoints (closestDist = 0 < 60m).
// Underpassing road passes within 25m of the flyover mid-section lon.

const BASE_LON = 73.74;
const BASE_LAT = 18.585;
const FLY_START: [number, number, number] = [BASE_LON, BASE_LAT, 0];
const FLY_END: [number, number, number]   = [BASE_LON, BASE_LAT + mToLatDeg(500), 0];
const MID_LAT = BASE_LAT + mToLatDeg(250); // mid-section

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BridgeFeasibilityEngine', () => {
  const engine = new BridgeFeasibilityEngine();

  it('Test 1: PASS - flyover 500m with 500m approach roads (6m elevation)', () => {
    const roadAtStart = makeRoad('r1', 'Start Road', [
      FLY_START,
      [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0],
    ]);
    const roadAtEnd = makeRoad('r2', 'End Road', [
      FLY_END,
      [BASE_LON + mToLonDeg(500, FLY_END[1]), FLY_END[1], 0],
    ]);

    const result = engine.run([FLY_START, FLY_END], 6.0, 4, [roadAtStart, roadAtEnd]);

    expect(result.rampGradeLength).toBe(150); // 6 m at 4 % (urban, IRC:SP:90-2023 §4.13) = 150 m on the grade
    expect(result.rampLengthRequired).toBe(190); // + 2 × 20 m vertical-curve halves (IRC:86-2018 Table 9.2, 60 km/h: 40 m)
    expect(result.totalFlyoverLength).toBeGreaterThanOrEqual(450);

    const deckCheck = result.checks.find(c => c.id === 'deck_length')!;
    expect(deckCheck.status).toBe('pass');

    const rampCheck = result.checks.find(c => c.id === 'ramp_grade')!;
    expect(rampCheck.status).toBe('pass');

    expect(result.feasible).toBe(true);
  });

  it('Test 2: flyover only 80m: deck shorter than 190+190+50 m only WARNS (50 m deck is assumed); the ramps squeezed into 40 m fail the 4 % grade', () => {
    const shortEnd: [number, number, number] = [BASE_LON, BASE_LAT + mToLatDeg(80), 0];
    const roadAtStart = makeRoad('r3', 'Short Start Road', [
      FLY_START,
      [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0],
    ]);

    const result = engine.run([FLY_START, shortEnd], 6.0, 4, [roadAtStart]);

    const deckCheck = result.checks.find(c => c.id === 'deck_length')!;
    expect(deckCheck.status).toBe('warn');
    expect(deckCheck.name).toContain(MIN_FLAT_DECK_LABEL);
    const ramp = result.checks.find(c => c.id === 'ramp_grade')!;
    expect(ramp.status).toBe('fail');
    expect(ramp.message).toMatch(/squeezes each ramp into 40 m/);
    expect(result.rampProfile!.modelledMaxGrade).toBeGreaterThan(0.04);
    expect(result.feasible).toBe(false);
  });

  it('Test 3: WARN - underpassing road has 2.5m median (below 3.0m pier fit threshold)', () => {
    // Road runs E-W through flyover mid-section, coords within 25m of flyover path
    const underpassRoad = makeRoad('r4', 'Narrow Median Road', [
      [BASE_LON - mToLonDeg(25, MID_LAT), MID_LAT, 0],
      [BASE_LON + mToLonDeg(25, MID_LAT), MID_LAT, 0],
    ], { hasDivider: true, dividerWidth: 2.5 });

    const roadAtStart = makeRoad('r5', 'Start Road', [
      FLY_START,
      [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0],
    ]);
    const roadAtEnd = makeRoad('r6', 'End Road', [
      FLY_END,
      [BASE_LON + mToLonDeg(500, FLY_END[1]), FLY_END[1], 0],
    ]);

    const result = engine.run([FLY_START, FLY_END], 6.0, 4, [underpassRoad, roadAtStart, roadAtEnd]);

    const pierCheck = result.checks.find(c => c.id === 'pier_fit')!;
    expect(pierCheck.status).toBe('warn');
    expect(pierCheck.message).toContain('Narrow Median Road');
    expect(result.feasible).toBe(true);
  });

  it('Test 4: WARN - 4-lane flyover connects to 2-lane road (lane mismatch)', () => {
    // 2-lane road at flyover START → triggers lane mismatch warn
    const twoLaneRoad = makeRoad('r7', 'Local Street', [
      FLY_START,
      [BASE_LON + mToLonDeg(300, BASE_LAT), BASE_LAT, 0],
    ], { laneCount: 2, trafficCapacity: 1000 });

    // 4-lane road at flyover END → satisfies ramp grade check (end approach = 400m > 120m required)
    const endRoad = makeRoad('r7b', 'End Road', [
      FLY_END,
      [BASE_LON + mToLonDeg(400, FLY_END[1]), FLY_END[1], 0],
    ], { laneCount: 4, trafficCapacity: 2000 });

    const result = engine.run([FLY_START, FLY_END], 6.0, 4, [twoLaneRoad, endRoad]);

    const laneCheck = result.checks.find(c => c.id === 'lane_match')!;
    expect(laneCheck.status).toBe('warn');
    expect(laneCheck.message).toContain('Local Street (2 lanes)');
    expect(laneCheck.name).not.toMatch(/MORTH/);
    // All ramp grade / deck length checks pass → overall feasible despite lane warn
    expect(result.feasible).toBe(true);
  });

  it('Test 5: PASS+IMPACT - surface road capacity reduced by an assumed 25% (weave zone; no published figure)', () => {
    const artRoad = makeRoad('r8', 'Main Arterial', [
      FLY_START,
      [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0],
    ], { trafficCapacity: 2000 });

    const result = engine.run([FLY_START, FLY_END], 6.0, 4, [artRoad]);

    expect(result.surfaceRoadImpacts.length).toBeGreaterThan(0);
    const impact = result.surfaceRoadImpacts[0];
    expect(impact.capacityReductionPercent).toBe(25);
    expect(impact.reducedCapacity).toBe(1500);
    expect(impact.originalCapacity).toBe(2000);
    // p5-qa: it was cited as "MORTH" with no document; it is an assumption and must say so
    expect(impact.reason).toMatch(/assumed/i);
    expect(impact.reason).not.toMatch(/MORTH/);
  });

  it('Test 7: honesty - says what it checked and what it did not', () => {
    const roadAtStart = makeRoad('r9', 'Start Road', [FLY_START, [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0]]);
    const roadAtEnd = makeRoad('r10', 'End Road', [FLY_END, [BASE_LON + mToLonDeg(500, FLY_END[1]), FLY_END[1], 0]]);
    const result = engine.run([FLY_START, FLY_END], 6.0, 4, [roadAtStart, roadAtEnd]);
    expect(result.feasible).toBe(true);
    expect(result.scope).toMatch(/Not a feasibility study/);
    expect(result.notChecked!.length).toBeGreaterThan(3);
    expect(result.notChecked!.join(' ')).toMatch(/soil|Ground conditions/);
    // No road under the deck: nothing measured, so no made-up median value.
    const pier = result.checks.find(c => c.id === 'pier_fit')!;
    expect(pier.actual).toBeNull();
    expect(result.checks.every(c => !!c.basis)).toBe(true);
  });

  it('Test 8: honesty - OSM median widths are model values, so a wide one is unknown, not a pass', () => {
    const osmUnder = makeRoad('osm_123', 'Mapped Road', [
      [BASE_LON - mToLonDeg(25, MID_LAT), MID_LAT, 0],
      [BASE_LON + mToLonDeg(25, MID_LAT), MID_LAT, 0],
    ], { hasDivider: true, dividerWidth: 4 });
    const roadAtStart = makeRoad('r11', 'Start Road', [FLY_START, [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0]]);
    const roadAtEnd = makeRoad('r12', 'End Road', [FLY_END, [BASE_LON + mToLonDeg(500, FLY_END[1]), FLY_END[1], 0]]);
    const result = engine.run([FLY_START, FLY_END], 6.0, 4, [osmUnder, roadAtStart, roadAtEnd]);
    const pier = result.checks.find(c => c.id === 'pier_fit')!;
    expect(pier.status).toBe('unknown');
    expect(pier.message).toContain('Mapped Road');
    expect(pier.basis).toMatch(/OpenStreetMap/);
    expect(pier.actual).toBeNull();
  });

  it('Test 6: bfe_pathLengthMeters - 0.009 deg lat should be ~999m', () => {
    const coords: [number, number, number][] = [
      [73.74, 18.590, 0],
      [73.74, 18.599, 0],
    ];
    const len = bfe_pathLengthMeters(coords);
    expect(len).toBeGreaterThan(900);
    expect(len).toBeLessThan(1100);
  });

  it('D5: ramp grade from IRC:SP:90-2023 §4.13 — 4 % on urban roads, 3.3 % on a highway (the 2010 3.5 % cap is gone)', () => {
    expect(maxRampGrade('arterial')).toMatchObject({ grade: 0.04 });
    expect(maxRampGrade(undefined).grade).toBe(0.04);
    expect(maxRampGrade('highway')).toMatchObject({ grade: 0.033 });
    expect(maxRampGrade('local').source).toContain('IRC:SP:90-2023 §4.13');
    // The ramps sit on the drawn alignment (as the 3D model draws them): approach roads no longer decide the grade
    const r = engine.run([FLY_START, FLY_END], 6.0, 4, []);
    const ramp = r.checks.find(c => c.id === 'ramp_grade')!;
    expect(ramp.name).toContain('4 %');
    expect(ramp.basis).toContain('IRC:SP:90-2023 §4.13');
    expect(ramp.basis).toContain('IRC:86-2018 Table 9.2');
    expect(ramp.status).toBe('pass');
    const hw = engine.run([FLY_START, FLY_END], 6.0, 4, [], { roadClass: 'highway' });
    expect(hw.rampGradeLength).toBe(182); // 6 / 0.033 = 181.8
    expect(hw.rampLengthRequired).toBe(232); // + 50 m (80 km/h vertical curves)
    // 500 m holds 2 × 232 m of ramp at 3.3 %, but not the assumed 50 m flat deck as well: a warning only
    expect(hw.checks.find(c => c.id === 'ramp_grade')!.status).toBe('pass');
    expect(hw.checks.find(c => c.id === 'deck_length')!.status).toBe('warn');
  });

  it('D5: an as-built flyover is information only — nothing fails, no surface road is changed', () => {
    const under = makeRoad('u', 'Under', [[BASE_LON - mToLonDeg(25, MID_LAT), MID_LAT, 0], [BASE_LON + mToLonDeg(25, MID_LAT), MID_LAT, 0]], { dividerWidth: 1 });
    const shortEnd: [number, number, number] = [BASE_LON, BASE_LAT + mToLatDeg(80), 0];
    const r = engine.run([FLY_START, shortEnd], 6.0, 4, [under], { asBuilt: true });
    expect(r.asBuilt).toBe(true);
    expect(r.checks.some(c => c.status === 'fail' || c.status === 'warn')).toBe(false);
    expect(r.checks.find(c => c.id === 'ramp_grade')!.status).toBe('info');
    expect(r.checks.find(c => c.id === 'ramp_grade')!.message).toMatch(/information only/);
    expect(r.surfaceRoadImpacts).toEqual([]);
    expect(r.feasible).toBe(true);
  });

  it('D5: as-built = mapped (OSM / municipal / surveyed) and not geometry-edited; drawn designs are not', () => {
    expect(isAsBuiltFlyover({ id: 'osm_123' })).toBe(true);
    expect(isAsBuiltFlyover({ id: 'f1', osmProvenance: { osmId: 1 } })).toBe(true);
    expect(isAsBuiltFlyover({ id: 'f2', provenance: { originalSource: 'municipal' } })).toBe(true);
    expect(isAsBuiltFlyover({ id: 'f3', provenance: { originalSource: 'OSM', geometryModified: true } })).toBe(false);
    expect(isAsBuiltFlyover({ id: 'abc123' })).toBe(false);
    expect(isAsBuiltFlyover({ id: 'f4', provenance: { originalSource: 'manual' } })).toBe(false);
  });
});

describe('Flyover desk check: elevated metro (p6)', () => {
  const engine = new BridgeFeasibilityEngine();
  const approach = [
    makeRoad('ra', 'Start Road', [FLY_START, [BASE_LON + mToLonDeg(500, BASE_LAT), BASE_LAT, 0]], { laneCount: 3 }),
    makeRoad('rb', 'End Road', [FLY_END, [BASE_LON + mToLonDeg(500, FLY_END[1]), FLY_END[1], 0]], { laneCount: 2 }),
  ];
  // OSM Line 2 style viaduct along the same alignment, level 12 m (model default; OSM does not map height)
  const viaduct = { id: 'osm_m_way_1', name: 'Pune Metro Line 2', coordinates: [[BASE_LON, BASE_LAT - mToLatDeg(100), 12], [BASE_LON, BASE_LAT + mToLatDeg(600), 12]] as [number, number, number][], level: 12, levelSource: 'osm_assumed' as const };

  it('a flyover along the elevated metro raises a potential conflict with assumed clearance and the official NOC zone', () => {
    const result = engine.run([FLY_START, FLY_END], 6.0, 2, approach, { metroLines: [viaduct] });
    const c = result.checks.find(x => x.id === 'metro_clearance')!;
    expect(c.status).toBe('warn');
    expect(c.message).toMatch(/Potential conflict/);
    expect(c.message).toMatch(/runs along the viaduct/);
    expect(c.message).toMatch(/NOC/);
    expect(c.basis).toMatch(/assumed/);
    expect(c.basis).toMatch(/UDCPR 2020/);
    expect(c.basis).toMatch(/does not map its height/);
    expect(c.actual).toBeLessThan(5.5);
  });

  it('a metro 300 m away is outside the NOC zone; an absence is not called clear', () => {
    const far = { ...viaduct, coordinates: viaduct.coordinates.map(([x, y, z]) => [x + mToLonDeg(300, y), y, z]) as [number, number, number][] };
    const c = engine.run([FLY_START, FLY_END], 6.0, 2, approach, { metroLines: [far] }).checks.find(x => x.id === 'metro_clearance')!;
    expect(c.status).toBe('info');
    expect(c.message).toMatch(/not a confirmation/);
    const none = engine.run([FLY_START, FLY_END], 6.0, 2, approach, { metroLines: [] }).checks.find(x => x.id === 'metro_clearance')!;
    expect(none.status).toBe('info');
    const notSupplied = engine.run([FLY_START, FLY_END], 6.0, 2, approach).checks.find(x => x.id === 'metro_clearance')!;
    expect(notSupplied.status).toBe('unknown');
  });

  it('an underground metro (level 0) is not screened as a viaduct', () => {
    const tunnel = { ...viaduct, level: 0, coordinates: viaduct.coordinates.map(([x, y]) => [x, y, 0]) as [number, number, number][] };
    const c = engine.run([FLY_START, FLY_END], 6.0, 2, approach, { metroLines: [tunnel] }).checks.find(x => x.id === 'metro_clearance')!;
    expect(c.status).toBe('info');
  });

  it('lane check: plain header, and it never implies the ramps are joined', () => {
    const lane = engine.run([FLY_START, FLY_END], 6.0, 2, approach, { metroLines: [] }).checks.find(x => x.id === 'lane_match')!;
    expect(lane.display).toBe('Deck 2 lanes · roads near the ends 2–3');
    expect(lane.message).toMatch(/joined or not|Connectivity/);
    expect(lane.message).not.toMatch(/adjacent surface roads/);
    const alone = engine.run([FLY_START, FLY_END], 6.0, 2, [], { metroLines: [] }).checks.find(x => x.id === 'lane_match')!;
    expect(alone.status).toBe('info');
  });
});
