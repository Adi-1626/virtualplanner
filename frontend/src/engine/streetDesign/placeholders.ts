/**
 * Simple placeholders for street elements and junction markings in the 3D view (Cesium entities). The realistic
 * models (poles, trees, shelters, painted markings) are the visuals work's; these only show where the data is and
 * let the user select it. Entity ids are the element ids, so a click selects the element.
 */
import { Color, Entity, type Viewer } from 'cesium';
import type { CityObject, StreetElementObject } from '../objects/types';
import { scenePoint } from '../terrain/groundHeight';
import type { MarkingItem } from './junctionTool';
import { frameAt, toLngLat } from './geom';
import { mapLegend, LEGEND_ORDER, type LegendItem } from '../rendering/mapLegend';

const STREET_LABEL: Record<StreetElementObject['kind'], { label: string; detail: string; swatch: LegendItem['swatch']['kind'] }> = {
  crossing: { label: 'Pedestrian crossing', detail: 'placeholder dot where a crossing is drawn', swatch: 'dot' },
  bus_stop: { label: 'Bus stop', detail: 'placeholder dot', swatch: 'dot' },
  streetlight: { label: 'Streetlights', detail: 'one dot per pole, at pole height', swatch: 'dot' },
  street_tree: { label: 'Street trees', detail: 'one dot per tree', swatch: 'dot' },
  roundabout: { label: 'Roundabout', detail: 'outer ring and central island', swatch: 'ring' },
  path: { label: 'Footpath, cycle track or foot overbridge', detail: 'line at its level', swatch: 'line' },
};

/** Placeholder colour by street element kind (shared with the map key). */
export const STREET_ELEMENT_COLOUR: Record<StreetElementObject['kind'], string> = {
  crossing: '#f8fafc', bus_stop: '#f59e0b', streetlight: '#fde68a', street_tree: '#22c55e', roundabout: '#38bdf8', path: '#a78bfa',
};

const ring = (c: readonly number[], r: number, n = 48) => {
  const f = frameAt(c);
  return Array.from({ length: n + 1 }, (_, i) => toLngLat(f, [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n)]));
};

export class StreetElementPlaceholders {
  private entities: Entity[] = [];
  private markingEntities: Entity[] = [];
  private readonly viewer: () => Viewer | null;
  constructor(viewer: () => Viewer | null) { this.viewer = viewer; }

  sync(objects: readonly CityObject[], visible: boolean, selectedId: string | undefined) {
    const v = this.viewer();
    if (!v) return;
    for (const e of this.entities) v.entities.remove(e);
    this.entities = [];
    if (!visible) { mapLegend.set('street-elements', null); return; }
    const kinds = new Set<StreetElementObject['kind']>();
    for (const o of objects) if (o.type === 'street_element' && o.coordinates.length) kinds.add(o.kind);
    mapLegend.set('street-elements', kinds.size ? { title: 'Street elements (placeholders)', order: LEGEND_ORDER.street,
      items: [...kinds].map(k => ({ id: k, label: STREET_LABEL[k].label, detail: STREET_LABEL[k].detail, swatch: { kind: STREET_LABEL[k].swatch, color: STREET_ELEMENT_COLOUR[k], color2: '#000000' } })),
      note: 'Simple markers where the data is; selected ones turn cyan. Hover or tap one to see what it is.' } : null);
    for (const o of objects) {
      if (o.type !== 'street_element' || !o.coordinates.length) continue;
      const sel = o.id === selectedId;
      const col = Color.fromCssColorString(sel ? '#22d3ee' : STREET_ELEMENT_COLOUR[o.kind]);
      const p = (c: readonly number[], h = 0.6) => scenePoint(c[0], c[1], (c[2] || 0) + h);
      if (o.kind === 'path') {
        this.entities.push(v.entities.add({ id: o.id, name: o.name, polyline: { positions: o.coordinates.map(c => p(c, o.path?.level === 'fob' ? (o.path.clearHeightM ?? 5.5) : 0.3)), width: sel ? 6 : 4, material: col.withAlpha(0.9) } }));
      } else if (o.kind === 'roundabout' && o.roundabout) {
        const c = o.coordinates[0], rb = o.roundabout;
        this.entities.push(v.entities.add({ id: o.id, name: o.name, polyline: { positions: ring(c, rb.icdM / 2).map(q => p(q, 0.4)), width: sel ? 4 : 2.5, material: col } }));
        this.entities.push(v.entities.add({ id: `${o.id}#island`, name: o.name, polyline: { positions: ring(c, Math.max(0.5, rb.islandM / 2)).map(q => p(q, 0.4)), width: 2, material: col.withAlpha(0.7) } }));
      } else if ((o.kind === 'streetlight' || o.kind === 'street_tree') && o.roadside) {
        const pts = o.roadside.points.length ? o.roadside.points : o.coordinates;
        pts.forEach((c, i) => this.entities.push(v.entities.add({ id: i === 0 ? o.id : `${o.id}#${i}`, name: o.name,
          position: p(c, o.kind === 'streetlight' ? (o.roadside!.poleHeightM ?? 8) : 4),
          point: { pixelSize: sel ? 10 : 7, color: col, outlineColor: Color.BLACK, outlineWidth: 1 } })));
      } else {
        this.entities.push(v.entities.add({ id: o.id, name: o.name, position: p(o.coordinates[0], 1.2),
          point: { pixelSize: sel ? 12 : 9, color: col, outlineColor: Color.BLACK, outlineWidth: 1.5 } }));
      }
    }
  }

  /** Junction markings (IRC:35) of the junctions edited in this session: thin lines where the paint goes. */
  syncMarkings(items: readonly MarkingItem[], visible: boolean) {
    const v = this.viewer();
    if (!v) return;
    for (const e of this.markingEntities) v.entities.remove(e);
    this.markingEntities = [];
    if (!visible) return;
    for (const m of items) {
      if (m.line.length < 2) continue;
      const col = m.kind === 'zebra' ? Color.WHITE.withAlpha(0.6) : m.kind === 'arrow' ? Color.WHITE.withAlpha(0.8) : m.kind === 'give_way_line' ? Color.fromCssColorString('#e2e8f0') : Color.WHITE;
      this.markingEntities.push(v.entities.add({ polyline: { positions: m.line.map(c => scenePoint(c[0], c[1], (c[2] || 0) + 0.25)), width: m.kind === 'zebra' ? 8 : m.kind === 'arrow' ? 2 : 3, material: col } }));
    }
  }
}
