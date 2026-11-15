import React, { useMemo, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { coordinationApi, type SubsurfaceDataset, type SubsurfaceRecord } from '../../lib/coordinationApi';
import { engineInstance } from '../../engine/TwinCityEngine';
import { Disclosure } from '../ui/Disclosure';
import { LAYER_HOLDER, licenceShort, sourceLine, summariseRecords, type LayerSummary } from '../../engine/underground/recordsSummary';
import { CertaintyBadge } from '../ui/badges/CertaintyBadge';
import { field, fmtM, input, inputStyle, lbl, labelStyle, note } from './common';
import { MAX_DRAWN, USER_KEY, useSubsurfaceRecords } from './useSubsurfaceRecords';

const QL_NOTE: Record<string, string> = {
  'QL-A': 'ASCE 38 QL-A: exposed / potholed (horizontal and vertical measured)',
  'QL-B': 'ASCE 38 QL-B: surface geophysics (horizontal position)',
  'QL-C': 'ASCE 38 QL-C: surveyed surface features correlated with records',
  'QL-D': 'ASCE 38 QL-D: records or recollection',
};

const RecordRow: React.FC<{ r: SubsurfaceRecord; datasetName: string }> = ({ r, datasetName }) => {
  const ql = r.record_type === 'utility' ? (r.quality_level ?? 'UNKNOWN') : null;
  const fly = () => {
    const g = r.geometry;
    const v = engineInstance.getViewer();
    if (!g || !v) return;
    const pts = g.type === 'Point' ? [g.coordinates] : g.type === 'LineString' ? g.coordinates : g.coordinates[0];
    const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length, lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    import('cesium').then(({ Cartesian3 }) => v.camera.flyTo({ destination: Cartesian3.fromDegrees(lon, lat - 0.004, 450), orientation: { heading: 0, pitch: -0.6, roll: 0 } }));
  };
  return (
    <li>
      <button type="button" className="uos-row w-full text-left" onClick={fly} disabled={!r.geometry} title={r.geometry ? 'Fly to record' : r.location_note || 'Location UNKNOWN'}>
        <span className="min-w-0 flex-1">
          <span className="block text-body text-text-1 truncate">{r.record_type === 'borehole' ? 'Borehole' : (r.utility_type ?? 'Utility')} {r.external_id}</span>
          <span className="block text-meta text-text-2">
            {r.record_type === 'borehole'
              ? <>final depth {fmtM(r.final_depth_m)} · {r.strata.length} strata</>
              : <>depth {fmtM(r.depth_m)} · Ø {fmtM(r.diameter_m, 2)} · owner {r.owner || 'Unknown'}</>}
            {!r.geometry && ' · location UNKNOWN'}
          </span>
          <span className="block text-meta text-text-3 truncate">from {datasetName}</span>
        </span>
        <span className="flex flex-col items-end gap-1 shrink-0">
          {ql && <span className="text-meta font-semibold rounded px-1.5" style={{ border: '1px solid var(--border-strong)' }} title={QL_NOTE[ql] ?? 'Quality level not recorded: UNKNOWN'} data-testid="ug-record-ql">{ql === 'UNKNOWN' ? 'QL ?' : ql}</span>}
          <CertaintyBadge certainty={r.z_certainty} compact note="Depth certainty (from QL: only QL-A is measured)" />
        </span>
      </button>
    </li>
  );
};

/** Full provenance of one dataset, behind a one-line source + "details" disclosure (no licence wall inline). */
const DatasetSource: React.FC<{ d: SubsurfaceDataset }> = ({ d }) => (
  <details className="text-meta text-text-3" data-testid="ug-dataset-source">
    <summary className="cursor-pointer">
      <span className="text-text-2">{sourceLine(d)}</span> · {licenceShort(d.licence)} · <span className="uos-link">details</span>
    </summary>
    <div className="pl-3 flex flex-col gap-0.5 mt-1">
      <div className="text-text-2">{d.name} · {d.format.toUpperCase()} · {d.record_count.toLocaleString('en-IN')} records in the dataset</div>
      <div>Licence: {d.licence || 'UNKNOWN'}</div>
      <div>Coverage: {d.coverage_label}</div>
      <div className="truncate" title={d.file_sha256 ?? ''}>Imported by {d.imported_by} · sha256 {d.file_sha256 ? d.file_sha256.replace(/^sha256:/, '').slice(0, 12) + '…' : 'n/a'}</div>
      {d.warnings.map((w, i) => <div key={i} className="text-warn">{w}</div>)}
    </div>
  </details>
);

const qlText = (qls: string[]) => (qls.length === 0 ? null : qls.map(q => (q === 'UNKNOWN' ? 'QL ?' : q)).join(', '));

/** One row per layer: how many records are in the work area, or "Not available" when UrbanOS holds no such data. */
const LayerRow: React.FC<{ l: LayerSummary }> = ({ l }) => (
  <li className="py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }} data-testid={`ug-layer-${l.key}`} data-availability={l.availability}>
    <div className="flex items-baseline gap-2">
      <span className="text-body text-text-1 flex-1">{l.label}</span>
      {l.availability === 'available'
        ? <span className="text-label tabular-nums text-text-1" data-testid={`ug-layer-${l.key}-count`}>{l.inArea.toLocaleString('en-IN')} here</span>
        : <span className="text-label text-unknown">Not available</span>}
    </div>
    {l.availability === 'available' ? (
      <>
        {l.inArea > 0 && (
          <div className="text-meta text-text-2">
            {qlText(l.qualityLevels) && <span title="ASCE 38 quality level: QL-D = from records only, position and depth not verified">{qlText(l.qualityLevels)} · </span>}
            {l.key === 'sewer'
              ? <>levels published (no datum) for {l.withDepth.toLocaleString('en-IN')} of {l.inArea.toLocaleString('en-IN')}: design depths below manhole top, vertical datum not stated, not verified</>
              : <>depth recorded for {l.withDepth.toLocaleString('en-IN')} of {l.inArea.toLocaleString('en-IN')}</>}
          </div>
        )}
        {l.inArea === 0 && <div className="text-meta text-text-2">None recorded in this area — coverage of the dataset is not stated, so this is UNKNOWN, not "none".</div>}
        {l.datasets.map(d => <DatasetSource key={d.id} d={d} />)}
      </>
    ) : (
      <div className="text-meta text-text-3">No dataset in UrbanOS — UNKNOWN here.{LAYER_HOLDER[l.key] ? ` Ask: ${LAYER_HOLDER[l.key]}.` : ''}</div>
    )}
  </li>
);

/**
 * "What records exist here": one answer per layer for the work area (UNDERGROUND_AUDIT F1/F2). The bulk PMC networks
 * are only listed for an area (backend), so the area is always sent; layers without any data are listed as not available.
 */
export const SubsurfaceRecords: React.FC = () => {
  const { datasets, records, recordsState, recordsError, recordsArea, recordsAreaSource, recordsAreaNote, reload } = useSubsurfaceRecords();
  const [importing, setImporting] = useState(false);
  const dsName = (id: string) => datasets.find(d => d.id === id)?.name ?? id;
  const layers = useMemo(() => summariseRecords(records, datasets), [records, datasets]);
  const shownOnMap = Math.min(records.length, MAX_DRAWN);
  return (
    <div className="flex flex-col gap-2" data-testid="ug-records">
      <div className="flex items-center gap-2 text-meta text-text-2" data-testid="ug-records-area">
        <span className="flex-1">
          {recordsArea
            ? <>Within {recordsAreaSource === 'alignments' ? '250 m of your alignments' : 'the map view'}{recordsState === 'loaded' && records.length > 0 ? ` · ${shownOnMap.toLocaleString('en-IN')} drawn on the map${shownOnMap < records.length ? ` (first ${MAX_DRAWN})` : ''}` : ''}</>
            : recordsAreaNote ?? 'No area yet'}
        </span>
        <button type="button" className="uos-btn uos-btn-sm" onClick={() => void reload()} data-testid="ug-records-refresh" title="List the records for the area now on the map">
          <RefreshCw size={12} aria-hidden /> Look here
        </button>
      </div>
      {recordsState === 'loading' && <p className="text-label text-text-2" data-testid="ug-records-loading">Loading records for this area…</p>}
      {recordsState === 'error' && <p className="text-label text-fail" role="alert">Could not load records: {recordsError}. Existing utilities here are UNKNOWN until this loads. <button type="button" className="uos-link" onClick={() => void reload()}>Retry</button></p>}
      {recordsState === 'loaded' && (
        <ul data-testid="ug-layer-summary">
          {layers.map(l => <LayerRow key={l.key} l={l} />)}
        </ul>
      )}
      {recordsState === 'loaded' && <p className="text-meta text-text-3">Records show where a utility was recorded, not that nothing else is there. Before construction: owner as-builts, GPR survey, trial pits.</p>}
      {records.length > 0 && (
        <Disclosure summary={`List the ${records.length.toLocaleString('en-IN')} records here`} data-testid="ug-record-disclosure">
          <ul className="space-y-1 max-h-64 overflow-auto" data-testid="ug-record-list">
            {records.slice(0, 200).map(r => <RecordRow key={r.id} r={r} datasetName={dsName(r.dataset_id)} />)}
          </ul>
          {records.length > 200 && <p className="text-meta text-text-3">First 200 of {records.length.toLocaleString('en-IN')}; all are drawn on the map (up to {MAX_DRAWN}).</p>}
        </Disclosure>
      )}
      {importing ? <ImportForm onDone={() => { setImporting(false); void reload(); }} onCancel={() => setImporting(false)} />
        : <button type="button" className="uos-btn uos-btn-sm self-start" onClick={() => setImporting(true)} data-testid="ug-import-open"><Upload size={14} aria-hidden /> Import records (AGS4 / CSV / JSON)</button>}
    </div>
  );
};

const formatFor = (name: string): 'ags4' | 'csv' | 'json' => (/\.ags4?$/i.test(name) ? 'ags4' : /\.json$/i.test(name) ? 'json' : 'csv');

const ImportForm: React.FC<{ onDone: () => void; onCancel: () => void }> = ({ onDone, onCancel }) => {
  const [recordType, setRecordType] = useState<'borehole' | 'utility'>('borehole');
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [publisher, setPublisher] = useState('');
  const [licence, setLicence] = useState('');
  const [dataDate, setDataDate] = useState('');
  const [bbox, setBbox] = useState('');
  const [user, setUser] = useState(() => localStorage.getItem(USER_KEY) ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const bboxNums = bbox.trim() === '' ? null : bbox.split(',').map(s => Number(s.trim()));
  const bboxOk = bboxNums === null || (bboxNums.length === 4 && bboxNums.every(Number.isFinite));
  const submit = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      localStorage.setItem(USER_KEY, user.trim());
      const content = await file.text();
      const fmt = formatFor(file.name);
      const res = await coordinationApi.importSubsurface({
        record_type: recordType, format: fmt, content, name: name.trim() || file.name, file_name: file.name,
        ...(publisher.trim() ? { publisher: publisher.trim() } : {}), ...(licence.trim() ? { licence: licence.trim() } : {}),
        ...(dataDate ? { data_date: dataDate } : {}), ...(bboxNums ? { coverage_bbox: bboxNums as [number, number, number, number] } : {}),
        imported_by: user.trim(),
      });
      setWarn(res.warnings);
      (window as any).showToast?.(`Imported ${res.record_count} ${recordType} record(s) from ${file.name}${res.warnings.length ? ` with ${res.warnings.length} warning(s)` : ''}.`, 'success');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <form className="uos-card flex flex-col gap-2" data-testid="ug-import-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <div className="grid grid-cols-2 gap-2">
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="ug-imp-type">Records</label>
          <select id="ug-imp-type" className={input} style={inputStyle} value={recordType} onChange={e => setRecordType(e.target.value as 'borehole' | 'utility')}>
            <option value="borehole">Boreholes</option><option value="utility">Utilities</option>
          </select>
        </div>
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="ug-imp-user">Your name</label>
          <input id="ug-imp-user" required className={input} style={inputStyle} value={user} onChange={e => setUser(e.target.value)} />
        </div>
      </div>
      <div className={field}>
        <label className={lbl} style={labelStyle} htmlFor="ug-imp-file">File (.ags AGS4 subset · .csv template · .json)</label>
        <input id="ug-imp-file" data-testid="ug-import-file" type="file" accept=".ags,.ags4,.csv,.json,text/csv,application/json" required className="text-label text-text-2" onChange={e => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={field}><label className={lbl} style={labelStyle} htmlFor="ug-imp-name">Dataset name</label><input id="ug-imp-name" className={input} style={inputStyle} value={name} placeholder={file?.name ?? ''} onChange={e => setName(e.target.value)} /></div>
        <div className={field}><label className={lbl} style={labelStyle} htmlFor="ug-imp-pub">Publisher</label><input id="ug-imp-pub" className={input} style={inputStyle} value={publisher} placeholder="Unknown" onChange={e => setPublisher(e.target.value)} /></div>
        <div className={field}><label className={lbl} style={labelStyle} htmlFor="ug-imp-lic">Licence</label><input id="ug-imp-lic" className={input} style={inputStyle} value={licence} placeholder="UNKNOWN" onChange={e => setLicence(e.target.value)} /></div>
        <div className={field}><label className={lbl} style={labelStyle} htmlFor="ug-imp-date">Data date</label><input id="ug-imp-date" type="date" className={input} style={inputStyle} value={dataDate} onChange={e => setDataDate(e.target.value)} /></div>
      </div>
      <div className={field}>
        <label className={lbl} style={labelStyle} htmlFor="ug-imp-bbox">Stated coverage (W,S,E,N degrees)</label>
        <input id="ug-imp-bbox" className={input} style={inputStyle} value={bbox} placeholder="blank = coverage UNKNOWN" onChange={e => setBbox(e.target.value)} aria-invalid={!bboxOk} />
        <p className="text-[11px]" style={note}>Only a stated coverage lets a conflict check say "no record within available data"; without it utilities stay UNKNOWN.</p>
      </div>
      {err && <p className="text-label text-fail" role="alert">{err}</p>}
      {warn.length > 0 && <p className="text-label text-warn">{warn.join('; ')}</p>}
      <div className="flex gap-2">
        <button type="submit" className="uos-btn" disabled={busy || !file || !user.trim() || !bboxOk} data-testid="ug-import-submit">{busy ? 'Importing…' : 'Import'}</button>
        <button type="button" className="uos-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};
