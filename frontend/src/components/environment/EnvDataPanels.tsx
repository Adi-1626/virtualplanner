/**
 * Environment data panels: land-cover class areas (current view / selected proposal footprint), air-quality station
 * series (parameter selector, data date, sample counts; no surface), rainfall statistics (IMD 0.25° cells, CHIRPS box
 * average, IMD district via NWDP; descriptive only — not IDF curves, not design storms).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { envDataApi, type AqSeries, type AqStation, type LandcoverAreas, type RainfallSummary } from '../../lib/envDataApi';
import { engineInstance } from '../../engine/TwinCityEngine';
import { isProposalObject } from '../../engine/feasibility/proposal';
import { useSelectedId } from '../../hooks/useAppMode';
import { istDate, lineFootprint, MONTHS, seriesPath } from './envDataModel';
import { cameraBox, loadStations } from './envDataOverlay';
import { airCsv, NAAQS_24H, rainCsv, readoutIndex } from './envPlanner';
import { downloadText } from './download';
import { useEnvFocus } from './envFocus';

const selCls = 'max-w-full min-w-0 rounded-md bg-white/[0.05] border border-white/10 px-1.5 py-0.5 text-label text-text-1 focus:outline-none focus:border-cyan-400/60';
const fmt = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });

const Err: React.FC<{ e: string | null; id: string }> = ({ e, id }) => e ? <p className="text-meta text-warn" role="status" data-testid={id}>{e}</p> : null;

// ── land cover areas ───────────────────────────────────────────────────────────
export const LandcoverAreasPanel: React.FC = () => {
  const [res, setRes] = useState<(LandcoverAreas & { label: string; scope: 'view' | 'footprint'; bbox?: number[] }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selectedId = useSelectedId();
  const sel = selectedId ? engineInstance.objects.getById(selectedId) : undefined;
  const prop = sel && isProposalObject(sel) ? sel : null;
  const reqSeq = React.useRef(0);
  const run = (p: Promise<LandcoverAreas>, label: string, scope: 'view' | 'footprint', bbox?: number[]) => {
    const my = ++reqSeq.current;
    setBusy(true); setErr(null); setRes(null);
    p.then(r => { if (my === reqSeq.current) setRes({ ...r, label, scope, bbox }); })
      .catch((e: Error) => { if (my === reqSeq.current) setErr(e.message); })
      .finally(() => { if (my === reqSeq.current) setBusy(false); });
  };
  // A result describes the area it was computed for: drop it when that area changes (no stale numbers)
  useEffect(() => {
    const v = engineInstance.getViewer() as { camera?: { moveEnd: { addEventListener: (f: () => void) => () => void } } } | null;
    const off = v?.camera?.moveEnd.addEventListener(() => setRes(r => (r && r.scope === 'view' ? null : r)));
    return () => { off?.(); };
  }, []);
  useEffect(() => { setRes(r => (r && r.scope === 'footprint' ? null : r)); }, [selectedId]);
  const view = () => {
    const b = cameraBox();
    if (!b) { setErr('Camera view could not be read.'); return; }
    run(envDataApi.landcoverAreasBbox(b), 'Current camera view', 'view', b);
  };
  const footprint = () => {
    if (!prop) return;
    const g = lineFootprint(prop.coordinates.map(c => [c[0], c[1]] as [number, number]), (prop as { width?: number }).width ?? 0);
    if (!g) { setErr('Selected object has no usable footprint (needs ≥ 2 points and a width).'); return; }
    run(envDataApi.landcoverAreasPolygon(g, 'footprint'), `Footprint of “${prop.name || prop.type}” (centreline ± width/2, approximate)`, 'footprint');
  };
  return (
    <div className="space-y-1.5 min-w-0 [overflow-wrap:anywhere]" data-testid="env-landcover-areas">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="uos-btn uos-btn-sm" data-testid="env-lc-view" onClick={view} disabled={busy}>Class areas: current view</button>
        <button type="button" className="uos-btn uos-btn-sm" data-testid="env-lc-footprint" onClick={footprint} disabled={busy || !prop}
          title={prop ? undefined : 'Select a road, flyover or double-deck proposal first'}>Selected proposal footprint</button>
        {busy && <Loader2 size={14} className="animate-spin text-text-2" aria-hidden />}
      </div>
      <Err e={err} id="env-lc-error" />
      {res && (
        <div data-testid="env-lc-result">
          <p className="text-meta text-text-2">{res.label}: {fmt(res.area_km2, 3)} km²{res.bbox ? ` (${res.bbox.map(v => v.toFixed(3)).join(', ')} °, W,S,E,N)` : ''} · ESA WorldCover 2021 · derived · screening only</p>
          <p className="text-meta text-text-3">Cleared when the {res.scope === 'view' ? 'camera moves' : 'selection changes'}.</p>
          <table className="w-full text-label tabular-nums mt-1">
            <tbody>
              {res.classes.map(c => (
                <tr key={c.value}>
                  <td className="py-0.5"><span className="inline-block h-2.5 w-2.5 rounded-sm mr-1.5 align-middle" style={{ background: c.color }} aria-hidden />{c.label}</td>
                  <td className="text-right text-text-1">{fmt(c.km2, c.km2 < 1 ? 3 : 1)} km²</td>
                  <td className="text-right text-text-2 w-14">{c.pct == null ? '—' : `${fmt(c.pct, 1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {res.classes.length === 0 && <p className="text-meta text-text-2" data-testid="env-lc-empty">No land-cover pixels in this area (outside the Pune study box) — UNKNOWN, not zero.</p>}
          {res.nodata_pixels > 0 && <p className="text-meta text-text-3">{fmt(res.nodata_pixels)} pixels ({fmt(res.nodata_pixels * 100 / 1e6, 3)} km²) outside the data, not counted in %.</p>}
          <p className="text-meta text-text-3">{res.method.replace(/\s+on\s+[\w.-]+\.tif\b[^.;]*/i, '')} (ESA WorldCover 10 m pixels). Inferred by a machine-learning classification; land cover is not land use or zoning.</p>
        </div>
      )}
    </div>
  );
};

