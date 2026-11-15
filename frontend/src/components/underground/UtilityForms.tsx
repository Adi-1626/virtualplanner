import React, { useEffect, useMemo, useState } from 'react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { CityObject, UtilityObject, UtilityType } from '../../engine/objects/types';
import type { Certainty } from '../../engine/objects/certainty';
import { chainages } from '../../engine/underground/alignmentGeometry';
import { groundAt, groundSamples } from '../../engine/underground/terrainProfile';
import {
  EVIDENCE_LABEL, STATUS_LABEL, TYPICAL_COVER, ZREF_LABEL, bottomDepthFrom, cleanUtilityDepth, utilitySummary,
  withAllUtilityDepths, withUtilityGroundReference, withUtilityType, withUtilityVertexDepth, withUtilityZ,
  type UtilityEvidence, type UtilityStatus, type UtilityZRef,
} from '../../engine/underground/utilityModel';
import { utilityLayerId } from '../../engine/layers/LayerManager';
import { CertaintyBadge } from '../ui/badges/CertaintyBadge';
import { useTerrainProfile } from './useTerrain';
import { CERTAINTY_OPTIONS, field, input, inputStyle, lbl, labelStyle, note } from './common';
import { terrainErrorReason } from './chartLabels';

const cell: React.CSSProperties = { padding: '4px 3px' };
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const f2 = (v: number | null) => (v === null ? 'Unknown' : `${v.toFixed(2)} m`);

const UTILITY_TYPE_OPTIONS: { value: UtilityType; label: string }[] = [
  { value: 'water', label: 'Water' }, { value: 'sewage', label: 'Sewer' }, { value: 'electricity', label: 'Electrical' }, { value: 'gas', label: 'Gas' }, { value: 'fiber', label: 'Fibre / telecom' },
];
const STATUS_OPTIONS: UtilityStatus[] = ['proposed', 'conceptual', 'existing', 'abandoned'];
const EVIDENCE_OPTIONS: UtilityEvidence[] = ['user-drawn', 'QL-D', 'QL-C', 'QL-B', 'QL-A', 'unknown'];
const ZREF_OPTIONS: UtilityZRef[] = ['top', 'centre', 'invert'];

/** Applies a utility edit with Undo (history.recordUpdate + ObjectManager.update: copy-on-write in a proposal). */
function commitUtility(before: UtilityObject, after: UtilityObject, what: string, coalesceKey?: string) {
  engineInstance.history.recordUpdate(before, after, `${what} — ${before.name || before.id}`, coalesceKey);
  const { id: _id, type: _type, ...updates } = after;
  void _id; void _type;
  engineInstance.objects.update(before.id, updates as Partial<CityObject>);
}

/** Ground at each vertex from the DSM (same source and sampling as the Profile), with the model label. */
function useUtilityGround(u: UtilityObject) {
  const terrain = useTerrainProfile(u.coordinates);
  return useMemo(() => {
    if (terrain.state !== 'ok' || terrain.data.summary.n_ok === 0) return { state: terrain.state, ground: null, model: null, error: terrain.state === 'error' ? terrain.error : null };
    const ds = terrain.data.dataset;
    const model = `Copernicus GLO-30 ${ds.surface} ${ds.version}${ds.dataset_version_id ? ` (${ds.dataset_version_id})` : ''}`;
    const samples = groundSamples(u, terrain.data);
    return { state: 'ok' as const, ground: chainages(u.coordinates).map(c => groundAt(samples, c)), model, error: null };
  }, [terrain, u]);
}

