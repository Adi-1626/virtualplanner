import React, { useEffect, useMemo } from 'react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { BuildingObject, GatewayObject, MetroLineObject, MetroStationObject, UndergroundAlignmentObject, UtilityObject, UtilityType, ZoneObject } from '../../engine/objects/types';
import type { DemandZone } from '../../engine/objects/demandTypes';
import { findNearestTrack, resolveStationHeading, STATION_TRACK_SNAP_METERS } from '../../engine/objects/stationAlignment';
import { filterObjectsForScenario } from '../../engine/scenarios/scenarioFilter';
import { activityEndpoints } from '../../engine/simulation/StudyDemand';
import { MODE_SPLIT_KEYS, rebalanceSplit } from '../../engine/simulation/modeSplit';
import { alignmentProfile, ALIGNMENT_KIND_LABEL } from '../../engine/underground/alignmentGeometry';
import { useShellStore } from '../../shell/useShellStore';
import { useUndergroundStore } from '../underground/undergroundStore';
import { AlignmentEditor } from '../underground/AlignmentForms';
import { CertaintyBadge } from '../ui/badges/CertaintyBadge';
import { SourceBadge } from '../ui/SourceBadge';
import { sourceOf } from '../ui/dataSource';
import type { Certainty } from '../ui/badges/honesty';

/*
 * Inspector editors for the Design tools Metro line, Double-deck metro deck, Station, Utility, Tunnel (underground
 * alignment), Demand zone and Gateway (docs/urbanos/DESIGN_CONTROLS_TRANSIT_UNDERGROUND.md). Every control writes a
 * field that something reads: the 3D geometry, the trip model (StudyDemand / DemandMatrixCompiler) or the underground
 * section views. Fields nothing reads are not offered.
 */

type Update = (field: string, value: unknown) => void;

const lbl = 'text-[11px] font-semibold uppercase tracking-wide flex items-center gap-1.5';
const inputCls = 'rounded border px-1.5 py-1 text-[13px] focus:outline-none w-full';
const inputStyle: React.CSSProperties = { background: 'var(--surface-2, #1E252E)', borderColor: 'var(--border-strong, #4A5563)', color: 'var(--text-1, #E6EAF0)' };
const labelStyle: React.CSSProperties = { color: 'var(--text-2, #A9B3C1)' };
const note: React.CSSProperties = { color: 'var(--text-3, #8B95A3)' };
const card = 'rounded-lg border p-2.5 flex flex-col gap-2';
const cardStyle: React.CSSProperties = { borderColor: 'var(--border, #333C47)', background: 'var(--surface-1, #161B22)' };
const valueCls = 'text-[12px] tabular-nums';
const valueStyle: React.CSSProperties = { color: 'var(--text-1, #E6EAF0)' };

const M_PER_DEG_LAT = 110_540;
const mPerDegLon = (lat: number) => 111_320 * Math.cos(lat * Math.PI / 180);
const planLengthM = (coords: readonly (readonly number[])[]) => coords.slice(1).reduce((s, p, i) => {
  const q = coords[i];
  return s + Math.hypot((p[0] - q[0]) * mPerDegLon(q[1]), (p[1] - q[1]) * M_PER_DEG_LAT);
}, 0);
const fmtInt = (n: number) => Math.round(n).toLocaleString('en-IN');

const Slider: React.FC<{ id: string; label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; testId?: string }> = ({ id, label, unit, min, max, step, value, onChange, testId }) => (
  <div className="flex flex-col gap-0.5">
    <div className="flex justify-between items-center">
      <label className={lbl} style={labelStyle} htmlFor={id}>{label}</label>
      <span className={valueCls} style={valueStyle}>{value} {unit}</span>
    </div>
    <input id={id} data-testid={testId} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-sky-400 cursor-pointer" />
  </div>
);

const Row: React.FC<{ k: string; v: React.ReactNode; testId?: string }> = ({ k, v, testId }) => (
  <div className="flex justify-between gap-2 text-[12px]"><span style={labelStyle}>{k}</span><span className="tabular-nums text-right" style={valueStyle} data-testid={testId}>{v}</span></div>
);

