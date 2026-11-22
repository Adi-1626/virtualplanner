/**
 * Pure path helpers for markings, piers and terrain fit (BUILD_VISUALS_AND_TOOLS_PLAN §A3.4, §A3.5, §A4).
 * Paths are `[lng, lat, z]` with z in metres; distances use a local equirectangular metre scale, which is within
 * 0.1 % over a few kilometres at Pune's latitude — ample for dash and pier placement.
 */
export type PathPt = [number, number, number];

const M_PER_DEG_LAT = 111_320;

function segLen(a: PathPt, b: PathPt): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dx = (b[0] - a[0]) * M_PER_DEG_LAT * k;
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Cumulative plan length at each vertex (metres). */
export function cumulativeLengths(path: readonly PathPt[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + segLen(path[i - 1], path[i]));
  return out;
}

function lerp(a: PathPt, b: PathPt, t: number): PathPt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t];
}

/** Point at plan distance `s` along the path (clamped), with the index of the segment it lies on. */
export function pointAt(path: readonly PathPt[], cum: readonly number[], s: number): { pt: PathPt; seg: number } {
  if (s <= 0) return { pt: [...path[0]] as PathPt, seg: 0 };
  const total = cum[cum.length - 1];
  if (s >= total) return { pt: [...path[path.length - 1]] as PathPt, seg: Math.max(0, path.length - 2) };
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const L = cum[lo + 1] - cum[lo];
  return { pt: lerp(path[lo], path[lo + 1], L > 0 ? (s - cum[lo]) / L : 0), seg: lo };
}

/** The sub-path between plan distances `s0` and `s1`, keeping interior vertices (so dashes follow curves). */
export function subPath(path: readonly PathPt[], cum: readonly number[], s0: number, s1: number): PathPt[] {
  const a = pointAt(path, cum, s0);
  const b = pointAt(path, cum, s1);
  const out: PathPt[] = [a.pt];
  for (let i = a.seg + 1; i <= b.seg; i++) if (cum[i] > s0 && cum[i] < s1) out.push([path[i][0], path[i][1], path[i][2] || 0]);
  out.push(b.pt);
  return out;
}

/**
 * Broken-line dashes along a path: `mark` metres painted, `gap` metres clear, starting `phase` metres in.
 * A dash cut by the path end is kept if at least half a mark long (a stub reads as noise).
 * IRC:35-2015 urban lane / centre line: mark 3 m, gap 6 m; one-way / ramp: 1.5 m / 3 m.
 */
export function dashPieces(path: readonly PathPt[], mark: number, gap: number, phase = 0): PathPt[][] {
  if (path.length < 2 || mark <= 0) return [];
  const cum = cumulativeLengths(path);
  const total = cum[cum.length - 1];
  const out: PathPt[][] = [];
  const period = mark + Math.max(0, gap);
  for (let s = phase; s < total; s += period) {
    const e = Math.min(s + mark, total);
    if (e - s < mark / 2) continue;
    out.push(subPath(path, cum, s, e));
  }
  return out;
}

/** Dashes over several pieces (e.g. a road split at junctions), each piece starting its own pattern. */
export function dashAll(pieces: readonly (readonly PathPt[])[], mark: number, gap: number): PathPt[][] {
  const out: PathPt[][] = [];
  for (const p of pieces) out.push(...dashPieces(p, mark, gap, gap / 2));
  return out;
}

/** Pier stations along a deck: first at half a span, then every span (as the generator has always placed them). */
export function pierStations(totalLength: number, span: number, firstAt = span / 2): number[] {
  const out: number[] = [];
  if (!(span > 0) || !(totalLength > 0)) return out;
  for (let s = firstAt; s < totalLength; s += span) out.push(s);
  return out;
}

/**
 * Inserts vertices so no segment is longer than `maxSeg` metres (terrain fit: each new vertex samples the ground).
 * z is interpolated linearly; the caller adds ground per vertex.
 */
export function densify(path: readonly PathPt[], maxSeg: number): PathPt[] {
  if (path.length < 2 || !(maxSeg > 0)) return path.map(p => [p[0], p[1], p[2] || 0] as PathPt);
  const out: PathPt[] = [[path[0][0], path[0][1], path[0][2] || 0]];
  for (let i = 1; i < path.length; i++) {
    const L = segLen(path[i - 1], path[i]);
    const n = Math.max(1, Math.ceil(L / maxSeg));
    for (let k = 1; k <= n; k++) out.push(lerp(path[i - 1], path[i], k / n));
  }
  return out;
}