// ── charts ─────────────────────────────────────────────────────────────────────
/** Value under the pointer for a chart (index into its series), with a readout line above the chart. */
function useReadout(n: number) {
  const [i, setI] = useState(-1);
  const onMove = (e: React.PointerEvent<Element>) => { const r = e.currentTarget.getBoundingClientRect(); setI(readoutIndex(n, (e.clientX - r.left) / (r.width || 1))); };
  return { i, onMove, onLeave: () => setI(-1) };
}

const LineChart: React.FC<{ values: number[]; times?: string[]; labels: [string, string]; unit: string; testId: string; color?: string; refLine?: { value: number; label: string } }> = ({ values, times, labels, unit, testId, color = '#ffb300', refLine }) => {
  const W = 300, H = 90, pad = 2;
  // one axis for the series and the reference line (seriesPath's own range, widened to include the line)
  const { min, max } = seriesPath(refLine ? [...values, refLine.value] : values, W, H);
  const path = seriesPathScaled(values, W, H, min, max);
  const ry = refLine ? H - pad - ((refLine.value - min) / (max - min || 1)) * (H - 2 * pad) : 0;
  const ro = useReadout(values.length);
  const x = ro.i >= 0 && values.length > 1 ? pad + ro.i * ((W - 2 * pad) / (values.length - 1)) : null;
  return (
    <figure className="space-y-0.5" data-testid={testId} data-points={values.length}>
      <div className="flex justify-between text-meta text-text-3 tabular-nums" data-testid={`${testId}-readout`}>
        {ro.i >= 0
          ? <span className="text-text-1">{times?.[ro.i] ?? `#${ro.i + 1}`}: {fmt(values[ro.i], 1)} {unit}</span>
          : <><span>top of axis {fmt(max, 1)} {unit}</span><span>bottom {fmt(min, 1)} {unit}</span></>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[90px] rounded bg-white/[0.03] border border-white/10 cursor-crosshair" role="img" aria-label={`Series ${labels[0]} to ${labels[1]}, ${values.length} values, max ${fmt(Math.max(...values), 1)} ${unit}`}
        onPointerMove={ro.onMove} onPointerLeave={ro.onLeave} data-testid={`${testId}-svg`}>
        {refLine && <line x1={0} x2={W} y1={ry} y2={ry} stroke="#E8B04A" strokeDasharray="4 3" strokeWidth={0.8} />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.2} />
        {x != null && <line x1={x} x2={x} y1={0} y2={H} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.6} />}
      </svg>
      <figcaption className="flex justify-between text-meta text-text-3"><span>{labels[0]}</span><span>{labels[1]}</span></figcaption>
      {refLine && <p className="text-meta" style={{ color: '#E8B04A' }} data-testid={`${testId}-ref`}>Dashed line: {refLine.label}</p>}
    </figure>
  );
};

