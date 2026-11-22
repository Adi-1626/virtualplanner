/**
 * Planning defaults decided from the governing standards (docs/urbanos/PLANNING_DEFAULTS_DECISIONS.md).
 * New objects only; existing objects keep their stored values.
 */
import { describe, expect, it } from 'vitest';
import { ROAD_CLASS_DEFAULTS } from '../editing/EditingEngine';
import { GEOMETRY_DEFAULTS, defaultAlignmentSettings } from '../geometry/alignment/defaults';
import { checkAlignment } from '../geometry/alignment';
import { autoRadiusM, FALLBACK_AUTO_RADIUS_M } from '../editing/drawConstraints';
import { ENV_WORKSPACES } from '../../components/environment/envPerf';
import { pisFromXY } from './geometryTestHelpers';

describe('D1/D2 road class defaults for new roads', () => {
  it('posted speed and flyover speed equal the IRC:86-2018 Table 3.1 design speed (never above it, §3.3)', () => {
    for (const cls of ['highway', 'arterial', 'collector', 'local'] as const) {
      expect(ROAD_CLASS_DEFAULTS[cls].speedLimit).toBe(GEOMETRY_DEFAULTS.roadDesignSpeedKmh[cls]);
      expect(ROAD_CLASS_DEFAULTS[cls].flyoverSpeed).toBe(GEOMETRY_DEFAULTS.flyoverDesignSpeedKmh[cls]);
    }
    expect(GEOMETRY_DEFAULTS.roadDesignSpeedKmh).toEqual({ highway: 80, arterial: 60, collector: 40, local: 30 });
  });

  it('footpath 2.0 m (Pune USDG clear walking zone), never below the IRC:86-2018 1.8 m minimum; none on the expressway', () => {
    expect(ROAD_CLASS_DEFAULTS.arterial.footpathWidth).toBe(2.0);
    expect(ROAD_CLASS_DEFAULTS.collector.footpathWidth).toBe(2.0);
    expect(ROAD_CLASS_DEFAULTS.local.footpathWidth).toBe(2.0);
    expect(ROAD_CLASS_DEFAULTS.highway.footpathWidth).toBe(0);
    for (const c of Object.values(ROAD_CLASS_DEFAULTS)) if (c.footpathWidth > 0) expect(c.footpathWidth).toBeGreaterThanOrEqual(1.8);
  });
});

describe('D3/D4 superelevation and spirals', () => {
  it('4 % on surface roads (urban), 7 % on flyover decks; no spirals this phase', () => {
    expect(defaultAlignmentSettings({ type: 'road', roadClass: 'local' }).eMax).toBe(0.04);
    expect(defaultAlignmentSettings({ type: 'flyover', roadClass: 'arterial' }).eMax).toBe(0.07);
    expect(GEOMETRY_DEFAULTS.spiralsEnabled).toBe(false);
  });
});

describe('D6 cut-and-cover fallback radius', () => {
  it('50 m drawing aid, labelled assumed with no official figure; the curve is reported not checked', () => {
    const s = defaultAlignmentSettings({ type: 'underground_alignment', alignmentKind: 'cut_and_cover' });
    expect(autoRadiusM(s)).toBe(FALLBACK_AUTO_RADIUS_M);
    const flags = checkAlignment({ v: 1, ...s, pis: pisFromXY([[0, 0], [500, 0], [500, 500]], 50) });
    const nc = flags.find(f => f.code === 'not-checked-no-criteria')!;
    expect(nc.message).toContain('50 m');
    expect(nc.message).toContain('assumed, no official figure');
  });
});

describe('D9 OSM reference overlays', () => {
  it('Environment OSM overlays are drawn only in Environment and Explore, not in Design', () => {
    expect(ENV_WORKSPACES.has('design')).toBe(false);
    expect(ENV_WORKSPACES.has('environment')).toBe(true);
    expect(ENV_WORKSPACES.has('explore')).toBe(true);
  });
});
