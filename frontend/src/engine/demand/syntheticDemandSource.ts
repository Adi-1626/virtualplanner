/**
 * Where the app gets the SYNTHETIC demand (p14, docs/urbanos/DEMAND_P14.md): the city model from
 * /api/synthetic-demand/{id} (about 1 MB, loaded only when the synthetic demand is switched on) and each study area's
 * building trip ends from /api/synthetic-demand/{id}/trip-ends?bbox. Label `synthetic` throughout.
 */
import { apiGet } from '../../lib/api';
import type { StudyArea, DrivableObject } from '../simulation/StudyAreaExplorer';
import type { DemandPlan } from '../simulation/StudyDemand';
import { DEFAULT_SYNTHETIC_DEMAND, decodeSyntheticDemand, rebalance, syntheticAreaPlan, tripEndsFromRows, type AreaPaths, type SyntheticCity, type SyntheticDemandDoc, type SyntheticTripEnd } from './syntheticDemand';

export type SyntheticStatus = 'off' | 'loading' | 'ready' | 'none';
interface Box { minLng: number; minLat: number; maxLng: number; maxLat: number }
const PAD_DEG = 0.01;
const covers = (a: Box, b: Box) => a.minLng <= b.minLng && a.minLat <= b.minLat && a.maxLng >= b.maxLng && a.maxLat >= b.maxLat;

export class SyntheticDemandSource {
  status: SyntheticStatus = 'off';
  error: string | null = null;
  city: SyntheticCity | null = null;
  private loading: Promise<void> | null = null;
  private ends: { box: Box; ends: SyntheticTripEnd[] } | null = null;
  private endsLoading: { box: Box; p: Promise<void> } | null = null;
  private paths = new Map<string, { paths?: AreaPaths }>();

  private readonly id: string;
  private readonly fetchDoc: (id: string) => Promise<SyntheticDemandDoc>;
  private readonly fetchEnds: (id: string, b: Box) => Promise<SyntheticTripEnd[]>;

  constructor(id = DEFAULT_SYNTHETIC_DEMAND, fetchDoc?: (id: string) => Promise<SyntheticDemandDoc>, fetchEnds?: (id: string, b: Box) => Promise<SyntheticTripEnd[]>) {
    this.id = id;
    this.fetchDoc = fetchDoc ?? (async id => {
      const installed = await apiGet<{ files: string[] }>('/api/synthetic-demand');
      if (!installed.files.includes(id)) throw new Error(`synthetic demand ${id} is not installed`);
      return apiGet<SyntheticDemandDoc>(`/api/synthetic-demand/${encodeURIComponent(id)}`);
    });
    this.fetchEnds = fetchEnds ?? (async (id, b) => {
      const r = await apiGet<{ label: string; rows: number[][] }>(`/api/synthetic-demand/${encodeURIComponent(id)}/trip-ends?min_lng=${b.minLng}&min_lat=${b.minLat}&max_lng=${b.maxLng}&max_lat=${b.maxLat}`);
      if (r.label !== 'synthetic') throw new Error('trip ends not labelled synthetic');
      return tripEndsFromRows(r.rows);
    });
  }

  /** Loads the city model once (resolves when ready or failed; status says which); betaMult: the recorded calibration of the deterrence. */
  load(betaMult = 1): Promise<void> {
    if (this.city) return Promise.resolve();
    if (!this.loading) {
      this.status = 'loading';
      this.loading = this.fetchDoc(this.id).then(doc => { this.city = rebalance(decodeSyntheticDemand(doc), betaMult); this.status = 'ready'; })
        .catch(e => { this.status = 'none'; this.error = e instanceof Error ? e.message : String(e); this.loading = null; });
    }
    return this.loading;
  }

  /** True when the area's building trip ends are in memory. */
  hasEnds(b: Box): boolean { return !!this.ends && covers(this.ends.box, b); }

  /** Loads the building trip ends around an area (a little beyond its bounds). */
  loadEnds(b: Box): Promise<void> {
    if (this.hasEnds(b)) return Promise.resolve();
    if (this.endsLoading && covers(this.endsLoading.box, b)) return this.endsLoading.p;
    const box = { minLng: b.minLng - PAD_DEG, minLat: b.minLat - PAD_DEG, maxLng: b.maxLng + PAD_DEG, maxLat: b.maxLat + PAD_DEG };
    const p = this.fetchEnds(this.id, box).then(ends => { this.ends = { box, ends }; }).catch(e => { this.error = e instanceof Error ? e.message : String(e); })
      .finally(() => { if (this.endsLoading?.p === p) this.endsLoading = null; });
    this.endsLoading = { box, p };
    return p;
  }

  /** The area's synthetic plan at the clock hour, or null when the model or the area's trip ends are not loaded (yet). */
  plan(area: StudyArea, roads: ReadonlyMap<string, DrivableObject>, hour: number, through: boolean, areaKey: string, scale = 1): DemandPlan | null {
    if (!this.city || !this.hasEnds(area.bounds)) return null;
    const cache = this.paths.get(areaKey) ?? {};
    if (!this.paths.has(areaKey)) { if (this.paths.size > 8) this.paths.clear(); this.paths.set(areaKey, cache); }
    return syntheticAreaPlan(this.city, area, roads, this.ends!.ends, { hour, through, scale }, cache);
  }
}