/** Series path on a fixed value range (so a reference line and the series share one axis). */
function seriesPathScaled(values: number[], w: number, h: number, min: number, max: number, pad = 2): string {
  const span = max - min || 1;
  const step = values.length > 1 ? (w - 2 * pad) / (values.length - 1) : 0;
  return values.map((v, i) => `${i ? 'L' : 'M'}${(pad + i * step).toFixed(1)},${(h - pad - ((v - min) / span) * (h - 2 * pad)).toFixed(1)}`).join('');
}

const Bars: React.FC<{ items: { label: string; v: number; flag?: boolean }[]; unit: string; testId: string; color?: string }> = ({ items, unit, testId, color = '#4FA3FF' }) => {
  const max = Math.max(1, ...items.map(i => i.v));
  const ro = useReadout(items.length);
  const cur = ro.i >= 0 ? items[ro.i] : null;
  return (
    <div className="space-y-0.5">
      <p className="text-meta text-text-3 tabular-nums" data-testid={`${testId}-readout`}>
        {cur ? <span className="text-text-1">{cur.label}: {fmt(cur.v, 1)} {unit}{cur.flag ? ' · flagged suspect (value as stored)' : ''}</span> : <>top of axis {fmt(max)} {unit} · point at a bar for its value</>}
      </p>
      <div className="flex items-end gap-px h-[80px] rounded bg-white/[0.03] border border-white/10 px-1 pt-1 cursor-crosshair" data-testid={testId} role="img"
        aria-label={`Bar chart, ${items.length} bars, max ${fmt(max)} ${unit}`} onPointerMove={ro.onMove} onPointerLeave={ro.onLeave}>
        {items.map((i, k) => (
          <div key={i.label} className="flex-1 min-w-0" title={`${i.label}: ${fmt(i.v, 1)} ${unit}${i.flag ? ' — flagged suspect (as stored)' : ''}`}
            style={{ height: `${(i.v / max) * 100}%`, background: i.flag ? '#E8B04A' : color, opacity: k === ro.i ? 1 : i.flag ? 1 : 0.8, outline: k === ro.i ? '1px solid #fff' : undefined }} />
        ))}
      </div>
    </div>
  );
};

