/**
 * 3D display of underground alignments and imported subsurface records (docs/urbanos/UNDERGROUND_WORKSPACE.md §3).
 * Uses Cesium entities in its own CustomDataSource:
 * - an alignment is a polylineVolume (circle or box of the entered size) whose centreline sits at
 *   −(crown depth + height/2) below the ground datum. Runs of vertices with UNKNOWN depth are not placed below ground:
 *   they are a dashed line on the surface ("depth UNKNOWN"). An UNKNOWN section size is a plain line at crown depth.
 *   Hypothetical values are drawn paler than estimated / measured ones.
 * - subsurface utility records: a line at −depth when the depth is known, else dashed on the surface;
 *   boreholes: a vertical line from ground to the final depth (or a short stub when it is UNKNOWN).
 * The first entity of an alignment carries the object's id, so clicking it selects the object like any other.
 */
import {
  Cartesian2, Color, ColorMaterialProperty, CornerType, CustomDataSource, PolylineDashMaterialProperty, type Entity, type Viewer,
} from 'cesium';
import { scenePoint } from '../terrain/groundHeight';
import type { Certainty } from '../objects/certainty';
import type { UndergroundAlignmentKind, UndergroundAlignmentObject } from '../objects/types';
import { depthsOf, sectionHeightM, sectionWidthM } from './alignmentGeometry';
import type { SubsurfaceRecord } from '../../lib/coordinationApi';
import { layerOf } from './recordsSummary';

/** Utility colours (APWA-style convention, used informally in India too): what the asset is. */
export const RECORD_COLOR: Record<string, string> = {
  sewer: '#22c55e', storm_drain: '#14b8a6', water: '#3b82f6', power: '#ef4444', gas: '#eab308', telecom: '#f97316', other_utility: '#38bdf8',
};
/** Evidence → opacity (ASCE 38 quality level): how sure the position is, separate from status. */
export const EVIDENCE_ALPHA: Record<string, number> = { 'QL-A': 1, 'QL-B': 0.9, 'QL-C': 0.75, 'QL-D': 0.6, UNKNOWN: 0.5 };

const KIND_COLOR: Record<UndergroundAlignmentKind, string> = {
  bored_tunnel: '#f59e0b', underground_metro: '#a855f7', cut_and_cover: '#f97316', utility_trunk: '#22d3ee', storm_drain: '#22c55e',
};
const ALPHA: Record<Certainty, number> = { measured: 0.95, estimated: 0.8, hypothetical: 0.55, unknown: 0.35 };

function circleShape(r: number, n = 20): Cartesian2[] {
  return Array.from({ length: n }, (_, i) => new Cartesian2(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)));
}
function boxShape(w: number, h: number): Cartesian2[] {
  return [new Cartesian2(-w / 2, -h / 2), new Cartesian2(w / 2, -h / 2), new Cartesian2(w / 2, h / 2), new Cartesian2(-w / 2, h / 2)];
}

/** Consecutive vertex runs whose depth is known (≥2 vertices) and the spans between them that are UNKNOWN. */
export function depthRuns(a: UndergroundAlignmentObject): { known: number[][]; unknown: number[][] } {
  const ds = depthsOf(a);
  const known: number[][] = [], unknown: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < ds.length; i++) {
    if (ds[i].crownDepthM !== null) run.push(i);
    else { if (run.length >= 2) known.push(run); run = []; }
  }
  if (run.length >= 2) known.push(run);
  // a segment is unknown when either end is unknown
  for (let i = 1; i < ds.length; i++) {
    if (ds[i - 1].crownDepthM === null || ds[i].crownDepthM === null) {
      const last = unknown[unknown.length - 1];
      if (last && last[last.length - 1] === i - 1) last.push(i); else unknown.push([i - 1, i]);
    }
  }
  return { known, unknown };
}

export class UndergroundRenderer {
  private ds: CustomDataSource | null = null;
  private viewer: Viewer | null = null;
  private recordsDs: CustomDataSource | null = null;

  attach(viewer: Viewer | null) {
    if (!viewer || this.viewer === viewer) return;
    this.viewer = viewer;
    this.ds = new CustomDataSource('underground-alignments');
    this.recordsDs = new CustomDataSource('subsurface-records');
    void viewer.dataSources.add(this.ds);
    void viewer.dataSources.add(this.recordsDs);
  }

  isAttached() { return !!this.viewer && !this.viewer.isDestroyed(); }

