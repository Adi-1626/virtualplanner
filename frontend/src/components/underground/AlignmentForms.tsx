import React, { useEffect, useMemo, useState } from 'react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { CityObject, UndergroundAlignmentKind, UndergroundAlignmentObject, UndergroundLifecycle, UndergroundSection } from '../../engine/objects/types';
import type { Certainty } from '../../engine/objects/certainty';
import { ALIGNMENT_KIND_LABEL, alignmentProfile } from '../../engine/underground/alignmentGeometry';
import { ALIGNMENT_KINDS, cleanDepth, withAllDepths, withGroundReference, withKind, withLifecycle, withSection, withVertexDepth } from '../../engine/underground/alignmentFactory';
import { elevationProfile } from '../../engine/underground/terrainProfile';
import { useTerrainProfile } from './useTerrain';
import { CertaintyBadge } from '../ui/badges/CertaintyBadge';
import { CERTAINTY_OPTIONS, commitAlignment, field, input, inputStyle, lbl, labelStyle, note } from './common';

const cell: React.CSSProperties = { padding: '4px 3px' };
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

/** Section shape + dimension inputs; a blank dimension is UNKNOWN (null), never 0. */
export const SectionFields: React.FC<{ section: UndergroundSection; onChange: (s: UndergroundSection) => void; idBase: string }> = ({ section, onChange, idBase }) => (
  <div className="flex flex-col gap-2">
    <div className={field}>
      <label className={lbl} style={labelStyle} htmlFor={`${idBase}-shape`}>Cross-section</label>
      <select id={`${idBase}-shape`} data-testid={`${idBase}-shape`} className={input} style={inputStyle} value={section.shape}
        onChange={e => onChange(e.target.value === 'box'
          ? { shape: 'box', widthM: section.shape === 'circular' ? section.diameterM : section.widthM, heightM: section.shape === 'circular' ? section.diameterM : section.heightM }
          : { shape: 'circular', diameterM: section.shape === 'box' ? section.widthM : section.diameterM })}>
        <option value="circular">Circular (bored)</option>
        <option value="box">Box / rectangular</option>
      </select>
    </div>
    {section.shape === 'circular' ? (
      <div className={field}>
        <label className={lbl} style={labelStyle} htmlFor={`${idBase}-dia`}>Outer diameter (m)</label>
        <input id={`${idBase}-dia`} data-testid={`${idBase}-diameter`} type="number" min={0.1} step={0.1} placeholder="Unknown" className={input} style={inputStyle}
          value={section.diameterM ?? ''} onChange={e => onChange({ shape: 'circular', diameterM: num(e.target.value) })} />
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-2">
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor={`${idBase}-w`}>Width (m)</label>
          <input id={`${idBase}-w`} data-testid={`${idBase}-width`} type="number" min={0.1} step={0.1} placeholder="Unknown" className={input} style={inputStyle}
            value={section.widthM ?? ''} onChange={e => onChange({ ...section, widthM: num(e.target.value) })} />
        </div>
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor={`${idBase}-h`}>Height (m)</label>
          <input id={`${idBase}-h`} data-testid={`${idBase}-height`} type="number" min={0.1} step={0.1} placeholder="Unknown" className={input} style={inputStyle}
            value={section.heightM ?? ''} onChange={e => onChange({ ...section, heightM: num(e.target.value) })} />
        </div>
      </div>
    )}
  </div>
);

const CertaintySelect: React.FC<{ value: Certainty; onChange: (c: Certainty) => void; id: string; label: string; testId?: string; short?: boolean }> = ({ value, onChange, id, label, testId, short }) => (
  <select id={id} aria-label={label} data-testid={testId} className={input} style={short ? { ...inputStyle, width: 100, fontSize: 12 } : inputStyle} value={value} onChange={e => onChange(e.target.value as Certainty)}>
    {CERTAINTY_OPTIONS.filter(o => !short || o.value !== 'unknown').map(o => <option key={o.value} value={o.value}>{short ? o.label.split(' ')[0] : o.label}</option>)}
  </select>
);

