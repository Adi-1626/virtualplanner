import { Color, ColorGeometryInstanceAttribute, GeometryInstance, PolylineColorAppearance, PolylineGeometry, Primitive } from 'cesium';
import type { Viewer } from 'cesium';
import { engineInstance } from '../../engine/TwinCityEngine';
import { scenePoint } from '../../engine/terrain/groundHeight';
import type { LonLatBounds } from './conflictClasses';

/**
 * Highlight of one screening finding: the proposed object (magenta) and the other asset (amber), drawn as lines lifted
 * above ground without a depth test so ground, buildings and the cutaway never hide them. Not pickable. Uses the
 * engine's public viewer and camera only (no change to the Underground panel or renderer).
 */
export const HIGHLIGHT_CSS = { proposed: '#e879f9', other: '#fbbf24' } as const;
const LIFT_M = 1.5;

let primitive: Primitive | null = null;
let viewerRef: Viewer | null = null;
let current: { findingId: string; proposed: number; other: number } | null = null;

export function clearConflictHighlight() {
  if (primitive && viewerRef && !viewerRef.isDestroyed()) {
    viewerRef.scene.primitives.remove(primitive);
    viewerRef.scene.requestRender();
  }
  primitive = null;
  current = null;
}

/** The highlight on show (finding id + path counts), for tests and the browser check; null when none. */
export function shownConflictHighlight() {
  return current ? { ...current } : null;
}

export function showConflictHighlight(findingId: string, proposed: [number, number][][], other: [number, number][][], bounds: LonLatBounds | null) {
  clearConflictHighlight();
  const viewer = engineInstance.getViewer() as Viewer | null;
  const lines = [
    ...proposed.filter(p => p.length >= 2).map(p => ({ p, css: HIGHLIGHT_CSS.proposed, w: 7 })),
    ...other.filter(p => p.length >= 2).map(p => ({ p, css: HIGHLIGHT_CSS.other, w: 7 })),
  ];
  current = { findingId, proposed: proposed.length, other: other.length };
  if (viewer && !viewer.isDestroyed() && lines.length) {
    viewerRef = viewer;
    primitive = viewer.scene.primitives.add(new Primitive({
      geometryInstances: lines.map((l, i) => new GeometryInstance({
        id: `conflict-highlight:${findingId}:${i}`,
        geometry: new PolylineGeometry({ positions: l.p.map(c => scenePoint(c[0], c[1], LIFT_M)), width: l.w, vertexFormat: PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(Color.fromCssColorString(l.css).withAlpha(0.95)) },
      })),
      appearance: new PolylineColorAppearance({ translucent: true, renderState: { depthTest: { enabled: false }, depthMask: false } }),
      asynchronous: false,
      allowPicking: false,
    }));
    viewer.scene.requestRender();
  }
  if (bounds) engineInstance.simMode.flyToBounds(bounds);
}
