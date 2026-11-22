/**
 * Hard-edge normals for procedural meshes (BUILD_VISUALS_AND_TOOLS_PLAN §A3.2).
 *
 * The generator emits boxes and ribbons from shared vertices, so Cesium's `computeNormal` averages a box into a blob.
 * This splits each vertex by the faces that use it: faces whose normals differ by less than `creaseDeg` share one
 * smoothed vertex, others get their own copy. Cylinders (adjacent faces ≤ 30° apart) stay smooth; box corners (90°)
 * become crisp. Pure and allocation-light; positions stay double precision (ECEF metres).
 */
export interface CreasedMesh {
  positions: Float64Array;
  indices: Uint32Array;
  normals: Float32Array;
}

export const DEFAULT_CREASE_DEG = 40;

export function creaseNormals(positions: ArrayLike<number>, indices: ArrayLike<number>, creaseDeg = DEFAULT_CREASE_DEG): CreasedMesh {
  const triCount = Math.floor(indices.length / 3);
  const vertCount = Math.floor(positions.length / 3);
  // Face normals (unnormalised area-weighted kept separately for smoothing weights)
  const fn = new Float64Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    // Relative to vertex a: ECEF coordinates are ~6.4e6 m, differences keep full precision in doubles
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    fn[t * 3] = uy * vz - uz * vy;
    fn[t * 3 + 1] = uz * vx - ux * vz;
    fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const unit = (t: number): [number, number, number] => {
    const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };

  // Faces incident to each vertex (CSR layout)
  const counts = new Uint32Array(vertCount + 1);
  for (let i = 0; i < triCount * 3; i++) counts[indices[i] + 1]++;
  for (let v = 0; v < vertCount; v++) counts[v + 1] += counts[v];
  const fill = counts.slice(0, vertCount);
  const incident = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount * 3; i++) incident[fill[indices[i]]++] = Math.floor(i / 3);

  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  const outPos: number[] = [];
  const outNrm: number[] = [];
  // For each (triangle corner) the output vertex it uses
  const cornerVertex = new Int32Array(triCount * 3).fill(-1);

  for (let v = 0; v < vertCount; v++) {
    const start = counts[v], end = counts[v + 1];
    if (start === end) continue;
    // Greedy grouping: each incident face joins the first group whose seed normal is within the crease angle
    const seeds: [number, number, number][] = [];
    const sums: [number, number, number][] = [];
    const groupOf = new Int32Array(end - start);
    for (let k = start; k < end; k++) {
      const t = incident[k];
      const n = unit(t);
      let g = -1;
      for (let s = 0; s < seeds.length; s++) {
        const d = seeds[s][0] * n[0] + seeds[s][1] * n[1] + seeds[s][2] * n[2];
        if (d >= cosCrease) { g = s; break; }
      }
      if (g < 0) {
        g = seeds.length;
        seeds.push(n);
        sums.push([0, 0, 0]);
      }
      // Area-weighted smoothing inside a group
      sums[g][0] += fn[t * 3]; sums[g][1] += fn[t * 3 + 1]; sums[g][2] += fn[t * 3 + 2];
      groupOf[k - start] = g;
    }
    const base = outPos.length / 3;
    for (let g = 0; g < seeds.length; g++) {
      const [x, y, z] = sums[g];
      const l = Math.hypot(x, y, z);
      const n = l > 0 ? [x / l, y / l, z / l] : seeds[g];
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
      outNrm.push(n[0], n[1], n[2]);
    }
    for (let k = start; k < end; k++) {
      const t = incident[k];
      // Which corner(s) of t are vertex v
      for (let c = 0; c < 3; c++) if (indices[t * 3 + c] === v) cornerVertex[t * 3 + c] = base + groupOf[k - start];
    }
  }

  const outIdx = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount * 3; i++) outIdx[i] = cornerVertex[i] < 0 ? 0 : cornerVertex[i];
  return { positions: new Float64Array(outPos), indices: outIdx, normals: new Float32Array(outNrm) };
}