/** Settings for the next alignment drawn with the Tunnel tool (EditingEngine.underground*). */
export const UndergroundToolSettings: React.FC = () => {
  const e = engineInstance.editing;
  const [, bump] = useState(0);
  const set = (fn: () => void) => { fn(); bump(n => n + 1); };
  return (
    <div className="flex flex-col gap-2" data-testid="underground-tool-settings">
      <div className={field}>
        <label className={lbl} style={labelStyle} htmlFor="ug-tool-kind">Alignment type</label>
        <select id="ug-tool-kind" data-testid="ug-tool-kind" className={input} style={inputStyle} value={e.undergroundKind}
          onChange={ev => set(() => e.setUndergroundKind(ev.target.value as UndergroundAlignmentKind))}>
          {ALIGNMENT_KINDS.map(k => <option key={k} value={k}>{ALIGNMENT_KIND_LABEL[k]}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="ug-tool-depth">Crown depth (m)</label>
          <input id="ug-tool-depth" data-testid="ug-tool-depth" type="number" min={0} step={0.5} placeholder="Unknown" className={input} style={inputStyle}
            value={e.undergroundCrownDepthM ?? ''} onChange={ev => set(() => { e.undergroundCrownDepthM = cleanDepth(num(ev.target.value)); })} />
        </div>
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="ug-tool-depth-cert">Depth is <CertaintyBadge certainty={e.undergroundCrownDepthM === null ? 'unknown' : e.undergroundDepthCertainty} compact /></label>
          <CertaintySelect id="ug-tool-depth-cert" label="Depth certainty" value={e.undergroundDepthCertainty} onChange={c => set(() => { e.undergroundDepthCertainty = c; })} testId="ug-tool-depth-certainty" />
        </div>
      </div>
      <SectionFields idBase="ug-tool-section" section={e.undergroundSection} onChange={s => set(() => { e.undergroundSection = s; })} />
      <div className={field}>
        <label className={lbl} style={labelStyle} htmlFor="ug-tool-sec-cert">Section is <CertaintyBadge certainty={e.undergroundSectionCertainty} compact /></label>
        <CertaintySelect id="ug-tool-sec-cert" label="Section certainty" value={e.undergroundSectionCertainty} onChange={c => set(() => { e.undergroundSectionCertainty = c; })} />
      </div>
      <p className="text-[11px]" style={note}>Defaults per type are drawing placeholders, not standards. Depth is below the ground: the Copernicus GLO-30 DSM where it covers the alignment (screening only; buildings/trees included), else a flat datum labelled UNKNOWN. Set each vertex's depth after drawing.</p>
    </div>
  );
};

const LIFECYCLE_OPTIONS: { value: UndergroundLifecycle; label: string }[] = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'conceptual', label: 'Conceptual / illustrative' },
  { value: 'existing', label: 'Existing (entered from records)' },
];

/** Ground at each vertex from the DSM, with the model label (null while loading / unavailable). */
function useVertexGround(a: UndergroundAlignmentObject) {
  const terrain = useTerrainProfile(a.coordinates);
  return useMemo(() => {
    if (terrain.state !== 'ok' || terrain.data.summary.n_ok === 0) return { state: terrain.state, ground: null, model: null, error: terrain.state === 'error' ? terrain.error : null };
    const ds = terrain.data.dataset;
    const model = `Copernicus GLO-30 ${ds.surface} ${ds.version}${ds.dataset_version_id ? ` (${ds.dataset_version_id})` : ''}`;
    return { state: 'ok' as const, ground: elevationProfile(a, terrain.data).vertices.map(v => v.groundM), model, error: null };
  }, [terrain, a]);
}

