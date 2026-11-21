/**
 * Circular fillets at PIs with the fit rule (GEOMETRY_EDITOR_DESIGN.md §3.2). Local equirectangular plane (metres).
 * T = R·tan(|Δ|/2), L = R·|Δ|. On each tangent T(i) + T(i+1) ≤ PI-to-PI distance; a request that does not fit is reduced.
 */
import { projectorFor, toLonLat, toXY, type Projector } from '../../underground/alignmentGeometry';
import type {
  AlignmentPI, CurveElement, FilletAlignmentFn, FilletedPI, FilletOptions, FilletResult, HorizontalAlignment, LonLat, MaxFittingRadiusFn,
} from './types';

export const MIN_DEFLECTION_DEG = 0.5;
export const MAX_DEFLECTION_DEG = 179;
const EPS = 1e-9;

type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: V2) => Math.hypot(a[0], a[1]);

/** Projector for an alignment's PIs (shared by fillet and densify so both use the same plane). */
export const alignmentProjector = (pis: readonly AlignmentPI[]): Projector => projectorFor(pis.map(p => [p.lon, p.lat]));

interface Geo {
  xy: V2[];
  segLen: number[];
  /** Unit direction of segment i (PI i → PI i+1). */
  dir: V2[];
  /** Signed deflection at each PI (0 at ends). */
  defl: number[];
  error?: { error: FilletResult['error']; index: number };
}

function geometry(pis: readonly AlignmentPI[], proj: Projector, maxDefl: number): Geo {
  const xy = pis.map(p => toXY(proj, [p.lon, p.lat]) as V2);
  const segLen: number[] = [];
  const dir: V2[] = [];
  let error: Geo['error'];
  for (let i = 0; i + 1 < xy.length; i++) {
    const d = sub(xy[i + 1], xy[i]);
    const l = len(d);
    segLen.push(l);
    dir.push(l > EPS ? [d[0] / l, d[1] / l] : [0, 0]);
    if (!(l > 1e-6) && !error) error = { error: 'coincident-pis', index: i + 1 };
  }
  const defl = pis.map(() => 0);
  for (let i = 1; i + 1 < xy.length; i++) {
    const a = dir[i - 1], b = dir[i];
    defl[i] = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    if (!error && Math.abs(defl[i]) >= maxDefl) error = { error: 'u-turn', index: i };
  }
  return { xy, segLen, dir, defl, error };
}

/** Requested tangent length at each PI (0 where there is no curve). */
function requestedTangents(pis: readonly AlignmentPI[], g: Geo, angled: boolean, minDefl: number): number[] {
  return pis.map((p, i) => {
    if (angled || i === 0 || i === pis.length - 1) return 0;
    const d = Math.abs(g.defl[i]);
    if (!(p.radiusM > 0) || d < minDefl || d >= Math.PI) return 0;
    return p.radiusM * Math.tan(d / 2);
  });
}

/** Share of a tangent of length L available to a PI whose request is t when its neighbour requests n. */
const share = (L: number, t: number, n: number) => (t + n <= L ? t : (L * t) / (t + n));