const Sel = <T extends string>({ id, value, options, label, onChange, testId }: { id: string; value: T; options: { value: T; label: string }[]; label: string; onChange: (v: T) => void; testId: string }) => (
  <div className={field}>
    <label className={lbl} style={labelStyle} htmlFor={id}>{label}</label>
    <select id={id} data-testid={testId} className={input} style={inputStyle} value={value} onChange={e => onChange(e.target.value as T)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

/**
 * The editor of a drawn utility (Design inspector and Underground): status and evidence as separate fields, type,
 * diameter, which part of the pipe the depths are to, per-vertex depth with the elevation it gives (m EGM2008) and its
 * certainty. A typical-cover default is labelled "default — adjust", never measured.
 */
export const UtilityZEditor: React.FC<{ u: UtilityObject }> = ({ u }) => {
  const s = utilitySummary(u);
  const z = s.z;
  const g = useUtilityGround(u);
  const [allDepth, setAllDepth] = useState('');
  const commit = (after: UtilityObject, what: string, key?: string) =>
    commitUtility(u, g.ground && g.model ? withUtilityGroundReference(after, g.ground, g.model) : after, what, key);
  // Elevations once the ground is known (derived data, no Undo entry; only in the object's own alternative and never
  // for a legacy object that has not been edited yet, so viewing creates no change)
  useEffect(() => {
    if (!g.ground || !g.model || u.scenarioId !== engineInstance.scenarios.getActiveScenarioId()) return;
    const next = withUtilityGroundReference(u, g.ground, g.model);
    if (next !== u) engineInstance.objects.update(u.id, { depths: next.depths } as Partial<CityObject>);
  }, [u, g.ground, g.model]);
  const bottoms = z.depths.map(d => bottomDepthFrom(d.depthM, z.zRef, z.diameterM)).filter((v): v is number => v !== null);
  const len = chainages(u.coordinates);
  return (
    <div className="flex flex-col gap-3" data-testid="utility-editor">
      {z.migrated && (
        <p className="text-meta text-text-3" data-testid="utility-migrated">Saved before per-point depths were recorded: shown from its single depth{u.depthCertainty === 'unknown' ? ' (a placeholder, so Unknown)' : ''}. Any edit stores the full depth model.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Sel id="util-status" testId="utility-status" label="Status" value={z.status}
          options={[...(z.status === 'unknown' ? ['unknown' as UtilityStatus] : []), ...STATUS_OPTIONS].map(v => ({ value: v, label: STATUS_LABEL[v] }))}
          onChange={v => commit(withUtilityZ(u, { status: v }), 'Change utility status')} />
        <Sel id="util-evidence" testId="utility-evidence" label="Evidence" value={z.evidence}
          options={EVIDENCE_OPTIONS.map(v => ({ value: v, label: EVIDENCE_LABEL[v] }))}
          onChange={v => commit(withUtilityZ(u, { evidence: v }), 'Change utility evidence')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Sel id="util-type" testId="utility-type" label="Type" value={u.utilityType} options={UTILITY_TYPE_OPTIONS}
          onChange={v => {
            const next = { ...withUtilityType(u, v), layerId: utilityLayerId(v) };
            // Utility layers start hidden: show the new one, or the line vanishes as its type changes
            if (!engineInstance.layers.isVisible(next.layerId)) engineInstance.layers.setVisibility(next.layerId, true);
            commit(next, 'Change utility type');
          }} />
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="util-dia">Diameter (mm)</label>
          <input id="util-dia" data-testid="utility-diameter" type="number" min={1} placeholder="Unknown" className={input} style={inputStyle} value={u.diameterMm ?? ''}
            onChange={e => commit(withUtilityZ(u, { diameterMm: num(e.target.value) }), 'Edit diameter', `${u.id}:diameter`)} />
        </div>
      </div>
      <Sel id="util-zref" testId="utility-zref" label="Depths are measured to" value={z.zRef}
        options={ZREF_OPTIONS.map(v => ({ value: v, label: ZREF_LABEL[v] }))}
        onChange={v => commit(withUtilityZ(u, { zRef: v }), 'Change depth reference')} />
      <div className="uos-card text-meta text-text-2 flex flex-col gap-0.5" data-testid="utility-summary">
        <span>Plan length <span className="tabular-nums text-text-1">{Math.round(len[len.length - 1] ?? 0).toLocaleString('en-IN')} m</span></span>
        <span data-testid="utility-top">Top of pipe {s.minTopM === null ? <span className="text-unknown">Unknown{z.zRef !== 'top' && z.diameterM === null ? ' (needs the diameter)' : ''}</span>
          : <span className="tabular-nums text-text-1">{s.minTopM === s.maxTopM ? f2(s.minTopM) : `${f2(s.minTopM)} to ${f2(s.maxTopM)}`} below ground</span>}</span>
        <span data-testid="utility-bottom">Bottom (invert) {bottoms.length ? <span className="tabular-nums text-text-1">{Math.min(...bottoms) === Math.max(...bottoms) ? f2(bottoms[0]) : `${f2(Math.min(...bottoms))} to ${f2(Math.max(...bottoms))}`} below ground</span> : <span className="text-unknown">Unknown{z.diameterM === null ? ' (diameter unknown)' : ''}</span>}</span>
        {s.defaults > 0 && <span className="text-warn" data-testid="utility-default-note">{s.defaults} of {z.depths.length} depths are the typical cover for this type ({TYPICAL_COVER[u.utilityType].coverM} m, {TYPICAL_COVER[u.utilityType].source}): default — adjust.</span>}
      </div>
      <div className="uos-card text-meta text-text-2 flex flex-col gap-0.5" data-testid="utility-depth-reference">
        <span className="text-label text-text-1">Depth reference</span>
        {g.state === 'ok' && g.model
          ? <span>Depth = {ZREF_LABEL[z.zRef].toLowerCase()}, metres below ground. Ground = {g.model}, m EGM2008 (a surface model incl. roofs and trees, ±2–4 m: screening only).</span>
          : g.state === 'error' ? <span className="text-unknown">Ground level UNKNOWN ({terrainErrorReason(g.error)}). No elevations stored.</span>
            : g.state === 'ok' ? <span className="text-unknown">Ground level UNKNOWN here (outside the ground model).</span> : <span>Loading ground levels…</span>}
      </div>
      <div>
        <div className="flex items-end gap-2 mb-1">
          <div className={`${field} flex-1`}>
            <label className={lbl} style={labelStyle} htmlFor="util-all-depth">Set all depths (m below ground)</label>
            <input id="util-all-depth" data-testid="utility-all-depth" type="number" min={0} step={0.1} placeholder={ZREF_LABEL[z.zRef].toLowerCase()} className={input} style={inputStyle} value={allDepth} onChange={e => setAllDepth(e.target.value)} />
          </div>
          <button type="button" className="uos-btn uos-btn-sm" data-testid="utility-apply-all-depth" disabled={allDepth.trim() === '' || cleanUtilityDepth(Number(allDepth)) === null}
            onClick={() => { commit(withAllUtilityDepths(u, Number(allDepth), 'hypothetical'), 'Set all utility depths'); setAllDepth(''); }}>Apply</button>
        </div>
        <table className="uos-table" data-testid="utility-vertex-table">
          <thead><tr><th style={cell}>#</th><th className="num" style={cell}>Chainage</th><th style={cell}>Depth ↓ (m)</th><th style={cell}>Certainty</th></tr></thead>
          <tbody>
            {z.depths.map((d, i) => {
              const gr = g.ground?.[i] ?? null;
              const elev = d.depthM !== null && gr !== null ? gr - d.depthM : null;
              return (
                <tr key={i}>
                  <td style={cell}>{i + 1}</td>
                  <td className="num" style={cell}>{Math.round(len[i] ?? 0)} m</td>
                  <td style={cell}>
                    <input aria-label={`Depth to ${ZREF_LABEL[z.zRef].toLowerCase()} at point ${i + 1} (m below ground)`} data-testid={`utility-depth-${i}`} type="number" min={0} step={0.1} placeholder="?" title="Blank = Unknown"
                      className={input} style={{ ...inputStyle, width: 70, fontSize: 12 }} value={d.depthM ?? ''}
                      onChange={e => commit(withUtilityVertexDepth(u, i, { depthM: num(e.target.value) }), `Utility depth at point ${i + 1}`, `${u.id}:depth:${i}`)} />
                    {d.isDefault && <span className="block text-meta text-warn" data-testid={`utility-default-${i}`} title={TYPICAL_COVER[u.utilityType].source}>default — adjust</span>}
                    <span className="block text-meta text-text-3 tabular-nums" data-testid={`utility-elev-${i}`} title={gr === null ? 'Ground UNKNOWN here' : `Ground ${gr.toFixed(1)} m EGM2008 (DSM) − depth`}>
                      {elev === null ? (d.depthM === null ? 'elev ?' : 'ground ?') : `${elev.toFixed(1)} m EGM2008`}
                    </span>
                  </td>
                  <td style={cell}>
                    {d.depthM === null ? <CertaintyBadge certainty="unknown" note="No depth entered" /> : (
                      <select aria-label={`Depth certainty at point ${i + 1}`} data-testid={`utility-cert-${i}`} className={input} style={{ ...inputStyle, width: 100, fontSize: 12 }} value={d.certainty}
                        onChange={e => commit(withUtilityVertexDepth(u, i, { certainty: e.target.value as Certainty }), `Utility depth certainty at point ${i + 1}`)}>
                        {CERTAINTY_OPTIONS.filter(o => o.value !== 'unknown').map(o => <option key={o.value} value={o.value}>{o.label.split(' ')[0]}</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] mt-1" style={note}>Under each depth: the elevation of the {ZREF_LABEL[z.zRef].toLowerCase()} (ground − depth), stored with the ground level and model used. Status (proposed / existing…) and evidence (how the position is known) are separate: an existing pipe drawn from memory is "existing · user-drawn". Blank = Unknown, never 0.</p>
      </div>
    </div>
  );
};
