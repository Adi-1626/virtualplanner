import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// conflictHighlight (HIGHLIGHT_CSS) imports the engine; only its constants are used here
vi.mock('../TwinCityEngine', () => ({ engineInstance: {} }));

import { displayPath, hasLocalPath, redactPaths } from '../../lib/redactPaths';
import { declutterLabels, flatDatumLabel, FLAT_DATUM, terrainErrorReason, withCount } from '../../components/underground/chartLabels';
import { UndergroundLegend } from '../../components/underground/UndergroundLegend';
import { ALIGNMENT_KIND_COLOR, LEGEND_COLOR } from '../../components/underground/legendPalette';
import { Disclosure } from '../../components/ui/Disclosure';
import { RECORD_COLOR, UTILITY_COLOR } from '../underground/UndergroundRenderer';
import * as R from '../underground/UndergroundRenderer';
import { HIGHLIGHT_CSS } from '../../components/underground/conflictHighlight';

const WIN_DEM_ERR = String.raw`No elevation_copdem30 DEM under C:\Users\adity\Desktop\VirtualPlanner\backend\data\urbanos\derived - run python -m datasets.pipelines.elevation`;

describe('path sanitiser: no filesystem path reaches the UI', () => {
  it('redacts Windows, UNC and POSIX absolute paths', () => {
    const r = redactPaths(WIN_DEM_ERR);
    expect(r).not.toMatch(/C:\\|adity|Users/);
    expect(r).toContain('a local folder');
    expect(r).toContain('python -m datasets.pipelines.elevation');
    expect(redactPaths('open C:/Users/adity/data/dem.tif failed')).toBe('open dem.tif failed');
    expect(redactPaths(String.raw`\\srv\share\x\y.fgb missing`)).toBe('y.fgb missing');
    expect(redactPaths('index /workspace/work/urbanos-data/derived/osm/osm_index.db locked')).toBe('index osm_index.db locked');
    expect(hasLocalPath(WIN_DEM_ERR)).toBe(true);
  });
  it('keeps URLs, API routes, units, fractions and relative paths', () => {
    for (const keep of ['see https://opencity.in/dataset/pmc/sewer.csv', 'GET /api/terrain/overlays/slope.png', 'speed 40 km/h, 2 m/s',
      'derived/elevation_copdem30/v2/dem.tif', 'ratio 3/4', '503: Service Unavailable', 'QL-D']) {
      expect(redactPaths(keep)).toBe(keep);
      expect(hasLocalPath(keep)).toBe(false);
    }
    expect(redactPaths(null)).toBeNull();
  });
  it('displayPath shows relative paths as they are and absolute ones as a file name', () => {
    expect(displayPath('derived/x/v1/a.fgb')).toBe('derived/x/v1/a.fgb');
    expect(displayPath('/workspace/work/urbanos-data/derived/x/a.fgb')).toBe('a.fgb');
    expect(displayPath(String.raw`C:\Users\adity\data\b.tif`)).toBe('b.tif');
    expect(displayPath(null)).toBe('');
  });
});

describe('flat datum label (Profile / Cross-section 0 m line)', () => {
  it('never shows the terrain error text', () => {
    const l = flatDatumLabel({ state: 'error', error: WIN_DEM_ERR });
    expect(l).toBe(FLAT_DATUM.notLoaded);
    expect(l).toContain('Flat datum 0 m (local DEM not loaded)');
    expect(l).not.toMatch(/C:\\|adity|derived|python/);
    expect(flatDatumLabel({ state: 'error', error: 'backend unreachable' })).toBe(FLAT_DATUM.unreachable);
    expect(flatDatumLabel({ state: 'error', error: 'Failed to fetch' })).toBe(FLAT_DATUM.unreachable);
    expect(flatDatumLabel({ state: 'loading' })).toBe(FLAT_DATUM.loading);
    expect(flatDatumLabel({ state: 'ok', data: {} })).toBe(FLAT_DATUM.outside);
    expect(flatDatumLabel({ state: 'idle' })).toBe(FLAT_DATUM.idle);
    for (const v of Object.values(FLAT_DATUM)) expect(hasLocalPath(v)).toBe(false);
  });
  it('editors say why ground is unknown in plain words', () => {
    expect(terrainErrorReason(WIN_DEM_ERR)).toBe('local DEM not loaded');
    expect(terrainErrorReason('backend unreachable')).toBe('terrain service unreachable');
    expect(terrainErrorReason(null)).toBe('local DEM not loaded');
  });
});

