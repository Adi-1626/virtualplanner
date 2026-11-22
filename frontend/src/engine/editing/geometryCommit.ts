/**
 * Commit of a reshaped alignment (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md §3.4, §6, phase 2 agent D).
 *
 * `coordinates` of a line object with `alignment` is always derived. A reshape (Edit shape: drag release, panel cell,
 * context-menu action) hands the new alignment here, and everything downstream is made consistent in ONE Undo step:
 *
 *   regenerate (densify, heights carried from the old line) → ends re-joined to the network (as when drawing)
 *   → T-junction splits of the roads an end lands on → crossings found again (roads and flyovers; the flyover on its
 *   profile) with earlier level decisions carried by distance → flyover ground line reset so its profile is rebuilt
 *   (legacy 40 m ramps unchanged) and its ramp-merge capacity effects recomputed → road sections remapped by chainage
 *   → tunnel / utility depth controls kept at the PIs and per-vertex depths derived from them → one `batch` diff.
 *
 * `regenerateGeometry` is the pure part (no network, no history), used for tunnels, utilities and metro lines as a
 * whole and by the network pipeline. The traffic graph rebuild follows the object update as for any other edit.
 * Vertices this line's crossings / end junctions inserted into OTHER roads (recorded as `addedNetworkVertices`) are taken
 * back when the reshaped line no longer passes through them, in the same Undo step (editing/addedVertices.ts).
 */
import type { CityObject, FlyoverObject, MetroFlyoverObject, RoadObject, UndergroundAlignmentObject, UtilityObject } from '../objects/types';
import type { ObjectManager } from '../objects/ObjectManager';
import type { HistoryDiff, HistoryManager } from '../history/HistoryManager';
import type { EditingEngine } from './EditingEngine';
import { densifyAlignment } from '../geometry/alignment/densify';
import { remapSectionsByChainage } from '../geometry/alignment/remap';
import { projectOntoLine } from '../geometry/alignment/stationing';
import { geometryLockReason } from '../geometry/alignment/fromPolyline';
import type { AlignableObjectType, HorizontalAlignment } from '../geometry/alignment/types';
import { connectEnds, AUTO_CONNECT_M } from './autoConnect';
import { carryCrossingDecisions, planDistM, type LevelCrossing } from './levelCrossings';
import { insertRoadVertex, markGeometryEdited } from './roadGaps';
import { addedVerticesOf, mergeAdded, pruneStaleAddedVertices, verticesInsertedBy } from './addedVertices';
import { applyFlyoverElevationProfile } from '../objects/flyoverHelper';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';
import { remapControls, depthsFromControls } from '../underground/depthControls';
import { utilityZ, withUtilityZ } from '../underground/utilityModel';

type Pt3 = [number, number, number];
export type AlignableObject = RoadObject | FlyoverObject | MetroFlyoverObject | UndergroundAlignmentObject | UtilityObject | (CityObject & { type: 'metro_line' });

const ALIGNABLE = new Set<string>(['road', 'flyover', 'metro_flyover', 'metro_line', 'underground_alignment', 'utility'] satisfies AlignableObjectType[]);
const NETWORK = new Set<string>(['road', 'flyover', 'metro_flyover']);
const isFlyover = (t: string) => t === 'flyover' || t === 'metro_flyover';

export type GeometryCommitError = 'not-alignable' | 'locked' | 'invalid-geometry' | 'too-few-pis';

export interface RegeneratedGeometry {
  ok: boolean;
  error?: GeometryCommitError;
  /** Why it is invalid, in words (a U-turn at PI n, coincident points …). */
  message?: string;
  /** The object with the new alignment and everything derived from it (no network steps). */
  object?: CityObject;
}

/** The ground-level line of a line object (a flyover's stored ground path, else its coordinates). */
function groundLineOf(o: CityObject): readonly (readonly number[])[] {
  const g = (o as { groundCoordinates?: number[][] }).groundCoordinates;
  if (isFlyover(o.type) && Array.isArray(g) && g.length >= 2) return g;
  return (o as { coordinates: number[][] }).coordinates;
}

