/**
 * Densify an alignment into the derived `coordinates` polyline (GEOMETRY_EDITOR_DESIGN.md §3.2): arcs with chord sagitta
 * ≤ 0.10 m and steps ≤ 10 m; tangents keep only their end points. All radii 0 → the PIs exactly (identity).
 */
import { toLonLat, toXY } from '../../underground/alignmentGeometry';
import { alignmentProjector, filletAlignment } from './fillet';
import { chainagesOf } from './stationing';
import type { DensifyAlignmentFn, DensifyOptions, DensifyResult, HorizontalAlignment, LonLatZ } from './types';

export const DENSIFY_SAGITTA_M = 0.1;
export const DENSIFY_MAX_STEP_M = 10;

/** Number of chords for an arc of radius R and |Δ| so that sagitta ≤ s and chord ≤ step. */
export function arcSteps(radiusM: number, absDeflRad: number, sagittaM = DENSIFY_SAGITTA_M, maxStepM = DENSIFY_MAX_STEP_M): number {
  if (!(radiusM > 0) || !(absDeflRad > 0)) return 1;
  const byStep = (radiusM * absDeflRad) / maxStepM;
  // sagitta R(1 − cos(θ/2)) ≤ s  ⇔  θ ≤ 2·acos(1 − s/R)
  const thetaMax = sagittaM >= radiusM ? Math.PI : 2 * Math.acos(1 - sagittaM / radiusM);
  return Math.max(1, Math.ceil(Math.max(byStep, absDeflRad / thetaMax) - 1e-9));
}

export const densifyAlignment: DensifyAlignmentFn = (a: Pick<HorizontalAlignment, 'behaviour' | 'pis'>, opts: DensifyOptions = {}): DensifyResult => {
  const z = opts.z ?? 0;
  const fillet = filletAlignment(a);
  const raw: LonLatZ[] = a.pis.map(p => [p.lon, p.lat, z]);
  if (!fillet.ok) {
    return { ok: false, error: fillet.error, errorPiIndex: fillet.errorPiIndex, coordinates: raw, chainagesM: chainagesOf(raw), piChainagesM: [], fillet };
  }
  const proj = alignmentProjector(a.pis);
  const coords: LonLatZ[] = [raw[0]];
  /** For each PI: vertex index of a sharp PI, or [arcStart, arcEnd] vertex indices of a curved one. */
  const piVertex: (number | [number, number])[] = [0];
  let nextPi = 1; // next interior PI not yet reached
  for (const el of fillet.elements) {
    if (el.kind === 'tangent') {
      coords.push([el.end[0], el.end[1], z]);
      const p = a.pis[nextPi];
      if (nextPi < a.pis.length - 1 && p.lon === el.end[0] && p.lat === el.end[1]) piVertex[nextPi++] = coords.length - 1;
    } else {
      const f = fillet.pis[el.piIndex!];
      const c = toXY(proj, f.centre!);
      const s0 = toXY(proj, el.start);
      const a0 = Math.atan2(s0[1] - c[1], s0[0] - c[0]);
      const sweep = el.deflectionRad!; // + = anticlockwise
      const n = arcSteps(f.radiusM, Math.abs(sweep), opts.sagittaM, opts.maxStepM);
      const startIdx = coords.length - 1;
      for (let k = 1; k < n; k++) {
        const ang = a0 + (sweep * k) / n;
        const [lon, lat] = toLonLat(proj, c[0] + f.radiusM * Math.cos(ang), c[1] + f.radiusM * Math.sin(ang));
        coords.push([lon, lat, z]);
      }
      coords.push([el.end[0], el.end[1], z]);
      piVertex[el.piIndex!] = [startIdx, coords.length - 1];
      nextPi = el.piIndex! + 1;
    }
  }
  const last = a.pis.length - 1;
  piVertex[last] = coords.length - 1;
  const chainagesM = chainagesOf(coords);
  const piChainagesM = a.pis.map((p, i) => {
    const v = piVertex[i];
    if (Array.isArray(v)) return (chainagesM[v[0]] + chainagesM[v[1]]) / 2;
    if (typeof v === 'number') return chainagesM[v];
    // A sharp PI reached by a zero-length tangent (a clamped curve's CT sits on it): nearest vertex.
    let best = 0, bd = Infinity;
    const q = toXY(proj, [p.lon, p.lat]);
    coords.forEach((c, k) => { const w = toXY(proj, c); const d = Math.hypot(w[0] - q[0], w[1] - q[1]); if (d < bd) { bd = d; best = k; } });
    return chainagesM[best];
  });
  return { ok: true, coordinates: coords, chainagesM, piChainagesM, fillet };
};
