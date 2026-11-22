/**
 * Cesium drawing of the shape editor's grips (AlignmentEditor.ts): square PI grips, round end grips, small midpoint
 * circles, diamond radius grips, ⚠ markers at flagged curves, and the light preview line while dragging. A radius grip
 * that would sit on its PI grip on screen (small radii, zoomed out) is drawn pushed clear of it, so both stay clickable.
 * Entity ids are the handle ids (align_<kind>_<i>), which TwinCityEngine's pick handlers pass back to the session.
 */
import { CallbackProperty, Cartesian2, Color, HorizontalOrigin, SceneTransforms, VerticalOrigin, type Cartesian3, type Entity, type Viewer } from 'cesium';
import { scenePoint } from '../terrain/groundHeight';
import { gripSeparationPx, type EditorSnapshot, type Handle, type HandleKind } from './AlignmentEditor';

const icons = new Map<string, HTMLCanvasElement>();
function icon(kind: HandleKind): HTMLCanvasElement | string {
  if (typeof document === 'undefined') return '';
  const cached = icons.get(kind);
  if (cached) return cached;
  const size = kind === 'mid' ? 12 : kind === 'warn' ? 20 : 16;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.lineWidth = 2;
  g.strokeStyle = '#000';
  const m = size / 2;
  if (kind === 'pi') { g.fillStyle = '#FFD84D'; g.fillRect(2, 2, size - 4, size - 4); g.strokeRect(2, 2, size - 4, size - 4); }
  else if (kind === 'end') { g.fillStyle = '#4DE3FF'; g.beginPath(); g.arc(m, m, m - 2, 0, Math.PI * 2); g.fill(); g.stroke(); }
  else if (kind === 'mid') { g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(m, m, m - 2, 0, Math.PI * 2); g.fill(); g.stroke(); }
  else if (kind === 'radius') {
    g.fillStyle = '#FF9F43'; g.beginPath(); g.moveTo(m, 1); g.lineTo(size - 1, m); g.lineTo(m, size - 1); g.lineTo(1, m); g.closePath(); g.fill(); g.stroke();
  } else {
    g.fillStyle = '#FFB020'; g.beginPath(); g.moveTo(m, 1); g.lineTo(size - 1, size - 2); g.lineTo(1, size - 2); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#000'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillText('!', m, size - 5);
  }
  icons.set(kind, c);
  return c;
}

export class AlignmentEditorView {
  private entities: Entity[] = [];

  private viewer: Viewer;
  constructor(viewer: Viewer) { this.viewer = viewer; }

  render(s: EditorSnapshot) {
    this.clear();
    if (!s.objectId || !s.state || this.viewer.isDestroyed()) return;
    const add = (e: Entity.ConstructorOptions) => this.entities.push(this.viewer.entities.add(e));
    if (s.preview && s.preview.length >= 2) {
      add({ polyline: { positions: s.preview.map(c => scenePoint(c[0], c[1], 0.6)), width: 4, material: Color.YELLOW.withAlpha(0.85), clampToGround: true } });
    }
    // Tangent lines (dashed look via low alpha) between PIs so the PI grips read as control points
    const pis = s.state.alignment.pis;
    if (pis.length > 2) add({ polyline: { positions: pis.map(p => scenePoint(p.lon, p.lat, 0.6)), width: 1, material: Color.WHITE.withAlpha(0.45), clampToGround: true } });
    const radiusGrip = new Map<number, Handle>();
    for (const h of s.handles) if (h.kind === 'radius') radiusGrip.set(h.index, h);
    for (const h of s.handles) {
      if (s.dragging && (h.kind === 'mid' || h.kind === 'warn')) continue;
      const position = scenePoint(h.lon, h.lat, 1);
      // A radius grip (and the ⚠ above it) is pushed off its PI grip on screen when they would overlap (small radii,
      // zoomed out), re-evaluated every frame as the camera moves; the drag is relative to where it is grabbed
      const rg = h.kind === 'radius' ? h : h.kind === 'warn' ? radiusGrip.get(h.index) : undefined;
      const lift = h.kind === 'warn' ? -20 : 0;
      const pixelOffset = rg
        ? new CallbackProperty((_t, result?: Cartesian2) => {
          const o = this.separation(pis, rg, rg === h ? position : scenePoint(rg.lon, rg.lat, 1));
          return Cartesian2.fromElements(o[0], o[1] + lift, result);
        }, false)
        : undefined;
      add({
        id: h.id,
        position,
        billboard: {
          image: icon(h.kind), horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // The ⚠ sits just above the curve's radius grip so both stay clickable
          ...(pixelOffset ? { pixelOffset } : h.kind === 'warn' ? { pixelOffset: new Cartesian2(0, -20) } : {}),
        },
        description: h.title,
      });
    }
  }

  /** Screen offset keeping radius grip `g` clear of its PI grip (see gripSeparationPx). */
  private separation(pis: readonly { lon: number; lat: number }[], g: Handle, gripPos: Cartesian3): [number, number] {
    const scene = this.viewer.scene;
    const P = pis[g.index];
    if (!P) return [0, 0];
    const win = (lon: number, lat: number) => SceneTransforms.worldToWindowCoordinates(scene, scenePoint(lon, lat, 1));
    const pi = win(P.lon, P.lat);
    const grip = SceneTransforms.worldToWindowCoordinates(scene, gripPos);
    if (!pi || !grip) return [0, 0];
    // Fallback direction when the two coincide on screen: the PI's bisector, towards the curve
    const A = pis[g.index - 1], B = pis[g.index + 1];
    const a = A && win(A.lon, A.lat), b = B && win(B.lon, B.lat);
    let dir: { x: number; y: number } | null = null;
    if (a && b) {
      const la = Math.hypot(a.x - pi.x, a.y - pi.y), lb = Math.hypot(b.x - pi.x, b.y - pi.y);
      if (la > 0 && lb > 0) dir = { x: (a.x - pi.x) / la + (b.x - pi.x) / lb, y: (a.y - pi.y) / la + (b.y - pi.y) / lb };
    }
    return gripSeparationPx(pi, grip, undefined, dir);
  }

  clear() {
    if (!this.viewer.isDestroyed()) this.entities.forEach(e => this.viewer.entities.remove(e));
    this.entities = [];
  }
}