// ── air quality ────────────────────────────────────────────────────────────────
export const AirQualityPanel: React.FC = () => {
  const [stations, setStations] = useState<AqStation[] | null>(null);
  const [sid, setSid] = useState<string>('');
  const [param, setParam] = useState('pm25_ugm3');
  const [agg, setAgg] = useState<'day' | 'month'>('day');
  const [series, setSeries] = useState<AqSeries | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const focus = useEnvFocus(s => s.station);
  const focusNonce = useEnvFocus(s => s.nonce);
  useEffect(() => {
    loadStations().then(s => {
      setStations(s);
      const f = useEnvFocus.getState().station;
      const first = (f && s.find(x => x.station_id === f && x.has_series)) || s.find(x => x.has_series && x.lon != null) || s.find(x => x.has_series);
      if (first) setSid(first.station_id);
    }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { if (focus && stations?.some(x => x.station_id === focus)) setSid(focus); }, [focus, focusNonce, stations]);
  const st = stations?.find(s => s.station_id === sid);
  const params = st ? Object.entries(st.parameters) : [];
  useEffect(() => {
    setSeries(null);
    if (!st || !st.has_series) return;
    const p = st.parameters[param] ? param : Object.keys(st.parameters)[0];
    if (p !== param) { setParam(p); return; }
    let live = true;
    setBusy(true); setErr(null);
    envDataApi.airSeries(sid, p, agg).then(r => { if (live) setSeries(r); }).catch((e: Error) => { if (live) setErr(e.message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [sid, param, agg, st]);
  const partial = series ? series.points.filter(p => series.samples_per_full_bucket && p.n < series.samples_per_full_bucket).length : 0;
  return (
    <div className="space-y-1.5 min-w-0 [overflow-wrap:anywhere]" data-testid="env-air-panel">
      {!stations && !err && <p className="text-label text-text-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />Loading stations…</p>}
      <Err e={err} id="env-air-error" />
      {stations && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className={selCls} aria-label="Station" data-testid="env-air-station" value={sid} onChange={e => setSid(e.target.value)}>
              {stations.map(s => <option key={s.station_id} value={s.station_id} disabled={!s.has_series}>{s.name}{s.has_series ? '' : ' — no series downloaded'}{s.lon == null ? ' (coords UNKNOWN)' : ''}</option>)}
            </select>
            <select className={selCls} aria-label="Parameter" data-testid="env-air-param" value={param} onChange={e => setParam(e.target.value)}>
              {params.map(([k, v]) => <option key={k} value={k}>{v.label} ({v.unit})</option>)}
            </select>
            <select className={selCls} aria-label="Aggregation" data-testid="env-air-agg" value={agg} onChange={e => setAgg(e.target.value as 'day' | 'month')}>
              <option value="day">Daily mean</option><option value="month">Monthly mean</option>
            </select>
            {busy && <Loader2 size={14} className="animate-spin text-text-2" aria-hidden />}
          </div>
          {st && (
            <p className="text-meta text-text-2" data-testid="env-air-meta">
              {st.name} · {st.agency ?? 'agency UNKNOWN'} · Measured · coordinates {st.lon != null ? 'from CPCB list' : 'UNKNOWN (not drawn)'} ·
              data {istDate(st.parameters[param]?.first)} → {istDate(st.parameters[param]?.last)} · {st.parameters[param] ? `${fmt(st.parameters[param].samples ?? 0)} 15-min samples` : 'no samples for this parameter'}
            </p>
          )}
          {series && series.points.length === 0 && <p className="text-meta text-text-2" data-testid="env-air-empty">No values for this parameter at this station — UNKNOWN, not zero.</p>}
          {series && series.points.length > 0 && (
            <>
              <LineChart values={series.points.map(p => p.v)} times={series.points.map(p => `${p.t.slice(0, agg === 'month' ? 7 : 10)} IST`)} labels={[istDate(series.first), istDate(series.last)]} unit={series.unit} testId="env-air-chart"
                refLine={agg === 'day' && NAAQS_24H[param] ? { value: NAAQS_24H[param], label: `India NAAQS 24-hour limit ${NAAQS_24H[param]} ${series.unit}, for reading the chart only (a compliance check needs the full NAAQS method).` } : undefined} />
              <button type="button" className="uos-btn uos-btn-sm" data-testid="env-air-csv" onClick={() => downloadText(`air-${series.station_id}-${series.parameter}-${agg}.csv`, airCsv(series, st?.name ?? series.station_id), 'text/csv')}>
                <Download size={13} aria-hidden />Download CSV
              </button>
              <p className="text-meta text-text-3">{series.label} {agg === 'day' ? 'daily' : 'monthly'} mean of published 15-min values, {series.points.length} buckets with data
                {series.samples_per_full_bucket ? `; ${partial} days have fewer than ${series.samples_per_full_bucket} samples` : ''}. No gap filling, no interpolation, not a NAAQS compliance check.</p>
            </>
          )}
        </>
      )}
      <p className="text-meta text-text-3">Source: CPCB CCR station data via OpenCity (CPCB / MPCB / IITM). Licence as stated by OpenCity: Other (Public Domain); ODbL unless stated.</p>
    </div>
  );
};

// ── rainfall ───────────────────────────────────────────────────────────────────
export const RainfallPanel: React.FC = () => {
  const [s, setS] = useState<RainfallSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ci, setCi] = useState(0);
  useEffect(() => { envDataApi.rainfallSummary().then(setS).catch((e: Error) => setErr(e.message)); }, []);
  const cell = s?.imd_grid.cells[ci];
  const top = useMemo(() => cell ? [...cell.daily_max_by_year].sort((a, b) => b.mm - a.mm).slice(0, 5) : [], [cell]);
  const chirpsYears = s ? Object.entries(s.chirps_box.annual_total_mm).filter(([y]) => +y >= 2000) : [];
  return (
    <div className="space-y-2 min-w-0 [overflow-wrap:anywhere]" data-testid="env-rain-panel">
      <p className="text-label font-semibold" style={{ color: 'var(--warn, #E8B04A)' }} data-testid="env-rain-statement">Descriptive statistics only — not IDF curves, not design storms.</p>
      {!s && !err && <p className="text-label text-text-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />Loading rainfall…</p>}
      <Err e={err} id="env-rain-error" />
      {s && cell && (
        <>
          <label className="flex items-center gap-2 text-meta text-text-2">IMD 0.25° cell
            <select className={selCls} data-testid="env-rain-cell" value={ci} onChange={e => setCi(+e.target.value)}>
              {s.imd_grid.cells.map((c, i) => <option key={i} value={i}>{c.cell_lon.toFixed(2)}°E {c.cell_lat.toFixed(2)}°N (~27 km)</option>)}
            </select>
          </label>
          <div>
            <p className="text-meta text-text-2">Annual total, {cell.annual[0]?.year}–{cell.annual[cell.annual.length - 1]?.year} (mm; amber = flagged suspect, value as stored)</p>
            <Bars items={cell.annual.map(a => ({ label: `${a.year}`, v: a.mm, flag: !!a.qa_flag }))} unit="mm" testId="env-rain-annual" />
            <button type="button" className="uos-btn uos-btn-sm mt-1" data-testid="env-rain-csv" onClick={() => downloadText(`rainfall-imd-${cell.cell_lon.toFixed(2)}E-${cell.cell_lat.toFixed(2)}N.csv`, rainCsv(cell), 'text/csv')}>
              <Download size={13} aria-hidden />Download CSV
            </button>
            {cell.suspect_years.length > 0 && <p className="text-meta text-warn" data-testid="env-rain-flags">Suspect: {cell.suspect_years.join(', ')} — {s.imd_grid.suspect_rule}.</p>}
          </div>
          <div>
            <p className="text-meta text-text-2">Monthly mean total (mm)</p>
            <Bars items={cell.monthly_mean_mm.map(m => ({ label: MONTHS[m.month - 1], v: m.mm }))} unit="mm" testId="env-rain-monthly" />
            <div className="flex justify-between text-meta text-text-3"><span>Jan</span><span>Dec</span></div>
          </div>
          <div data-testid="env-rain-dailymax">
            <p className="text-meta text-text-2">Highest daily totals in this cell (mm/day, IMD day):</p>
            <ul className="text-label tabular-nums">{top.map(t => <li key={t.year} className="flex justify-between"><span>{t.date}</span><span className="text-text-1">{fmt(t.mm, 1)} mm{cell.suspect_years.includes(t.year) ? ' · suspect year' : ''}</span></li>)}</ul>
          </div>
          <div>
            <p className="text-meta text-text-2">CHIRPS v2 study-box average, annual total 2000–{chirpsYears[chirpsYears.length - 1]?.[0]} (mm; estimated)</p>
            <LineChart values={chirpsYears.map(([, v]) => v)} labels={[chirpsYears[0]?.[0] ?? '', chirpsYears[chirpsYears.length - 1]?.[0] ?? '']} unit="mm" testId="env-rain-chirps" color="#4FA3FF" />
          </div>
          <p className="text-meta text-text-3" data-testid="env-rain-nwdp">IMD district daily (Pune, via NWDP): {s.nwdp_district.rows.length} days published, {s.nwdp_district.first} → {s.nwdp_district.last}; licence UNKNOWN.</p>
          <p className="text-meta text-text-3">IMD gridded {s.imd_grid.period}; licence UNKNOWN (cite Pai et al. 2014). CHIRPS: public domain. {s.statement}</p>
        </>
      )}
    </div>
  );
};