  renderAlignments(alignments: UndergroundAlignmentObject[], selectedId: string | null) {
    if (!this.ds || !this.isAttached()) return;
    const ents = this.ds.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const a of alignments) this.addAlignment(ents, a, a.id === selectedId);
    ents.resumeEvents();
    this.viewer?.scene.requestRender();
  }

  private addAlignment(ents: CustomDataSource['entities'], a: UndergroundAlignmentObject, selected: boolean) {
    const ds = depthsOf(a);
    const h = sectionHeightM(a.section), w = sectionWidthM(a.section);
    const base = Color.fromCssColorString(KIND_COLOR[a.alignmentKind] ?? '#f59e0b');
    const { known, unknown } = depthRuns(a);
    let first = true;
    const nextId = (suffix: string) => { if (first) { first = false; return a.id; } return `ug:${a.id}:${suffix}`; };
    known.forEach((run, k) => {
      const cert = run.reduce<Certainty>((worst, i) => (ALPHA[ds[i].certainty] < ALPHA[worst] ? ds[i].certainty : worst), 'measured');
      const color = base.withAlpha(selected ? Math.min(1, ALPHA[cert] + 0.25) : ALPHA[cert]);
      if (h !== null && w !== null) {
        const positions = run.map(i => scenePoint(a.coordinates[i][0], a.coordinates[i][1], -((ds[i].crownDepthM as number) + h / 2)));
        ents.add({
          id: nextId(`run${k}`), name: a.name,
          polylineVolume: {
            positions, shape: a.section.shape === 'circular' ? circleShape(w / 2) : boxShape(w, h), cornerType: CornerType.MITERED,
            material: new ColorMaterialProperty(color), outline: selected, outlineColor: Color.WHITE,
          },
        } as Entity.ConstructorOptions);
      } else {
        // Section size UNKNOWN: a centreline at crown depth only
        const positions = run.map(i => scenePoint(a.coordinates[i][0], a.coordinates[i][1], -(ds[i].crownDepthM as number)));
        ents.add({ id: nextId(`line${k}`), name: a.name, polyline: { positions, width: selected ? 6 : 4, material: new PolylineDashMaterialProperty({ color, dashLength: 10 }) } });
      }
    });
    unknown.forEach((span, k) => {
      ents.add({
        id: nextId(`unk${k}`), name: `${a.name} (depth UNKNOWN)`,
        polyline: {
          positions: span.map(i => scenePoint(a.coordinates[i][0], a.coordinates[i][1], 0)), width: 3, clampToGround: true,
          material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#94a3b8'), dashLength: 8 }),
        },
      });
    });
    // Plan trace on the surface so the alignment can be found and clicked from above
    ents.add({
      id: nextId('plan'), name: a.name,
      polyline: { positions: a.coordinates.map(c => scenePoint(c[0], c[1], 0)), width: selected ? 3 : 2, clampToGround: true, material: base.withAlpha(0.5) },
    });
  }

  renderRecords(records: SubsurfaceRecord[]) {
    if (!this.recordsDs || !this.isAttached()) return;
    const ents = this.recordsDs.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const r of records) {
      const g = r.geometry;
      if (!g) continue;
      if (r.record_type === 'borehole' && g.type === 'Point') {
        const [x, y] = g.coordinates;
        const depth = r.final_depth_m;
        ents.add({
          id: `rec:${r.id}`, name: `Borehole ${r.external_id}`,
          polyline: {
            positions: [scenePoint(x, y, 0), scenePoint(x, y, -(depth ?? 1))], width: 4,
            material: depth === null ? new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#94a3b8') }) : Color.fromCssColorString('#eab308'),
          },
        });
      } else if (g.type === 'LineString') {
        // Existing records: solid line in the layer colour; opacity by evidence (QL-A/B strong, QL-C/D and unknown paler).
        // A record with no depth is drawn ON the surface (it cannot be placed below ground) — never at an invented depth.
        const d = r.depth_m ?? (r.z_max_m !== null ? -r.z_max_m : null);
        const alpha = EVIDENCE_ALPHA[r.quality_level ?? 'UNKNOWN'] ?? 0.55;
        const color = Color.fromCssColorString(RECORD_COLOR[layerOf(r)] ?? '#38bdf8').withAlpha(d === null ? alpha * 0.8 : alpha);
        const lines = [g.coordinates];
        lines.forEach((line, k) => {
          if (line.length < 2) return;
          ents.add({
            id: k === 0 ? `rec:${r.id}` : `rec:${r.id}:${k}`, name: `${r.utility_type ?? 'Utility'} record ${r.external_id}${d === null ? ' (depth UNKNOWN: drawn on the surface)' : ''}`,
            polyline: d === null
              ? { positions: line.map(c => scenePoint(c[0], c[1], 0)), width: 2, clampToGround: true, material: color }
              : { positions: line.map(c => scenePoint(c[0], c[1], -d)), width: 3, material: color },
          });
        });
      }
    }
    ents.resumeEvents();
    this.viewer?.scene.requestRender();
  }
}

export const undergroundRenderer = new UndergroundRenderer();