/* ─── Metro line (elevated) ──────────────────────────────────────────────── */

export const MetroLineEditor: React.FC<{ m: MetroLineObject; onUpdate: Update }> = ({ m, onUpdate }) => {
  const stations = engineInstance.objects.getAll().filter(o => o.type === 'metro_station' && findNearestTrack(o.coordinates, [m])).length;
  return (
    <div className="flex flex-col gap-3" data-testid="metro-line-editor">
      <div className={card} style={cardStyle}>
        <Row k="Plan length" v={`${fmtInt(planLengthM(m.coordinates))} m`} testId="metro-length" />
        <Row k="Stations on it" v={stations} />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className={lbl} style={labelStyle} htmlFor="metro-tracks">Tracks</label>
        <select id="metro-tracks" data-testid="metro-tracks" value={m.trackCount === 1 ? 1 : 2} onChange={e => onUpdate('trackCount', Number(e.target.value))} className={inputCls} style={inputStyle}>
          <option value={1}>Single track</option>
          <option value={2}>Double track</option>
        </select>
      </div>
      <Slider id="metro-deck" testId="metro-deck" label="Deck width" unit="m" min={4} max={12} step={0.5} value={m.deckWidth || 8} onChange={v => onUpdate('deckWidth', v)} />
      <Slider id="metro-elev" testId="metro-elevation" label="Track height" unit="m" min={6} max={24} step={1} value={m.elevation} onChange={v => onUpdate('elevation', v)} />
      <Slider id="metro-piers" label="Pier spacing" unit="m" min={15} max={60} step={5} value={m.pierSpacing || 30} onChange={v => onUpdate('pierSpacing', v)} />
      <p className="text-[11px] flex items-center gap-1.5 flex-wrap" style={note}><CertaintyBadge certainty="hypothetical" /> Design values; drawn in 3D as set. Stations placed within {STATION_TRACK_SNAP_METERS} m sit on this track.</p>
    </div>
  );
};

/* ─── Metro station ──────────────────────────────────────────────────────── */

export const MetroStationEditor: React.FC<{ s: MetroStationObject; onUpdate: Update }> = ({ s, onUpdate }) => {
  const all = engineInstance.objects.getAll();
  const orientation = resolveStationHeading(s, all);
  const track = findNearestTrack(s.coordinates, all);
  const heading = Math.round(orientation.heading);
  const autoAlign = s.alignToTrack !== false;
  const onTrack = !!track && track.distanceMeters < 1;
  return (
    <div className="flex flex-col gap-3" data-testid="station-editor">
      <div className={card} style={cardStyle}>
        <Row k="Track" testId="station-track" v={track ? (onTrack ? `On ${track.trackName}` : `${track.trackName}, ${Math.round(track.distanceMeters)} m away`) : `None within ${STATION_TRACK_SNAP_METERS} m`} />
        {track && !onTrack && (
          <button type="button" className="uos-btn uos-btn-sm self-start" data-testid="station-snap" onClick={() => onUpdate('snapToTrack', true)}>Move onto the track</button>
        )}
        <Row k="Faces" v={`${heading}° from north`} />
        <label className="flex items-center justify-between gap-2 text-[12px] cursor-pointer" style={labelStyle}>
          <span>Follow the track direction</span>
          <input type="checkbox" checked={autoAlign} data-testid="station-align" onChange={e => onUpdate('alignToTrack', e.target.checked)} className="accent-sky-400 cursor-pointer" />
        </label>
        {!(autoAlign && orientation.source === 'track') && (
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => onUpdate('heading', heading - 15)} className="uos-btn uos-btn-sm" title="Rotate 15° anticlockwise (Shift+R)">⟲ 15°</button>
            <input type="range" min={0} max={359} step={1} value={heading} onChange={e => onUpdate('heading', Number(e.target.value))} aria-label="Station heading in degrees" className="flex-1 accent-sky-400 cursor-pointer" />
            <button type="button" onClick={() => onUpdate('heading', heading + 15)} className="uos-btn uos-btn-sm" title="Rotate 15° clockwise (R)">15° ⟳</button>
          </div>
        )}
      </div>
      <Slider id="st-len" testId="station-length" label="Platform length" unit="m" min={80} max={200} step={10} value={s.length} onChange={v => onUpdate('length', v)} />
      <Slider id="st-w" label="Width" unit="m" min={12} max={30} step={2} value={s.width} onChange={v => onUpdate('width', v)} />
      <Slider id="st-elev" testId="station-elevation" label="Platform height" unit="m" min={6} max={24} step={1} value={s.elevation} onChange={v => onUpdate('elevation', v)} />
      <p className="text-[11px] flex items-center gap-1.5 flex-wrap" style={note}><CertaintyBadge certainty="hypothetical" /> Design values; the station box is drawn to them.</p>
    </div>
  );
};

