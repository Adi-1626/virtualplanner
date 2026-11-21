/**
 * Static map lines (flow paths, OSM water edges / waterways / railways) as ONE batched `Primitive` of `PolylineGeometry`
 * instances, each instance keeping its own id for hover picks.
 *
 * Not a `PolylineCollection`: a PolylineCollection rebuilds its draw commands on every rendered frame by walking every
 * polyline (material check, bucket scan, bounding-sphere union) — with ~1,000 lines that was ~76 ms of main-thread script
 * per frame at CPU ×4 in the headless audit (docs/urbanos/ENVIRONMENT_WORKSPACE.md § Performance), the cause of the
 * slower pan / zoom frames. A Primitive's geometry is built once (in web workers) and costs nothing per frame in script.
 */
import {
  ArcType, ColorGeometryInstanceAttribute, GeometryInstance, PolylineColorAppearance, PolylineGeometry, Primitive, type Cartesian3, type Color,
} from 'cesium';

export interface StaticLine { id: string; positions: Cartesian3[]; width: number }

/** A line Cesium can draw: at least two positions that are not all the same point. */
export function drawable(positions: { x: number; y: number; z: number }[]): boolean {
  if (positions.length < 2) return false;
  const a = positions[0];
  return positions.some(p => p.x !== a.x || p.y !== a.y || p.z !== a.z);
}

/** One Primitive for all lines (null when none is drawable). Lines keep their vertices (no geodesic resampling). */
export function staticLines(items: StaticLine[], color: Color): Primitive | null {
  const fill = ColorGeometryInstanceAttribute.fromColor(color);
  const instances = items.filter(l => drawable(l.positions)).map(l => new GeometryInstance({
    id: l.id,
    geometry: new PolylineGeometry({ positions: l.positions, width: l.width, vertexFormat: PolylineColorAppearance.VERTEX_FORMAT, arcType: ArcType.NONE }),
    attributes: { color: fill },
  }));
  if (!instances.length) return null;
  return new Primitive({ geometryInstances: instances, appearance: new PolylineColorAppearance({ translucent: color.alpha < 1 }) });
}
