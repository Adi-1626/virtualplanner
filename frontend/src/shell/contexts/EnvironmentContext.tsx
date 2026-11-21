import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleHelp, Eye, EyeOff, Layers, Leaf, Loader2, RefreshCw, ScanSearch, Wind } from 'lucide-react';
import { PanelSection } from '../../components/ui/Panel';
import { Disclosure } from '../../components/ui/Disclosure';
import { EmptyState } from '../../components/ui/EmptyState';
import { TrustBadge } from '../../components/ui/badges/TrustBadge';
import { FeasibilityPanel } from '../../components/FeasibilityPanel';
import { coordinationApi, type EnvironmentLayer } from '../../lib/coordinationApi';
import { MAP_TOGGLES } from '../../components/environment/envCatalogue';
import { envDataApi, type EnvDataLayer } from '../../lib/envDataApi';
import { EnvDataRow } from '../../components/environment/EnvDataRow';
import { AirQualityPanel, LandcoverAreasPanel, RainfallPanel } from '../../components/environment/EnvDataPanels';
import { OVERLAY_STYLE, setOverlayVisible, useEnvOverlayStore } from '../../components/environment/constraintOverlay';
import { setEnvDataVisible, useEnvDataOverlayStore } from '../../components/environment/envDataOverlay';
import { EnvImpact } from '../../components/environment/EnvImpact';
import { EnvHoverTooltip } from '../../components/environment/EnvHoverTooltip';
import { EvidenceChip, LayerMeta } from '../../components/environment/EnvBits';
import { useEnvFocus } from '../../components/environment/envFocus';
import {
  ESSENTIALS, evidenceOf, fmtPct, metaOfCoord, PLAIN, PLANNER_GROUPS, plainTitle, relativeEmissions, unavailableOf,
} from '../../components/environment/envPlanner';
import { loadOverlayMeta, setTerrainOverlay, useTerrainOverlayStore } from '../../components/explore/terrainOverlay';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { useSelectedId } from '../../hooks/useAppMode';
import { SelectionDetailsButton } from '../SelectionDetailsButton';
import { engineInstance } from '../../engine/TwinCityEngine';
import { isProposalObject } from '../../engine/feasibility/proposal';
import { redactPaths } from '../../lib/redactPaths';
import { useShellStore } from '../useShellStore';

/** Engine layer visibility, re-rendering on change (LayerManager registry). */
function useEngineLayerVisible(id: string): boolean {
  return useSyncExternalStore(
    cb => engineInstance.layers.onChange(() => cb()),
    () => engineInstance.layers.getAll().find(l => l.id === id)?.visible ?? false,
  );
}

