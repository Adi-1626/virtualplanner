import { Viewer, PointPrimitiveCollection, Color, NearFarScalar, DistanceDisplayCondition } from 'cesium';
import { scenePoint } from '../../terrain/groundHeight';
import type { TrafficEdge, TrafficNetwork, TrafficNode } from '../../objects/trafficTypes';

/** Node classes shown by the "Junction points" layer (docs/urbanos/DESIGN_WORKSPACE.md, Points layer). */
export type JunctionPointKind = 'dead_end' | 't_junction' | 'x_junction' | 'complex' | 'roundabout';

/** The junction point kinds in words, for the map key and Design's toggle. */
import { mapLegend, LEGEND_ORDER } from '../mapLegend';

export const JUNCTION_POINT_LEGEND: { kind: JunctionPointKind; label: string; detail: string }[] = [
  { kind: 't_junction', label: 'T junction', detail: 'three roads meet' },
  { kind: 'x_junction', label: 'Crossroads', detail: 'four roads meet' },
  { kind: 'complex', label: '5 or more roads', detail: 'a complex junction' },
  { kind: 'roundabout', label: 'Roundabout', detail: 'a node on a roundabout ring' },
  { kind: 'dead_end', label: 'Dead end', detail: 'a road that ends without joining another' },
];

export const JUNCTION_POINT_COLORS: Record<JunctionPointKind, string> = {
  dead_end: '#facc15',
  t_junction: '#fb923c',
  x_junction: '#ef4444',
  complex: '#a855f7',
  roundabout: '#22d3ee',
};

/**
 * A node's class from its arms (distinct neighbouring nodes reached by a road
 * segment in or out), or null for a plain link node: two road pieces joined
 * end to end or a shape vertex, which is not a junction and was most of the
 * dots of the old "Show Traffic Network" layer. Arms, not road ids, are
 * counted so a side road joining the middle of another road is a T (the old
 * layer counted it as a link because only two road ids meet there).
 */
export function junctionPointKind(node: Pick<TrafficNode, 'id' | 'incomingSegments' | 'outgoingSegments'>, edges: ReadonlyMap<string, Pick<TrafficEdge, 'fromNodeId' | 'toNodeId' | 'roadId'>>, isRoundaboutRoad: (roadId: string) => boolean = () => false): JunctionPointKind | null {
  const arms = new Set<string>();
  let roundabout = false;
  for (const id of [...node.incomingSegments, ...node.outgoingSegments]) {
    const e = edges.get(id);
    if (!e) continue;
    if (isRoundaboutRoad(e.roadId)) roundabout = true;
    const other = e.fromNodeId === node.id ? e.toNodeId : e.fromNodeId;
    if (other !== node.id) arms.add(other);
  }
  const degree = arms.size;
  // An entry or exit of a roundabout (its plain ring vertices have two arms and are skipped)
  if (roundabout && degree >= 3) return 'roundabout';
  if (degree === 1) return 'dead_end';
  if (degree === 3) return 't_junction';
  if (degree === 4) return 'x_junction';
  if (degree > 4) return 'complex';
  return null;
}

/** Points shrink with distance and are not drawn from higher than this (they hid the roads from far away). */
const VISIBLE = new DistanceDisplayCondition(0, 9000);
const SCALE = new NearFarScalar(300, 1.0, 6000, 0.45);

/**
 * "Junction points" layer: one point per junction / dead end / roundabout of
 * the traffic network, coloured by how many roads meet there. Off by default.
 *
 * Drawn as ONE PointPrimitiveCollection (a single draw call) instead of one
 * Cesium Entity per node plus an arrow polyline per edge: the entity version
 * made ~29k entities for the full Pune network. When the layer is off the
 * collection is destroyed, so nothing is created or drawn.
 */
export class TrafficNetworkVisualizer {
  private viewer: Viewer | null = null;
  private points: PointPrimitiveCollection | null = null;
  /** How many points the last render drew (0 when the layer is off). */
  public pointCount = 0;

  public setViewer(viewer: Viewer) {
    this.viewer = viewer;
  }

  public clear() {
    if (this.points && this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.scene.primitives.remove(this.points); // remove() destroys it
    }
    this.points = null;
    this.pointCount = 0;
    mapLegend.set('junction-points', null);
    this.viewer?.scene.requestRender();
  }

  public render(network: TrafficNetwork, isRoundaboutRoad?: (roadId: string) => boolean) {
    this.clear();
    if (!this.viewer || !network) return;
    const colors = Object.fromEntries(Object.entries(JUNCTION_POINT_COLORS).map(([k, css]) => [k, Color.fromCssColorString(css)])) as Record<JunctionPointKind, Color>;
    const outline = Color.fromCssColorString('#0f172a');
    const points = new PointPrimitiveCollection();
    let count = 0;
    network.nodes.forEach(node => {
      const kind = junctionPointKind(node, network.edges, isRoundaboutRoad);
      if (!kind) return;
      count++;
      points.add({
        id: `debug_node_${node.id}`,
        position: scenePoint(node.coordinates[0], node.coordinates[1], (node.coordinates[2] || 0) + 1.0),
        pixelSize: kind === 'dead_end' ? 6 : 9,
        color: colors[kind],
        outlineColor: outline,
        outlineWidth: 1.5,
        scaleByDistance: SCALE,
        distanceDisplayCondition: VISIBLE,
      });
    });
    this.pointCount = count;
    this.points = this.viewer.scene.primitives.add(points);
    mapLegend.set('junction-points', { title: 'Junction points (traffic network)', order: LEGEND_ORDER.junctions, items: JUNCTION_POINT_LEGEND.map(l => ({ id: l.kind, label: l.label, detail: l.detail, swatch: { kind: 'dot', color: JUNCTION_POINT_COLORS[l.kind], color2: '#0f172a' } })),
      note: 'Where the traffic model joins roads, from the drawn and imported roads. Shown when zoomed in.' });
    this.viewer.scene.requestRender();
  }
}
