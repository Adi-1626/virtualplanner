import { describe, it, expect } from 'vitest';
import { snapPreviewStale, snapPreviewWanted } from '../editing/snapPreview';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('snap marker follows the tool (p5 QA: it stayed after switching tools)', () => {
  it('is cleared on every tool change and never shown in Select or Study area', () => {
    expect(snapPreviewStale('draw_road', 'import_osm')).toBe(true);
    expect(snapPreviewStale('draw_road', 'draw_flyover')).toBe(true);
    expect(snapPreviewStale('draw_road', 'draw_road')).toBe(false);
    expect(snapPreviewStale('draw_road', 'select')).toBe(true);
    expect(snapPreviewWanted('import_osm')).toBe(false);
    expect(snapPreviewWanted('select')).toBe(false);
    expect(snapPreviewWanted('draw_road')).toBe(true);
  });
  it('the engine wires both rules (cleared on change; no snap lookup in Study area)', () => {
    const src = readFileSync(resolve(__dirname, '../TwinCityEngine.ts'), 'utf8');
    expect(src).toMatch(/snapPreviewStale\(this\.snapPreviewMode, mode\)[\s\S]{0,120}clearSnapPreview\(\)/);
    expect(src).toMatch(/snapPreviewWanted\(mode\) \? this\.editing\.findSnap/);
  });
});