const ShowBtn: React.FC<{ on: boolean; loading?: boolean; label: string; testId: string; status?: string; onClick: () => void }> = ({ on, loading, label, testId, status, onClick }) => (
  <button type="button" className="uos-btn uos-btn-sm shrink-0" aria-pressed={on} aria-label={`${on ? 'Hide' : 'Show'} ${label} on the map`}
    data-testid={testId} data-status={status} disabled={loading} onClick={onClick}>
    {loading ? <Loader2 size={13} aria-hidden className="animate-spin" /> : on ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
    {loading ? 'Loading' : on ? 'Shown' : 'Show'}
  </button>
);

const EngineLayerToggle: React.FC<{ layerId: string; label: string }> = ({ layerId, label }) => {
  const visible = useEngineLayerVisible(layerId);
  return <ShowBtn on={visible} label={label} testId={`env-toggle-${layerId}`} onClick={() => engineInstance.layers.setVisibility(layerId, !visible)} />;
};

/** OSM-derived rows of the coordination catalogue (water, heritage, railway overlays; metro engine layer). */
const CoordRow: React.FC<{ l: EnvironmentLayer }> = ({ l }) => {
  const t = MAP_TOGGLES[l.id];
  const k = t?.kind === 'overlay' ? t.key : null;
  const st = useEnvOverlayStore(s => (k ? s.overlays[k] : null));
  const on = !!st && (st.status === 'shown' || st.status === 'loading');
  return (
    <li className="rounded-md border border-border px-2 py-1.5 space-y-1 min-w-0" data-testid={`env-layer-${l.id}`} data-available="true">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-body text-text-1 leading-snug" title={l.name}>{plainTitle(l.id, l.name)}</p>
          <LayerMeta m={metaOfCoord(l)} testId={`env-meta-${l.id}`} />
        </div>
        {k && st && <ShowBtn on={on} loading={st.status === 'loading'} label={l.name} testId={`env-toggle-${k}`} status={st.status} onClick={() => void setOverlayVisible(k, !on)} />}
        {t?.kind === 'engine' && <EngineLayerToggle layerId={t.layerId} label={l.name} />}
      </div>
      {k && st?.status === 'shown' && (
        <>
          {PLAIN[l.id] && <p className="text-meta text-text-2">{PLAIN[l.id].what}</p>}
          <p className="text-meta text-text-2 flex items-center gap-1.5" data-testid={`env-overlay-info-${k}`}>
            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: OVERLAY_STYLE[k].css }} aria-hidden />
            {st.count?.toLocaleString()} features drawn for the {st.bboxFrom === 'camera view' ? 'camera view (with a margin; redrawn when you move)' : 'whole mapped area'}. Absence on the map proves nothing.
          </p>
        </>
      )}
      {k && st?.status === 'error' && <p className="text-meta text-warn" role="status" data-testid={`env-overlay-error-${k}`}>Could not draw: {redactPaths(st.error)}</p>}
      <Disclosure summary="Details, limits & licence">
        <p className="text-meta text-text-1">{l.name}</p>
        {l.limitations && <p className="text-meta text-text-2">{redactPaths(l.limitations)}</p>}
        <p className="text-meta text-text-3">Licence: {l.licence || 'UNKNOWN'} · © OpenStreetMap contributors{l.feature_count != null ? ` · ${l.feature_count.toLocaleString()} features in the local extract` : ''}</p>
      </Disclosure>
    </li>
  );
};

/** Slope classes from the DEM (shared with Explore → Terrain). */
const SlopeRow: React.FC = () => {
  const st = useTerrainOverlayStore();
  useEffect(() => { void loadOverlayMeta(); }, []);
  const s = st.shown.slope, on = s === 'shown' || s === 'loading';
  const m = st.meta;
  const legend = m && Array.isArray(m.overlays.slope.legend) ? m.overlays.slope.legend : [];
  const e = evidenceOf('slope');
  return (
    <li className="rounded-md border border-border px-2 py-1.5 space-y-1 min-w-0" data-testid="env-layer-slope" data-available={m ? 'true' : 'unknown'}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-body text-text-1 leading-snug">{PLAIN.slope.title}</p>
          <LayerMeta m={{ evidence: e.kind, evidenceLabel: e.label, why: e.why, source: 'Copernicus DEM, computed by UrbanOS', date: '2011–2015', licence: 'Copernicus DEM licence' }} testId="env-meta-slope" />
        </div>
        <ShowBtn on={on} loading={s === 'loading'} label="Slope" testId="env-toggle-slope" status={s} onClick={() => void setTerrainOverlay('slope', !on)} />
      </div>
      {s === 'shown' && (
        <>
          <p className="text-meta text-text-2">{PLAIN.slope.what}</p>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-meta text-text-2" data-testid="env-slope-legend">
            {legend.map(l => <span key={l.label} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `rgba(${l.rgba[0]},${l.rgba[1]},${l.rgba[2]},${(l.rgba[3] ?? 255) / 255})` }} aria-hidden />{l.label.replace(/deg/g, '°')}</span>)}
          </div>
          <p className="text-meta text-text-3">Unit: degrees from horizontal, 30 m grid. Screening only — not for design levels.</p>
        </>
      )}
      {(s === 'error' || st.metaError) && <p className="text-meta text-warn" role="status" data-testid="env-slope-error">Slope is not available: {redactPaths(st.error ?? st.metaError)}</p>}
    </li>
  );
};

