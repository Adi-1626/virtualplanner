import type { Profile2D } from '../standards/profiles';

export type ToECEF = (lng: number, lat: number, h: number) => [number, number, number];

function norm(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Sweeps a closed 2D section along a `[lng, lat, z]` path (BUILD_VISUALS_AND_TOOLS_PLAN §A3.5). Frames match
 * `generateRibbon`: up = geocentric normal at the vertex, right = tangent × up (central-difference tangent, so joints are
 * mitred by the averaged direction). Side walls are quads between consecutive stations; both ends are capped with a fan
 * from `profile.centre`. Normals are left to creaseNormals (Realistic) so section corners stay crisp.
 */
export function extrudeProfile(
  path: readonly (readonly number[])[],
  profile: Profile2D,
  toECEF: ToECEF,
  elevation = 0,
  capEnds = true
): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = path.length;
  const m = profile.pts.length;
  if (n < 2 || m < 3) return { positions, indices };

  const frames: { o: [number, number, number]; up: [number, number, number]; right: [number, number, number] }[] = [];
  for (let i = 0; i < n; i++) {
    const c = path[i], nx = path[i + 1] || c, pv = path[i - 1] || c;
    const o = toECEF(c[0], c[1], (c[2] || 0) + elevation);
    const up = norm(o);
    const a = toECEF(nx[0], nx[1], (nx[2] || 0) + elevation);
    const b = toECEF(pv[0], pv[1], (pv[2] || 0) + elevation);
    const t = norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    const right = norm([t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]);
    frames.push({ o, up, right });
  }
  const at = (f: (typeof frames)[number], x: number, y: number) => {
    positions.push(f.o[0] + f.right[0] * x + f.up[0] * y, f.o[1] + f.right[1] * x + f.up[1] * y, f.o[2] + f.right[2] * x + f.up[2] * y);
  };
  for (const f of frames) for (const [x, y] of profile.pts) at(f, x, y);
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const a = i * m + k, b = i * m + k2, c = (i + 1) * m + k2, d = (i + 1) * m + k;
      indices.push(a, b, c, a, c, d);
    }
  }
  if (capEnds) {
    for (const [fi, flip] of [[0, true], [n - 1, false]] as const) {
      const centre = positions.length / 3;
      at(frames[fi], profile.centre[0], profile.centre[1]);
      for (let k = 0; k < m; k++) {
        const a = fi * m + k, b = fi * m + ((k + 1) % m);
        if (flip) indices.push(centre, b, a); else indices.push(centre, a, b);
      }
    }
  }
  return { positions, indices };
}