/** z of each new vertex = the old line's z at the nearest point (ground roads 0, flyover ground path, metro deck as drawn). */
function carryHeights(newPlan: readonly (readonly number[])[], oldLine: readonly (readonly number[])[]): Pt3[] {
  return newPlan.map(c => {
    const hit = oldLine.length >= 2 ? projectOntoLine(oldLine, c) : null;
    return [c[0], c[1], hit ? hit.z : (oldLine[0]?.[2] ?? 0)];
  });
}

/**
 * The object regenerated from `alignment`: densified coordinates (heights carried from the old line), depth controls at
 * the PIs with per-vertex depths derived from them (tunnels, utilities), road sections remapped by chainage, a flyover's
 * ground line reset (its profile is rebuilt by ObjectManager.update). Level crossings and network joins are not touched
 * here (commitGeometry does them). Pure.
 */
export function regenerateGeometry(obj: CityObject, alignment: HorizontalAlignment): RegeneratedGeometry {
  if (!ALIGNABLE.has(obj.type)) return { ok: false, error: 'not-alignable', message: `A ${obj.type} has no editable line geometry.` };
  const lock = geometryLockReason(obj as Parameters<typeof geometryLockReason>[0]);
  if (lock) return { ok: false, error: 'locked', message: lock === 'osm-import' ? 'Imported from OpenStreetMap: its geometry is kept as mapped.' : lock === 'imported-metro' ? 'An imported metro line keeps its mapped geometry.' : 'Entered from records as existing: its geometry is kept as recorded.' };
  if (alignment.pis.length < 2) return { ok: false, error: 'too-few-pis', message: 'A line needs at least 2 points.' };
  const d = densifyAlignment(alignment);
  if (!d.ok) {
    const at = d.errorPiIndex !== undefined ? ` at point ${d.errorPiIndex + 1}` : '';
    return { ok: false, error: 'invalid-geometry', message: d.error === 'u-turn' ? `The line turns back on itself${at}: a U-turn needs two points.` : d.error === 'coincident-pis' ? `Two points are in the same place${at}.` : 'Not enough points.' };
  }
  const old = obj as CityObject & { coordinates: Pt3[] };
  const coordinates = carryHeights(d.coordinates, groundLineOf(old));
  const now = new Date().toISOString();
  let next: CityObject = { ...old, alignment, coordinates, updatedAt: now } as CityObject;

  if (obj.type === 'road') {
    const r = obj as RoadObject;
    const out = next as RoadObject;
    if (r.sections?.length) out.sections = markGeometryEdited(remapSectionsByChainage(r.sections, r.coordinates, coordinates));
    delete out.sourceCoordinates; // a drawn road's source geometry is what was drawn: set again from the new line
  } else if (isFlyover(obj.type)) {
    delete (next as { groundCoordinates?: unknown }).groundCoordinates; // rebuilt from the new ground line
  } else if (obj.type === 'underground_alignment') {
    const a = obj as UndergroundAlignmentObject;
    const controls = remapControls(a, alignment, 'crownDepthM');
    next = { ...next, depthControls: controls, depths: depthsFromControls(alignment, coordinates, controls, 'crownDepthM') } as CityObject;
  } else if (obj.type === 'utility') {
    const u = obj as UtilityObject;
    // A legacy-model utility (one `depth` for the line) is read per vertex the way utilityZ migrates it
    const controls = remapControls({ ...u, depths: utilityZ(u).depths }, alignment, 'depthM');
    next = withUtilityZ({ ...(next as UtilityObject), depthControls: undefined }, { controls });
    (next as UtilityObject).updatedAt = now;
  }
  return { ok: true, object: next };
}

export interface GeometryCommitContext {
  objects: ObjectManager;
  history: HistoryManager | null;
  /** The crossing / T-junction steps the drawing uses (EditingEngine). */
  editing: Pick<EditingEngine, 'reconstructCrossings' | 'insertJunctionIntoIntersectedRoads'>;
  /** The alternative the object is edited in. */
  scenarioId: string;
}

