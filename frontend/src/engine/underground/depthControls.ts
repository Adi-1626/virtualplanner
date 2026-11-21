/**
 * Depth controls at alignment PIs ↔ per-vertex depths (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §3.4).
 *
 * When a tunnel or utility carries `alignment`, the depths the user types live at its PIs (`depthControls[]`, one per PI,
 * the same entry shape as the per-vertex `depths[]`). `depths[]` stays, one entry per vertex of the derived densified
 * `coordinates`, because the profile, the renderer and the backend screening read it per vertex. It is DERIVED here by
 * linear interpolation along the chainage between controls: certainty = the worse of the two, and an UNKNOWN control
 * on either side makes the vertex UNKNOWN (never 0, never bridged). Pure functions.
 */
import type { Certainty } from '../objects/certainty';
import { chainages } from './alignmentGeometry';
import { densifyAlignment } from '../geometry/alignment/densify';
import { interpolateDepths } from '../geometry/alignment/remap';
import { projectOntoLine } from '../geometry/alignment/stationing';
import { alignmentFromPolyline } from '../geometry/alignment/fromPolyline';
import type { DepthEntryLike, DepthValueKey, DerivedDepth, HorizontalAlignment } from '../geometry/alignment/types';

type Coords = readonly (readonly number[])[];

export interface DepthCarrier<T> {
  coordinates: Coords;
  alignment?: HorizontalAlignment;
  depthControls?: T[];
  depths?: T[];
}

/** Stored fields that depend on where the point is (ground, elevation): dropped when a point moves or is derived. */
const POSITION_FIELDS = ['elevationM', 'groundM', 'groundModel'] as const;

export function withoutPositionFields<T extends object>(e: T): T {
  const out = { ...e } as Record<string, unknown>;
  for (const k of POSITION_FIELDS) delete out[k];
  return out as T;
}

/**
 * Chainage (m) of each PI along `coords`: the vertex of a sharp PI, the arc midpoint of a curved one (densifyAlignment),
 * scaled to the stored line's length (equal for tunnels and utilities, whose coordinates are exactly the densified line).
 */
export function piChainagesOn(alignment: Pick<HorizontalAlignment, 'behaviour' | 'pis'>, coords: Coords): number[] {
  const d = densifyAlignment(alignment);
  const ch = chainages(coords);
  const L = ch[ch.length - 1] ?? 0;
  if (!d.ok) return alignment.pis.map(p => projectOntoLine(coords, [p.lon, p.lat])?.chainageM ?? 0);
  const Ld = d.chainagesM[d.chainagesM.length - 1] ?? 0;
  const k = Ld > 0 ? L / Ld : 1;
  return d.piChainagesM.map(c => Math.min(L, c * k));
}

/** The depth entry at chainage `ch` on a line with per-vertex depths: the vertex's own entry at a vertex, else derived. */
export function depthAtChainage<T extends DepthEntryLike>(depths: readonly T[], vertexChainagesM: readonly number[], ch: number, key: DepthValueKey): DerivedDepth<T> {
  if (!depths.length) return { [key]: null, certainty: 'unknown' as Certainty, derived: true } as unknown as DerivedDepth<T>;
  const n = Math.min(depths.length, vertexChainagesM.length);
  return interpolateDepths(depths.slice(0, n), vertexChainagesM.slice(0, n), [ch], key)[0];
}

/**
 * The depth controls of an object with `alignment`: the stored ones when there is one per PI, else read from the
 * per-vertex depths at each PI's chainage (a PI on a vertex keeps that vertex's entry as it is; typed stays typed).
 * Null for an object without `alignment` (its depths are edited per vertex, as before).
 */
export function controlsOf<T extends DepthEntryLike>(o: DepthCarrier<T>, key: DepthValueKey): DerivedDepth<T>[] | null {
  const a = o.alignment;
  if (!a || a.pis.length < 2) return null;
  if (Array.isArray(o.depthControls) && o.depthControls.length === a.pis.length) return o.depthControls;
  const vch = chainages(o.coordinates);
  const depths = Array.isArray(o.depths) ? o.depths : [];
  return piChainagesOn(a, o.coordinates).map(c => depthAtChainage(depths, vch, c, key));
}

/** Per-vertex depths of `coords` from controls at the alignment's PIs (interpolated by chainage, unknown stays unknown). */
export function depthsFromControls<T extends DepthEntryLike>(
  alignment: Pick<HorizontalAlignment, 'behaviour' | 'pis'>, coords: Coords, controls: readonly T[], key: DepthValueKey,
): DerivedDepth<T>[] {
  const vch = chainages(coords);
  if (controls.length !== alignment.pis.length) return vch.map(() => ({ [key]: null, certainty: 'unknown', derived: true }) as unknown as DerivedDepth<T>);
  return interpolateDepths(controls, piChainagesOn(alignment, coords), vch, key);
}

const samePos = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.abs(a.lon - b.lon) < 1e-9 && Math.abs(a.lat - b.lat) < 1e-9;

/**
 * Depth controls for a reshaped object: one per PI of `next`.
 *  - Same number of PIs as before (a drag, a radius change): PI i keeps control i (its typed value moves with it).
 *  - A PI inserted or deleted: PIs at the same position as before keep their control; a new PI gets the depth the old
 *    line had where it projects (derived, certainty the worse of the neighbours, unknown stays unknown).
 *  - A legacy object (no alignment before, its first reshape): the old PIs are those the migration makes from its
 *    polyline (alignmentFromPolyline, which keeps every vertex with a typed depth the interpolation would not give), with
 *    their vertices' entries as controls; then as above.
 * Ground / elevation fields are dropped (the point may have moved; the editor stores them again from the ground model).
 */
export function remapControls<T extends DepthEntryLike>(before: DepthCarrier<T>, next: HorizontalAlignment, key: DepthValueKey): DerivedDepth<T>[] {
  const oldCoords = before.coordinates;
  const oldDepths = Array.isArray(before.depths) ? before.depths : [];
  const vch = chainages(oldCoords);
  const sampleAt = (p: { lon: number; lat: number }): DerivedDepth<T> => {
    const hit = projectOntoLine(oldCoords, [p.lon, p.lat]);
    return depthAtChainage(oldDepths, vch, hit?.chainageM ?? 0, key);
  };
  let oldControls = controlsOf(before, key);
  let oldPis = before.alignment?.pis;
  if (!oldControls || !oldPis) {
    // Legacy line: the PIs the shape editor makes from it (same migration: Douglas–Peucker, typed depths kept as PIs)
    const typedDepthAt = (i: number): number | null => {
      const d = oldDepths[i] as (T & { derived?: boolean }) | undefined;
      const v = d?.[key];
      return d && !d.derived && typeof v === 'number' && Number.isFinite(v) ? v : null;
    };
    const m = alignmentFromPolyline(oldCoords, { typedDepthAt });
    oldPis = m.alignment.pis;
    oldControls = m.keptIndices.map(i => (oldDepths[i] ? { ...oldDepths[i] } : sampleAt(oldPis![m.keptIndices.indexOf(i)])));
  }
  let out: DerivedDepth<T>[];
  if (oldPis.length === next.pis.length) out = next.pis.map((_, i) => ({ ...oldControls![i] }));
  else {
    let k = 0;
    out = next.pis.map(p => {
      for (let j = k; j < oldPis!.length; j++) if (samePos(oldPis![j], p)) { k = j + 1; return { ...oldControls![j] }; }
      return sampleAt(p);
    });
  }
  return out.map(withoutPositionFields);
}