/** The one editor for an alignment (Underground panel; the Design inspector shows it only in Design): status, type, section, depths. */
export const AlignmentEditor: React.FC<{ a: UndergroundAlignmentObject }> = ({ a }) => {
  const p = alignmentProfile(a);
  const [allDepth, setAllDepth] = useState('');
  const g = useVertexGround(a);
  // Every depth edit also stores the crown elevation, datum, ground level and ground model used (research §2.3)
  const commit = (after: UndergroundAlignmentObject, what: string, key?: string) =>
    commitAlignment(a, g.ground && g.model ? withGroundReference(after, g.ground, g.model) : after, what, key);
  // Alignments drawn before the ground was known get their elevations once it is (derived data, no undo entry;
  // only in the alternative the object belongs to, so viewing never creates a copy-on-write change)
  useEffect(() => {
    if (!g.ground || !g.model || a.scenarioId !== engineInstance.scenarios.getActiveScenarioId()) return;
    const next = withGroundReference(a, g.ground, g.model);
    if (next !== a) engineInstance.objects.update(a.id, { depths: next.depths } as Partial<CityObject>);
  }, [a, g.ground, g.model]);
  const lifecycle = a.lifecycle ?? 'proposed';
  return (
    <div className="flex flex-col gap-3" data-testid="alignment-editor">
      <div className="grid grid-cols-2 gap-2">
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="ug-lifecycle">Status</label>
          <select id="ug-lifecycle" data-testid="ug-lifecycle" className={input} style={inputStyle} value={lifecycle}
            onChange={e => commit(withLifecycle(a, e.target.value as UndergroundLifecycle), 'Change status')}>
            {LIFECYCLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className={field}>
          <label className={lbl} style={labelStyle} htmlFor="ug-kind">Type</label>
          <select id="ug-kind" data-testid="ug-kind" className={input} style={inputStyle} value={a.alignmentKind}
            onChange={e => commit(withKind(a, e.target.value as UndergroundAlignmentKind), 'Change alignment type')}>
            {ALIGNMENT_KINDS.map(k => <option key={k} value={k}>{ALIGNMENT_KIND_LABEL[k]}</option>)}
          </select>
        </div>
      </div>
      <div className="text-label text-text-2">Length <span className="tabular-nums text-text-1">{Math.round(p.lengthM).toLocaleString('en-IN')} m</span> (plan)</div>
      <SectionFields idBase="ug-section" section={a.section} onChange={s => commit(withSection(a, s), 'Edit cross-section', `${a.id}:section`)} />
      <div className={field}>
        <label className={lbl} style={labelStyle} htmlFor="ug-sec-cert">Section is <CertaintyBadge certainty={a.sectionCertainty} compact /></label>
        <CertaintySelect id="ug-sec-cert" label="Section certainty" value={a.sectionCertainty} onChange={c => commit(withSection(a, a.section, c), 'Section certainty')} />
      </div>
      <div className="uos-card text-meta text-text-2 flex flex-col gap-0.5" data-testid="ug-depth-reference">
        <span className="text-label text-text-1">Depth reference</span>
        {g.state === 'ok' && g.model ? (
          <>
            <span>Depth = top of the structure (crown), metres below ground. Ground = {g.model}, m EGM2008.</span>
            <span className="text-warn">This ground model is a surface model: it includes roofs and trees (about ±2–4 m in the open), so treat cover as screening only.</span>
          </>
        ) : g.state === 'error'
          ? <span className="text-unknown">Ground level UNKNOWN (terrain service unavailable: {g.error}). Depths are below an unknown ground; no elevations stored.</span>
          : g.state === 'ok'
            ? <span className="text-unknown">Ground level UNKNOWN here (outside the ground model). Depths are below an unknown ground.</span>
            : <span>Loading ground levels…</span>}
      </div>
      <div>
        <div className="flex items-end gap-2 mb-1">
          <div className={`${field} flex-1`}>
            <label className={lbl} style={labelStyle} htmlFor="ug-all-depth">Set all depths (m below ground)</label>
            <input id="ug-all-depth" data-testid="ug-all-depth" type="number" min={0} step={0.5} placeholder="crown depth" className={input} style={inputStyle} value={allDepth} onChange={e => setAllDepth(e.target.value)} />
          </div>
          <button type="button" className="uos-btn uos-btn-sm" data-testid="ug-apply-all-depth" disabled={allDepth.trim() === '' || cleanDepth(Number(allDepth)) === null}
            onClick={() => { commit(withAllDepths(a, Number(allDepth), 'hypothetical'), 'Set all depths'); setAllDepth(''); }}>Apply</button>
        </div>
        <table className="uos-table ug-vertex-table" data-testid="ug-vertex-table">
          <thead><tr><th style={cell}>#</th><th className="num" style={cell}>Chainage · grade</th><th style={cell}>Depth ↓ (m)</th><th style={cell}>Certainty</th></tr></thead>
          <tbody>
            {p.vertices.map((v, i) => {
              const gr = g.ground?.[i] ?? null;
              const elev = v.crownDepthM !== null && gr !== null ? gr - v.crownDepthM : null;
              return (
                <tr key={i}>
                  <td style={cell}>{i + 1}</td>
                  <td className="num" style={cell} title="Grade = Δcrown / Δchainage to the next vertex; + = getting deeper">
                    {Math.round(v.chainageM)} m
                    {i < p.gradientsPct.length && <span className="block text-meta text-text-3">{p.gradientsPct[i] === null ? 'grade ?' : `${(p.gradientsPct[i] as number) >= 0 ? '+' : ''}${(p.gradientsPct[i] as number).toFixed(2)} %`}</span>}
                  </td>
                  <td style={cell}>
                    <input aria-label={`Crown depth below ground at vertex ${i + 1} (m)`} data-testid={`ug-depth-${i}`} type="number" min={0} step={0.5} placeholder="?" title="Blank = Unknown"
                      className={input} style={{ ...inputStyle, width: 70, fontSize: 12 }} value={v.crownDepthM ?? ''}
                      onChange={e => commit(withVertexDepth(a, i, { crownDepthM: num(e.target.value) }), `Depth at vertex ${i + 1}`, `${a.id}:depth:${i}`)} />
                    <span className="block text-meta text-text-3 tabular-nums" data-testid={`ug-elev-${i}`}
                      title={gr === null ? 'Ground UNKNOWN here' : `Ground ${gr.toFixed(1)} m EGM2008 (DSM) − depth`}>
                      {elev === null ? (v.crownDepthM === null ? 'elev ?' : 'ground ?') : `${elev.toFixed(1)} m EGM2008`}
                    </span>
                  </td>
                  <td style={cell}>
                    {v.crownDepthM === null ? <CertaintyBadge certainty="unknown" note="No depth entered" /> : (
                      <CertaintySelect id={`ug-cert-${i}`} label={`Depth certainty at vertex ${i + 1}`} testId={`ug-cert-${i}`} short value={v.certainty}
                        onChange={c => commit(withVertexDepth(a, i, { certainty: c }), `Depth certainty at vertex ${i + 1}`)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[11px] mt-1" style={note}>Under each depth: the crown elevation it gives (ground − depth), stored with the ground level and model used. Blank depth = Unknown: never interpolated across, shown as "?" on the Profile.</p>
      </div>
    </div>
  );
};