export interface GeometryCommitResult extends RegeneratedGeometry {
  /** The Undo step pushed (null when nothing was committed). */
  diff: HistoryDiff | null;
  /** Crossings whose level is not confirmed after the reshape (new ones, or found again unconfirmed). */
  uncertainCrossings: number;
}

/** Nearest segment insertion of `p` into `coords` (null when a vertex is already within 5 cm). */
function withVertexAt(coords: readonly Pt3[], p: readonly number[]): { index: number; coords: Pt3[] } | null {
  if (coords.some(c => planDistM(c, p) < 0.05)) return null;
  const hit = projectOntoLine(coords, p);
  if (!hit) return null;
  const out = [...coords];
  out.splice(hit.segmentIndex + 1, 0, [p[0], p[1], hit.z]);
  return { index: hit.segmentIndex + 1, coords: out };
}

/**
 * Commits a reshape of `obj` (as stored now) to `alignment`: regenerates it, runs the same network steps as drawing
 * (roads, flyovers), updates the object and every road it changes, and pushes ONE `batch` diff "Reshape <name>" so Undo
 * restores the object and the roads together. Returns the committed object, or ok: false with a message (nothing changed).
 */
export function commitGeometry(obj: CityObject, alignment: HorizontalAlignment, ctx: GeometryCommitContext): GeometryCommitResult {
  const regen = regenerateGeometry(obj, alignment);
  if (!regen.ok || !regen.object) return { ...regen, diff: null, uncertainCrossings: 0 };
  const { objects, editing, scenarioId } = ctx;
  const before = objects.getById(obj.id) ?? obj;
  type LineObj = { id: string; name: string; type: string; coordinates: Pt3[]; alignment: HorizontalAlignment; levelCrossings?: LevelCrossing[]; [k: string]: unknown };
  let next = regen.object as unknown as LineObj;
  const asCity = (o: LineObj) => o as unknown as CityObject & { coordinates: Pt3[] };
  const diffs: HistoryDiff[] = [];
  let uncertain = 0;

  if (NETWORK.has(obj.type)) {
    // 1. Ends re-joined to the road they stop just short of, at their level (as joinedToNetwork does when drawing);
    //    the end PIs follow
    const candidates = filterObjectsForScenario(objects.getAll(), scenarioId)
      .filter(o => o.id !== obj.id && NETWORK.has(o.type)) as { id: string; coordinates: Pt3[] }[];
    let coords: Pt3[] = connectEnds(next.coordinates, candidates, obj.id) ?? next.coordinates;
    const pis = next.alignment.pis.map(p => ({ ...p }));
    const n = pis.length - 1;
    if (planDistM([pis[0].lon, pis[0].lat], coords[0]) < AUTO_CONNECT_M + 5) { pis[0].lon = coords[0][0]; pis[0].lat = coords[0][1]; }
    if (planDistM([pis[n].lon, pis[n].lat], coords[coords.length - 1]) < AUTO_CONNECT_M + 5) { pis[n].lon = coords[coords.length - 1][0]; pis[n].lat = coords[coords.length - 1][1]; }
    next = { ...next, coordinates: coords, alignment: { ...next.alignment, pis } };

    // 2. T-junctions where an end lands mid-segment on another road (never on itself: it is replaced whole below)
    diffs.push(...editing.insertJunctionIntoIntersectedRoads(coords).filter(df => !(df.type === 'update' && df.id === obj.id)));

    // 3. Crossings found again on the new line (a flyover on the heights its profile will give it)
    let profiled: Pt3[] | undefined;
    if (isFlyover(obj.type)) {
      const probe = structuredClone(next) as any;
      applyFlyoverElevationProfile(probe);
      profiled = probe.coordinates;
    }
    const rec = editing.reconstructCrossings(asCity(next), scenarioId, profiled);
    diffs.push(...rec.diffs);
    if (!profiled) coords = rec.coordinates;
    // 4. Earlier level decisions carried by distance (≤ 2 m, same other road); a confirmed junction is made again
    const flags = carryCrossingDecisions(obj.type === 'road' || isFlyover(obj.type) ? (before as { levelCrossings?: LevelCrossing[] }).levelCrossings : undefined, rec.flags);
    for (const f of flags) {
      if (f.decision !== 'junction' || obj.type !== 'road') continue;
      const other = objects.getById(f.roadId) as RoadObject | undefined;
      if (!other || other.type !== 'road') { f.decision = 'unconfirmed'; continue; }
      // The other road's vertex near the crossing is the shared point (it was made when the junction was confirmed)
      const shared = other.coordinates.find(c => planDistM(c, f.point) <= 0.5);
      const p: Pt3 = shared ? [shared[0], shared[1], f.point[2]] : [f.point[0], f.point[1], f.point[2]];
      if (!shared) {
        const hit = projectOntoLine(other.coordinates, p);
        if (hit) {
          const o2 = insertRoadVertex(other, hit.segmentIndex + 1, [p[0], p[1], hit.z]);
          const ob = other;
          objects.update(other.id, o2.sections ? { coordinates: o2.coordinates, sections: o2.sections } : { coordinates: o2.coordinates });
          diffs.push({ type: 'update', id: other.id, before: ob, after: objects.getById(other.id)!, description: `Junction with ${obj.name}` });
        }
      }
      const ins = withVertexAt(coords, p);
      if (ins) coords = ins.coords;
      f.point = [p[0], p[1], f.point[2]];
    }
    uncertain = flags.filter(f => f.decision === 'unconfirmed').length;
    next = { ...next, coordinates: coords };
    if (flags.length) next.levelCrossings = flags; else delete next.levelCrossings;
    // Sections follow the final line (crossing vertices included)
    if (obj.type === 'road' && (obj as RoadObject).sections?.length) {
      (next as unknown as RoadObject).sections = markGeometryEdited(remapSectionsByChainage((obj as RoadObject).sections!, (obj as RoadObject).coordinates, coords));
    }

    // 5. Flyover: ramp-merge capacity effects on the surface roads worked out again for the new path (legacy ramps)
    if (isFlyover(obj.type)) {
      const { flyover, roadUpdates } = objects.flyoverFeasibility(asCity(next));
      next = { ...next, ...flyover } as LineObj;
      const touched = new Set(roadUpdates.map(u => u.id));
      for (const u of roadUpdates) {
        const b = objects.getById(u.id)!;
        objects.update(u.id, u.updates);
        diffs.push({ type: 'update', id: u.id, before: b, after: objects.getById(u.id)!, description: `Ramp merge on ${b.name || b.id}` });
      }
      for (const r of objects.getAll()) {
        if (r.type !== 'road' || touched.has(r.id) || r.flyoverImpact?.flyoverId !== obj.id) continue;
        const { flyoverImpact: _gone, ...after } = r;
        void _gone;
        objects.update(r.id, after as CityObject, false, true);
        diffs.push({ type: 'update', id: r.id, before: r, after: objects.getById(r.id)!, description: `Ramp merge removed from ${r.name || r.id}` });
      }
    }

    // 6. Vertices this line put into other roads earlier and no longer passes through are taken back (only ours)
    const pruned = pruneStaleAddedVertices(obj.id, addedVerticesOf(before), next.coordinates, { objects, scenarioId });
    diffs.push(...pruned.diffs);
    const added = mergeAdded(pruned.kept, verticesInsertedBy(diffs, obj.id).filter(v => {
      const r = objects.getById(v.roadId) as { coordinates?: Pt3[] } | undefined;
      return !!r?.coordinates?.some(c => planDistM(c, v.point) < 0.05);
    }));
    if (added.length) next.addedNetworkVertices = added; else delete next.addedNetworkVertices;
  }

  objects.update(obj.id, asCity(next), false, true);
  const after = objects.getById(obj.id)!;
  diffs.push({ type: 'update', id: obj.id, before, after, description: `Reshape ${obj.name || obj.id}` });
  const diff: HistoryDiff = { type: 'batch', description: `Reshape ${obj.name || obj.type}`, diffs };
  ctx.history?.pushDiff(diff);
  return { ok: true, object: after, diff, uncertainCrossings: uncertain };
}