export const filletAlignment: FilletAlignmentFn = (
  a: Pick<HorizontalAlignment, 'behaviour' | 'pis'>, opts: FilletOptions = {},
): FilletResult => {
  const pis = a.pis;
  const empty: FilletResult = { ok: false, error: 'too-few-pis', pis: [], elements: [], lengthM: 0 };
  if (pis.length < 2) return empty;
  const minDefl = ((opts.minDeflectionDeg ?? MIN_DEFLECTION_DEG) * Math.PI) / 180;
  const maxDefl = ((opts.maxDeflectionDeg ?? MAX_DEFLECTION_DEG) * Math.PI) / 180;
  const proj = alignmentProjector(pis);
  const g = geometry(pis, proj, maxDefl);
  const angled = a.behaviour === 'angled';
  const req = requestedTangents(pis, g, angled, minDefl);
  const last = pis.length - 1;
  const ll = (p: V2): LonLat => toLonLat(proj, p[0], p[1]);
  const piLL = (i: number): LonLat => [pis[i].lon, pis[i].lat];

  const out: FilletedPI[] = pis.map((p, i) => {
    const deflectionRad = i === 0 || i === last ? 0 : g.defl[i];
    const base: FilletedPI = {
      index: i, deflectionRad, requestedRadiusM: p.radiusM, radiusM: 0, clamped: false, tangentLengthM: 0, arcLengthM: 0,
      tc: null, ct: null, centre: null,
    };
    if (i === 0 || i === last) return { ...base, noCurveReason: 'end-pi' };
    if (angled) return { ...base, noCurveReason: 'angled' };
    if (!(p.radiusM > 0)) return { ...base, noCurveReason: 'radius-zero' };
    if (Math.abs(deflectionRad) < minDefl) return { ...base, noCurveReason: 'small-deflection' };
    if (g.error) return base;
    const t = req[i];
    const T = Math.min(t, share(g.segLen[i - 1], t, req[i - 1]), share(g.segLen[i], t, req[i + 1]));
    const half = Math.tan(Math.abs(deflectionRad) / 2);
    const R = T / half;
    const clamped = T < t - 1e-9 * Math.max(1, t);
    if (!(R > EPS)) return { ...base, clamped };
    const din = g.dir[i - 1], dout = g.dir[i], P = g.xy[i];
    const tc: V2 = [P[0] - din[0] * T, P[1] - din[1] * T];
    const ct: V2 = [P[0] + dout[0] * T, P[1] + dout[1] * T];
    const s = Math.sign(deflectionRad); // + left: centre on the left normal of din
    const centre: V2 = [tc[0] - s * din[1] * R, tc[1] + s * din[0] * R];
    return {
      ...base, radiusM: clamped ? R : p.radiusM, clamped, tangentLengthM: T, arcLengthM: (clamped ? R : p.radiusM) * Math.abs(deflectionRad),
      tc: ll(tc), ct: ll(ct), centre: ll(centre),
    };
  });

  if (g.error) return { ok: false, error: g.error.error, errorPiIndex: g.error.index, pis: out, elements: [], lengthM: 0 };

  // Elements: tangent (cursor → TC or PI), arc (TC → CT), …, tangent to the last PI.
  const elements: CurveElement[] = [];
  let cursor: V2 = g.xy[0];
  let cursorLL: LonLat = piLL(0);
  let ch = 0;
  const pushTangent = (toXY: V2, toLL: LonLat) => {
    const l = len(sub(toXY, cursor));
    if (l > EPS) elements.push({ kind: 'tangent', piIndex: null, startChainageM: ch, endChainageM: ch + l, lengthM: l, radiusM: null, deflectionRad: null, start: cursorLL, end: toLL });
    ch += l; cursor = toXY; cursorLL = toLL;
  };
  for (let i = 1; i < last; i++) {
    const f = out[i];
    if (f.radiusM > 0 && f.tc && f.ct) {
      const tcXY: V2 = [g.xy[i][0] - g.dir[i - 1][0] * f.tangentLengthM, g.xy[i][1] - g.dir[i - 1][1] * f.tangentLengthM];
      const ctXY: V2 = [g.xy[i][0] + g.dir[i][0] * f.tangentLengthM, g.xy[i][1] + g.dir[i][1] * f.tangentLengthM];
      pushTangent(tcXY, f.tc);
      elements.push({ kind: 'arc', piIndex: i, startChainageM: ch, endChainageM: ch + f.arcLengthM, lengthM: f.arcLengthM, radiusM: f.radiusM, deflectionRad: f.deflectionRad, start: f.tc, end: f.ct });
      ch += f.arcLengthM; cursor = ctXY; cursorLL = f.ct;
    } else {
      pushTangent(g.xy[i], piLL(i));
    }
  }
  pushTangent(g.xy[last], piLL(last));
  return { ok: true, pis: out, elements, lengthM: ch };
};

/**
 * Largest radius that fits at interior PI i, given the neighbours' requested tangents (fit rule). End PIs → 0;
 * a straight-through PI (|Δ| below the minimum) → Infinity; an invalid geometry → 0.
 */
export const maxFittingRadius: MaxFittingRadiusFn = (a: Pick<HorizontalAlignment, 'pis'>, piIndex: number): number => {
  const pis = a.pis;
  if (piIndex <= 0 || piIndex >= pis.length - 1) return 0;
  const g = geometry(pis, alignmentProjector(pis), (MAX_DEFLECTION_DEG * Math.PI) / 180);
  if (g.error) return 0;
  const d = Math.abs(g.defl[piIndex]);
  if (d < (MIN_DEFLECTION_DEG * Math.PI) / 180) return Infinity;
  const req = requestedTangents(pis, g, false, (MIN_DEFLECTION_DEG * Math.PI) / 180);
  const T = Math.min(g.segLen[piIndex - 1] - req[piIndex - 1], g.segLen[piIndex] - req[piIndex + 1]);
  return Math.max(0, T / Math.tan(d / 2));
};
