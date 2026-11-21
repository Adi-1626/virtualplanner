/**
 * Cesium drawing of the shape editor's grips (AlignmentEditor.ts): square PI grips, round end grips, small midpoint
 * circles, diamond radius grips, ⚠ markers at flagged curves, and the light preview line while dragging.
 * Entity ids are the handle ids (align_<kind>_<i>), which TwinCityEngine's pick handlers pass back to the session.
 */
import { Cartesian2, Color, HorizontalOrigin, VerticalOrigin, type Entity, type Viewer } from 'cesium';
import { scenePoint } from '../terrain/groundHeight';
import type { EditorSnapshot, HandleKind } from './AlignmentEditor';

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
    for (const h of s.handles) {
      if (s.dragging && (h.kind === 'mid' || h.kind === 'warn')) continue;
      add({
        id: h.id,
        position: scenePoint(h.lon, h.lat, 1),
        billboard: {
          image: icon(h.kind), horizontalOrigin: HorizontalOrigin.CENTER, verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // The ⚠ sits just above the curve's radius grip so both stay clickable
          ...(h.kind === 'warn' ? { pixelOffset: new Cartesian2(0, -20) } : {}),
        },
        description: h.title,
      });
    }
  }

  clear() {
    if (!this.viewer.isDestroyed()) this.entities.forEach(e => this.viewer.entities.remove(e));
    this.entities = [];
  }
}
