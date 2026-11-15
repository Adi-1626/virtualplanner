import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Database, Loader2, Pencil, RefreshCw, Square, Pentagon, Trash2, Undo2, X, Crosshair } from 'lucide-react';
import { engineInstance } from '../../engine/TwinCityEngine';
import { INFRASTRUCTURE_CATEGORIES, type InfrastructureCategory, type StudyAreaImportProgress, type StudyAreaImportReport } from '../../engine/editing/studyAreaImport';
import type { StudyAreaSummary } from '../../engine/editing/studyAreaSummary';
import type { LocalOsmStatus } from '../../engine/editing/LocalOsmIndex';
import type { Area } from '../../engine/objects/types';
import { STUDY_AREA_ROADS_PREFIX } from '../../engine/simulation/osmCoverage';
import { API_BASE } from '../../lib/api';
import { CertaintyBadge } from '../ui/badges/CertaintyBadge';

const CATEGORY_LABEL: Record<InfrastructureCategory, string> = {
  roads: 'Roads (junctions derive from them)',
  buildings: 'Buildings',
  metro: 'Metro lines and stations',
  signals: 'Traffic signals',
};
const toast = (msg: string, kind: 'success' | 'error' | 'info') => (window as any).showToast?.(msg, kind);

type OsmStatus = LocalOsmStatus & { source?: string; buildCommand?: string; reason?: string; overpass?: { cache?: { entries: number } } };

/** Where the data will come from, in one line (with the build command when there is no local index). */
const SourceLine: React.FC<{ status: OsmStatus | null | 'offline' }> = ({ status }) => {
  if (status === null) return <p className="text-meta text-text-3" data-testid="study-source">Checking data source…</p>;
  if (status === 'offline') return <p className="text-meta text-warn" data-testid="study-source" role="status">Backend offline: data comes straight from public OpenStreetMap servers (not cached) and areas cannot be saved.</p>;
  if (status.available) {
    return (
      <p className="text-meta text-text-3 flex items-center gap-1" data-testid="study-source" title={`Local index built from ${status.source ?? 'an OSM extract'}; OpenStreetMap © contributors, ODbL. Outside its region (${status.bbox?.join(', ')}) the live Overpass API is used.`}>
        <Database size={12} aria-hidden className="text-measured" /> OpenStreetMap, local index{status.dataTimestamp ? ` · data ${String(status.dataTimestamp).slice(0, 16)}` : ''}
      </p>
    );
  }
  return (
    <p className="text-meta text-text-3" data-testid="study-source" title={`${status.reason ?? 'No local OpenStreetMap index.'} For faster, offline, complete imports run: ${status.buildCommand ?? 'cd backend && python -m osm.build_index'} (downloads ~220 MB once).`}>
      <span className="text-estimated">No local index</span> · live OpenStreetMap (Overpass), cached by the backend.{' '}
      <span className="whitespace-nowrap">Faster: <code className="text-text-2">python -m osm.build_index</code></span>
    </p>
  );
};