describe('crossing label declutter', () => {
  const overlaps = (labels: { x: number; text: string; row: number }[], charPx = 5, anchor: 'start' | 'middle' = 'start') => {
    const span = (l: { x: number; text: string }) => { const w = l.text.length * charPx; const a = anchor === 'middle' ? l.x - w / 2 : l.x; return [a, a + w]; };
    for (const a of labels) for (const b of labels) {
      if (a === b || a.row !== b.row) continue;
      const [a0, a1] = span(a), [b0, b1] = span(b);
      if (a0 < b1 && b0 < a1) return true;
    }
    return false;
  };
  it('groups identical labels close together into one with a count', () => {
    const items = [100, 104, 109, 115, 120].map(x => ({ x, text: 'Road · depth unknown' }));
    const { labels, hidden } = declutterLabels(items);
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('Road ×5 · depth unknown');
    expect(labels[0].members).toHaveLength(5);
    expect(hidden).toBe(0);
    expect(withCount('Building', 2)).toBe('Building ×2');
  });
  it('staggers different labels over rows so none overlap, and counts what does not fit', () => {
    const items = [
      { x: 100, text: 'Road · depth unknown' }, { x: 108, text: 'Building · depth unknown' }, { x: 112, text: 'Road · depth unknown' },
      { x: 116, text: 'Building · depth unknown' }, { x: 125, text: 'Metro' }, { x: 130, text: 'Utility' },
    ];
    const { labels, hidden } = declutterLabels(items, { maxRows: 3 });
    expect(labels.map(l => l.text)).toEqual(expect.arrayContaining(['Road ×2 · depth unknown', 'Building ×2 · depth unknown']));
    expect(new Set(labels.map(l => l.row)).size).toBeGreaterThan(1);
    expect(overlaps(labels)).toBe(false);
    // every input is either drawn (as a member) or counted as hidden
    expect(labels.reduce((n, l) => n + l.members.length, 0) + hidden).toBe(items.length);
    const tight = declutterLabels(items, { maxRows: 1 });
    expect(tight.labels).toHaveLength(1);
    expect(tight.hidden).toBe(items.length - tight.labels[0].members.length);
  });
  it('labels far apart stay on the lowest row; middle anchor and plot clamp respected', () => {
    const { labels } = declutterLabels([{ x: 50, text: 'Road' }, { x: 400, text: 'Road' }, { x: 800, text: 'Building · depth unknown' }],
      { anchor: 'middle', minX: 40, maxX: 820 });
    expect(labels.map(l => l.row)).toEqual([0, 0, 0]);
    expect(labels.map(l => l.text)).toEqual(['Road', 'Road', 'Building · depth unknown']);
    const last = labels[2];
    expect(last.x + (last.text.length * 5) / 2).toBeLessThanOrEqual(820);
    expect(labels[0].x - 2 * 5 / 1).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(overlaps(labels, 5, 'middle')).toBe(false);
  });
});

