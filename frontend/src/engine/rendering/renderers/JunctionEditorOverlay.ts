import { Cartesian2, Color, Entity, LabelStyle, PolygonHierarchy, VerticalOrigin, type Viewer } from 'cesium';
import { scenePoint } from '../../terrain/groundHeight';
import type { CityObject } from '../../objects/types';
import { junctionLayout } from '../../objects/junctionLayout';
import { GeometryContext } from '../geometry/GeometryContext';
import { mapLegend, LEGEND_ORDER, type LegendGroup, type LegendItem } from '../mapLegend';

/** Colours of the junction tool's markers (shared with the map key). */
export const JUNCTION_TOOL_COLORS = { drawn: '#22d3ee', selected: '#fbbf24', invalid: '#fb7185' } as const;

/**
 * The key's "Junctions you drew" group: only the markers on the map now (P12 browser test: it listed "Selected
 * junction" with nothing selected and the junction tool's red marker with the tool off).
 */
export function junctionToolLegend(s: { drawn: number; selected: boolean; placing: boolean }): Omit<LegendGroup, 'id'> | null {
  const items: LegendItem[] = [];
  if (s.drawn > 0) items.push({ id: 'drawn', label: 'Drawn junction', swatch: { kind: 'dot', color: JUNCTION_TOOL_COLORS.drawn, color2: '#ffffff' } });
  if (s.selected) items.push({ id: 'selected', label: 'Selected junction', detail: 'its label says signalised or give way and how many roads', swatch: { kind: 'dot', color: JUNCTION_TOOL_COLORS.selected, color2: '#ffffff' } });
  if (s.placing) items.push({ id: 'invalid', label: 'Junction tool: not on a road connection', detail: 'cyan when it can be placed', swatch: { kind: 'dot', color: JUNCTION_TOOL_COLORS.invalid, color2: '#ffffff' } });
  return items.length ? { title: 'Junctions you drew', order: LEGEND_ORDER.design, items } : null;
}

/** Editor-only affordances; the actual asphalt stays in the batched mesh renderer. */
export class JunctionEditorOverlay {
  private viewer: Viewer | null = null;
  private markers: Entity[] = [];
  private ghost: Entity | null = null;
  private approaches: Entity[] = [];
  private context = new GeometryContext(new Map());
  private scene: CityObject[] = [];
  private hoveredRoads = '';
  private shown = { drawn: 0, selected: false };
  private publishLegend() { mapLegend.set('junction-tool', junctionToolLegend({ ...this.shown, placing: !!this.ghost })); }

  setViewer(viewer: Viewer) { this.viewer = viewer; }

  sync(objects: CityObject[], editing: boolean, selectedId?: string) {
    if (!this.viewer) return;
    if (objects.length !== this.scene.length || objects.some((o, i) => o !== this.scene[i])) {
      this.scene = objects;
      this.context = new GeometryContext(new Map(objects.map(o => [o.id, o])));
    }
    this.markers.forEach(e => this.viewer!.entities.remove(e));
    this.markers = [];
    if (!editing) { this.shown = { drawn: 0, selected: false }; this.clearPreview(); mapLegend.set('junction-tool', null); return; }
    let drawn = 0, anySelected = false;
    for (const j of objects) {
      if (j.type !== 'junction') continue;
      const selected = j.id === selectedId;
      if (selected) anySelected = true; else drawn++;
      const cs = j.coordinates;
      this.markers.push(this.viewer.entities.add({
        id: `junction_edit_${j.id}`,
        position: scenePoint(cs[0], cs[1], (cs[2] || 0) + 1.5),
        point: { pixelSize: selected ? 14 : 10, color: Color.fromCssColorString(selected ? JUNCTION_TOOL_COLORS.selected : JUNCTION_TOOL_COLORS.drawn), outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Infinity },
        label: {
          text: selected ? `${j.name}\n${j.hasSignals ? 'Signalised' : 'Give way'} · ${j.connectedRoads.length} roads` : 'Junction',
          font: '12px Inter, sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -15),
          disableDepthTestDistance: Infinity,
        },
      }));
    }
    this.shown = { drawn, selected: anySelected };
    this.publishLegend();
  }

  preview(point: [number, number, number]) {
    if (!this.viewer) return;
    const [x, y] = point;
    const nearby = this.context.drivablesNear(x - 0.0003, y - 0.0003, x + 0.0003, y + 0.0003);
    const layout = junctionLayout(point, nearby);
    const color = Color.fromCssColorString(layout.valid ? JUNCTION_TOOL_COLORS.drawn : JUNCTION_TOOL_COLORS.invalid);
    const label = layout.valid ? `Place junction · ${layout.roadIds.length} road${layout.roadIds.length === 1 ? '' : 's'}\nClick to place · Esc to cancel` : 'Move onto a road connection';
    const position = scenePoint(x, y, layout.elevation + 1.5);
    const boundary = layout.boundary.map(p => scenePoint(p[0], p[1], p[2] + 0.18));
    if (!this.ghost) {
      this.ghost = this.viewer.entities.add({
        id: 'junction_placement_preview', position,
        point: { pixelSize: 17, color, outlineColor: Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Infinity },
        label: { text: label, font: '13px Inter, sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -25), disableDepthTestDistance: Infinity },
        polygon: { hierarchy: new PolygonHierarchy(boundary), perPositionHeight: true, material: color.withAlpha(0.32), show: layout.valid },
        polyline: { positions: boundary.length ? [...boundary, boundary[0]] : [], width: 3, material: color, depthFailMaterial: color, show: layout.valid },
      });
      this.publishLegend();
    } else {
      this.ghost.position = position as any;
      this.ghost.point!.color = color as any;
      this.ghost.label!.text = label as any;
      this.ghost.polygon!.hierarchy = new PolygonHierarchy(boundary) as any;
      this.ghost.polygon!.material = color.withAlpha(0.32) as any;
      this.ghost.polygon!.show = layout.valid as any;
      this.ghost.polyline!.positions = (boundary.length ? [...boundary, boundary[0]] : []) as any;
      this.ghost.polyline!.material = color as any;
      this.ghost.polyline!.show = layout.valid as any;
    }
    const key = layout.roadIds.join('|');
    if (key !== this.hoveredRoads) {
      this.approaches.forEach(e => this.viewer!.entities.remove(e));
      this.approaches = [];
      this.hoveredRoads = key;
      for (const road of nearby.filter(r => layout.roadIds.includes(r.id))) {
        this.approaches.push(this.viewer.entities.add({
          polyline: { positions: road.coordinates.map(p => scenePoint(p[0], p[1], p[2] + 0.2)), width: 4, material: Color.CYAN.withAlpha(0.65), depthFailMaterial: Color.CYAN.withAlpha(0.35) },
        }));
      }
    }
    this.viewer.scene.requestRender();
  }

  clearPreview() {
    const had = !!this.ghost;
    if (this.ghost) this.viewer?.entities.remove(this.ghost);
    this.ghost = null;
    if (had && this.viewer) this.publishLegend();
    this.approaches.forEach(e => this.viewer?.entities.remove(e));
    this.approaches = [];
    this.hoveredRoads = '';
  }

  dispose() {
    this.clearPreview();
    this.markers.forEach(e => this.viewer?.entities.remove(e));
    this.markers = [];
    this.viewer = null;
    this.scene = [];
  }
}