const n = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** The summary of what a study area holds (counts from the project's objects inside the polygon). */
export const StudyAreaSummaryCard: React.FC<{ area: Area; summary: StudyAreaSummary; report: StudyAreaImportReport | null }> = ({ area, summary, report }) => {
  const sources = report ? [...new Set(report.categories.filter(c => !c.error && c.sourceDetail).map(c => c.sourceDetail!))] : [];
  const topClasses = summary.roadKmByClass.slice(0, 4);
  const rest = summary.roadKmByClass.slice(4).reduce((s, c) => s + c.km, 0);
  return (
    <div className="uos-card flex flex-col gap-2" data-testid="study-summary" aria-label={`Study area ${area.name} summary`}>
      <div className="flex items-baseline justify-between gap-2">
        <strong className="text-label text-text-1 truncate" title={area.name}>{area.name}</strong>
        <span className="text-meta text-text-3 tabular-nums whitespace-nowrap">{n(summary.areaKm2)} km²</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label tabular-nums">
        <dt className="text-text-2">Roads</dt>
        <dd className="text-text-1" data-testid="study-sum-roads">{n(summary.roadKm)} km <span className="text-text-3">· {summary.roads.toLocaleString()} pieces</span></dd>
        <dt className="text-text-2">Junctions</dt>
        <dd className="text-text-1 flex items-center gap-1.5" data-testid="study-sum-junctions">{summary.junctions.toLocaleString()}{summary.roundaboutJunctions ? <span className="text-text-3">· {summary.roundaboutJunctions} on roundabouts</span> : null}
          <CertaintyBadge certainty="estimated" compact note="Derived: road vertices where three or more road arms meet (from OSM geometry), not a surveyed junction list." /></dd>
        <dt className="text-text-2">Signals</dt>
        <dd className="text-text-1" data-testid="study-sum-signals">{summary.signals === null ? <span className="text-text-3">load data to count</span> : summary.signals.toLocaleString()}</dd>
        <dt className="text-text-2">Buildings</dt>
        <dd className="text-text-1" data-testid="study-sum-buildings">{summary.buildings.toLocaleString()}</dd>
        <dt className="text-text-2">Metro</dt>
        <dd className="text-text-1" data-testid="study-sum-metro">{summary.metroKm || summary.metroStations ? `${n(summary.metroKm)} km · ${summary.metroStations} stations` : <span className="text-text-3">none mapped</span>}</dd>
        {summary.elevatedKm > 0 && <><dt className="text-text-2">Elevated</dt><dd className="text-text-1">{n(summary.elevatedKm)} km of roads on bridges / flyovers</dd></>}
      </dl>
      {topClasses.length > 0 && (
        <details className="text-meta text-text-3">
          <summary className="cursor-pointer select-none">Road length by class</summary>
          <ul className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 tabular-nums" data-testid="study-sum-classes">
            {topClasses.map(c => <React.Fragment key={c.cls}><li>{c.cls}</li><li className="text-right">{n(c.km)} km</li></React.Fragment>)}
            {rest > 0 && <><li>other</li><li className="text-right">{n(rest)} km</li></>}
          </ul>
        </details>
      )}
      <p className="text-meta text-text-3 flex items-center gap-1 flex-wrap">
        <CertaintyBadge certainty="measured" compact note="Counted from mapped OpenStreetMap data: complete only as far as OSM is." />
        {sources.length ? sources.join(' · ') : 'OpenStreetMap'} · © OSM contributors (ODbL)
      </p>
    </div>
  );
};

/**
 * "Study area" tool (was "Import area (OSM)", originally "Create Study Area and Import Infrastructure"):
 * draw a polygon or rectangle → its OpenStreetMap roads, signals, buildings and metro load automatically
 * (cut at the boundary) → a summary. The imported objects are ordinary project objects, so Select,
 * lane / junction editing and Simulate work on them. Data source: the backend's local OSM index, else the
 * backend's cached Overpass proxy, else the public Overpass servers directly.
 */
export const ImportAreaPanel: React.FC = () => {
  const ed = engineInstance.editing;
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<StudyAreaImportProgress | null>(null);
  const [pointCount, setPointCount] = useState(0);
  const [shape, setShape] = useState(ed.getAreaShape());
  const [savedAreas, setSavedAreas] = useState<Area[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<InfrastructureCategory[]>([...INFRASTRUCTURE_CATEGORIES]);
  const [wholeFeatures, setWholeFeatures] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [report, setReport] = useState<StudyAreaImportReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [redrawingId, setRedrawingId] = useState<string | null>(null);
  const [status, setStatus] = useState<OsmStatus | null | 'offline'>(null);
  const [objectsVersion, setObjectsVersion] = useState(0);

  useEffect(() => {
    const sync = () => {
      setIsImporting(ed.getIsImporting());
      setProgress(ed.studyAreaImportProgress ? { ...ed.studyAreaImportProgress } : null);
      setPointCount(ed.getDrawingPoints().length);
      setShape(ed.getAreaShape());
      setRedrawingId(ed.getRedrawingAreaId());
      setSavedAreas(ed.getSavedAreas().filter(a => !a.id.startsWith(STUDY_AREA_ROADS_PREFIX)));
      const r = ed.studyAreaImportReport;
      setReport(r ? { ...r, categories: r.categories.map(c => ({ ...c })) } : null);
    };
    sync();
    setSelectedId(engineInstance.selection.getSelection()[0] || null);
    const unsubs = [
      ed.onChange(sync),
      engineInstance.selection.onChange(() => setSelectedId(engineInstance.selection.getSelection()[0] || null)),
      engineInstance.objects.onChange(() => setObjectsVersion(v => v + 1)),
    ];
    let alive = true;
    // Ask the backend directly (not the cached LocalOsmIndex promise) so a missing index / offline backend is reported
    fetch(`${API_BASE}/api/osm/status`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(st => { if (alive) setStatus(st); })
      .catch(() => { if (alive) setStatus('offline'); });
    return () => { alive = false; unsubs.forEach(u => u()); };
  }, [ed]);

  const nextName = useCallback(() => {
    const used = new Set(ed.getSavedAreas().map(a => a.name));
    let i = ed.getSavedAreas().filter(a => !a.id.startsWith(STUDY_AREA_ROADS_PREFIX)).length + 1;
    while (used.has(`Study area ${i}`)) i++;
    return `Study area ${i}`;
  }, [ed]);
  useEffect(() => { if (!name) setName(nextName()); }, [name, nextName, savedAreas.length]);

  const runImport = useCallback(async (area: Area, cats: InfrastructureCategory[], clip: boolean) => {
    setFailure(null);
    try {
      const outcome = await ed.importStudyArea(area, engineInstance.scenarios.getActiveScenarioId(), cats, { clipToBoundary: clip });
      if (outcome.cancelled) toast('Loading cancelled; what was loaded is kept.', 'info');
      else if (outcome.categories.every(c => c.error)) setFailure(outcome.categories[0]?.error ?? 'No data could be loaded.');
    } catch (err: any) {
      setFailure(err?.message || 'Loading failed.');
    }
  }, [ed]);

  // Save the drawn outline as a study area and load its data at once (no dialog)
  const loadDrawn = useCallback(async () => {
    if (saving || ed.getIsImporting()) return;
    if (ed.getDrawingPoints().length < 3) { toast('Place at least 3 points on the map.', 'error'); return; }
    if (!categories.length) { toast('Choose at least one kind of data under Options.', 'error'); return; }
    setSaving(true); setFailure(null);
    try {
      const redrawn = ed.getRedrawingAreaId() ? ed.getSavedAreas().find(a => a.id === ed.getRedrawingAreaId()) : undefined;
      const area = await ed.saveArea((redrawn?.name ?? name.trim()) || nextName());
      engineInstance.selection.selectSingle(area.id);
      setName('');
      await runImport(area, categories, !wholeFeatures);
    } catch (err: any) {
      setFailure(err?.message || 'Could not save the study area.');
    } finally { setSaving(false); }
  }, [saving, ed, categories, name, nextName, runImport, wholeFeatures]);

  // Double-click / rectangle's second corner finishes the outline → load
  const loadRef = useRef(loadDrawn);
  loadRef.current = loadDrawn;
  useEffect(() => ed.onAreaDrawingComplete(() => { void loadRef.current(); }), [ed]);

  const selectedArea: Area | undefined = savedAreas.find(a => a.id === selectedId)
    ?? (selectedId ? ed.studyAreaFromZone(selectedId) ?? undefined : undefined);
  // Recounted when the objects change (objectsVersion: an import, an edit)
  const summary = useMemo(() => { void objectsVersion; return selectedArea && !isImporting ? ed.studyAreaSummary(selectedArea) : null; },
    [selectedArea, isImporting, objectsVersion, ed]);
  const areaReport = report && selectedArea && report.areaId === selectedArea.id ? report : null;

  const deleteArea = async (area: Area) => {
    if (!confirm(`Delete the study area "${area.name}"? Its roads, buildings and other objects stay in the project.`)) return;
    try { await ed.deleteArea(area.id); engineInstance.selection.selectSingle(null); toast('Study area deleted; its objects are kept.', 'info'); }
    catch (err: any) { toast(err?.message || 'Could not delete the study area.', 'error'); }
  };
  const editBoundary = (area: Area) => {
    try { ed.beginRedrawArea(area.id); toast('Drag the corner points (drag a white midpoint to add one, right-click to remove), then Load data.', 'info'); }
    catch (err: any) { toast(err?.message || 'Could not edit that boundary.', 'error'); }
  };
  const flyTo = (a: Area) => engineInstance.simMode.flyToBounds({ minLng: a.minLon, minLat: a.minLat, maxLng: a.maxLon, maxLat: a.maxLat });

  const busy = isImporting || saving;
  const failedCats = areaReport?.categories.filter(c => c.error) ?? [];

  return (
    <div className="flex flex-col gap-2.5" data-testid="study-area-panel">
      <SourceLine status={status} />

      {/* Drawing */}
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Area shape">
        {(['polygon', 'rectangle'] as const).map(s => {
          const Icon = s === 'polygon' ? Pentagon : Square;
          const active = shape === s;
          return (
            <button key={s} type="button" role="radio" aria-checked={active} disabled={busy || !!redrawingId} onClick={() => ed.setAreaShape(s)}
              data-testid={`study-shape-${s}`} title={s === 'polygon' ? 'Polygon: click the corners on the map, double-click to finish' : 'Rectangle: click two opposite corners'}
              className="uos-btn uos-btn-sm flex-1 justify-center" style={active ? { borderColor: 'var(--accent)', color: 'var(--text-1)', background: 'color-mix(in srgb, var(--accent) 18%, transparent)' } : { color: 'var(--text-2)' }}>
              <Icon size={13} aria-hidden /> {s === 'polygon' ? 'Polygon' : 'Rectangle'}
            </button>
          );
        })}
      </div>

      {pointCount === 0 && !busy && (
        <p className="text-meta text-text-2" data-testid="study-hint">
          {shape === 'polygon' ? 'Click the corners of your study area on the map; double-click to finish. Its data loads automatically.' : 'Click two opposite corners on the map. Its data loads automatically.'}
        </p>
      )}

      {pointCount > 0 && !busy && (
        <div className="flex flex-col gap-1.5" data-testid="study-drawing">
          <span className="text-meta text-text-2">
            {redrawingId ? 'Editing boundary · ' : ''}{pointCount} {pointCount === 1 ? 'point' : 'points'}{pointCount < 3 ? ` · ${3 - pointCount} more needed` : ' · double-click or Load data'}
          </span>
          <div className="flex gap-1">
            <button type="button" className="uos-btn uos-btn-sm flex-1 justify-center" data-testid="study-load" disabled={pointCount < 3}
              style={pointCount >= 3 ? { background: 'var(--accent)', color: 'var(--accent-contrast)', borderColor: 'var(--accent)' } : undefined}
              onClick={() => void loadDrawn()} title="Save this outline as a study area and load its roads, junctions, signals, buildings and metro">Load data</button>
            <button type="button" className="uos-btn uos-btn-sm" onClick={() => ed.removeDrawingPoint(pointCount - 1)} title="Remove the last point" aria-label="Undo point"><Undo2 size={13} aria-hidden /></button>
            <button type="button" className="uos-btn uos-btn-sm" onClick={() => ed.clearDrawing()} title="Clear the outline" aria-label="Clear outline"><X size={13} aria-hidden /></button>
          </div>
        </div>
      )}

      {/* Options (collapsed) */}
      <div>
        <button type="button" className="flex items-center gap-1 text-meta text-text-3 cursor-pointer hover:text-text-2" aria-expanded={advanced} onClick={() => setAdvanced(a => !a)} data-testid="study-options">
          {advanced ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />} Options
        </button>
        {advanced && (
          <div className="flex flex-col gap-1.5 pt-1.5 pl-1 text-label text-text-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-meta text-text-3">Name of the next area</span>
              <input value={name} onChange={e => setName(e.target.value)} disabled={busy || !!redrawingId} data-testid="study-name"
                className="h-8 rounded-md border px-2 text-label text-text-1" style={{ background: 'var(--surface-2)', borderColor: 'var(--border-strong)' }} />
            </label>
            <fieldset className="flex flex-col gap-0.5" disabled={busy}>
              <legend className="text-meta text-text-3 mb-0.5">Data to load</legend>
              {INFRASTRUCTURE_CATEGORIES.map(c => (
                <label key={c} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={categories.includes(c)} data-testid={`study-cat-${c}`}
                    onChange={e => setCategories(cur => e.target.checked ? [...cur, c] : cur.filter(x => x !== c))} />
                  {CATEGORY_LABEL[c]}
                </label>
              ))}
            </fieldset>
            <label className="flex items-start gap-2 cursor-pointer" title="Off (default): roads and metro lines are cut at the boundary; cut ends become gateway candidates in Simulate. On: whole roads and buildings that touch the area are kept.">
              <input type="checkbox" checked={wholeFeatures} onChange={e => setWholeFeatures(e.target.checked)} disabled={busy} data-testid="study-whole" />
              <span>Keep whole roads crossing the edge</span>
            </label>
          </div>
        )}
      </div>

      {/* Loading */}
      {busy && (
        <div className="uos-card flex flex-col gap-1.5" role="status" aria-live="polite" data-testid="study-loading">
          <div className="flex items-center gap-2 text-label text-text-1">
            <Loader2 size={14} className="animate-spin text-accent" aria-hidden />
            {saving && !isImporting ? 'Saving the study area…' : progress ? `${progress.phase === 'saving' ? 'Saving' : 'Loading'} ${progress.category}… (${progress.completed + 1} of ${progress.total})` : 'Loading…'}
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }} aria-hidden>
            <div className="h-full transition-all" style={{ width: `${progress ? Math.round(((progress.completed + (progress.phase === 'saving' ? 0.7 : 0.2)) / progress.total) * 100) : 5}%`, background: 'var(--accent)' }} />
          </div>
          {isImporting && <button type="button" className="uos-btn uos-btn-sm self-start" onClick={() => ed.cancelImport()} data-testid="study-cancel">Cancel</button>}
        </div>
      )}

      {/* Error */}
      {!busy && failure && (
        <div className="uos-banner-fail flex-col" role="alert" data-testid="study-error">
          <div className="flex items-start gap-2"><AlertTriangle size={14} aria-hidden className="shrink-0 mt-0.5" /><span>Could not load data: {failure}</span></div>
          {status && status !== 'offline' && !status.available && (
            <span className="text-meta text-text-2">Overpass servers are often busy; try again in a minute. For reliable imports build the local index once: <code>{status.buildCommand ?? 'cd backend && python -m osm.build_index'}</code></span>
          )}
          {selectedArea && <button type="button" className="uos-btn uos-btn-sm self-start" onClick={() => void runImport(selectedArea, categories, !wholeFeatures)}><RefreshCw size={12} aria-hidden /> Try again</button>}
        </div>
      )}

      {/* Summary of the selected area */}
      {selectedArea && summary && !busy && (
        <>
          {areaReport && !failure && (
            <div className={`flex items-center gap-1.5 text-meta ${failedCats.length || areaReport.cancelled ? 'text-warn' : 'text-measured'}`} role="status" data-testid="study-result">
              {failedCats.length || areaReport.cancelled ? <AlertTriangle size={12} aria-hidden /> : <CheckCircle2 size={12} aria-hidden />}
              {areaReport.cancelled ? 'Cancelled: part of the data loaded' : failedCats.length ? `Loaded, except ${failedCats.map(c => c.category).join(', ')}` : `Loaded · ${areaReport.categories.filter(c => c.category !== 'signals').reduce((s, c) => s + c.added, 0).toLocaleString()} new objects`}
            </div>
          )}
          {failedCats.length > 0 && (
            <ul className="text-meta text-warn flex flex-col gap-0.5" data-testid="study-failures">
              {failedCats.map(c => <li key={c.category}>{c.category}: {c.error}</li>)}
              <li><button type="button" className="uos-link" onClick={() => void runImport(selectedArea, failedCats.map(c => c.category), !!areaReport!.clippedToBoundary)}>Retry {failedCats.length === 1 ? failedCats[0].category : 'these'}</button></li>
            </ul>
          )}
          <StudyAreaSummaryCard area={selectedArea} summary={summary} report={areaReport} />
          <div className="flex flex-wrap gap-1">
            <button type="button" className="uos-btn uos-btn-sm" onClick={() => flyTo(selectedArea)} title="Zoom the map to this area"><Crosshair size={12} aria-hidden /> Zoom to</button>
            <button type="button" className="uos-btn uos-btn-sm" onClick={() => void runImport(selectedArea, categories, !wholeFeatures)} title="Load the area's data again (new OSM features are added, your edits are kept)" data-testid="study-reload"><RefreshCw size={12} aria-hidden /> Reload</button>
            {savedAreas.some(a => a.id === selectedArea.id) && <>
              <button type="button" className="uos-btn uos-btn-sm" onClick={() => editBoundary(selectedArea)} title="Move, add or remove boundary points" aria-label="Edit boundary"><Pencil size={12} aria-hidden /></button>
              <button type="button" className="uos-btn uos-btn-sm" onClick={() => void deleteArea(selectedArea)} title="Delete this study area (its objects stay)" aria-label="Delete study area" data-testid="study-delete"><Trash2 size={12} aria-hidden /></button>
            </>}
          </div>
          <p className="text-meta text-text-3">The loaded roads are ordinary objects: pick one with Select to edit lanes or a junction, or study traffic in Simulate.</p>
        </>
      )}

      {/* Saved areas */}
      <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
        <span className="text-meta font-semibold text-text-3">Saved study areas</span>
        {savedAreas.length === 0 ? <span className="text-meta text-text-3">None yet</span> : (
          <ul className="flex flex-col gap-0.5 max-h-36 overflow-y-auto" data-testid="study-saved">
            {savedAreas.map(a => (
              <li key={a.id}>
                <button type="button" aria-pressed={selectedId === a.id} onClick={() => engineInstance.selection.selectSingle(a.id)}
                  className="w-full text-left truncate rounded px-2 py-1 text-label cursor-pointer hover:bg-white/5"
                  style={selectedId === a.id ? { color: 'var(--text-1)', background: 'color-mix(in srgb, #fbbf24 14%, transparent)' } : { color: 'var(--text-2)' }}>
                  <span className="inline-block h-2 w-2 mr-1.5 rounded-sm border border-dashed align-middle" style={{ borderColor: '#fbbf24' }} aria-hidden />{a.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/**
 * Compact, non-blocking progress pill while a study area loads (mounted by the tool palette, so it stays visible
 * when the tool's settings are closed). No full-screen backdrop or blur: the map stays visible.
 */
export const ImportProgressOverlay: React.FC = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<StudyAreaImportProgress | null>(null);
  useEffect(() => engineInstance.editing.onChange(() => {
    setIsImporting(engineInstance.editing.getIsImporting());
    setProgress(engineInstance.editing.studyAreaImportProgress ? { ...engineInstance.editing.studyAreaImportProgress } : null);
  }), []);
  if (!isImporting) return null;
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-label shadow-lg"
      style={{ background: 'var(--surface-1)', borderColor: 'var(--border-strong)', color: 'var(--text-1)' }} role="status" aria-live="polite" data-testid="study-progress-pill">
      <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} aria-hidden />
      {progress ? `Loading study area: ${progress.category} (${progress.completed + 1}/${progress.total})` : 'Loading study area…'}
      <button type="button" className="uos-link text-meta" onClick={() => engineInstance.editing.cancelImport()}>Cancel</button>
    </div>
  );
};
