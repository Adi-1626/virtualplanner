import { describe, it, expect, vi } from 'vitest';

// The real engine needs Cesium; the palette only reads mode and history from it
vi.mock('../TwinCityEngine', () => {
  const noop = () => () => {};
  return { engineInstance: {
    editing: { onChange: noop, getMode: () => 'draw_utility', setMode: () => {}, roadClass: 'local', buildingUsage: 'residential', utilityType: 'water', buildingFloors: 4, utilityDepthM: 1.5, utilityDepthCertainty: 'hypothetical', utilityDiameterMm: null, zonePopulation: 10000, zoneEmployment: 5000, getIsImporting: () => false },
    history: { onChange: noop, canUndo: () => false, canRedo: () => false, undo: () => {}, redo: () => {} },
    selection: { onChange: noop, getSelection: () => [] },
  } };
});
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Compass, Layers, Hammer, Settings } from 'lucide-react';
import { TOOLS, TOOL_CATEGORIES, toolByHotkey, toolsInCategory } from '../../components/tools';

/** Design tool palette data (docs/urbanos/UX_ARCHITECTURE.md §3; docs/urbanos/DESIGN_TOOLS_AND_HONESTY.md §3). */
describe('design tools', () => {
  it('keeps the EditingMode ids and the 1-9 hotkeys of the old toolbar', () => {
    const expected: Record<string, string> = { 1: 'select', 2: 'draw_road', 3: 'draw_building', 4: 'draw_junction', 5: 'draw_flyover', 6: 'draw_metro', 7: 'draw_metro_flyover', 8: 'place_station', 9: 'draw_utility' };
    for (const [k, mode] of Object.entries(expected)) expect(toolByHotkey(k)?.mode).toBe(mode);
    expect(TOOLS.map(t => t.mode).sort()).toEqual(['brush_junction_control', 'draw_building', 'draw_flyover', 'draw_gateway', 'draw_junction', 'draw_metro', 'draw_metro_flyover', 'draw_path', 'draw_road', 'draw_underground', 'draw_utility', 'draw_zone', 'import_osm',
      'place_bus_stop', 'place_crossing', 'place_roadside', 'place_roundabout', 'place_station', 'select']);
  });
  it('every tool has a category, short label, icon and description, and sits in exactly one listed group', () => {
    const cats = new Set(TOOL_CATEGORIES.map(c => c.id));
    for (const t of TOOLS) {
      expect(cats.has(t.category)).toBe(true);
      expect(t.shortLabel.length).toBeGreaterThan(0);
      expect(t.short).toBe(t.shortLabel);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.icon).toBeTruthy();
      expect(t.status).toBe('available');
    }
    expect(TOOL_CATEGORIES.reduce((n, c) => n + toolsInCategory(c.id).length, 0)).toBe(TOOLS.length);
  });
  it('no tool reuses an app-chrome icon (Compass, Layers, Hammer, gear) and no two tools share an icon', () => {
    for (const t of TOOLS) expect([Compass, Layers, Hammer, Settings]).not.toContain(t.icon);
    expect(new Set(TOOLS.map(t => t.icon)).size).toBe(TOOLS.length);
  });
  it('the OSM import is the first-class "Study area" tool, in its own group right after Select', () => {
    const imp = TOOLS.find(t => t.mode === 'import_osm')!;
    expect(imp.category).toBe('study');
    expect(imp.label).toBe('Study area');
    expect(imp.shortLabel).toBe('Study area');
    expect(TOOL_CATEGORIES.map(c => c.id).slice(0, 2)).toEqual(['select', 'study']);
    expect(TOOLS.some(t => /Draw area|Import area/i.test(t.label + t.shortLabel))).toBe(false);
  });
  it('the utility tool is in the Underground group and the metro is labelled elevated', () => {
    expect(TOOLS.find(t => t.mode === 'draw_utility')!.category).toBe('underground');
    expect(TOOLS.find(t => t.mode === 'draw_metro')!.label).toMatch(/elevated/);
  });
  it('the palette renders every group and tool with its test id', async () => {
    const { default: ToolPalette } = await import('../../components/design/ToolPalette');
    const html = renderToStaticMarkup(createElement(ToolPalette));
    expect(html).toContain('data-testid="tool-palette"');
    for (const c of TOOL_CATEGORIES) expect(html).toContain(`data-testid="tool-group-${c.id}"`);
    for (const t of TOOLS) expect(html).toContain(`data-testid="tool-${t.mode}"`);
    expect(html).toContain('data-testid="tool-undo"');
  });
  it('tool settings: utility offers gas, depth, depth certainty and an empty (unknown) diameter; building floors are hypothetical', async () => {
    const { ToolSettings } = await import('../../components/design/ToolSettings');
    const u = renderToStaticMarkup(createElement(ToolSettings, { mode: 'draw_utility' }));
    expect(u).toContain('value="gas"');
    expect(u).toContain('data-testid="tool-setting-utility-depth"');
    expect(u).toContain('data-testid="tool-setting-utility-depth-certainty"');
    expect(u).toMatch(/data-testid="tool-setting-utility-diameter"[^>]*placeholder="Unknown"[^>]*value=""/);
    const b = renderToStaticMarkup(createElement(ToolSettings, { mode: 'draw_building' }));
    expect(b).toContain('data-testid="tool-setting-floors"');
    expect(b).toContain('data-certainty="hypothetical"');
    const z = renderToStaticMarkup(createElement(ToolSettings, { mode: 'draw_zone' }));
    expect(z).toContain('data-certainty="hypothetical"');
    expect(renderToStaticMarkup(createElement(ToolSettings, { mode: 'draw_gateway' }))).toContain('440 m');
  });
});

describe('Study area layout (p5 QA F8)', () => {
  it('its settings sit in the column under the palette, not floating over the map; the loading pill clears the hint bar', async () => {
    const { settingsPlacement } = await import('../../components/design/settingsPlacement');
    expect(settingsPlacement('import_osm')).toBe('inline');
    expect(settingsPlacement('draw_road')).toBe('popover');
    expect(settingsPlacement('select')).toBe('none');
    const { PILL_BOTTOM_PX } = await import('../../components/design/ImportAreaPanel');
    expect(PILL_BOTTOM_PX).toBeGreaterThanOrEqual(16 + 48 + 16);   // drawing-hud: bottom-4, about 48 px high
  });
});
