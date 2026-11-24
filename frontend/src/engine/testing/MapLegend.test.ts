import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mapLegend, itemTip, tipFromPick, mapTipsAllowed } from '../rendering/mapLegend';
import { studyLegend, liveLegend, overlayLegend, directionsLegend, COMPARISON_COLORS, CAUSE_COLORS, BOTTLENECK_COLOR } from '../simulation/simLegend';
import { cityLegend, SCHEMATIC_CITY_COLORS } from '../rendering/cityLegend';
import { MATERIAL_COLORS } from '../rendering/materials/materialPalette';
import { STUDY_ROLE_COLORS, STUDY_BOUNDARY_COLORS, STUDY_JUNCTION_COLORS, STUDY_PROBLEM_COLORS, SELECT_LINK_COLORS } from '../rendering/renderers/StudyAreaVisualizer';
import { SPEED_COLORS } from '../rendering/renderers/MicroTrafficVisualizer';
import { VC_BANDS } from '../simulation/RoadAnalysis';
import { DIRECTION_COLORS } from '../simulation/directions';
import { JUNCTION_POINT_COLORS, JUNCTION_POINT_LEGEND } from '../rendering/renderers/TrafficNetworkVisualizer';
import { ROAD_HIGHLIGHT_STYLE } from '../rendering/renderers/RoadHighlight';
import { SwatchIcon } from '../../components/MapLegend';
import { TRAFFIC_VALIDATION_PLAIN, COUNTS_ALL, COUNTS_HOLDOUT, VALIDATION_CHECKS, COUNTS_CHECK } from '../../components/ui/badges/trafficValidation';
import { ValidationBanner } from '../../components/ui/badges/ValidationBanner';
import { drawnEnvLayers, setDrawnEnvLayer, useEnvDataOverlayStore } from '../../components/environment/envDataOverlayStore';
import { useShellStore } from '../../shell/useShellStore';

/**
 * The map key (docs/urbanos/SIM_FLOW_P12.md §8): every colour it shows is the colour the map draws (read from the
 * renderers' own constants, or checked against their source), it lists only what is drawn, and the plain validation
 * wording keeps the recorded numbers.
 */

afterEach(() => mapLegend._reset());
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const area = (o: Partial<Parameters<typeof studyLegend>[0]> = {}) => ({
  segments: [{ role: 'seed' }, { role: 'downstream' }, { role: 'upstream' }] as any, junctions: [{ kind: 'crossroads' }, { kind: 'dead_end' }] as any,
  boundary: [{ kind: 'entry' }, { kind: 'exit' }] as any, gradeSeparations: [] as any, problems: [] as any, ...o,
});

describe('map key registry', () => {
  it('lists groups in order, replaces a source\'s group, clears it, and notifies only on a real change', () => {
    let n = 0;
    const un = mapLegend.subscribe(() => n++);
    mapLegend.set('b', { title: 'B', order: 20, items: [] });
    mapLegend.set('a', { title: 'A', order: 10, items: [] });
    expect(mapLegend.list().map(g => g.id)).toEqual(['a', 'b']);
    mapLegend.set('a', { title: 'A', order: 10, items: [] });
    expect(n).toBe(2);
    mapLegend.set('a', null);
    mapLegend.set('a', null);
    expect(n).toBe(3);
    expect(mapLegend.list().map(g => g.id)).toEqual(['b']);
    un();
  });

  it('describes a picked symbol: its own tip, an entity property, or a registered resolver', () => {
    expect(tipFromPick({ id: { legendTip: { title: 'IN', text: 'enters' } } })).toEqual({ title: 'IN', text: 'enters' });
    expect(tipFromPick({ id: { properties: { legendTip: { getValue: () => ({ title: 'Queue', text: 'starts here' }) } } } })).toEqual({ title: 'Queue', text: 'starts here' });
    mapLegend.setResolver('x', p => ((p as any)?.id === 'seg1' ? { title: 'Road', text: 'a stretch' } : null));
    expect(tipFromPick({ id: 'seg1' })).toEqual({ title: 'Road', text: 'a stretch' });
    expect(tipFromPick({ id: 'other' })).toBeNull();
    expect(itemTip({ id: 'i', label: 'L', detail: 'd', swatch: { kind: 'dot', color: '#000' } })).toBe('L: d');
  });
});

