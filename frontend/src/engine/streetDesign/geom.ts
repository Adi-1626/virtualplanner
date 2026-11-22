/** Plan geometry for the street design tools: a local equirectangular frame (error well under 1 % over a few km). */

export type LngLat = readonly number[];
export type XY = [number, number];

const M_PER_DEG_LAT = 111320;

export interface Frame { lng0: number; lat0: number; kx: number }

export const frameAt = (p: LngLat): Frame => ({ lng0: p[0], lat0: p[1], kx: M_PER_DEG_LAT * Math.cos(p[1] * Math.PI / 180) });
export const toXY = (f: Frame, p: LngLat): XY => [(p[0] - f.lng0) * f.kx, (p[1] - f.lat0) * M_PER_DEG_LAT];
export const toLngLat = (f: Frame, q: readonly number[]): [number, number, number] => [f.lng0 + q[0] / f.kx, f.lat0 + q[1] / M_PER_DEG_LAT, 0];

export const distM = (a: LngLat, b: LngLat) => { const f = frameAt(a); const q = toXY(f, b); return Math.hypot(q[0], q[1]); };

export function lengthM(cs: readonly LngLat[]): number {
  let n = 0;
  for (let i = 1; i < cs.length; i++) n += distM(cs[i - 1], cs[i]);
  return n;
}

export interface Projection {
  /** Distance from the point to the line (m). */
  distanceM: number;
  /** Chainage of the foot of the perpendicular from the line's first vertex (m). */
  chainageM: number;
  /** Signed offset: + left of the line direction, − right (m). */
  offsetM: number;
  /** Unit direction of the line at the foot (local x/y). */
  dir: XY;
  segment: number;
}

/** Nearest point of a polyline to a point. */
export function projectOnLine(line: readonly LngLat[], p: LngLat): Projection | null {
  if (line.length < 2) return null;
  const f = frameAt(p);
  const pts = line.map(c => toXY(f, c));
  let best: Projection | null = null;
  let ch = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const t = Math.max(0, Math.min(1, (-a[0] * dx - a[1] * dy) / (L * L)));
    const fx = a[0] + t * dx, fy = a[1] + t * dy;
    const d = Math.hypot(fx, fy);
    if (!best || d < best.distanceM) {
      const ux = dx / L, uy = dy / L;
      // point minus foot, crossed with direction: + = left
      const side = ux * (0 - fy) - uy * (0 - fx);
      best = { distanceM: d, chainageM: ch + t * L, offsetM: Math.sign(side) * d, dir: [ux, uy], segment: i };
    }
    ch += L;
  }
  return best;
}

/** The point at a chainage along a polyline and the direction there. */
export function pointAtChainage(line: readonly LngLat[], chainageM: number): { point: [number, number, number]; dir: XY } | null {
  if (line.length < 2) return null;
  const f = frameAt(line[0]);
  const pts = line.map(c => toXY(f, c));
  let ch = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-9) continue;
    if (ch + L >= chainageM || i === pts.length - 2) {
      const t = Math.max(0, Math.min(1, (chainageM - ch) / L));
      const dir: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      return { point: toLngLat(f, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]), dir };
    }
    ch += L;
  }
  return null;
}

/** Points where two polylines cross (plan), with the chainage along the first. */
export function crossings(a: readonly LngLat[], b: readonly LngLat[]): { point: [number, number, number]; chainageA: number }[] {
  if (a.length < 2 || b.length < 2) return [];
  const f = frameAt(a[0]);
  const pa = a.map(c => toXY(f, c)), pb = b.map(c => toXY(f, c));
  const out: { point: [number, number, number]; chainageA: number }[] = [];
  let ch = 0;
  for (let i = 0; i < pa.length - 1; i++) {
    const p = pa[i], r: XY = [pa[i + 1][0] - p[0], pa[i + 1][1] - p[1]];
    const L = Math.hypot(r[0], r[1]);
    for (let j = 0; j < pb.length - 1; j++) {
      const q = pb[j], s: XY = [pb[j + 1][0] - q[0], pb[j + 1][1] - q[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const qp: XY = [q[0] - p[0], q[1] - p[1]];
      const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) out.push({ point: toLngLat(f, [p[0] + t * r[0], p[1] + t * r[1]]), chainageA: ch + t * L });
    }
    ch += L;
  }
  return out.sort((x, y) => x.chainageA - y.chainageA);
}

/** Shortest plan distance between a polygon (closed ring) and a polyline; 0 when they overlap or touch. */
export function polygonLineDistanceM(ring: readonly LngLat[], line: readonly LngLat[]): number {
  if (!ring.length || line.length < 1) return Infinity;
  const f = frameAt(ring[0]);
  const P = ring.map(c => toXY(f, c)), Q = line.map(c => toXY(f, c));
  const inside = (pt: XY) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      if ((P[i][1] > pt[1]) !== (P[j][1] > pt[1]) && pt[0] < (P[j][0] - P[i][0]) * (pt[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
    }
    return c;
  };
  if (Q.some(inside)) return 0;
  const segDist = (p: XY, a: XY, b: XY) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  let best = Infinity;
  const segsQ = Q.length === 1 ? [[Q[0], Q[0]]] : Q.slice(0, -1).map((q, i) => [q, Q[i + 1]]);
  for (const [a, b] of segsQ) {
    if (crossings([toLngLat(f, a), toLngLat(f, b)], ring).length) return 0;
    for (const p of P) best = Math.min(best, segDist(p, a, b));
  }
  for (let i = 0; i < P.length - 1; i++) for (const q of Q) best = Math.min(best, segDist(q, P[i], P[i + 1]));
  return best;
}
