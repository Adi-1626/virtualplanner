/**
 * Vertices a drawn road / flyover put into OTHER roads (crossing junctions, T-junctions at its ends, confirmed level
 * crossings), recorded on the drawn object as `addedNetworkVertices`, so a later reshape can take back the ones it no
 * longer uses. Before, a crossing that moved or disappeared left its vertex behind in the other road (a shape point
 * that did nothing, or a node the traffic graph still split the road at).
 *
 * Only what we added is ever removed: a vertex is listed only when a diff of ours inserted it (pure insertion, the old
 * vertices all kept), and it is removed only when the other road still has it exactly, it is not an end, not a section
 * boundary, and nothing else in the scenario (another road's vertex, a junction, another object's record) uses that
 * point. Mapped (OSM) geometry beyond what we added is never touched.
 */
import type { CityObject, RoadObject, RoadSectionProfile } from '../objects/types';
import type { HistoryDiff } from '../history/HistoryManager';
import { planDistM } from './levelCrossings';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';

export interface AddedVertex {
  /** The road the vertex was put into. */
  roadId: string;
  /** Plan position (lon, lat) of the vertex. */
  point: [number, number];
}

/** Two plan points closer than this are the same vertex. */
const SAME_M = 0.05;

type Line = readonly (readonly number[])[];
const coordsOf = (o: CityObject | undefined): Line | null => {
  const c = (o as { coordinates?: unknown } | undefined)?.coordinates;
  return Array.isArray(c) && Array.isArray(c[0]) ? (c as Line) : null;
};
const hasVertexAt = (line: Line, p: readonly number[]) => line.some(c => planDistM(c, p) < SAME_M);

export const addedVerticesOf = (o: CityObject | undefined): AddedVertex[] =>
  ((o as { addedNetworkVertices?: AddedVertex[] } | undefined)?.addedNetworkVertices ?? []).filter(v => v && typeof v.roadId === 'string' && Array.isArray(v.point));

/**
 * The vertices `diffs` inserted into roads other than `selfId`: per road update whose new line is the old one plus
 * extra vertices (nothing moved or removed), the extra ones. Anything else (a reshaped road, a ramp-merge update) adds
 * nothing.
 */
export function verticesInsertedBy(diffs: readonly HistoryDiff[], selfId: string): AddedVertex[] {
  const out: AddedVertex[] = [];
  const walk = (d: HistoryDiff) => {
    if (d.type === 'batch') { d.diffs.forEach(walk); return; }
    if (d.type !== 'update' || d.id === selfId || d.after?.type !== 'road') return;
    const b = coordsOf(d.before), a = coordsOf(d.after);
    if (!b || !a || a.length <= b.length) return;
    // Pure insertion: the old vertices appear in order in the new line
    let j = 0;
    const extra: number[][] = [];
    for (const c of a) {
      if (j < b.length && c[0] === b[j][0] && c[1] === b[j][1]) j++;
      else extra.push([c[0], c[1]]);
    }
    if (j !== b.length || extra.length !== a.length - b.length) return;
    for (const p of extra) out.push({ roadId: d.id, point: [p[0], p[1]] });
  };
  diffs.forEach(walk);
  return out;
}

/** `a` with the entries of `b` not already in it (same road, same point). */
export function mergeAdded(a: readonly AddedVertex[], b: readonly AddedVertex[]): AddedVertex[] {
  const out = [...a];
  for (const v of b) if (!out.some(w => w.roadId === v.roadId && planDistM(w.point, v.point) < SAME_M)) out.push(v);
  return out;
}

/** Inverse of insertRoadVertex: the road without vertex `index`, section ranges kept in step. */
export function removeRoadVertex(road: Pick<RoadObject, 'coordinates' | 'sections'>, index: number): { coordinates: [number, number, number][]; sections: RoadSectionProfile[] | undefined } {
  const coordinates = road.coordinates.filter((_, i) => i !== index);
  const sections = road.sections?.map(sec => ({
    ...sec,
    startNodeIndex: sec.startNodeIndex > index ? sec.startNodeIndex - 1 : sec.startNodeIndex,
    endNodeIndex: sec.endNodeIndex >= index ? sec.endNodeIndex - 1 : sec.endNodeIndex,
  }));
  return { coordinates, sections };
}

export interface PruneContext {
  objects: { getAll(): CityObject[]; getById(id: string): CityObject | undefined; update(id: string, updates: Partial<CityObject>): void };
  scenarioId: string;
}

/**
 * After `selfId` was reshaped to `line`: every vertex of `recorded` the new line no longer passes through is taken out
 * of its road again when it is safe (see the file comment). Returns the update diffs (for the same Undo step) and the
 * entries still standing (in use, or kept because something else relies on the point).
 */
export function pruneStaleAddedVertices(selfId: string, recorded: readonly AddedVertex[], line: Line, ctx: PruneContext): { diffs: HistoryDiff[]; kept: AddedVertex[] } {
  const diffs: HistoryDiff[] = [];
  const kept: AddedVertex[] = [];
  if (!recorded.length) return { diffs, kept };
  const visible = filterObjectsForScenario(ctx.objects.getAll(), ctx.scenarioId);
  for (const v of recorded) {
    if (hasVertexAt(line, v.point)) { kept.push(v); continue; } // still where this line meets that road
    const road = ctx.objects.getById(v.roadId) as RoadObject | undefined;
    if (!road || road.type !== 'road' || !visible.some(o => o.id === road.id)) continue; // road gone: nothing to take back
    const idx = road.coordinates.findIndex(c => planDistM(c, v.point) < SAME_M);
    if (idx < 0) continue; // already gone (edited since): forget it
    const isEnd = idx === 0 || idx === road.coordinates.length - 1;
    const isBoundary = (road.sections ?? []).some(s => s.startNodeIndex === idx || s.endNodeIndex === idx);
    const usedElsewhere = visible.some(o => {
      if (o.id === selfId || o.id === road.id) return false;
      if (addedVerticesOf(o).some(w => w.roadId === road.id && planDistM(w.point, v.point) < SAME_M)) return true;
      const c = (o as { coordinates?: unknown }).coordinates;
      if (!Array.isArray(c)) return false;
      if (typeof c[0] === 'number') return planDistM(c as number[], v.point) < SAME_M; // a junction / point object
      return Array.isArray(c[0]) && typeof (c[0] as unknown[])[0] === 'number' && hasVertexAt(c as Line, v.point);
    });
    if (isEnd || isBoundary || usedElsewhere) { kept.push(v); continue; }
    const before = road;
    const r = removeRoadVertex(road, idx);
    ctx.objects.update(road.id, r.sections ? { coordinates: r.coordinates, sections: r.sections } : { coordinates: r.coordinates });
    diffs.push({ type: 'update', id: road.id, before, after: ctx.objects.getById(road.id)!, description: `Crossing point removed from ${road.name || road.id}` });
  }
  return { diffs, kept };
}