describe('Simulate key groups use the map\'s own colours and list only what is drawn', () => {
  it('study area: roles only without live speeds or an overlay; markers only when present', () => {
    const g = studyLegend(area(), { live: false, overlay: 'none' });
    const by = Object.fromEntries(g.items.map(i => [i.id, i.swatch]));
    expect(by.seed.color).toBe(STUDY_ROLE_COLORS.seed);
    expect(by.downstream.color).toBe(STUDY_ROLE_COLORS.downstream);
    expect(by.upstream.color).toBe(STUDY_ROLE_COLORS.upstream);
    expect(by.both).toBeUndefined();
    expect(by.junction.color).toBe(STUDY_JUNCTION_COLORS.junction);
    expect(by.dead_end.color).toBe(STUDY_JUNCTION_COLORS.dead_end);
    expect(by.roundabout).toBeUndefined();
    expect(by.in).toMatchObject({ kind: 'marker', color: STUDY_BOUNDARY_COLORS.entry, text: 'IN' });
    expect(by.out).toMatchObject({ kind: 'marker', color: STUDY_BOUNDARY_COLORS.exit, text: 'OUT' });
    expect(by.grade).toBeUndefined();
    const live = studyLegend(area({ problems: [{ kind: 'one_way_trap', severity: 'error' }, { kind: 'area_edge', severity: 'info' }] as any }), { live: true, overlay: 'none' });
    expect(live.items.map(i => i.id)).not.toContain('downstream');
    expect(live.items.find(i => i.id === 'p-error')!.swatch.color).toBe(STUDY_PROBLEM_COLORS.error);
    expect(live.items.find(i => i.id === 'p-edge')!.swatch.color).toBe(STUDY_PROBLEM_COLORS.area_edge);
  });

  it('live view, overlays and directions', () => {
    const l = liveLegend({ signals: true });
    expect(l.items.slice(0, 3).map(i => i.swatch.color)).toEqual([SPEED_COLORS.free, SPEED_COLORS.slow, SPEED_COLORS.stopped]);
    expect(l.items.map(i => i.id)).toContain('signals');
    expect(liveLegend({ signals: false }).items.map(i => i.id)).not.toContain('signals');
    expect(overlayLegend('none')).toBeNull();
    expect(overlayLegend('area-vc', { bottlenecks: 3 })!.scale!.steps.map(s => s.color)).toEqual(VC_BANDS.map(b => b.css));
    expect(overlayLegend('area-vc', { bottlenecks: 3 })!.scale!.unit).toMatch(/capacity/);
    expect(overlayLegend('select-link')!.scale!.steps.map(s => s.color)).toEqual([...SELECT_LINK_COLORS]);
    const c = overlayLegend('comparison', { newBottlenecks: 1 })!;
    expect(c.items.find(i => i.id === 'better')!.swatch.color).toBe(COMPARISON_COLORS.better);
    expect(c.items.find(i => i.id === 'worse')!.swatch.color).toBe(COMPARISON_COLORS.worse);
    expect(c.items.find(i => i.id === 'new-bn')!.swatch.color).toBe(BOTTLENECK_COLOR);
    expect(overlayLegend('comparison')!.items.map(i => i.id)).not.toContain('new-bn');
    expect(overlayLegend('cause', { hasRootMarker: true })!.items.map(i => i.swatch.color)).toEqual([CAUSE_COLORS.section, CAUSE_COLORS.queue, CAUSE_COLORS.queue]);
    expect(directionsLegend(['northbound', 'southbound'])!.items.map(i => i.swatch.color)).toEqual([DIRECTION_COLORS[0], DIRECTION_COLORS[1]]);
    expect(directionsLegend([])).toBeNull();
  });

  it('the overlay colours in the key are the ones SimulationMode draws', () => {
    const sm = src('simulation/SimulationMode.ts');
    // redrawOverlay: comparison green/red, cause section/queue, bottleneck markers
    const draw = sm.slice(sm.indexOf('private redrawOverlay()'), sm.indexOf('// ── Existing city against a proposal'));
    expect(draw).toContain('d < 0 ? COMPARISON_COLORS.better : COMPARISON_COLORS.worse');
    expect(draw).toContain('CAUSE_COLORS.section');
    expect(draw).toContain('css: BOTTLENECK_COLOR');
    expect(draw).toContain('vcColour(vc)');
    // No colour literal left in the overlay drawing: every colour comes from a constant the key reads
    expect(draw.match(/'#[0-9a-f]{6}'/gi) ?? []).toEqual([]);
  });
});