/* ─── Utility line ───────────────────────────────────────────────────────── */

const UTILITY_TYPES: { value: UtilityType; label: string }[] = [
  { value: 'water', label: 'Water' }, { value: 'sewage', label: 'Sewage' }, { value: 'electricity', label: 'Electrical' }, { value: 'gas', label: 'Gas' }, { value: 'fiber', label: 'Fibre / telecom' },
];
const CERTAINTY_OPTIONS: { value: Certainty; label: string }[] = [
  { value: 'hypothetical', label: 'Hypothetical (design / assumed)' }, { value: 'estimated', label: 'Estimated' }, { value: 'measured', label: 'Measured (survey / record)' }, { value: 'unknown', label: 'Unknown' },
];

export const UtilityEditor: React.FC<{ u: UtilityObject; onUpdate: Update }> = ({ u, onUpdate }) => (
  <div className="flex flex-col gap-3" data-testid="utility-editor">
    <div className={card} style={cardStyle}>
      <Row k="Plan length" v={`${fmtInt(planLengthM(u.coordinates))} m`} />
      <Row k="Top of pipe" testId="utility-top" v={`${u.depth} m below ground`} />
      {u.diameterMm ? <Row k="Bottom of pipe" v={`${(u.depth + u.diameterMm / 1000).toFixed(2)} m below ground`} /> : null}
    </div>
    <div className="flex flex-col gap-0.5">
      <label className={lbl} style={labelStyle} htmlFor="util-type">Type</label>
      <select id="util-type" data-testid="utility-type" value={u.utilityType} onChange={e => onUpdate('utilityType', e.target.value)} className={inputCls} style={inputStyle}>
        {UTILITY_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div className="flex flex-col gap-0.5">
        <label className={lbl} style={labelStyle} htmlFor="util-depth">Depth (m)</label>
        <input id="util-depth" data-testid="utility-depth" type="number" min={0.1} step={0.1} value={u.depth} onChange={e => onUpdate('depth', Number(e.target.value))} className={inputCls} style={inputStyle} />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className={lbl} style={labelStyle} htmlFor="util-dia">Diameter (mm)</label>
        <input id="util-dia" data-testid="utility-diameter" type="number" min={1} placeholder="Unknown" value={u.diameterMm ?? ''} onChange={e => onUpdate('diameterMm', e.target.value)} className={inputCls} style={inputStyle} />
      </div>
    </div>
    <div className="flex flex-col gap-0.5">
      <label className={lbl} style={labelStyle} htmlFor="util-cert">Depth is <CertaintyBadge certainty={u.depthCertainty ?? 'unknown'} note={u.depthCertainty ? undefined : 'Drawn before depth certainty was recorded.'} /></label>
      <select id="util-cert" data-testid="utility-depth-certainty" value={u.depthCertainty ?? 'unknown'} onChange={e => onUpdate('depthCertainty', e.target.value)} className={inputCls} style={inputStyle}>
        {CERTAINTY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
    <p className="text-[11px]" style={note}>Depth is to the top of the pipe. A blank diameter is unknown, not 0. Underground shows it in the long-section and conflict check.</p>
  </div>
);

/* ─── Underground alignment (Tunnel tool) ────────────────────────────────── */

/** Small to-scale cross-section at the deepest known vertex: ground line, structure, depth labels. */
const SectionSketch: React.FC<{ a: UndergroundAlignmentObject }> = ({ a }) => {
  const p = alignmentProfile(a);
  const known = p.vertices.filter(v => v.crownDepthM !== null);
  const crown = known.length ? Math.max(...known.map(v => v.crownDepthM as number)) : null;
  const sec = a.section;
  const w = sec.shape === 'circular' ? sec.diameterM : sec.widthM;
  const h = sec.shape === 'circular' ? sec.diameterM : sec.heightM;
  const W = 300, H = 130, top = 18;
  if (crown === null || !w || !h) {
    return <p className="text-[11px]" style={note} data-testid="ug-sketch-unknown">Cross-section not drawn: {crown === null ? 'no vertex depth entered' : 'section size unknown'}.</p>;
  }
  const depthSpan = crown + h + 2;
  const s = Math.min((H - top - 8) / depthSpan, (W - 40) / Math.max(w + 6, 12));
  const cx = W / 2, cy = top + (crown + h / 2) * s;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Cross-section: ${ALIGNMENT_KIND_LABEL[a.alignmentKind]}, crown ${crown} m deep`} data-testid="ug-sketch">
      <line x1={8} x2={W - 8} y1={top} y2={top} stroke="var(--text-2, #A9B3C1)" strokeDasharray="6 4" strokeWidth={1.2} />
      <text x={10} y={top - 5} fontSize={10} fill="var(--text-3, #8B95A3)">ground</text>
      {sec.shape === 'circular'
        ? <circle cx={cx} cy={cy} r={(w * s) / 2} fill="#f59e0b" fillOpacity={0.3} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray={a.sectionCertainty === 'measured' ? undefined : '4 3'} />
        : <rect x={cx - (w * s) / 2} y={top + crown * s} width={w * s} height={h * s} fill="#f59e0b" fillOpacity={0.3} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray={a.sectionCertainty === 'measured' ? undefined : '4 3'} />}
      <line x1={cx + (w * s) / 2 + 6} x2={cx + (w * s) / 2 + 6} y1={top} y2={top + crown * s} stroke="var(--text-3, #8B95A3)" strokeWidth={1} />
      <text x={cx + (w * s) / 2 + 10} y={top + (crown * s) / 2 + 3} fontSize={10} fill="var(--text-2, #A9B3C1)">crown {crown} m</text>
      <text x={cx + (w * s) / 2 + 10} y={top + (crown + h) * s} fontSize={10} fill="var(--text-2, #A9B3C1)">invert {(crown + h).toFixed(1)} m</text>
      <text x={cx} y={H - 2} fontSize={10} textAnchor="middle" fill="var(--text-3, #8B95A3)">{sec.shape === 'circular' ? `Ø ${w} m` : `${w} × ${h} m`} · deepest vertex · to scale</text>
    </svg>
  );
};

export const AlignmentInspector: React.FC<{ a: UndergroundAlignmentObject }> = ({ a }) => (
  <div className="flex flex-col gap-3" data-testid="alignment-inspector">
    <div className={card} style={cardStyle}>
      <span className={lbl} style={labelStyle}>Cross-section</span>
      <SectionSketch a={a} />
      <button type="button" className="uos-btn uos-btn-sm self-start" data-testid="ug-open-underground"
        onClick={() => { useUndergroundStore.getState().setActive(a.id); useShellStore.getState().setWorkspace('underground'); }}>
        Long-section, sections &amp; conflicts →
      </button>
    </div>
    <AlignmentEditor a={a} />
  </div>
);

/* ─── Demand zone ────────────────────────────────────────────────────────── */

const inside = (pt: readonly number[], poly: readonly (readonly number[])[]) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
};
const centroid = (pts: readonly (readonly number[])[]): [number, number, number] => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length, 0];
const areaKm2 = (poly: readonly (readonly number[])[]) => {
  const lat = poly[0]?.[1] ?? 0;
  const a = Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  return a * mPerDegLon(lat) * M_PER_DEG_LAT / 1e6;
};

export const ZoneEditor: React.FC<{ z: ZoneObject; onUpdate: Update }> = ({ z, onUpdate }) => {
  useEffect(() => engineInstance.requestTrafficNetwork(), []);
  const scenarioId = engineInstance.scenarios.getActiveScenarioId();
  const buildings = useMemo(() => filterObjectsForScenario(engineInstance.objects.getAll(), scenarioId).filter(o => o.type === 'building') as BuildingObject[], [scenarioId]);
  // Same rule as the trip model (StudyDemand.activityEndpoints): buildings whose centroid is inside, their residents/employees
  const contained = buildings.filter(b => b.coordinates.length && inside(centroid(b.coordinates), z.coordinates));
  const bRes = contained.reduce((n, b) => n + (b.residents ?? 0), 0);
  const bEmp = contained.reduce((n, b) => n + (b.employees ?? 0), 0);
  const demand = useMemo(() => {
    const zone: DemandZone = { id: z.id, name: z.name, boundaryPolygon: z.coordinates, totalPopulation: z.totalPopulation || 0, totalEmployment: z.totalEmployment || 0,
      landUseMix: z.landUseMix, gateways: [], provenance: z.provenance ?? { source: 'hypothetical', confidence: 0, updatedAt: z.updatedAt } } as DemandZone;
    const { origins, destinations } = activityEndpoints({ zones: [zone], buildings: contained, period: 'AM_Peak' });
    const sum = (a: { id: string; flow: number }[]) => a.filter(e => e.id === z.id).reduce((n, e) => n + e.flow, 0);
    return { out: sum(origins), in: sum(destinations) };
  }, [z, contained]);
  return (
    <div className="flex flex-col gap-3" data-testid="zone-editor">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <label className={lbl} style={labelStyle} htmlFor="zone-pop">Residents</label>
          <input id="zone-pop" data-testid="zone-population" type="number" min={0} step={100} value={z.totalPopulation || 0} onChange={e => onUpdate('totalPopulation', Math.max(0, Number(e.target.value) || 0))} className={inputCls} style={inputStyle} />
        </div>
        <div className="flex flex-col gap-0.5">
          <label className={lbl} style={labelStyle} htmlFor="zone-emp">Jobs</label>
          <input id="zone-emp" data-testid="zone-employment" type="number" min={0} step={100} value={z.totalEmployment || 0} onChange={e => onUpdate('totalEmployment', Math.max(0, Number(e.target.value) || 0))} className={inputCls} style={inputStyle} />
        </div>
      </div>
      <div className={card} style={cardStyle} data-testid="zone-trips">
        <span className={lbl} style={labelStyle}>Feeds the trip model</span>
        <Row k="Area" v={`${areaKm2(z.coordinates).toFixed(2)} km²`} />
        <Row k="Buildings inside" v={`${contained.length} (${fmtInt(bRes)} residents, ${fmtInt(bEmp)} jobs)`} />
        <Row k="Spread over the zone" v={`${fmtInt(Math.max(0, (z.totalPopulation || 0) - bRes))} residents, ${fmtInt(Math.max(0, (z.totalEmployment || 0) - bEmp))} jobs`} />
        <Row k="AM peak leaving" testId="zone-am-out" v={`${fmtInt(demand.out)} veh/h`} />
        <Row k="AM peak arriving" testId="zone-am-in" v={`${fmtInt(demand.in)} veh/h`} />
        <p className="text-[11px]" style={note}>Residents and jobs not already in modelled buildings, at Pune trip rates (CMP 2018). Estimated, not counted. Simulate uses these.</p>
      </div>
      <p className="text-[11px] flex items-center gap-1.5 flex-wrap" style={note}><SourceBadge source={sourceOf(z.provenance?.source)} /> A traffic demand zone, not a zoning plan. Drag its corners with Select to reshape it.</p>
    </div>
  );
};

/* ─── Traffic gateway ────────────────────────────────────────────────────── */

const PERIODS = [['AM_Peak', 'AM peak'], ['PM_Peak', 'PM peak'], ['Midday', 'Midday'], ['Night', 'Night']] as const;
const MODE_LABEL: Record<string, string> = { car: 'Car', twoWheeler: 'Two-wheeler', bus: 'Bus', metro: 'Metro', walking: 'Walking', other: 'Auto / other' };

export const GatewayEditor: React.FC<{ g: GatewayObject; onUpdate: Update }> = ({ g, onUpdate }) => {
  useEffect(() => engineInstance.requestTrafficNetwork(), []);
  const network = engineInstance.getTrafficNetwork();
  const edge = g.connectedNodeId && network ? [...network.edges.values()].find(e => e.fromNodeId === g.connectedNodeId || e.toNodeId === g.connectedNodeId) : undefined;
  const road = edge ? engineInstance.objects.getById(edge.roadId) : undefined;
  const nodeKnown = !!(g.connectedNodeId && network?.nodes.has(g.connectedNodeId));
  const split = g.modeSplit || { car: 0.25, twoWheeler: 0.35, bus: 0.2, metro: 0.1, walking: 0.08, other: 0.02 };
  const offRoad = Math.round(((split.metro || 0) + (split.walking || 0)) * 100);
  return (
    <div className="flex flex-col gap-3" data-testid="gateway-editor">
      <div className={card} style={cardStyle}>
        <Row k="Attached to" testId="gateway-road" v={road ? (road.name || road.id) : nodeKnown ? 'Road node' : network ? 'Not connected (road changed)' : 'Loading network…'} />
      </div>
      <div className={card} style={cardStyle}>
        <div className="flex items-center justify-between gap-2">
          <span className={lbl} style={labelStyle}>Vehicles per hour</span>
          <SourceBadge source={sourceOf(g.provenance?.source)} />
        </div>
        <label className="flex items-center justify-between gap-2 text-[11px]" style={labelStyle}>
          Source
          <select value={g.provenance?.source === 'observed' || g.provenance?.source === 'survey' || g.provenance?.source === 'hypothetical' ? g.provenance.source : 'estimated'} data-testid="gateway-source"
            onChange={e => onUpdate('provenance', { ...(g.provenance ?? { confidence: 0.5 }), source: e.target.value, updatedAt: new Date().toISOString() })} className="rounded border px-1 py-0.5 text-[11px]" style={inputStyle}>
            <option value="hypothetical">Hypothetical (default / what-if)</option>
            <option value="estimated">Estimated</option>
            <option value="survey">Survey (own count)</option>
            <option value="observed">Observed (published, cite in name)</option>
          </select>
        </label>
        <div className="grid grid-cols-3 gap-1.5 items-center text-[11px]" style={labelStyle}>
          <span /> <span className="text-center">Entering</span> <span className="text-center">Leaving</span>
          {PERIODS.map(([p, label]) => (
            <React.Fragment key={p}>
              <span>{label}</span>
              <input type="number" min={0} aria-label={`${label} entering (veh/h)`} data-testid={`gateway-in-${p}`} value={g.inboundFlows?.[p] ?? 0}
                onChange={e => onUpdate('inboundFlows', { ...(g.inboundFlows || {}), [p]: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} text-center`} style={inputStyle} />
              <input type="number" min={0} aria-label={`${label} leaving (veh/h)`} data-testid={`gateway-out-${p}`} value={g.outboundFlows?.[p] ?? 0}
                onChange={e => onUpdate('outboundFlows', { ...(g.outboundFlows || {}), [p]: Math.max(0, Number(e.target.value) || 0) })} className={`${inputCls} text-center`} style={inputStyle} />
            </React.Fragment>
          ))}
        </div>
        <p className="text-[11px]" style={note}>Set leaving to 0 for an entry-only gateway (or entering to 0 for exit-only).</p>
      </div>
      <details className={card} style={cardStyle}>
        <summary className={`${lbl} cursor-pointer`} style={labelStyle}>Mode split</summary>
        {MODE_SPLIT_KEYS.map(mode => {
          const val = Math.round((split[mode] || 0) * 100);
          return (
            <Slider key={mode} id={`gw-ms-${mode}`} label={MODE_LABEL[mode] ?? mode} unit="%" min={0} max={100} step={1} value={val}
              onChange={v => onUpdate('modeSplit', rebalanceSplit(split, MODE_SPLIT_KEYS, mode, v / 100, 1))} />
          );
        })}
        <p className="text-[11px]" style={note}>{offRoad}% (metro + walking) is taken off the road; the rest becomes vehicles by class.</p>
      </details>
    </div>
  );
};
