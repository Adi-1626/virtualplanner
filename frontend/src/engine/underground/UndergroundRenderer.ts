/**
 * 3D display of underground alignments and imported subsurface records (docs/urbanos/UNDERGROUND_WORKSPACE.md §5.3).
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
  Cartesian2, Color, ColorMaterialProperty, CornerType, CustomDataSource, DistanceDisplayCondition, PolylineDashMaterialProperty, type Entity, type Viewer,
} from 'cesium';
import { scenePoint } from '../terrain/groundHeight';
import type { Certainty } from '../objects/certainty';
import type { MetroLineObject, MetroStationObject, UndergroundAlignmentKind, UndergroundAlignmentObject, UtilityObject, UtilityType } from '../objects/types';
import { METRO_STATION_LABEL, METRO_TUNNEL_LABEL } from './metroLevel';
import { utilityZ } from './utilityModel';
import { depthsOf, sectionHeightM, sectionWidthM } from './alignmentGeometry';
import type { SubsurfaceRecord } from '../../lib/coordinationApi';
import { layerOf } from './recordsSummary';

/** Utility colours (APWA-style convention, used informally in India too): what the asset is. */
export const RECORD_COLOR: Record<string, string> = {
  sewer: '#22c55e', storm_drain: '#14b8a6', water: '#3b82f6', power: '#ef4444', gas: '#eab308', telecom: '#f97316', other_utility: '#38bdf8',
};
/** Evidence → opacity (ASCE 38 quality level): how sure the position is, separate from status. */
/** Drawn utility type → the record colour of the same network (legend). */
export const UTILITY_COLOR: Record<UtilityType, string> = {
  water: RECORD_COLOR.water, sewage: RECORD_COLOR.sewer, electricity: RECORD_COLOR.power, gas: RECORD_COLOR.gas, fiber: RECORD_COLOR.telecom,
};
/** Minimum on-screen width (px) of a buried utility line, so a 150 mm pipe can be found from 1 km up. */
export const UTILITY_MIN_PX = 3;
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
  private utilDs: CustomDataSource | null = null;
  private metroDs: CustomDataSource | null = null;

  attach(viewer: Viewer | null) {
    if (!viewer || this.viewer === viewer) return;
    this.viewer = viewer;
    this.ds = new CustomDataSource('underground-alignments');
    this.recordsDs = new CustomDataSource('subsurface-records');
    this.utilDs = new CustomDataSource('underground-utilities');
    this.metroDs = new CustomDataSource('metro-plan-only');
    void viewer.dataSources.add(this.utilDs);
    void viewer.dataSources.add(this.metroDs);
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
      const conceptual = a.lifecycle === 'conceptual';
      const alpha = ALPHA[cert] * (conceptual ? 0.6 : 1);
      const color = base.withAlpha(selected ? Math.min(1, alpha + 0.25) : alpha);
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
    // Plan trace on the surface so the alignment can be found and clicked from above. Line style = status
    // (research §5): solid existing, dashed proposed, dotted conceptual.
    const lc = a.lifecycle ?? 'proposed';
    const traceColor = base.withAlpha(0.7);
    ents.add({
      id: nextId('plan'), name: `${a.name} (${lc})`,
      polyline: {
        positions: a.coordinates.map(c => scenePoint(c[0], c[1], 0)), width: selected ? 4 : 3, clampToGround: true,
        material: lc === 'existing' ? traceColor : new PolylineDashMaterialProperty({ color: traceColor, dashLength: lc === 'conceptual' ? 6 : 18 }),
      },
    });
  }

  /**
   * Drawn utilities, on top of their to-scale mesh (ProceduralGeometryGenerator): a buried line at the pipe's centre with a
   * minimum pixel width that also draws through the ground (depthFailMaterial) when proposed or selected, so it is never
   * hidden by opaque ground outside the see-through area; spans with an UNKNOWN depth dashed grey on the surface; and a
   * plan trace on the surface above it (dashed proposed, dotted conceptual, solid existing, long-dash abandoned), so the
   * line can be found and clicked from above. The first entity carries the object id (click = select).
   */
  renderUtilities(utils: UtilityObject[], selectedId: string | null) {
    if (!this.utilDs || !this.isAttached()) return;
    const ents = this.utilDs.entities;
    ents.suspendEvents();
    ents.removeAll();
    for (const u of utils) this.addUtility(ents, u, u.id === selectedId);
    ents.resumeEvents();
    this.viewer?.scene.requestRender();
  }

  private addUtility(ents: CustomDataSource['entities'], u: UtilityObject, selected: boolean) {
    if (u.coordinates.length < 2) return;
    const z = utilityZ(u);
    const base = Color.fromCssColorString(UTILITY_COLOR[u.utilityType] ?? '#38bdf8');
    const st = z.status;
    const prominent = selected || st === 'proposed' || st === 'conceptual';
    let first = true;
    const nextId = (suffix: string) => { if (first) { first = false; return u.id; } return `ug:${u.id}:${suffix}`; };
    // plan trace first, so the object id sits on the line seen from above
    const traceColor = (selected ? Color.WHITE : base).withAlpha(selected ? 0.95 : 0.8);
    ents.add({
      id: nextId('plan'), name: `${u.name || 'Utility'} (${st}, plan trace on the surface)`,
      polyline: {
        // 0.3 m above the scene ground at each vertex (not clamped: a ground-clamped line is rebuilt asynchronously on every
        // redraw and was often missing right after an edit); drawn through the ground so it is never hidden
        positions: u.coordinates.map(c => scenePoint(c[0], c[1], 0.3)), width: selected ? 5 : 3,
        depthFailMaterial: st === 'existing' ? traceColor : new PolylineDashMaterialProperty({ color: traceColor, dashLength: st === 'conceptual' ? 6 : st === 'abandoned' ? 30 : 16 }),
        material: st === 'existing' ? traceColor : new PolylineDashMaterialProperty({ color: traceColor, dashLength: st === 'conceptual' ? 6 : st === 'abandoned' ? 30 : 16 }),
      },
    });
    const half = (z.diameterM ?? 0) / 2;
    let run: number[] = [];
    let k = 0;
    const flush = () => {
      if (run.length >= 2) {
        const color = base.withAlpha(z.depths.some(d => d.isDefault) || st === 'conceptual' ? 0.7 : 0.95);
        ents.add({
          id: nextId(`buried${k++}`), name: `${u.name || 'Utility'} (buried, top of pipe ${run.map(i => z.depths[i].topDepthM?.toFixed(2)).join('/')} m)`,
          polyline: {
            positions: run.map(i => scenePoint(u.coordinates[i][0], u.coordinates[i][1], -((z.depths[i].topDepthM as number) + half))),
            width: selected ? UTILITY_MIN_PX + 3 : UTILITY_MIN_PX, material: color,
            ...(prominent ? { depthFailMaterial: color.withAlpha(0.6) } : {}),
          },
        } as Entity.ConstructorOptions);
      }
      run = [];
    };
    z.depths.forEach((d, i) => { if (d.topDepthM !== null && d.topDepthM !== undefined) run.push(i); else flush(); });
    flush();
    // segments with an unknown end: on the surface, never at a guessed depth
    for (let i = 1; i < z.depths.length; i++) {
      if (z.depths[i - 1].topDepthM == null || z.depths[i].topDepthM == null) {
        ents.add({
          id: nextId(`unk${i}`), name: `${u.name || 'Utility'} (depth UNKNOWN: drawn on the surface)`,
          polyline: { positions: [i - 1, i].map(j => scenePoint(u.coordinates[j][0], u.coordinates[j][1], 0)), width: 3, clampToGround: true,
            material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#94a3b8'), dashLength: 8 }) },
        });
      }
    }
  }

  /**
   * Existing OSM metro whose depth is not mapped (metroLevel.ts): a dashed purple plan line on the surface labelled
   * "Metro tunnel — depth not mapped", and a dashed station outline labelled "Underground station — depth not mapped".
   * Never placed below ground. The first entity carries the object id (click = select).
   */
  renderMetroPlanOnly(lines: MetroLineObject[], stations: { s: MetroStationObject; heading: number; inferred: boolean }[]) {
    if (!this.metroDs || !this.isAttached()) return;
    const ents = this.metroDs.entities;
    ents.suspendEvents();
    ents.removeAll();
    const purple = Color.fromCssColorString('#a855f7');
    const label = (text: string) => ({
      text, font: '12px sans-serif', fillColor: Color.WHITE, showBackground: true, backgroundColor: Color.fromCssColorString('#3b0764').withAlpha(0.8),
      // Not ground-clamped (scenePoint is already on the ground): a clamped label keeps whatever height a coarse
      // tile gave it and, without depth test, can be drawn far from its place
      pixelOffset: new Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new DistanceDisplayCondition(0, 6000),
    });
    // OSM splits one tunnel into many short ways: one label per ~400 m of tunnel (longest ways first), not one per
    // way, which stacked several identical labels on top of each other
    const kx0 = 111320 * Math.cos((18.5 * Math.PI) / 180), ky0 = 110574;
    const lenOf = (m: MetroLineObject) => m.coordinates.reduce((a, c, i) => i ? a + Math.hypot((c[0] - m.coordinates[i - 1][0]) * kx0, (c[1] - m.coordinates[i - 1][1]) * ky0) : 0, 0);
    const placed: number[][] = [];
    const stationAt = stations.map(({ s: st }) => [st.coordinates[0], st.coordinates[1]]); // stations keep their own label
    const near = (pts: number[][], p: number[], m: number) => pts.some(q => Math.hypot((q[0] - p[0]) * kx0, (q[1] - p[1]) * ky0) < m);
    for (const m of [...lines].sort((a, b) => lenOf(b) - lenOf(a))) {
      if (m.coordinates.length < 2) continue;
      ents.add({ id: m.id, name: `${m.name} — ${METRO_TUNNEL_LABEL} (plan position only, OpenStreetMap)`,
        polyline: { positions: m.coordinates.map(c => scenePoint(c[0], c[1], 0)), width: 4, clampToGround: true,
          material: new PolylineDashMaterialProperty({ color: purple.withAlpha(0.9), gapColor: Color.BLACK.withAlpha(0.25), dashLength: 20 }) } });
      const mid = m.coordinates[Math.floor(m.coordinates.length / 2)];
      if (near(placed, mid, 400) || near(stationAt, mid, 150)) continue;
      placed.push(mid);
      ents.add({ id: `ug:${m.id}:label`, name: METRO_TUNNEL_LABEL, position: scenePoint(mid[0], mid[1], 0), label: label(METRO_TUNNEL_LABEL) } as Entity.ConstructorOptions);
    }
    for (const { s: st, heading, inferred } of stations) {
      const [lon, lat] = st.coordinates;
      const L = (st.length || 140) / 2, W = (st.width || 20) / 2;
      const h = (heading * Math.PI) / 180, kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110574;
      const corner = (a: number, b: number) => { const e = a * Math.sin(h) + b * Math.cos(h), n = a * Math.cos(h) - b * Math.sin(h); return scenePoint(lon + e / kx, lat + n / ky, 0); };
      const ring = [corner(L, W), corner(L, -W), corner(-L, -W), corner(-L, W), corner(L, W)];
      const text = `${METRO_STATION_LABEL}${inferred ? ' (on a tunnel section in OSM)' : ''}`;
      ents.add({ id: st.id, name: `${st.stationName || st.name} — ${text}`,
        polyline: { positions: ring, width: 3, clampToGround: true, material: new PolylineDashMaterialProperty({ color: purple.withAlpha(0.9), dashLength: 12 }) } });
      ents.add({ id: `ug:${st.id}:label`, name: text, position: scenePoint(lon, lat, 0), label: label(`${st.stationName || st.name}: ${METRO_STATION_LABEL}`) } as Entity.ConstructorOptions);
    }
    ents.resumeEvents();
    this.viewer?.scene.requestRender();
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
            id: k === 0 ? `rec:${r.id}` : `rec:${r.id}:${k}`, name: `${r.utility_type ?? 'Utility'} record ${r.external_id}${d === null ? ' (depth UNKNOWN: drawn on the surface)' : ` · ~${Math.round(d * 10) / 10} m below ground as recorded`} · ${r.quality_level ?? 'quality UNKNOWN'}`,
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
