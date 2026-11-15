import { useCallback, useEffect } from 'react';
import { Cartesian2, Math as CMath } from 'cesium';
import { coordinationApi } from '../../lib/coordinationApi';
import { engineInstance } from '../../engine/TwinCityEngine';
import { undergroundRenderer } from '../../engine/underground/UndergroundRenderer';
import { isAlignment } from '../../engine/underground/alignmentFactory';
import { alignmentsRect } from '../../engine/underground/viewRect';
import { useUndergroundStore } from './undergroundStore';

export const USER_KEY = 'td-user';
/** Largest area (degrees, ≈ 4.4 km at Pune) records are listed for: beyond it the city-wide networks are too many to draw. */
export const MAX_AREA_DEG = 0.04;
/** Most records drawn on the map at once (polylines; the list says when more exist). */
export const MAX_DRAWN = 4000;

type Box = [number, number, number, number];

/** The work area: around the alignments when there are any, else the map view (null when zoomed out too far). */
export function workArea(): { box: Box | null; source: 'alignments' | 'view' | null; note: string | null } {
  const al = engineInstance.objects.getAll().filter(isAlignment);
  const r = alignmentsRect(al, 250);
  if (r) return { box: r, source: 'alignments', note: null };
  const v = engineInstance.getViewer?.();
  const rect = v?.camera.computeViewRectangle(v.scene.globe.ellipsoid);
  if (!rect) return { box: null, source: null, note: 'Map not ready' };
  const box: Box = [CMath.toDegrees(rect.west), CMath.toDegrees(rect.south), CMath.toDegrees(rect.east), CMath.toDegrees(rect.north)];
  if (box[2] - box[0] > MAX_AREA_DEG || box[3] - box[1] > MAX_AREA_DEG) {
    // Oblique views see to the horizon: fall back to a box around the point the camera looks at
    const centre = centreOfView();
    if (centre) {
      const h = MAX_AREA_DEG / 4;
      return { box: [centre[0] - h, centre[1] - h, centre[0] + h, centre[1] + h], source: 'view', note: null };
    }
    return { box: null, source: null, note: 'Zoom in (to a few km) to list the records here' };
  }
  return { box, source: 'view', note: null };
}

function centreOfView(): [number, number] | null {
  const v = engineInstance.getViewer?.();
  if (!v) return null;
  const c = v.canvas;
  const p = v.camera.pickEllipsoid(new Cartesian2(c.clientWidth / 2, c.clientHeight / 2), v.scene.globe.ellipsoid);
  if (!p) return null;
  const g = v.scene.globe.ellipsoid.cartesianToCartographic(p);
  if (v.camera.positionCartographic.height > 8000) return null;
  return [CMath.toDegrees(g.longitude), CMath.toDegrees(g.latitude)];
}

/** Loads the datasets and the records in the work area (bbox: includes the PMC reference networks) and draws them. */
export function useSubsurfaceRecords() {
  const s = useUndergroundStore();
  const reload = useCallback(async () => {
    const st = useUndergroundStore.getState();
    const area = workArea();
    st.setRecords({ recordsState: 'loading', recordsError: null, recordsArea: area.box, recordsAreaSource: area.source, recordsAreaNote: area.note });
    try {
      const [datasets, recs] = await Promise.all([
        coordinationApi.listDatasets(),
        area.box ? coordinationApi.listRecords({ bbox: area.box }) : Promise.resolve({ records: [], note: '' }),
      ]);
      st.setRecords({ datasets, records: recs.records, recordsState: 'loaded' });
      undergroundRenderer.attach(engineInstance.getViewer());
      undergroundRenderer.renderRecords(recs.records.slice(0, MAX_DRAWN));
    } catch (e) {
      st.setRecords({ recordsState: 'error', recordsError: (e as Error).message });
    }
  }, []);
  useEffect(() => { if (useUndergroundStore.getState().recordsState === 'idle') void reload(); }, [reload]);
  return { ...s, reload };
}
