import { describe, expect, it } from 'vitest';
import { summariseRecords, licenceShort, layerOf } from '../underground/recordsSummary';
import { verticalExtentOf } from '../underground/alignmentGeometry';
import type { SubsurfaceDataset, SubsurfaceRecord } from '../../lib/coordinationApi';
import type { CityObject } from '../objects/types';

const ds = (id: string, name: string, n: number): SubsurfaceDataset => ({
  id, project_id: null, record_type: 'utility', format: 'json', name, file_name: null, file_sha256: null, publisher: 'PMC', source_url: '',
  licence: "CKAN: Public Domain; OpenCity site terms 'non-commercial and / or personal use only'", data_date: '2025-11-25T15:51', coverage_bbox: null,
  coverage_label: 'UNKNOWN', provenance: '', record_count: n, warnings: [], supersedes_id: null, imported_by: 'x', imported_at: '2026-11-13',
});
const rec = (id: string, dataset_id: string, utility_type: string, depth_m: number | null): SubsurfaceRecord => ({
  id, dataset_id, record_type: 'utility', external_id: id, geometry: { type: 'LineString', coordinates: [[73.85, 18.5], [73.86, 18.5]] },
  location_note: '', ground_level_m: null, final_depth_m: null, strata: [], water_strikes: [], spt: [], utility_type, owner: 'PMC',
  depth_m, diameter_m: null, quality_level: 'QL-D', survey_method: null, z_min_m: null, z_max_m: null, z_certainty: depth_m === null ? 'unknown' : 'estimated', properties: {},
});

describe('records summary: one answer per layer (audit F1)', () => {
  const datasets = [ds('ssd_ref_storm', 'PMC storm-water drains', 9187), ds('ssd_ref_sewer', 'PMC sewer network', 44482)];
  it('counts the bbox records per layer and never says "no records" while datasets exist', () => {
    const L = summariseRecords([rec('a', 'ssd_ref_sewer', 'sewer', 2.1), rec('b', 'ssd_ref_sewer', 'sewer', null), rec('c', 'ssd_ref_storm', 'storm_drain', null)], datasets);
    const sewer = L.find(l => l.key === 'sewer')!;
    expect(sewer).toMatchObject({ inArea: 2, withDepth: 1, availability: 'available', qualityLevels: ['QL-D'] });
    expect(L.find(l => l.key === 'storm_drain')).toMatchObject({ inArea: 1, withDepth: 0, availability: 'available' });
  });
  it('lists layers with no data at all as not available', () => {
    const L = summariseRecords([], datasets);
    for (const k of ['water', 'power', 'gas', 'telecom', 'borehole', 'foundation']) expect(L.find(l => l.key === k)?.availability).toBe('not_available');
    // datasets present but nothing in the area: available, 0 here (coverage unknown)
    expect(L.find(l => l.key === 'sewer')).toMatchObject({ inArea: 0, availability: 'available' });
  });
  it('maps utility types and shortens licences', () => {
    expect(layerOf({ record_type: 'utility', utility_type: 'fiber' })).toBe('telecom');
    expect(layerOf({ record_type: 'borehole', utility_type: null })).toBe('borehole');
    expect(licenceShort(datasets[0].licence)).toBe('non-commercial use, attribution required');
    expect(licenceShort('UNKNOWN')).toBe('licence unknown');
  });
});

describe('existing metro tunnel (audit F8)', () => {
  it('an OSM tunnel metro line has UNKNOWN depth, not the −6 m placeholder', () => {
    const m = { id: 'm', type: 'metro_line', coordinates: [], elevation: -6 } as unknown as CityObject;
    const e = verticalExtentOf(m)!;
    expect(e.topDepthM).toBeNull();
    expect(e.certainty).toBe('unknown');
    expect(e.note).toMatch(/tunnel/);
  });
  it('an elevated metro keeps its deck height', () => {
    const m = { id: 'm', type: 'metro_line', coordinates: [], elevation: 12 } as unknown as CityObject;
    expect(verticalExtentOf(m)!.topDepthM).toBe(-12);
  });
});

import { buildAlignment, withGroundReference, withKind, withLifecycle, withSection, withVertexDepth } from '../underground/alignmentFactory';

describe('Z model: typed depth + elevation + datum + ground model per vertex (research §2.3)', () => {
  const a0 = buildAlignment({ id: 'abcd1234', scenarioId: 's', points: [[73.85, 18.5, 0], [73.86, 18.5, 0], [73.87, 18.5, 0]], kind: 'bored_tunnel',
    crownDepthM: 15, depthCertainty: 'hypothetical', section: { shape: 'circular', diameterM: 6 }, sectionCertainty: 'hypothetical', createdAt: 't' });
  const M = 'Copernicus GLO-30 DSM v3 (dsv_x)';
  it('new alignments are proposed', () => expect(a0.lifecycle).toBe('proposed'));
  it('stores crown elevation = ground − depth with datum, z-ref, ground and model; unknown ground stays null', () => {
    const a = withGroundReference(a0, [574.2, null, 575], M);
    expect(a.depths[0]).toMatchObject({ crownDepthM: 15, elevationM: 559.2, datum: 'EGM2008', zRef: 'crown', groundM: 574.2, groundModel: M });
    expect(a.depths[1]).toMatchObject({ crownDepthM: 15, elevationM: null, groundM: null, groundModel: null });
    expect(withGroundReference(a, [574.2, null, 575], M)).toBe(a);   // idempotent: no write when nothing changes
  });
  it('keeps Z through section / kind / status / certainty edits, and re-derives it when the depth changes', () => {
    const a = withGroundReference(a0, [574.2, 580, 575], M);
    for (const b of [withSection(a, { shape: 'circular', diameterM: 7 }), withKind(a, 'underground_metro'), withLifecycle(a, 'conceptual'), withVertexDepth(a, 1, { certainty: 'measured' })]) {
      expect(b.depths.map(d => d.elevationM)).toEqual([559.2, 565, 560]);
    }
    const c = withVertexDepth(a, 1, { crownDepthM: 20 });
    expect(c.depths[1].elevationM).toBeUndefined();                 // stale elevation dropped…
    expect(withGroundReference(c, [574.2, 580, 575], M).depths[1].elevationM).toBe(560);   // …and re-derived
    expect(c.coordinates.map(p => p[2])).toEqual([0, 0, 0]);        // plan vertices stay on the ground
  });
});
