/**
 * Remap per-vertex data when the derived polyline is regenerated (GEOMETRY_EDITOR_DESIGN.md §3.4): road sections by
 * chainage, per-vertex depths derived from control depths by chainage, level-crossing decisions re-matched by distance.
 * No typed value is invented: a derived depth is a linear interpolation between two known controls, else UNKNOWN.
 */
import type { Certainty } from '../../objects/certainty';
import { projectorFor, toXY } from '../../underground/alignmentGeometry';
import { chainagesOf } from './stationing';
import type { CrossingLike, DepthEntryLike, DepthValueKey, DerivedDepth, InterpolateDepthsFn, RematchCrossingsFn, RemapSectionsFn } from './types';

type Coords = readonly (readonly number[])[];

const normalised = (coords: Coords): number[] => {
  const ch = chainagesOf(coords);
  const L = ch[ch.length - 1] ?? 0;
  return ch.map((c, i) => (L > 0 ? c / L : coords.length > 1 ? i / (coords.length - 1) : 0));
};

/** Index of the vertex whose normalised chainage is nearest x. */
function nearestIndex(n: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < n.length; i++) if (Math.abs(n[i] - x) < Math.abs(n[best] - x)) best = i;
  return best;
}

/**
 * Sections own vertex ranges [start, end]; each boundary keeps its relative chainage along the line. Sections that collapse
 * onto the same start vertex keep the later one (as normalizeRoadSections does). Output covers 0 … n−1 contiguously.
 */
export const remapSectionsByChainage: RemapSectionsFn = (sections, oldCoords, newCoords) => {
  if (!sections.length) return [];
  const last = Math.max(0, newCoords.length - 1);
  const nOld = normalised(oldCoords), nNew = normalised(newCoords);
  const at = (i: number) => nOld[Math.max(0, Math.min(nOld.length - 1, i))] ?? 0;
  const mapped = [...sections].sort((x, y) => x.startNodeIndex - y.startNodeIndex)
    .map((s, k) => ({ s, start: k === 0 ? 0 : Math.min(last, nearestIndex(nNew, at(s.startNodeIndex))) }));
  const unique: typeof mapped = [];
  for (const m of mapped) {
    const prev = unique[unique.length - 1];
    if (prev && m.start <= prev.start) { unique[unique.length - 1] = { ...m, start: prev.start }; continue; }
    if (prev && last > 0 && m.start >= last) continue; // would own no segment
    unique.push(m);
  }
  return unique.map((m, k) => ({ ...m.s, startNodeIndex: m.start, endNodeIndex: unique[k + 1]?.start ?? last }));
};

const RANK: Record<Certainty, number> = { measured: 0, estimated: 1, hypothetical: 2, unknown: 3 };
/** The worse of two certainties (unknown wins). */
export const worseCertainty = (a: Certainty, b: Certainty): Certainty => (RANK[a] >= RANK[b] ? a : b);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function derived<T extends DepthEntryLike>(a: T, b: T, w: number, key: DepthValueKey): DerivedDepth<T> {
  const va = a[key], vb = b[key];
  const known = finite(va) && finite(vb);
  const entry: Record<string, unknown> = {
    [key]: known ? va + (vb - va) * w : null,
    certainty: known ? worseCertainty(a.certainty, b.certainty) : 'unknown',
    derived: true,
  };
  if (a.isDefault && b.isDefault) entry.isDefault = true;
  return entry as DerivedDepth<T>;
}

/**
 * Per-vertex depths from control depths (one per PI) by chainage. A vertex at a control's chainage (±1 mm) gets that
 * control unchanged (typed, not derived); between two controls it gets the linear interpolation, certainty = the worse of
 * the two, and UNKNOWN when either is unknown; beyond the end controls it gets a derived copy of the nearest control.
 */
export const interpolateDepths: InterpolateDepthsFn = <T extends DepthEntryLike>(
  controls: readonly T[], controlChainagesM: readonly number[], vertexChainagesM: readonly number[], valueKey: DepthValueKey,
): DerivedDepth<T>[] => {
  const unknown = { [valueKey]: null, certainty: 'unknown', derived: true } as unknown as DerivedDepth<T>;
  if (!controls.length || controls.length !== controlChainagesM.length) return vertexChainagesM.map(() => ({ ...unknown }));
  const used = new Set<number>();
  return vertexChainagesM.map(x => {
    let k = 0;
    while (k + 1 < controlChainagesM.length && controlChainagesM[k + 1] <= x) k++;
    for (const j of [k, k + 1]) {
      if (j < controls.length && !used.has(j) && Math.abs(controlChainagesM[j] - x) <= 1e-3) { used.add(j); return { ...controls[j] }; }
    }
    if (x <= controlChainagesM[0]) return derived(controls[0], controls[0], 0, valueKey);
    if (k + 1 >= controls.length) return derived(controls[k], controls[k], 0, valueKey);
    const span = controlChainagesM[k + 1] - controlChainagesM[k];
    return derived(controls[k], controls[k + 1], span > 0 ? (x - controlChainagesM[k]) / span : 0, valueKey);
  });
};

/** Keep a previous crossing decision when a new crossing with the same other road lies within toleranceM (default 2 m). */
export const rematchCrossings: RematchCrossingsFn = <C extends CrossingLike>(previous: readonly C[], next: readonly C[], toleranceM = 2): C[] =>
  next.map(n => {
    let best: C | null = null, bd = Infinity;
    for (const p of previous) {
      if (p.roadId !== n.roadId) continue;
      const proj = projectorFor([n.point, p.point]);
      const [x0, y0] = toXY(proj, n.point), [x1, y1] = toXY(proj, p.point);
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d <= toleranceM && d < bd) { bd = d; best = p; }
    }
    return best ? { ...n, decision: best.decision } : n;
  });