/** Moving median of `values` over a window of `windowM` metres (stations `cum`). Removes canopy / roof bumps of a DSM. */
export function movingMedian(values: readonly number[], cum: readonly number[], windowM: number): number[] {
  const half = windowM / 2;
  const out: number[] = [];
  let lo = 0, hi = 0;
  for (let i = 0; i < values.length; i++) {
    while (cum[lo] < cum[i] - half) lo++;
    while (hi + 1 < values.length && cum[hi + 1] <= cum[i] + half) hi++;
    const w = values.slice(lo, hi + 1).sort((a, b) => a - b);
    const m = w.length >> 1;
    out.push(w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2);
  }
  return out;
}

/**
 * Smoothed road profile over sampled ground (§A4.2): moving median over `windowM`. Where the ground is a genuine slope
 * (within `spikeTol` of the median) the road never sits more than `maxBury` below it; a narrow bump more than `spikeTol`
 * above the median (a tree or roof in a surface model) is bridged instead of ridden over, and the depth test against
 * terrain shows the bump as terrain. Returned as offsets to add to each vertex's own ground height.
 * Window 30 m, maxBury 0.3 m and spikeTol 1.5 m are ASSUMED rendering values (plan §A4).
 */
export function smoothedProfileOffsets(ground: readonly number[], cum: readonly number[], windowM = 30, maxBury = 0.3, spikeTol = 1.5): number[] {
  const med = movingMedian(ground, cum, windowM);
  return med.map((m, i) => {
    const g = ground[i];
    if (g - m > spikeTol) return m - g;
    return Math.max(m, g - maxBury) - g;
  });
}

/**
 * Terrain-adaptive subdivision (§A4.1): a segment is split at its midpoint while the ground there departs from the
 * straight chord by more than `tol` metres and the piece is longer than `minSeg`. Flat ground adds no vertices, so the
 * cost stays near today's on a city-wide import; hilly stretches end up at ≤ `minSeg` spacing where it matters.
 */
export function adaptiveDensify(path: readonly PathPt[], ground: (lng: number, lat: number) => number, minSeg = 5, tol = 0.2, maxSeg = 60): PathPt[] {
  if (path.length < 2) return path.map(p => [p[0], p[1], p[2] || 0] as PathPt);
  const out: PathPt[] = [[path[0][0], path[0][1], path[0][2] || 0]];
  const split = (a: PathPt, b: PathPt, ga: number, gb: number, depth: number) => {
    const L = segLen(a, b);
    if (L > minSeg && depth < 12) {
      const m = lerp(a, b, 0.5);
      const gm = ground(m[0], m[1]);
      if (Math.abs(gm - (ga + gb) / 2) > tol || L > maxSeg) {
        split(a, m, ga, gm, depth + 1);
        split(m, b, gm, gb, depth + 1);
        return;
      }
    }
    out.push(b);
  };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    split([a[0], a[1], a[2] || 0], [b[0], b[1], b[2] || 0], ground(a[0], a[1]), ground(b[0], b[1]), 0);
  }
  return out;
}

/**
 * Terrain fit of an at-grade road centreline (§A4.1–2): adaptive subdivision, then the smoothed profile expressed as
 * a per-vertex z offset (the renderer adds the ground at each vertex, so ground + z + offset = smoothed profile + z).
 */
export function fitToTerrain(path: readonly PathPt[], ground: (lng: number, lat: number) => number, windowM = 30, maxBury = 0.3, spikeTol = 1.5): PathPt[] {
  const d = adaptiveDensify(path, ground);
  const cum = cumulativeLengths(d);
  const total = cum[cum.length - 1];
  // The median is taken over ground sampled every 2 m along the path (length-weighted), not over the vertices:
  // subdivision is dense exactly at bumps, which would otherwise outvote the flat ground around them
  const step = 2;
  const n = Math.max(2, Math.ceil(total / step) + 1);
  const us: number[] = [], ug: number[] = [];
  for (let k = 0; k < n; k++) {
    const sk = Math.min(total, k * step);
    const p = pointAt(d, cum, sk).pt;
    us.push(sk);
    ug.push(ground(p[0], p[1]));
  }
  const med = movingMedian(ug, us, windowM);
  const medAt = (sv: number) => {
    const k = Math.min(n - 2, Math.max(0, Math.floor(sv / step)));
    const t = us[k + 1] > us[k] ? (sv - us[k]) / (us[k + 1] - us[k]) : 0;
    return med[k] + (med[k + 1] - med[k]) * Math.min(1, Math.max(0, t));
  };
  return d.map((p, i) => {
    const g = ground(p[0], p[1]);
    const m = medAt(cum[i]);
    const target = g - m > spikeTol ? m : Math.max(m, g - maxBury);
    return [p[0], p[1], p[2] + target - g] as PathPt;
  });
}
