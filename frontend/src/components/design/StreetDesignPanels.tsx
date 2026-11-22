/**
 * Street design tools UI (docs/urbanos/DESIGN_TOOLS_P7.md): tool settings, the screening checks list, the street
 * element inspector, the metro corridor screen, the bus lane / BRT upgrade and the junction markings section.
 * Every check is screening wording only; values show their source and status.
 */
import React, { useMemo, useState } from 'react';
import { engineInstance } from '../../engine/TwinCityEngine';
import { BASE_SCENARIO_ID } from '../../engine/scenarios/ScenarioManager';
import type { CityObject, MetroFlyoverObject, MetroLineObject, RoadObject, StreetElementObject } from '../../engine/objects/types';
import type { EditingMode } from '../../engine/editing/EditingEngine';
import type { LogicalJunction } from '../../engine/simulation/junctionGroups';
import type { JunctionEditSpec } from '../../engine/simulation/junctionControl';
import { countFlags, type SdCheck } from '../../engine/streetDesign/checks';
import { SD, sdLabel } from '../../engine/streetDesign/sources';
import { metroCorridorChecks, isMetroViaduct } from '../../engine/streetDesign/metroSetback';
import { crossingChecks } from '../../engine/streetDesign/crossings';
import { busStopChecks } from '../../engine/streetDesign/busStops';
import { roadsideChecks, withRunPoints } from '../../engine/streetDesign/roadside';
import { roundaboutChecks, roundaboutSizes, CATEGORY_LABEL, CATEGORY_RANGE, DEFAULT_ICD } from '../../engine/streetDesign/roundabout';
import { pathChecks, PATH_LABEL, LEVEL_LABEL } from '../../engine/streetDesign/paths';
import { busPriorityChecks, busPriorityBlockReason, commitBusPriority, DEFAULT_BUS_PRIORITY, type BusPrioritySpec } from '../../engine/streetDesign/busLane';
import { BRUSH_LABEL, junctionMarkings, markingCounts, signalWarrantChecks, type JunctionBrush } from '../../engine/streetDesign/junctionTool';
import { upgradeBlockReason } from '../../engine/crossSection/apply';
import type { RoundaboutCategory } from '../../engine/streetDesign/types';

const icon = (s: SdCheck['status']) => (s === 'pass' ? '✅' : s === 'warn' ? '⚠️' : s === 'unknown' ? '❔' : s === 'info' ? 'ℹ️' : '❌');
const colour = (s: SdCheck['status']) => (s === 'pass' ? 'text-emerald-400' : s === 'warn' ? 'text-amber-400' : s === 'fail' ? 'text-red-400' : 'text-slate-400');
const inputCls = 'bg-slate-900 border border-slate-700/50 rounded-lg p-1.5 text-xs text-slate-200 w-full';
const lbl = 'flex flex-col gap-0.5 text-[11px] text-slate-400';

/** A list of screening checks (same card layout as the cross-section checks). */
export const StreetChecksList: React.FC<{ title: string; checks: readonly SdCheck[]; testId?: string }> = ({ title, checks, testId = 'sd-checks' }) => {
  const sum = countFlags(checks);
  const head = sum.fail + sum.warn > 0 ? `${sum.fail + sum.warn} flag${sum.fail + sum.warn > 1 ? 's' : ''}${sum.unknown ? ` · ${sum.unknown} not screened` : ''}`
    : sum.unknown ? `No flag found · ${sum.unknown} not screened` : 'No flag found';
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold text-slate-400 uppercase tracking-widest font-mono">{title} <span className="ml-1 rounded border border-amber-400/30 px-1 text-[9px] text-amber-300 normal-case tracking-normal">screening</span></span>
        <span className={`font-bold ${sum.fail ? 'text-red-400' : sum.warn ? 'text-amber-300' : 'text-slate-300'}`} data-testid={`${testId}-summary`}>{head}</span>
      </div>
      {checks.map(c => (
        <div key={c.id} className="bg-slate-900/40 border border-white/5 rounded-lg p-2.5 text-xs space-y-0.5" data-testid={`${testId}-${c.id}`} data-status={c.status}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5"><span>{icon(c.status)}</span><span>{c.name}</span></span>
            <span className={`text-[11px] font-bold font-mono ${colour(c.status)}`}>{c.actual == null ? '—' : c.required == null ? `${c.actual} ${c.unit}` : `${c.actual} / ${c.required} ${c.unit}`}</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">{c.message}</p>
          <p className="text-[10px] text-slate-600 leading-relaxed">Source: {c.basis}</p>
        </div>
      ))}
    </div>
  );
};

