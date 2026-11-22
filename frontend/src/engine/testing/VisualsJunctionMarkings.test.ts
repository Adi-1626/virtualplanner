import { describe, it, expect } from 'vitest';
import { ProceduralGeometryGenerator } from '../rendering/geometry/ProceduralGeometryGenerator';
import type { JunctionMarkingInput } from '../rendering/junctionMarkingInput';
import { dim } from '../rendering/standards/visualDims';

const M_PER_DEG = 111_320;
const lngAt = (x: number, lat = 18.52) => 73.85 + x / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
const latAt = (y: number) => 18.52 + y / M_PER_DEG;
/** A line from (x0, y0) to (x1, y1) in plan metres around Pune. */
const line = (x0: number, y0: number, x1: number, y1: number): [number, number, number][] => [[lngAt(x0), latAt(y0), 0], [lngAt(x1), latAt(y1), 0]];
/** Item shaped like the junction tool's MarkingItem (extra fields armId / sources are accepted). */
const item = (kind: JunctionMarkingInput['kind'], l: [number, number, number][], over: Partial<JunctionMarkingInput> = {}) =>
  ({ kind, armId: 'a', line: l, widthM: 0.2, dashM: null, gapM: null, doubleGapM: null, sources: [], ...over });

const gen = new ProceduralGeometryGenerator();
const tris = (items: JunctionMarkingInput[]) => {
  const { meshes } = gen.generateJunctionMarkingMeshes(items);
  return meshes.length ? meshes[0].indices.length / 3 : 0;
};

describe('junction markings renderer hook (junction tool MarkingItem → painted meshes)', () => {
  it('stop line: one quad; double stop line: two; one merged white marking mesh', () => {
    const { meshes } = gen.generateJunctionMarkingMeshes([item('stop_line', line(0, -3.5, 0, 3.5))]);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].layerId).toBe('marking');
    expect(meshes[0].material.materialId).toBe('marking_white');
    expect(tris([item('stop_line', line(0, -3.5, 0, 3.5))])).toBe(2);
    expect(tris([item('double_stop_line', line(0, -3.5, 0, 3.5), { doubleGapM: 0.15 })])).toBe(4);
  });
  it('give-way line: two rows of 0.6 / 0.3 dashes across 7 m', () => {
    const n = tris([item('give_way_line', line(0, -3.5, 0, 3.5), { dashM: 0.6, gapM: 0.3, doubleGapM: 0.15 })]);
    expect(n).toBe(2 * 2 * Math.ceil(7 / 0.9)); // 8 dashes per row, two rows, two triangles each
  });
  it('zebra: 0.5 m stripes with 0.5 m gaps across 7 m, each as long as the crossing width', () => {
    const { meshes } = gen.generateJunctionMarkingMeshes([item('zebra', line(0, -3.5, 0, 3.5), { widthM: 3, dashM: 0.5, gapM: 0.5 })]);
    expect(meshes[0].indices.length / 6).toBe(7);
    // the stripe extent along the road (east-west here) is the zebra width
    const p = meshes[0].positions;
    const xs: number[] = []; for (let i = 0; i < p.length; i += 3) xs.push(p[i + 1]); // ECEF y ~ east at 73.85°E
    const span = Math.max(...xs) - Math.min(...xs);
    expect(span).toBeGreaterThan(2.5);
    expect(span).toBeLessThan(3.5);
  });
  it('arrow: shaft quad + head triangle; give-way triangle: one triangle; STOP word not drawn (counted)', () => {
    expect(tris([item('arrow', line(-15, 1.75, -9, 1.75))])).toBe(3);
    expect(tris([item('give_way_triangle', line(-12, 0, -12, 3.5))])).toBe(1);
    const r = gen.generateJunctionMarkingMeshes([item('stop_word', line(-12, 0, -12, 3.5)), item('stop_line', line(0, 0, 0, 0))]);
    expect(r.meshes).toEqual([]);
    expect(r.skipped).toBe(2);
    expect(dim('arrowHeadLength')).toBeGreaterThan(0);
  });
});