describe('other map symbols', () => {
  it('junction points, highlights and the city model match their renderers', () => {
    expect(JUNCTION_POINT_LEGEND.map(l => l.kind).sort()).toEqual(Object.keys(JUNCTION_POINT_COLORS).sort());
    expect(ROAD_HIGHLIGHT_STYLE.binding.css).toBe('#fbbf24');
    const gen = src('rendering/geometry/ProceduralGeometryGenerator.ts');
    for (const [k, c] of Object.entries(SCHEMATIC_CITY_COLORS)) expect(gen.includes(`'${c}'`), `${k} ${c} drawn by the generator`).toBe(true);
    const realistic = cityLegend('design', 'realistic');
    expect(realistic.items.find(i => i.id === 'road')!.swatch.color).toBe(MATERIAL_COLORS.asphalt);
    expect(realistic.items.map(i => i.id)).toContain('selected');
    const schematic = cityLegend('simulate', 'schematic');
    expect(schematic.items.find(i => i.id === 'b-com')!.swatch.color).toBe(SCHEMATIC_CITY_COLORS.buildingCommercial);
    expect(schematic.items.map(i => i.id)).not.toContain('selected');
  });

  it('every swatch kind renders', () => {
    for (const kind of ['line', 'dash', 'glow', 'outline', 'dot', 'ring', 'square', 'fill', 'arrow', 'label', 'gradient', 'marker'] as const) {
      const html = renderToStaticMarkup(createElement(SwatchIcon, { s: { kind, color: '#ff0000', color2: '#00ff00', text: 'IN' } }));
      expect(html.length, kind).toBeGreaterThan(10);
    }
  });
});

describe('validation banner in plain words', () => {
  it('says what was checked, why it fails and what it means, with the recorded numbers', () => {
    expect(TRAFFIC_VALIDATION_PLAIN.headline).toBe('Traffic model fails validation (TAG M3.1)');
    expect(TRAFFIC_VALIDATION_PLAIN.checked).toContain(`${COUNTS_ALL.n} places`);
    expect(TRAFFIC_VALIDATION_PLAIN.checked).toContain('85%');
    expect(TRAFFIC_VALIDATION_PLAIN.result).toBe(`${COUNTS_ALL.withinGeh5} of ${COUNTS_ALL.n} places are close enough (${COUNTS_HOLDOUT.withinGeh5} of the ${COUNTS_HOLDOUT.n} never used for fitting), and the river crossings carry 26.5% less traffic than counted.`);
    expect(TRAFFIC_VALIDATION_PLAIN.why).toMatch(/too few real counts/);
    expect(TRAFFIC_VALIDATION_PLAIN.why).toMatch(/turning counts/);
    expect(TRAFFIC_VALIDATION_PLAIN.why).toMatch(/journey times/);
    expect(TRAFFIC_VALIDATION_PLAIN.why).toMatch(/OpenStreetMap/);
    expect(TRAFFIC_VALIDATION_PLAIN.meaning).toMatch(/direction/);
    expect(TRAFFIC_VALIDATION_PLAIN.meaning).toMatch(/trade-offs/);
  });
});