// ── Tool settings ──────────────────────────────────────────────────────────

export const StreetToolSettingsPanel: React.FC<{ mode: EditingMode }> = ({ mode }) => {
  const e = engineInstance.editing;
  const s = e.streetSettings;
  const [, bump] = useState(0);
  const set = (fn: () => void) => { fn(); bump(n => n + 1); };
  const num = (v: string, min = 0) => { const n = Number(v); return Number.isFinite(n) && n > min ? n : null; };

  if (mode === 'brush_junction_control') return (
    <div className="flex flex-col gap-2" data-testid="tool-setting-junction-brush">
      <label className={lbl}>Control to apply
        <select className={inputCls} value={e.junctionBrush} onChange={ev => set(() => { e.junctionBrush = ev.target.value as JunctionBrush; })}>
          {(Object.keys(BRUSH_LABEL) as JunctionBrush[]).map(k => <option key={k} value={k}>{BRUSH_LABEL[k]}</option>)}
        </select>
      </label>
      <p className="text-[11px] text-slate-500">Click junctions on the map. Each click is one Undo step and the same edit as the junction editor: signal = one phase per approach (25 s green, 3 s amber, 2 s all-red; edit it in the junction editor); stop / give way = priority to the main road. IRC:35 markings (stop / give-way lines, zebras, arrows) are generated.</p>
    </div>
  );
  if (mode === 'place_crossing') return (
    <div className="flex flex-col gap-2" data-testid="tool-setting-crossing">
      <label className={lbl}>Crossing
        <select className={inputCls} value={s.crossingType} onChange={ev => set(() => { s.crossingType = ev.target.value as typeof s.crossingType; })}>
          <option value="zebra">Zebra</option><option value="raised">Raised (table-top)</option><option value="signalised">Signalised (mid-block)</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Width (m)<input type="number" min={1} step={0.5} className={inputCls} value={s.crossingWidthM} onChange={ev => set(() => { s.crossingWidthM = num(ev.target.value) ?? s.crossingWidthM; })} /></label>
        <label className={lbl}>Refuge (m)<input type="number" min={0} step={0.1} className={inputCls} disabled={!s.crossingRefuge} value={s.crossingRefugeWidthM} onChange={ev => set(() => { s.crossingRefugeWidthM = num(ev.target.value) ?? s.crossingRefugeWidthM; })} /></label>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={s.crossingRefuge} onChange={() => set(() => { s.crossingRefuge = !s.crossingRefuge; })} /> Refuge island in the middle</label>
      <p className="text-[11px] text-slate-500">Click on a road. Width ≥ max(2 m, footpath) ({sdLabel(SD.zebraMinWidthM)}); a crossing over 10.5 m needs a refuge ≥ 1.2 m.</p>
    </div>
  );
  if (mode === 'place_bus_stop') return (
    <div className="flex flex-col gap-2" data-testid="tool-setting-bus-stop">
      <label className={lbl}>Stop
        <select className={inputCls} value={s.busStopPlacement} onChange={ev => set(() => { s.busStopPlacement = ev.target.value as typeof s.busStopPlacement; })}>
          <option value="kerb">Kerb-side</option><option value="bay">In a bay (parking strip)</option><option value="median_brt">BRT median station</option>
        </select>
      </label>
      <p className="text-[11px] text-slate-500">Click on the side of the road the stop serves. Shelter {SD.busShelterLengthM.value} × {SD.busShelterDepthM.value} m (Pune USDG). Bus lanes / BRT: select the road.</p>
    </div>
  );
  if (mode === 'place_roadside') return (
    <div className="flex flex-col gap-2" data-testid="tool-setting-roadside">
      <label className={lbl}>Element
        <select className={inputCls} value={s.roadsideKind} onChange={ev => set(() => { s.roadsideKind = ev.target.value as typeof s.roadsideKind; })}>
          <option value="streetlight">Streetlights</option><option value="street_tree">Street trees</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Count<input type="number" min={1} max={200} step={1} className={inputCls} value={s.roadsideCount} onChange={ev => set(() => { s.roadsideCount = Math.max(1, Math.round(Number(ev.target.value) || 1)); })} /></label>
        <label className={lbl}>Spacing (m)<input type="number" min={1} step={1} className={inputCls} placeholder={s.roadsideKind === 'streetlight' ? 'IRC:86 Table 5.6' : '8 (assumed)'} value={s.roadsideSpacingM ?? ''} onChange={ev => set(() => { s.roadsideSpacingM = ev.target.value === '' ? null : num(ev.target.value); })} /></label>
        {s.roadsideKind === 'streetlight' && <label className={lbl}>Pole height (m)<input type="number" min={3} max={20} step={0.5} className={inputCls} value={s.roadsidePoleHeightM} onChange={ev => set(() => { s.roadsidePoleHeightM = num(ev.target.value) ?? s.roadsidePoleHeightM; })} /></label>}
        <label className={lbl}>Strip
          <select className={inputCls} value={s.roadsideZone} onChange={ev => set(() => { s.roadsideZone = ev.target.value as typeof s.roadsideZone; })}>
            <option value="furniture">Furniture / tree strip</option><option value="footpath">Footpath</option><option value="median">Median</option>
          </select>
        </label>
      </div>
      <p className="text-[11px] text-slate-500">Click on the side of the road; the run goes along the road's drawn direction from the click. Placement is data; the 3D models come with the realistic visuals.</p>
    </div>
  );
  if (mode === 'place_roundabout') {
    const range = CATEGORY_RANGE[s.roundaboutCategory];
    const icd = s.roundaboutIcdM ?? DEFAULT_ICD[s.roundaboutCategory];
    const sz = roundaboutSizes(s.roundaboutCategory, icd);
    return (
      <div className="flex flex-col gap-2" data-testid="tool-setting-roundabout">
        <label className={lbl}>Category
          <select className={inputCls} value={s.roundaboutCategory} onChange={ev => set(() => { s.roundaboutCategory = ev.target.value as RoundaboutCategory; s.roundaboutIcdM = null; })}>
            {(Object.keys(CATEGORY_LABEL) as RoundaboutCategory[]).map(k => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
          </select>
        </label>
        <label className={lbl}>Inscribed circle diameter (m) — {range.min}–{range.max}
          <input type="number" min={range.min} max={range.max} step={1} className={inputCls} value={icd} onChange={ev => set(() => { s.roundaboutIcdM = num(ev.target.value); })} />
        </label>
        <p className="text-[11px] text-slate-500">Island {sz.islandM} m, circulatory carriageway {sz.circulatoryM} m ({sz.how}). Click a junction.</p>
      </div>
    );
  }
  if (mode === 'draw_path') return (
    <div className="flex flex-col gap-2" data-testid="tool-setting-path">
      <label className={lbl}>Path
        <select className={inputCls} value={s.pathType} onChange={ev => set(() => { s.pathType = ev.target.value as typeof s.pathType; })}>
          {(Object.keys(PATH_LABEL) as (keyof typeof PATH_LABEL)[]).map(k => <option key={k} value={k}>{PATH_LABEL[k]}</option>)}
        </select>
      </label>
      <label className={lbl}>Level
        <select className={inputCls} value={s.pathLevel} onChange={ev => set(() => { s.pathLevel = ev.target.value as typeof s.pathLevel; })}>
          {(Object.keys(LEVEL_LABEL) as (keyof typeof LEVEL_LABEL)[]).map(k => <option key={k} value={k}>{LEVEL_LABEL[k]}</option>)}
        </select>
      </label>
      <label className={lbl}>Width (m)<input type="number" min={0.5} step={0.1} className={inputCls} value={s.pathWidthM} onChange={ev => set(() => { s.pathWidthM = num(ev.target.value) ?? s.pathWidthM; })} /></label>
      <p className="text-[11px] text-slate-500">Click points, double-click to finish. Pedestrians and cyclists are not modelled in Simulate.</p>
    </div>
  );
  return null;
};

// ── Street element inspector ───────────────────────────────────────────────

function useScenarioObjects(dep: unknown): CityObject[] {
  return useMemo(() => engineInstance.streetDesignObjects(), [dep]); // eslint-disable-line react-hooks/exhaustive-deps
}

function update(el: StreetElementObject, patch: Partial<StreetElementObject>, what: string) {
  let after = { ...el, ...patch } as StreetElementObject;
  if (after.roadside && after.anchor) {
    const road = engineInstance.objects.getById(after.anchor.roadId);
    after = withRunPoints(after, road?.type === 'road' ? road : null);
  }
  engineInstance.history.recordUpdate(el, after, `Update ${el.name}: ${what}`, `${el.id}:${what}`);
  engineInstance.objects.update(el.id, after);
}

const NumField: React.FC<{ label: string; value: number | null | undefined; onChange: (v: number | null) => void; step?: number; testId?: string; placeholder?: string }> = ({ label, value, onChange, step = 0.1, testId, placeholder = 'Unknown' }) => (
  <label className={lbl}>{label}
    <input type="number" step={step} data-testid={testId} placeholder={placeholder} className={inputCls} value={value ?? ''}
      onChange={e => { const n = Number(e.target.value); onChange(e.target.value === '' || !Number.isFinite(n) ? null : n); }} />
  </label>
);

export const StreetElementInspector: React.FC<{ el: StreetElementObject }> = ({ el }) => {
  const objects = useScenarioObjects(el);
  const road = el.anchor ? objects.find(o => o.id === el.anchor!.roadId) as RoadObject | undefined : undefined;
  const checks = useMemo(() => {
    switch (el.kind) {
      case 'crossing': return crossingChecks(el, objects);
      case 'bus_stop': return busStopChecks(el, objects);
      case 'streetlight': case 'street_tree': return roadsideChecks(el, objects);
      case 'roundabout': return roundaboutChecks(el, objects);
      case 'path': return pathChecks(el, objects);
    }
  }, [el, objects]);
  return (
    <section className="space-y-3 rounded-xl border border-white/5 bg-slate-950/20 p-3" data-testid="sd-inspector" data-kind={el.kind}>
      {road && <p className="text-[11px] text-slate-400">On {road.name || road.id}, {Math.round(el.anchor!.chainageM)} m along, {el.anchor!.side} side.</p>}
      {el.kind === 'crossing' && el.crossing && (
        <div className="grid grid-cols-2 gap-2">
          <label className={lbl}>Type
            <select className={inputCls} value={el.crossing.crossingType} onChange={e => update(el, { crossing: { ...el.crossing!, crossingType: e.target.value as 'zebra' } }, 'type')}>
              <option value="zebra">Zebra</option><option value="raised">Raised</option><option value="signalised">Signalised</option>
            </select>
          </label>
          <NumField label="Width (m)" value={el.crossing.widthM} onChange={v => v && update(el, { crossing: { ...el.crossing!, widthM: v } }, 'width')} testId="sd-crossing-width" />
          <label className="flex items-center gap-2 text-[12px] text-slate-300 col-span-2"><input type="checkbox" checked={el.crossing.refuge} onChange={() => update(el, { crossing: { ...el.crossing!, refuge: !el.crossing!.refuge, refugeWidthM: el.crossing!.refugeWidthM ?? 1.5 } }, 'refuge')} /> Refuge island</label>
          {el.crossing.refuge && <NumField label="Refuge width (m)" value={el.crossing.refugeWidthM} onChange={v => update(el, { crossing: { ...el.crossing!, refugeWidthM: v } }, 'refuge width')} />}
          <NumField label="Length to cross (m)" value={el.crossing.lengthM} placeholder="From the road" onChange={v => update(el, { crossing: { ...el.crossing!, lengthM: v } }, 'length')} />
          {el.crossing.crossingType === 'signalised' && <NumField label="Signal cycle (s)" value={el.crossing.signalCycleS} step={5} placeholder={`${SD.pedSignalCycleS.value} (assumed)`} onChange={v => update(el, { crossing: { ...el.crossing!, signalCycleS: v } }, 'cycle')} />}
          {el.crossing.crossingType === 'signalised' && <NumField label="Pedestrians / h (count)" value={el.crossing.pedsPerHour} step={10} onChange={v => update(el, { crossing: { ...el.crossing!, pedsPerHour: v } }, 'peds')} />}
        </div>
      )}
      {el.kind === 'bus_stop' && el.busStop && (
        <div className="grid grid-cols-2 gap-2">
          <label className={lbl}>Stop
            <select className={inputCls} value={el.busStop.placement} onChange={e => update(el, { busStop: { ...el.busStop!, placement: e.target.value as 'kerb' } }, 'placement')}>
              <option value="kerb">Kerb-side</option><option value="bay">Bay</option><option value="median_brt">BRT median</option>
            </select>
          </label>
          <NumField label="Shelter depth (m)" value={el.busStop.shelterDepthM} onChange={v => v && update(el, { busStop: { ...el.busStop!, shelterDepthM: v } }, 'shelter')} />
          {el.busStop.placement === 'median_brt' && <NumField label="Inner clear (m)" value={el.busStop.stationInnerM} onChange={v => update(el, { busStop: { ...el.busStop!, stationInnerM: v } }, 'inner')} />}
          {el.busStop.placement === 'median_brt' && <NumField label="Outer width (m)" value={el.busStop.stationOuterM} onChange={v => update(el, { busStop: { ...el.busStop!, stationOuterM: v } }, 'outer')} />}
        </div>
      )}
      {(el.kind === 'streetlight' || el.kind === 'street_tree') && el.roadside && (
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Count" value={el.roadside.count} step={1} onChange={v => v && update(el, { roadside: { ...el.roadside!, count: Math.max(1, Math.round(v)) } }, 'count')} testId="sd-roadside-count" />
          <NumField label="Spacing (m)" value={el.roadside.spacingM} step={1} onChange={v => update(el, { roadside: { ...el.roadside!, spacingM: v } }, 'spacing')} />
          {el.kind === 'streetlight' && <NumField label="Pole height (m)" value={el.roadside.poleHeightM} step={0.5} onChange={v => update(el, { roadside: { ...el.roadside!, poleHeightM: v } }, 'height')} />}
          {el.kind === 'street_tree' && <NumField label="Pit (m, square)" value={el.roadside.pitM} onChange={v => update(el, { roadside: { ...el.roadside!, pitM: v } }, 'pit')} />}
          {el.kind === 'street_tree' && <NumField label="Canopy clearance (m)" value={el.roadside.canopyClearanceM} onChange={v => update(el, { roadside: { ...el.roadside!, canopyClearanceM: v } }, 'canopy')} />}
          <p className="text-[11px] text-slate-500 col-span-2">{el.roadside.points.length} placed. Placeholder markers only; the 3D models come with the realistic visuals.</p>
        </div>
      )}
      {el.kind === 'roundabout' && el.roundabout && (
        <div className="grid grid-cols-2 gap-2">
          <label className={lbl}>Category
            <select className={inputCls} value={el.roundabout.category} onChange={e => { const c = e.target.value as RoundaboutCategory; const s = roundaboutSizes(c, DEFAULT_ICD[c]); update(el, { roundabout: { ...el.roundabout!, category: c, icdM: DEFAULT_ICD[c], islandM: s.islandM, circulatoryM: s.circulatoryM, entryLanes: c === 'double' ? 2 : 1 } }, 'category'); }}>
              {(Object.keys(CATEGORY_LABEL) as RoundaboutCategory[]).map(k => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
            </select>
          </label>
          <NumField label="ICD (m)" value={el.roundabout.icdM} step={1} testId="sd-rb-icd" onChange={v => { if (!v) return; const s = roundaboutSizes(el.roundabout!.category, v, el.roundabout!.entryLanes); update(el, { roundabout: { ...el.roundabout!, icdM: v, islandM: s.islandM, circulatoryM: s.circulatoryM } }, 'icd'); }} />
          <NumField label="Island (m)" value={el.roundabout.islandM} onChange={v => v != null && update(el, { roundabout: { ...el.roundabout!, islandM: v } }, 'island')} />
          <NumField label="Available diameter (m)" value={el.roundabout.availableDiameterM} step={1} onChange={v => update(el, { roundabout: { ...el.roundabout!, availableDiameterM: v } }, 'available')} />
        </div>
      )}
      {el.kind === 'path' && el.path && (
        <div className="grid grid-cols-2 gap-2">
          <label className={lbl}>Path
            <select className={inputCls} value={el.path.pathType} onChange={e => update(el, { path: { ...el.path!, pathType: e.target.value as 'footpath' } }, 'type')}>
              {(Object.keys(PATH_LABEL) as (keyof typeof PATH_LABEL)[]).map(k => <option key={k} value={k}>{PATH_LABEL[k]}</option>)}
            </select>
          </label>
          <label className={lbl}>Level
            <select className={inputCls} value={el.path.level} onChange={e => update(el, { path: { ...el.path!, level: e.target.value as 'ground' } }, 'level')}>
              {(Object.keys(LEVEL_LABEL) as (keyof typeof LEVEL_LABEL)[]).map(k => <option key={k} value={k}>{LEVEL_LABEL[k]}</option>)}
            </select>
          </label>
          <NumField label="Width (m)" value={el.path.widthM} onChange={v => v && update(el, { path: { ...el.path!, widthM: v } }, 'width')} />
          {el.path.level !== 'ground' && <NumField label="Clear height (m)" value={el.path.clearHeightM} onChange={v => update(el, { path: { ...el.path!, clearHeightM: v } }, 'clear height')} />}
          {el.path.level !== 'ground' && <NumField label="Ramp 1 in" value={el.path.rampGradient ? Math.round(1 / el.path.rampGradient) : null} step={1} onChange={v => update(el, { path: { ...el.path!, rampGradient: v ? 1 / v : null } }, 'ramp')} />}
          {el.path.level !== 'ground' && <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" checked={!!el.path.hasLift} onChange={() => update(el, { path: { ...el.path!, hasLift: !el.path!.hasLift } }, 'lift')} /> Lifts</label>}
          {el.path.level === 'ground' && el.path.pathType !== 'footpath' && <NumField label="Buffer (m)" value={el.path.bufferM} onChange={v => update(el, { path: { ...el.path!, bufferM: v } }, 'buffer')} />}
        </div>
      )}
      <StreetChecksList title="Checks" checks={checks ?? []} />
    </section>
  );
};

// ── Metro corridor ────────────────────────────────────────────────────────

export const MetroCorridorPanel: React.FC<{ obj: CityObject }> = ({ obj }) => {
  const objects = useScenarioObjects(obj);
  const checks = useMemo(() => (isMetroViaduct(obj) ? metroCorridorChecks(obj as MetroLineObject | MetroFlyoverObject, objects) : []), [obj, objects]);
  if (!isMetroViaduct(obj)) return null;
  return <section className="space-y-2 rounded-xl border border-white/5 bg-slate-950/20 p-3" data-testid="metro-corridor-panel"><StreetChecksList title="Metro corridor" checks={checks} testId="metro-checks" /></section>;
};

// ── Bus lane / BRT ────────────────────────────────────────────────────────

export const BusPriorityPanel: React.FC<{ road: RoadObject }> = ({ road }) => {
  const cur = road.busPriority;
  const [draft, setDraft] = useState<Omit<BusPrioritySpec, 'appliedAt'>>(cur ?? DEFAULT_BUS_PRIORITY('bus_lane'));
  const checks = useMemo(() => busPriorityChecks(road, draft), [road, draft]);
  const blockXs = upgradeBlockReason(road, { activeScenarioId: engineInstance.objects.getActiveScenarioId(), baseScenarioId: BASE_SCENARIO_ID });
  const block = blockXs ?? busPriorityBlockReason(road, draft);
  const apply = (spec: Omit<BusPrioritySpec, 'appliedAt'> | null) => {
    const r = commitBusPriority(engineInstance.objects, engineInstance.history, road, spec);
    if ('reason' in r) (window as any).showToast?.(r.reason, 'error');
    else (window as any).showToast?.(spec ? `${spec.kind === 'brt' ? 'BRT' : 'Bus lane'} on ${road.name || 'the road'}: Simulate's network loses one general lane per direction given to buses (Undo reverts it).` : 'Bus lane removed (Undo reverts it).', 'info');
  };
  return (
    <section className="space-y-2 rounded-xl border border-white/5 bg-slate-950/20 p-3" data-testid="bus-priority-panel">
      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest font-mono">Bus lane / BRT {cur && <span className="ml-1 text-amber-300 normal-case">({cur.kind === 'brt' ? 'BRT' : 'bus lane'} applied)</span>}</div>
      <div className="grid grid-cols-2 gap-2">
        <label className={lbl}>Kind
          <select className={inputCls} data-testid="bus-priority-kind" value={draft.kind} onChange={e => setDraft({ ...DEFAULT_BUS_PRIORITY(e.target.value as 'bus_lane'), directions: draft.directions })}>
            <option value="bus_lane">Bus lane (kerb side)</option><option value="brt">BRT (median)</option>
          </select>
        </label>
        <label className={lbl}>Directions
          <select className={inputCls} value={draft.directions} onChange={e => setDraft({ ...draft, directions: e.target.value as 'both' })}>
            <option value="both">Both</option><option value="forward">Forward (drawn direction)</option><option value="backward">Backward</option>
          </select>
        </label>
        <NumField label="Lane width (m)" value={draft.laneWidthM} onChange={v => v && setDraft({ ...draft, laneWidthM: v })} />
        <NumField label="Divider (m)" value={draft.dividerM} onChange={v => setDraft({ ...draft, dividerM: v })} />
      </div>
      <StreetChecksList title="Bus lane checks" checks={checks} testId="bus-checks" />
      {block ? <p className="text-[11px] text-amber-300" data-testid="bus-priority-blocked">{block}</p> : (
        <button type="button" data-testid="bus-priority-apply" onClick={() => apply(draft)} className="w-full rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/25">
          {cur ? 'Update' : 'Apply'} {draft.kind === 'brt' ? 'BRT' : 'bus lane'} (one Undo step)
        </button>
      )}
      {cur && !blockXs && <button type="button" data-testid="bus-priority-remove" onClick={() => apply(null)} className="w-full rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5">Remove</button>}
    </section>
  );
};

// ── Junction markings (junction editor) ───────────────────────────────────

export const JunctionMarkingsSection: React.FC<{ junction: LogicalJunction; draft: JunctionEditSpec; onChange: (d: JunctionEditSpec) => void }> = ({ junction, draft, onChange }) => {
  const open = engineInstance.getOpenImportedJunction();
  const marks = useMemo(() => (open && open.junction.id === junction.id ? junctionMarkings(junction, open.local.network, open.local.roads, draft) : null), [open, junction, draft]);
  const warrant = useMemo(() => signalWarrantChecks(junction, draft, null), [junction, draft]);
  const counts = marks ? markingCounts(marks.items) : {};
  const label: Record<string, string> = { stop_line: 'stop lines', double_stop_line: 'double stop lines (STOP)', give_way_line: 'give-way lines', zebra: 'zebra crossings', arrow: 'lane arrows', stop_word: 'STOP words', give_way_triangle: 'give-way triangles' };
  return (
    <div className="space-y-2" data-testid="junction-markings">
      {draft.control === 'priority' && (
        <label className={lbl}>Minor roads
          <select className={inputCls} data-testid="junction-minor-sign" value={draft.minorSign ?? 'give_way'} onChange={e => onChange({ ...draft, minorSign: e.target.value as 'stop' | 'give_way' })}>
            <option value="give_way">Give way (IRC:35 §6.2)</option><option value="stop">Stop (IRC:35 §6.1.6–6.1.7)</option>
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-[12px] text-slate-300"><input type="checkbox" data-testid="junction-zebras" checked={draft.pedestrianCrossings ?? draft.control === 'signal'} onChange={() => onChange({ ...draft, pedestrianCrossings: !(draft.pedestrianCrossings ?? draft.control === 'signal') })} /> Zebra crossings on the approaches</label>
      <p className="text-[11px] text-slate-400" data-testid="junction-marking-counts">IRC:35 markings: {Object.entries(counts).map(([k, n]) => `${n} ${label[k] ?? k}`).join(', ') || 'none'}{marks?.notes.length ? `. ${marks.notes.join(' ')}` : ''}</p>
      <p className="text-[10px] text-slate-600">Stop line 200 mm, at signals 1 m before the zebra; unsignalised 2–3 m; STOP = double line 300 mm apart; GIVE WAY = broken double line 600/300 mm; arrows 3.5 m (≤ 50 km/h). {sdLabel(SD.stopLineUrbanM)}. Drawn as placeholders; the painted look comes with the realistic visuals.</p>
      {draft.control === 'signal' && <StreetChecksList title="Signal warrant" checks={warrant} testId="junction-warrant" />}
    </div>
  );
};