describe('Underground legend', () => {
  const html = renderToStaticMarkup(createElement(UndergroundLegend, {
    counts: { records: { sewer: 12, storm_drain: 3, water: 0, borehole: 2 }, alignments: { bored_tunnel: 1 }, utilities: { water: 2, gas: 1 }, metroTunnels: 4, metroStations: 2 },
    metroLayer: { visible: true, onToggle: () => {} },
  }));
  const entry = (id: string) => new RegExp(`data-testid="${id}"[^>]*data-color="([^"]+)"`).exec(html)?.[1];
  const count = (id: string) => new RegExp(`data-testid="${id}-count">([^<]+)<`).exec(html)?.[1];

  it('has a swatch for everything the 3D view draws, in the renderer\'s colours', () => {
    expect(entry('ug-legend-record-sewer')).toBe(RECORD_COLOR.sewer);
    expect(entry('ug-legend-record-storm_drain')).toBe(RECORD_COLOR.storm_drain);
    expect(entry('ug-legend-record-borehole')).toBe(LEGEND_COLOR.borehole);
    expect(entry('ug-legend-metro-tunnel')).toBe(LEGEND_COLOR.metroPlanOnly);
    expect(entry('ug-legend-metro-station')).toBe(LEGEND_COLOR.metroPlanOnly);
    for (const [k, c] of Object.entries(ALIGNMENT_KIND_COLOR)) expect(entry(`ug-legend-alignment-${k}`)).toBe(c);
    for (const [t, c] of Object.entries(UTILITY_COLOR)) expect(entry(`ug-legend-utility-${t}`)).toBe(c);
    expect(entry('ug-legend-abandoned')).toBe('currentColor');
    expect(entry('ug-legend-unknown-depth')).toBe(LEGEND_COLOR.unknownDepth);
    expect(entry('ug-legend-selected')).toBe(LEGEND_COLOR.selected);
    expect(entry('ug-legend-flyto')).toBe(HIGHLIGHT_CSS.other);
    expect(entry('ug-legend-finding-proposed')).toBe(HIGHLIGHT_CSS.proposed);
    expect(html).toContain('PMC sewers');
    expect(html).toContain('PMC storm drains');
    expect(html).toContain('Metro tunnel — depth not mapped');
    expect(html).toContain('ug-legend-toggle-metro');
    // record layers with nothing in the area stay out (water 0), the PMC reference networks are always listed
    expect(html).not.toContain('ug-legend-record-water');
  });
  it('shows the counts it is given and leaves unknown ones out', () => {
    expect(count('ug-legend-record-sewer')).toBe('12');
    expect(count('ug-legend-metro-tunnel')).toBe('4');
    expect(count('ug-legend-metro-station')).toBe('2');
    expect(count('ug-legend-alignment-bored_tunnel')).toBe('1');
    expect(count('ug-legend-alignment-cut_and_cover')).toBe('0');
    expect(count('ug-legend-utility-water')).toBe('2');
    const bare = renderToStaticMarkup(createElement(UndergroundLegend, {}));
    expect(bare).not.toContain('-count"');
    expect(bare).toContain('ug-legend-record-sewer');
    expect(bare).not.toContain('ug-legend-toggle-metro');
  });
  it('is open by default in the Underground panel', () => {
    const ctx = readFileSync(resolve(__dirname, '../../shell/contexts/UndergroundContext.tsx'), 'utf8');
    expect(ctx).toMatch(/<Disclosure summary="Legend" open data-testid="ug-legend-disclosure">\s*<UndergroundLegend/);
    const rendered = renderToStaticMarkup(createElement(Disclosure, { summary: 'Legend', open: true, 'data-testid': 'ug-legend-disclosure' }, createElement(UndergroundLegend)));
    expect(rendered).toMatch(/<details[^>]*open=""[^>]*data-testid="ug-legend-disclosure"|<details[^>]*data-testid="ug-legend-disclosure"[^>]*open=""/);
    expect(rendered).toContain('data-testid="ug-legend"');
  });
  it('legend palette is the renderer\'s own exported colours (drift guard)', () => {
    const src = readFileSync(resolve(__dirname, '../underground/UndergroundRenderer.ts'), 'utf8');
    expect(ALIGNMENT_KIND_COLOR).toBe(R.KIND_COLOR);
    expect(LEGEND_COLOR).toMatchObject({ metroPlanOnly: R.METRO_PLAN_COLOR, unknownDepth: R.UNKNOWN_DEPTH_COLOR, borehole: R.BOREHOLE_COLOR });
    // the renderer draws with the constants, not with copies of their literals
    expect(src).toContain('const purple = Color.fromCssColorString(METRO_PLAN_COLOR)');
    expect(src).toContain('Color.fromCssColorString(UNKNOWN_DEPTH_COLOR)');
    expect(src).toContain('Color.fromCssColorString(BOREHOLE_COLOR)');
    expect(R.SELECTED_COLOR).toBe('#ffffff');
    expect(src).toMatch(/selected \? Color\.WHITE/);
  });
});
