import { useCallback, useEffect } from 'react';
import { Cartesian2, Math as CMath } from 'cesium';
import { coordinationApi, type SubsurfaceRecord } from '../../lib/coordinationApi';
import { engineInstance } from '../../engine/TwinCityEngine';
import { undergroundRenderer } from '../../engine/underground/UndergroundRenderer';
import { alignmentsRect, distanceToObjectsM, isWorkObject, workBoxes } from '../../engine/underground/viewRect';
import { useUndergroundStore } from './undergroundStore';

export const USER_KEY = 'td-user';
/** Largest area (degrees, ≈ 4.4 km at Pune) records are listed for: beyond it the city-wide networks are too many to draw. */
export const MAX_AREA_DEG = 0.04;
/** Most records drawn on the map at once (polylines; the list says when more exist). */
export const MAX_DRAWN = 4000;
/** Records are listed within this plan distance (m) of the drawn alignments and utilities. */
export const WORK_MARGIN_M = 250;

type Box = [number, number, number, number];

/** The work area: around the drawn alignments and utilities when there are any, else the map view (null when zoomed out too far). */
export function workArea(): { box: Box | null; boxes?: Box[]; source: 'alignments' | 'view' | null; note: string | null } {
  const al = engineInstance.objects.getAll().filter(isWorkObject);
  const r = alignmentsRect(al, WORK_MARGIN_M);
  if (r) return { box: r, boxes: workBoxes(al, WORK_MARGIN_M), source: 'alignments', note: null };
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

/**
 * Records for the work area. Around drawn objects: one request per separate group of objects (workBoxes), then only the
 * records whose plan distance to a drawn alignment or utility is at most WORK_MARGIN_M, so "within 250 m of what you
 * drew" is literally true (it used to be the box around everything plus 250 m). Records without geometry are kept.
 */
export async function loadWorkAreaRecords(area: ReturnType<typeof workArea>): Promise<SubsurfaceRecord[]> {
  if (!area.box) return [];
  if (area.source !== 'alignments' || !area.boxes) return (await coordinationApi.listRecords({ bbox: area.box })).records;
  const objs = engineInstance.objects.getAll().filter(isWorkObject);
  const lists = await Promise.all(area.boxes.map(b => coordinationApi.listRecords({ bbox: b })));
  const byId = new Map<string, SubsurfaceRecord>();
  for (const l of lists) for (const r of l.records) byId.set(r.id, r);
  return [...byId.values()].filter(r => { const d = distanceToObjectsM(r.geometry, objs); return d === null || d <= WORK_MARGIN_M; });
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
        loadWorkAreaRecords(area),
      ]);
      st.setRecords({ datasets, records: recs, recordsState: 'loaded' });
      undergroundRenderer.attach(engineInstance.getViewer());
      undergroundRenderer.renderRecords(recs.slice(0, MAX_DRAWN), datasets);
    } catch (e) {
      st.setRecords({ recordsState: 'error', recordsError: (e as Error).message });
    }
  }, []);
  useEffect(() => { if (useUndergroundStore.getState().recordsState === 'idle') void reload(); }, [reload]);
  return { ...s, reload };
}
