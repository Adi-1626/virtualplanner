import { describe, expect, it } from 'vitest';
import { checkAlignment, minRadius, requiredTransitionLength, type HorizontalAlignment } from '../geometry/alignment';
import {
  IRC86_TABLE10_MIN_RADIUS_M, IRC86_TABLE8_SSD_M, IRC_SP90, METRO_PUNE_SK_DPR, radiusFromFormula, SCREENING_DISCLAIMER, VERTICAL_CURVE_MIN,
} from '../geometry/alignment/criteria';
import { pisFromXY } from './geometryTestHelpers';

describe('criteria tables (as read in GEOMETRY_EDITOR_DESIGN.md §2.2)', () => {
  it('IRC:86 Table 10, Table 8, Table 14 / SP:23 Table 7, SP:90, Pune S–K DPR', () => {
    expect(IRC86_TABLE10_MIN_RADIUS_M).toEqual({ 30: { e7: 30, e4: 40 }, 50: { e7: 90, e4: 105 }, 60: { e7: 130, e4: 150 }, 80: { e7: 230, e4: 265 } });
    expect(IRC86_TABLE8_SSD_M).toEqual({ 30: 30, 50: 60, 60: 80, 80: 120 });
    expect(Object.fromEntries(Object.entries(VERTICAL_CURVE_MIN).map(([v, r]) => [v, [r.maxGradeChangePct, r.minLengthM]])))
      .toEqual({ 30: [1.5, 15], 40: [1.2, 20], 50: [1.0, 30], 60: [0.8, 40], 80: [0.6, 50], 100: [0.5, 60] });
    expect(IRC_SP90.maxGradientPct).toBe(3.5);
    expect([METRO_PUNE_SK_DPR.minRadiusLimitingM, METRO_PUNE_SK_DPR.minRadiusPreferentialM, METRO_PUNE_SK_DPR.minRadiusTbmM, METRO_PUNE_SK_DPR.minRadiusAtStationsM])
      .toEqual([120, 225, 200, 1000]);
  });

  it('formula R = V²/127(e+f): 80 km/h, e 7 % → 229 m', () => {
    expect(Math.round(radiusFromFormula(80, 0.07))).toBe(229);
  });

  it('minRadius: table where the speed is in Table 10, else labelled as calculated', () => {
    expect(minRadius('irc86-urban', 80, 0.07)).toMatchObject({ valueM: 230, basis: 'table', source: 'IRC:86-1983 Table 10' });
    expect(minRadius('irc86-urban', 80, 0.04)!.valueM).toBe(265);
    expect(minRadius('irc86-urban', 30, 0.04)!.valueM).toBe(40);
    const r40 = minRadius('irc86-urban', 40, 0.07)!;
    expect(r40.basis).toBe('formula');
    expect(r40.source).toMatch(/calculated/);
    const hw = minRadius('irc73-rural', 100, 0.07)!;
    expect(Math.round(hw.valueM)).toBe(358);
    expect(hw.basis).toBe('formula');
    expect(hw.source).toMatch(/calculated from IRC:73-1980 formula/);
    expect(minRadius('metro-pune-sk-dpr', 90, 0.07)).toMatchObject({ valueM: 120, basis: 'project-value' });
    expect(minRadius('none', 50, 0.04)).toBeNull();
  });

  it('IRC:86 §10.5.2 transition length (80 km/h, R 250 → 85 m)', () => {
    expect(Math.round(requiredTransitionLength(80, 250)!.valueM)).toBe(85);
    expect(requiredTransitionLength(80, 0)).toBeNull();
  });
});

const L90 = (R: number) => pisFromXY([[0, 0], [1000, 0], [1000, 1000]], R);
const road = (R: number, over: Partial<HorizontalAlignment> = {}): HorizontalAlignment => ({
  v: 1, behaviour: 'curved', pis: L90(R), designSpeedKmh: 80, designSpeedSource: 'class-default', eMax: 0.04, criteria: 'irc86-urban', ...over,
});
const FORBIDDEN = /\b(compliant|complies|compliance|passes|approved|meets)\b/i;

