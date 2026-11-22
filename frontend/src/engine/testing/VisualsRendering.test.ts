import { describe, it, expect, beforeEach } from 'vitest';
import { creaseNormals } from '../rendering/geometry/creaseNormals';
import { styleColor, materialOf, MATERIAL_COLORS } from '../rendering/materials/materialPalette';
import { getVisualStyle, setVisualStyle, onVisualStyleChange, VISUAL_STYLE_KEY, _reloadVisualStyleForTests } from '../rendering/visualStyle';

/** Unit cube from 8 shared vertices (the way the generator emits boxes). */
function cube(): { p: number[]; i: number[] } {
  const p = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
  const i = [0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7];
  return { p, i };
}

describe('creaseNormals (hard edges)', () => {
  it('splits a shared-vertex box into crisp faces with unit axis normals', () => {
    const { p, i } = cube();
    const m = creaseNormals(p, i);
    expect(m.indices.length).toBe(i.length);
    // each corner is used by 3 face directions → 8 × 3 vertices
    expect(m.positions.length / 3).toBe(24);
    for (let v = 0; v < m.normals.length / 3; v++) {
      const n = [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]];
      expect(Math.hypot(...n)).toBeCloseTo(1, 6);
      // axis aligned: one component ±1, the others 0
      expect(n.filter(c => Math.abs(Math.abs(c) - 1) < 1e-9).length).toBe(1);
    }
  });

  it('keeps a finely faceted cylinder smooth (faces < crease angle share vertices)', () => {
    const seg = 16, p: number[] = [], i: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      p.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 1);
    }
    for (let k = 0; k < seg; k++) {
      const a = k * 2, b = ((k + 1) % seg) * 2;
      i.push(a, b, b + 1, a, b + 1, a + 1);
    }
    const m = creaseNormals(p, i, 40);
    expect(m.positions.length).toBe(p.length); // no splits
    // normal at a vertex is radial
    expect(m.normals[0]).toBeCloseTo(1, 1);
  });

  it('is precise at ECEF magnitudes (Pune ~ 6.4e6 m)', () => {
    const { p, i } = cube();
    const off = [1.1e6, 5.9e6, 2.0e6];
    const shifted = p.map((v, k) => v + off[k % 3]);
    const m = creaseNormals(shifted, i);
    expect(m.positions.length / 3).toBe(24);
    expect(Math.hypot(m.normals[0], m.normals[1], m.normals[2])).toBeCloseTo(1, 6);
  });
});

describe('materials per visual style', () => {
  it('Schematic keeps the legend colour; Realistic uses the material colour', () => {
    const road = { material: { type: 'solid' as const, color: '#2b313b' }, layerId: 'asphalt' as const };
    expect(styleColor(road, 'schematic')).toBe('#2b313b');
    expect(styleColor(road, 'realistic')).toBe(MATERIAL_COLORS.asphalt);
  });
  it('derives materials from layer and legend colour, explicit ids win', () => {
    expect(materialOf({ material: { type: 'solid', color: '#E2E8F0' }, layerId: 'transit_deck' })).toBe('marking_white');
    expect(materialOf({ material: { type: 'solid', color: '#475569' }, layerId: 'sidewalk' })).toBe('paver_footpath');
    expect(materialOf({ material: { type: 'solid', color: '#475569', materialId: 'kerb_stone' }, layerId: 'sidewalk' })).toBe('kerb_stone');
  });
  it('drawn utilities keep their Underground legend colour in Realistic', () => {
    expect(styleColor({ material: { type: 'solid', color: '#1d4ed8' }, layerId: 'transit_utility' }, 'realistic')).toBe('#1d4ed8');
  });
});

describe('visual style switch', () => {
  beforeEach(() => { localStorage.removeItem(VISUAL_STYLE_KEY); _reloadVisualStyleForTests(); });
  it('defaults to Realistic and persists a change', () => {
    expect(getVisualStyle()).toBe('realistic');
    let seen: string | null = null;
    const off = onVisualStyleChange(s => { seen = s; });
    setVisualStyle('schematic');
    off();
    expect(seen).toBe('schematic');
    expect(localStorage.getItem(VISUAL_STYLE_KEY)).toBe('schematic');
    _reloadVisualStyleForTests();
    expect(getVisualStyle()).toBe('schematic');
    setVisualStyle('realistic');
  });
});