/** Emissions as relative change from a Simulate before/after comparison only (roadmap theme 7). */
const EmissionsChange: React.FC = () => {
  const sim = useSimulationMode();
  const setWorkspace = useShellStore(s => s.setWorkspace);
  const c = sim.comparison.result;
  const rows = relativeEmissions(c?.emissions?.deltas);
  if (!c || rows.length === 0) {
    return (
      <EmptyState icon={Wind} title="No before / after comparison yet"
        action={{ label: 'Open Simulate', onClick: () => setWorkspace('simulate'), 'data-testid': 'env-open-simulate' }}>
        {sim.analysis.output?.result?.emissions
          ? 'A traffic analysis has run, but a single run has no comparison. Capture a baseline and compare the proposal in Simulate to see the relative change here.'
          : 'Compare a proposal with the existing city in Simulate; the change in traffic emissions near the studied road shows here as a percentage.'}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-1.5" data-testid="env-emissions-change">
      <div className="flex flex-wrap gap-1.5">
        <TrustBadge trust="not_validated" label="Model-based · not validated" testId="trust-env-emissions" />
        <TrustBadge trust="fails_validation" label="Traffic input fails validation (TAG M3.1)" testId="trust-env-traffic" />
      </div>
      <table className="w-full text-label tabular-nums">
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="text-text-2 py-0.5">{r.label}</td>
              <td className="text-right text-text-1 whitespace-nowrap pl-2" data-testid="env-emissions-pct">{fmtPct(r.change)}</td>
              <td className="text-right text-text-3 w-20 whitespace-nowrap">{r.agreement ? `${r.agreement.same}/${r.agreement.of} seeds` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-meta text-text-3">Proposal vs existing{sim.comparison.current ? ` at ${String(sim.comparison.current.hour).padStart(2, '0')}:00` : ''}, same demand and seeds, neighbourhood of the studied road. Read the distance driven first: a proposal that lets more traffic through burns more fuel in total. Relative change only: absolute totals from this traffic model are not reliable enough to quote. Model: {c.emissions?.model ?? 'UNKNOWN'} (European vehicle classes as stand-ins).</p>
    </div>
  );
};

const GetStarted: React.FC<{ onEssentials: () => void; busy: boolean; onRecords: () => void }> = ({ onEssentials, busy, onRecords }) => (
  <div className="uos-card flex flex-col gap-2" data-testid="env-get-started">
    <p className="text-body text-text-1">See what is on the ground here, then check what a proposal would touch.</p>
    <ol className="text-label text-text-2 list-decimal pl-4 space-y-0.5">
      <li>Move the map to your site and show the essentials (land cover, trees, flow paths, air monitors).</li>
      <li>Select a proposed road, flyover or double-deck: count the trees and green area it covers.</li>
      <li>Read the air-quality and rainfall records for context.</li>
    </ol>
    <div className="flex flex-col gap-1.5">
      <button type="button" className="uos-btn justify-start" data-testid="env-start-essentials" onClick={onEssentials} disabled={busy}>
        {busy ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <Layers size={14} aria-hidden />} Show the essentials for this view
      </button>
      <button type="button" className="uos-btn justify-start" data-testid="env-start-records" onClick={onRecords}>
        <Wind size={14} aria-hidden /> Air-quality and rainfall records
      </button>
    </div>
    <p className="text-meta text-text-3">Every layer says how it is known: <EvidenceChip kind="measured" label="Measured" /> <EvidenceChip kind="modelled" label="Modelled" /> <EvidenceChip kind="inferred" label="Inferred" />.
      This is screening from available data — not an environmental impact assessment.</p>
  </div>
);

export const EnvironmentContext: React.FC = () => {
  const [layers, setLayers] = useState<EnvironmentLayer[] | null>(null);
  const [envData, setEnvData] = useState<EnvDataLayer[] | null>(null);
  const [envDataError, setEnvDataError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [screening, setScreening] = useState<string | null>(null);
  const [essBusy, setEssBusy] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const recordsRef = useRef<HTMLDivElement>(null);
  const selectedId = useSelectedId();
  const selected = selectedId ? engineInstance.objects.getById(selectedId) : undefined;
  const screenable = selected && isProposalObject(selected) ? selected : null;
  const focusNonce = useEnvFocus(s => s.nonce);
  const shownIds = useEnvDataOverlayStore(s => Object.entries(s.overlays).filter(([, o]) => o.status === 'shown' || o.status === 'loading').map(([k]) => k).join(','));

  const load = () => {
    setLoading(true); setError(null);
    coordinationApi.environmentLayers()
      .then(j => setLayers(j.layers))
      .catch((e: Error) => setError(redactPaths(e.message) || 'backend unreachable'))
      .finally(() => setLoading(false));
    envDataApi.catalogue()
      .then(j => { setEnvData(j.layers); setEnvDataError(null); })
      .catch((e: Error) => setEnvDataError(redactPaths(e.message) || 'backend unreachable'));
  };
  useEffect(load, []);
  // a station clicked on the map opens the records with its readings
  useEffect(() => { if (focusNonce > 0) { setRecordsOpen(true); setTimeout(() => recordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); } }, [focusNonce]);

  const screenObj = screening ? engineInstance.objects.getById(screening) : undefined;
  if (screenObj && isProposalObject(screenObj)) {
    return <div className="uos-embed-panel [&>div]:!w-full [&>div]:!rounded-none [&>div]:!border-0" data-testid="env-feasibility"><FeasibilityPanel obj={screenObj} onBack={() => setScreening(null)} /></div>;
  }

  const env = envData ?? [];
  const envById = new Map(env.map(l => [l.id, l]));
  const coordById = new Map((layers ?? []).map(l => [l.id, l]));
  const hasEnv = (id: string) => envById.get(id)?.status === 'available';
  const unavailable = layers || envData ? unavailableOf(layers ?? [], env) : [];
  const essentials = async () => {
    setEssBusy(true);
    try { await Promise.all(ESSENTIALS.map(id => envById.get(id)).filter((l): l is EnvDataLayer => !!l && l.status === 'available').map(l => setEnvDataVisible(l, true))); }
    finally { setEssBusy(false); }
  };
  const openRecords = () => { setRecordsOpen(true); setTimeout(() => recordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const catalogueDown = !!(error && envDataError);

  return (
    <div className="space-y-5">
      <EnvHoverTooltip />
      {!shownIds && <GetStarted onEssentials={() => void essentials()} busy={essBusy} onRecords={openRecords} />}

      <PanelSection title="What would a proposal touch?">
        {screenable ? (
          <div className="space-y-2" data-testid="env-proposal">
            <p className="text-label text-text-1">Selected: <span className="font-semibold">{screenable.name || screenable.type}</span></p>
            <EnvImpact obj={screenable} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="uos-btn uos-btn-sm" data-testid="env-screen-proposal" onClick={() => setScreening(screenable.id)}><ScanSearch size={13} aria-hidden />Check against constraint layers</button>
              <SelectionDetailsButton />
            </div>
          </div>
        ) : (
          <p className="text-label text-text-2" data-testid="env-screen-hint">Select a proposed road, flyover or double-deck on the map (or in “Your projects”) to count the census trees and green area inside its footprint and check it against water, heritage and rail.</p>
        )}
      </PanelSection>

      <PanelSection title="Map layers"
        aside={<button type="button" onClick={load} className="uos-link inline-flex items-center gap-1" aria-label="Reload the layer list" data-testid="env-reload"><RefreshCw size={12} aria-hidden />Reload</button>}>
        {loading && !layers && !envData && <p className="text-label text-text-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />Loading the layer list…</p>}
        {catalogueDown && (
          <div className="uos-card space-y-1" role="status" data-testid="env-catalogue-down">
            <p className="text-label text-warn">The data server is not answering, so no environmental layer can be shown. Nothing here means “no constraint”: everything is UNKNOWN until it answers.</p>
            <button type="button" className="uos-btn uos-btn-sm" onClick={load} data-testid="env-retry"><RefreshCw size={13} aria-hidden />Try again</button>
          </div>
        )}
        {!catalogueDown && error && <p className="text-meta text-warn" role="status" data-testid="env-catalogue-error">OpenStreetMap layers (water, heritage, rail) are unavailable ({error}); UNKNOWN until the server answers.</p>}
        {!catalogueDown && envDataError && <p className="text-meta text-warn" role="status" data-testid="env-data-catalogue-error">Environmental datasets are unavailable ({envDataError}); UNKNOWN until the server answers.</p>}
        <div className="space-y-3" data-testid="environment-layers">
          {(layers || envData) && PLANNER_GROUPS.map(g => {
            const rows = g.ids.map(id => {
              if (id === 'slope') return <SlopeRow key={id} />;
              const e = envById.get(id);
              if (e && e.status === 'available') return <EnvDataRow key={id} l={e} />;
              const c = coordById.get(id);
              if (c && c.status === 'available' && (MAP_TOGGLES[id] || id === 'osm_trees')) return id === 'osm_trees' ? null : <CoordRow key={id} l={c} />;
              return null;
            }).filter(Boolean);
            return (
              <section key={g.id} data-testid={`env-group-${g.id}`} aria-label={g.label}>
                <h4 className="text-meta font-semibold uppercase tracking-wide text-text-3 mb-1 flex justify-between gap-2">
                  <span>{g.label}</span><span className="normal-case font-normal tracking-normal">{g.question}</span>
                </h4>
                {rows.length === 0
                  ? <p className="text-meta text-text-3 flex items-center gap-1.5"><CircleHelp size={12} aria-hidden className="text-unknown" />No layer available here · UNKNOWN</p>
                  : <ul className="space-y-1.5">{rows}</ul>}
              </section>
            );
          })}
          <section aria-label="City model" data-testid="env-group-scene">
            <div className="flex items-center gap-2 text-label text-text-1"><span className="flex-1">Buildings (city model)</span><EngineLayerToggle layerId="buildings" label="Buildings" /></div>
          </section>
        </div>
      </PanelSection>

      {(hasEnv('air_cpcb_caaqms') || hasEnv('rain_imd_025') || hasEnv('landcover_worldcover2021')) && (
        <div ref={recordsRef} data-testid="env-records">
          <PanelSection title="Records">
            {hasEnv('air_cpcb_caaqms') && <Disclosure summary="Air quality — measured at stations" open={recordsOpen || undefined} data-testid="env-air-disclosure"><AirQualityPanel /></Disclosure>}
            {hasEnv('rain_imd_025') && <Disclosure summary="Rainfall — IMD grid, CHIRPS, district" open={recordsOpen || undefined} data-testid="env-rain-disclosure"><RainfallPanel /></Disclosure>}
            {hasEnv('landcover_worldcover2021') && <Disclosure summary="Land-cover areas — this view or a proposal" data-testid="env-lc-disclosure"><LandcoverAreasPanel /></Disclosure>}
          </PanelSection>
        </div>
      )}

      <PanelSection title="Traffic emissions">
        <EmissionsChange />
      </PanelSection>

      {unavailable.length > 0 && (
        <Disclosure summary={`Not available yet (${unavailable.length})`} data-testid="env-unavailable">
          <p className="text-meta text-text-2">These are missing on purpose, not hidden: there is no usable data for them yet. Their absence never means “no issue”.</p>
          <ul className="space-y-1.5 mt-1">
            {unavailable.map(u => (
              <li key={u.id} className="text-meta" data-testid={`env-unavailable-${u.id}`}>
                <p className="text-text-1"><Leaf size={11} aria-hidden className="inline mr-1 text-unknown" />{plainTitle(u.id, u.title)} <span className="text-text-3">· {u.status}</span></p>
                {u.why && <p className="text-text-2">{u.why}</p>}
                {u.needs && <p className="text-text-3">Needs: {u.needs}</p>}
                {u.sources && u.sources.length > 0 && <p className="text-text-3">Suggested source: {u.sources.map((r, i) => <React.Fragment key={r.name}>{i ? '; ' : ''}{r.url ? <a className="uos-link" href={r.url} target="_blank" rel="noreferrer">{r.name}</a> : r.name}{r.licence ? ` (${r.licence})` : ''}</React.Fragment>)}</p>}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}

      <Disclosure summary="About this data">
        <p className="text-label text-text-2">Layers come from real files on this server (ESA, Copernicus, JRC, ISRIC, PMC, CPCB, IMD, OpenStreetMap). Rasters are drawn for the camera view;
          trees, flow paths and OpenStreetMap features are fetched for the view with a margin and redrawn when you move. Several sources (PMC, IMD, OpenCity) are for internal use: do not redistribute.
          Nothing here is engineering-grade.</p>
      </Disclosure>
    </div>
  );
};