describe('checkAlignment (screening, never approval)', () => {
  it('flags a radius below the IRC:86 minimum with source and disclaimer', () => {
    const flags = checkAlignment(road(180));
    const below = flags.find(f => f.code === 'radius-below-minimum')!;
    expect(below.severity).toBe('warn');
    expect(below.requiredM).toBe(265);
    expect(below.message).toContain('IRC:86-1983 Table 10');
    expect(below.message).toContain('R 180 m is below 265 m (80 km/h, e 4 %');
    for (const f of flags) {
      expect(f.screening).toBe(true);
      expect(f.message.endsWith(SCREENING_DISCLAIMER)).toBe(true);
      expect(f.message).not.toMatch(FORBIDDEN);
    }
  });

  it('a large radius gets no warning but still the transition-not-modelled note with the Ls it would need', () => {
    const flags = checkAlignment(road(400));
    expect(flags.some(f => f.severity === 'warn')).toBe(false);
    const t = flags.find(f => f.code === 'transition-not-modelled')!;
    expect(t.severity).toBe('info');
    expect(t.requiredM).toBeGreaterThan(0);
  });

  it('no design speed or no criteria → not checked, never a pass', () => {
    const a = checkAlignment(road(100, { designSpeedKmh: null }));
    expect(a.map(f => f.code)).toContain('not-checked-no-design-speed');
    expect(a.some(f => f.code === 'radius-below-minimum')).toBe(false);
    expect(checkAlignment(road(100, { criteria: 'none' })).map(f => f.code)).toContain('not-checked-no-criteria');
  });

  it('flags a radius reduced to fit', () => {
    const a = road(0, { pis: pisFromXY([[0, 0], [60, 0], [60, 200]], 300) });
    const f = checkAlignment(a).find(x => x.code === 'radius-reduced-to-fit')!;
    expect(f.radiusM).toBeCloseTo(60, 6);
    expect(f.requiredM).toBe(300);
  });

  it('metro: limiting / preferential / TBM / station minimum and short curve (Pune S–K DPR project values)', () => {
    const metro = (R: number) => road(R, { criteria: 'metro-pune-sk-dpr', designSpeedKmh: 90, eMax: 0.07 });
    expect(checkAlignment(metro(100)).find(f => f.code === 'radius-below-minimum')!.requiredM).toBe(120);
    const pref = checkAlignment(metro(150));
    expect(pref.some(f => f.code === 'radius-below-minimum')).toBe(false);
    expect(pref.find(f => f.code === 'radius-below-preferred')!.severity).toBe('info');
    expect(checkAlignment(metro(150), { tbm: true }).find(f => f.code === 'radius-below-minimum')!.requiredM).toBe(200);
    const st = checkAlignment(metro(500), { stationChainagesM: [1000] });
    expect(st.find(f => f.code === 'radius-below-station-minimum')!.requiredM).toBe(1000);
    expect(checkAlignment(metro(500), { stationChainagesM: [100] }).some(f => f.code === 'radius-below-station-minimum')).toBe(false);
    const short = road(0, { criteria: 'metro-pune-sk-dpr', designSpeedKmh: 90, eMax: 0.07, pis: pisFromXY([[0, 0], [500, 0], [1000, 30]], 300) });
    expect(checkAlignment(short).map(f => f.code)).toContain('metro-short-curve');
    for (const f of st) expect(f.message).toMatch(/project value/);
  });

  it('metro: straight between curves under 25 m', () => {
    const a = road(0, { criteria: 'metro-pune-sk-dpr', designSpeedKmh: 90, eMax: 0.07, pis: pisFromXY([[0, 0], [400, 0], [400, 400], [800, 400]], 190) });
    const codes = checkAlignment(a).map(f => f.code);
    expect(codes).toContain('metro-short-straight');
  });

  it('sharp angle point on a curved object is noted; an angled utility gets no flags', () => {
    expect(checkAlignment(road(0)).map(f => f.code)).toContain('sharp-angle-point');
    const util: HorizontalAlignment = { ...road(0), behaviour: 'angled', criteria: 'none', designSpeedKmh: null };
    expect(checkAlignment(util)).toEqual([]);
  });

  it('a U-turn is refused', () => {
    expect(checkAlignment(road(0, { pis: pisFromXY([[0, 0], [100, 0], [0, 0.5]], 30) }))[0].code).toBe('u-turn-refused');
  });
});
