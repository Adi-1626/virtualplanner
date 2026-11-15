/**
 * One answer to "what subsurface records exist in this area?" (UNDERGROUND_AUDIT F1, research Top-12 #1).
 * Pure: groups the records returned for a bbox into layers, and lists the layers UrbanOS has no data for at all as
 * "not available" so they are never silently absent. Absence of a record is never absence of the asset.
 */
import type { SubsurfaceDataset, SubsurfaceRecord } from '../../lib/coordinationApi';

export type LayerKey = 'sewer' | 'storm_drain' | 'water' | 'power' | 'gas' | 'telecom' | 'other_utility' | 'borehole' | 'foundation';

export const LAYER_LABEL: Record<LayerKey, string> = {
  sewer: 'Sewers', storm_drain: 'Storm-water drains', water: 'Water supply', power: 'Power cables', gas: 'Gas (CGD)',
  telecom: 'Telecom / OFC', other_utility: 'Other utility records', borehole: 'Boreholes', foundation: 'Building foundations / basements',
};

/** Who would hold the missing layer (research §6) — shown as the next step, not as data. */
export const LAYER_HOLDER: Partial<Record<LayerKey, string>> = {
  water: 'PMC water supply GIS', power: 'MSEDCL / Tata Power cable records', gas: 'MNGL CGD network',
  telecom: 'operators via the Call Before u Dig (CBuD) portal', borehole: 'site investigation (AGS4 logs: Maha-Metro, PMC)',
  foundation: 'PMC building-permission (basement levels)', sewer: 'PMC drainage department', storm_drain: 'PMC storm-water department',
};

/** Layers a planner expects to see (always listed, with a count or "not available"). */
export const EXPECTED_LAYERS: LayerKey[] = ['sewer', 'storm_drain', 'water', 'power', 'gas', 'telecom', 'borehole', 'foundation'];

const TYPE_TO_LAYER: Record<string, LayerKey> = {
  sewer: 'sewer', sewage: 'sewer', storm_drain: 'storm_drain', drainage: 'storm_drain', storm: 'storm_drain',
  water: 'water', electricity: 'power', power: 'power', electrical: 'power', gas: 'gas', fiber: 'telecom', fibre: 'telecom', telecom: 'telecom',
};

export function layerOf(r: Pick<SubsurfaceRecord, 'record_type' | 'utility_type'>): LayerKey {
  if (r.record_type === 'borehole') return 'borehole';
  return TYPE_TO_LAYER[(r.utility_type ?? '').toLowerCase()] ?? 'other_utility';
}

export interface LayerSummary {
  key: LayerKey;
  label: string;
  /** Records of this layer inside the area. */
  inArea: number;
  /** Datasets of this layer that exist in UrbanOS (anywhere). */
  datasets: SubsurfaceDataset[];
  /** How many of the records in the area have a known depth. */
  withDepth: number;
  /** Quality levels present (ASCE 38). */
  qualityLevels: string[];
  /** available = some dataset of this kind exists; not_available = UrbanOS holds no dataset of this kind. */
  availability: 'available' | 'not_available';
}

/** Dataset → layer (from its records' utility type; a dataset with no records in the area falls back to its name). */
function datasetLayer(d: SubsurfaceDataset, records: readonly SubsurfaceRecord[]): LayerKey {
  if (d.record_type === 'borehole') return 'borehole';
  const r = records.find(x => x.dataset_id === d.id);
  if (r) return layerOf(r);
  const n = d.name.toLowerCase();
  if (n.includes('storm')) return 'storm_drain';
  if (n.includes('sewer')) return 'sewer';
  for (const [k, v] of Object.entries(TYPE_TO_LAYER)) if (n.includes(k)) return v;
  return 'other_utility';
}

const hasDepth = (r: SubsurfaceRecord) => {
  const v = r.record_type === 'borehole' ? r.final_depth_m : (r.depth_m ?? r.z_max_m ?? r.z_min_m);
  return typeof v === 'number' && Number.isFinite(v);
};

export function summariseRecords(records: readonly SubsurfaceRecord[], datasets: readonly SubsurfaceDataset[]): LayerSummary[] {
  const keys = new Set<LayerKey>(EXPECTED_LAYERS);
  const dsByLayer = new Map<LayerKey, SubsurfaceDataset[]>();
  for (const d of datasets) {
    const k = datasetLayer(d, records);
    keys.add(k);
    dsByLayer.set(k, [...(dsByLayer.get(k) ?? []), d]);
  }
  const recByLayer = new Map<LayerKey, SubsurfaceRecord[]>();
  for (const r of records) {
    const k = layerOf(r);
    keys.add(k);
    recByLayer.set(k, [...(recByLayer.get(k) ?? []), r]);
  }
  const order = [...EXPECTED_LAYERS, 'other_utility' as LayerKey];
  return [...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(key => {
    const rs = recByLayer.get(key) ?? [];
    const ds = dsByLayer.get(key) ?? [];
    return {
      key, label: LAYER_LABEL[key], inArea: rs.length, datasets: ds,
      withDepth: rs.filter(hasDepth).length,
      qualityLevels: [...new Set(rs.filter(r => r.record_type === 'utility').map(r => r.quality_level ?? 'UNKNOWN'))],
      availability: ds.length > 0 || rs.length > 0 ? 'available' : 'not_available',
    };
  });
}


/** Short source line for a dataset: publisher · data date (no licence text; that sits behind "details"). */
export function sourceLine(d: Pick<SubsurfaceDataset, 'publisher' | 'data_date' | 'imported_at'>): string {
  const date = d.data_date ? d.data_date.slice(0, 10) : 'date unknown';
  return `${d.publisher || 'Publisher unknown'} · data ${date}`;
}

/** Licence in one line: the part before the first ";" or ".", capped. Full text stays in the details disclosure. */
export function licenceShort(licence: string): string {
  if (!licence || licence === 'UNKNOWN') return 'licence unknown';
  if (/non-commercial/i.test(licence)) return 'non-commercial use, attribution required';
  const s = licence.split(/[;.]/)[0].trim();
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}