describe('validation banner as a list of checks', () => {
  it('shows each check as its own labelled row, so a second check is one more entry', () => {
    expect(VALIDATION_CHECKS).toEqual([COUNTS_CHECK]);
    expect(COUNTS_CHECK).toMatchObject({ id: 'counts', outcome: 'fails', checked: TRAFFIC_VALIDATION_PLAIN.checked, result: TRAFFIC_VALIDATION_PLAIN.result, why: TRAFFIC_VALIDATION_PLAIN.why });
    const one = renderToStaticMarkup(createElement(ValidationBanner));
    expect(one.match(/data-testid="validation-check"/g)).toHaveLength(1);
    expect(one).toContain('Model against real traffic counts');
    expect(one).toContain('data-testid="validation-meaning"');
    expect(one).toContain('Technical summary');
    const two = renderToStaticMarkup(createElement(ValidationBanner, { checks: [...VALIDATION_CHECKS, { id: 'project', label: 'Project check against estimated data', outcome: 'not_run', checked: 'C.', result: 'R.' }] }));
    expect(two.match(/data-testid="validation-check"/g)).toHaveLength(2);
    expect(two).toContain('data-check="project"');
    expect(two).toContain('data-testid="validation-checked-project"');
    expect(two).toContain('Not run');
  });
});

describe('environment layers in the map key (read without the map renderer)', () => {
  it('lists layers switched on and shown, only in Environment and Explore', () => {
    const l = { id: 'ndvi', name: 'Vegetation' } as any;
    useShellStore.setState({ workspace: 'environment' } as any);
    setDrawnEnvLayer('ndvi', l);
    expect(drawnEnvLayers()).toEqual([]);                       // on, still loading
    useEnvDataOverlayStore.getState().set('ndvi', { status: 'shown', variant: '2024' });
    expect(drawnEnvLayers()).toEqual([{ layer: l, variant: '2024' }]);
    useShellStore.setState({ workspace: 'simulate' } as any);
    expect(drawnEnvLayers()).toEqual([]);
    useShellStore.setState({ workspace: 'explore' } as any);
    setDrawnEnvLayer('ndvi', null);
    expect(drawnEnvLayers()).toEqual([]);
  });
});

describe('map-symbol tooltips and drawing tools', () => {
  it('show only with the Select tool: a drawing tool keeps the map for clicks and Esc for cancelling the drawing', () => {
    expect(mapTipsAllowed('select')).toBe(true);
    expect(mapTipsAllowed(undefined)).toBe(true);
    for (const m of ['draw_road', 'draw_flyover', 'draw_junction', 'place_station', 'brush_junction_control', 'draw_underground']) expect(mapTipsAllowed(m), m).toBe(false);
  });
});

describe('the junction tool group of the key', () => {
  it('lists only the markers on the map now', async () => {
    const { junctionToolLegend } = await import('../rendering/renderers/JunctionEditorOverlay');
    expect(junctionToolLegend({ drawn: 0, selected: false, placing: false })).toBeNull();
    expect(junctionToolLegend({ drawn: 2, selected: false, placing: false })!.items.map(i => i.id)).toEqual(['drawn']);
    expect(junctionToolLegend({ drawn: 1, selected: true, placing: false })!.items.map(i => i.id)).toEqual(['drawn', 'selected']);
    expect(junctionToolLegend({ drawn: 0, selected: false, placing: true })!.items.map(i => i.id)).toEqual(['invalid']);
  });
});

describe('map key placement (P12 browser check)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
  const bottomOf = (selector: string) => {
    const m = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*?bottom:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };
  it('sits clear of Cesium\'s fullscreen button (12 px from the bottom, 29 px tall) and above the drawing tool\'s hint', () => {
    // At 36 px the key's lower edge ran 5 px into the fullscreen button
    expect(parseInt(bottomOf('.uos-legend') ?? '0', 10)).toBeGreaterThanOrEqual(45);
    // While a drawing tool is active its hint sits bottom centre (16 px up, ~80 px tall); the key goes above it
    expect(parseInt(bottomOf('.uos-shell:has([data-testid=drawing-hud]) .uos-legend') ?? '0', 10)).toBeGreaterThanOrEqual(104);
    // An open drawer still wins (its rule comes after the hint's)
    expect(css.indexOf('.uos-shell:has(.uos-drawer.is-open) .uos-legend')).toBeGreaterThan(css.indexOf('.uos-shell:has([data-testid=drawing-hud]) .uos-legend'));
  });
});
