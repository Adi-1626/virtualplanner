import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cable, CircleHelp, FlaskConical, Redo2, Search, ShieldQuestion, TrainFrontTunnel, Undo2 } from 'lucide-react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { CityObject, UndergroundAlignmentObject, UtilityObject } from '../../engine/objects/types';
import { PanelSection } from '../../components/ui/Panel';
import { EmptyState } from '../../components/ui/EmptyState';
import { Disclosure } from '../../components/ui/Disclosure';
import { CertaintyBadge } from '../../components/ui/badges/CertaintyBadge';
import { useEngineObjects } from '../useEngineObjects';
import { dualOverlay, useShellStore } from '../useShellStore';
import { lengthM } from './geo';
import { UTILITY_LABEL } from './utilityCertainty';
import { STATUS_LABEL, utilitySummary } from '../../engine/underground/utilityModel';

const topText = (s: ReturnType<typeof utilitySummary>) => (s.minTopM === null ? 'Unknown' : s.minTopM === s.maxTopM ? `${s.minTopM.toFixed(2)} m` : `${s.minTopM.toFixed(2)}–${(s.maxTopM as number).toFixed(2)} m`);
import { ALIGNMENT_KIND_LABEL, alignmentProfile, alignmentRowSummary, worstCertainty } from '../../engine/underground/alignmentGeometry';
import { useActiveAlignment, useSelectedId } from '../../components/underground/common';
import { useUndergroundStore } from '../../components/underground/undergroundStore';
import { AlignmentEditor } from '../../components/underground/AlignmentForms';
import { ViewControls } from '../../components/underground/ViewControls';
import { SubsurfaceRecords } from '../../components/underground/SubsurfaceRecords';
import { useSubsurfaceRecords } from '../../components/underground/useSubsurfaceRecords';
import { ToolSettings } from '../../components/design/ToolSettings';
import type { EditingMode } from '../../engine/editing/EditingEngine';
import { alignmentsRect } from '../../engine/underground/viewRect';
import { summariseRecords } from '../../engine/underground/recordsSummary';
import { isUnmappedMetroTunnel, unmappedUndergroundStation } from '../../engine/underground/metroLevel';
import { UndergroundLegend, type LegendCounts } from '../../components/underground/UndergroundLegend';
import { ConflictCheck } from '../../components/underground/ConflictCheck';

const isUtility = (o: CityObject): o is UtilityObject => o.type === 'utility';

export const CertaintyText: React.FC<{ level: 'hypothetical' | 'unknown'; why: string }> = ({ level, why }) => (
  <span className={`inline-flex items-center gap-1 text-meta font-medium ${level === 'unknown' ? 'text-unknown' : 'text-hypothetical'}`} title={why}>
    {level === 'unknown' ? <CircleHelp size={12} aria-hidden /> : <FlaskConical size={12} aria-hidden />}
    {level === 'unknown' ? 'Unknown' : 'Hypothetical'}
  </span>
);

const focus = (id: string) => { engineInstance.selection.selectSingle(id); engineInstance.flyToObject(id); };

/** The utility table for the bottom drawer (same data as the context list, with every column). */
export const UtilityTable: React.FC = () => {
  const utils = useEngineObjects(isUtility);
  if (utils.length === 0) return <p className="text-label text-text-2">No utilities in this alternative.</p>;
  return (
    <table className="uos-table" data-testid="utility-table">
      <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Evidence</th><th className="num">Top of pipe (m below ground)</th><th className="num">Ø (mm)</th><th className="num">Length (m)</th><th>Depth</th></tr></thead>
      <tbody>
        {utils.map(u => {
          const s = utilitySummary(u);
          const len = lengthM(u.coordinates);
          return (
            <tr key={u.id} onClick={() => focus(u.id)} className="cursor-pointer" data-testid={`utility-row-${u.id}`}>
              <td>{u.name || 'Utility'}</td>
              <td>{UTILITY_LABEL[u.utilityType] ?? u.utilityType}</td>
              <td>{STATUS_LABEL[s.z.status]}</td>
              <td>{s.z.evidence === 'user-drawn' ? 'User-drawn' : s.z.evidence === 'unknown' ? 'Unknown' : s.z.evidence}</td>
              <td className="num">{topText(s)}{s.defaults ? ' (default — adjust)' : ''}</td>
              <td className="num">{u.diameterMm ?? 'Unknown'}</td>
              <td className="num">{len == null ? '—' : Math.round(len).toLocaleString('en-IN')}</td>
              <td><CertaintyBadge certainty={worstCertainty(s.z.depths.map(d => d.certainty))} compact /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const AlignmentList: React.FC = () => {
  const { alignments, active } = useActiveAlignment();
  const setActive = useUndergroundStore(s => s.setActive);
  if (alignments.length === 0) {
    return (
      <div className="flex items-center gap-2 text-label text-text-2" data-testid="ug-alignments-empty">
        <span className="flex-1">None in this alternative yet.</span>
        <button type="button" className="uos-btn uos-btn-sm" onClick={() => engineInstance.editing.setMode('draw_underground')} data-testid="ug-alignments-draw">
          <TrainFrontTunnel size={14} aria-hidden /> Draw
        </button>
      </div>
    );
  }
  return (
    <ul className="space-y-1" data-testid="underground-alignments">
      {alignments.map(a => {
        const p = alignmentProfile(a);
        const cert = worstCertainty(p.vertices.map(v => v.certainty));
        return (
          <li key={a.id}>
            <button type="button" aria-pressed={active?.id === a.id} className="uos-row w-full text-left" data-testid={`ug-alignment-${a.id}`}
              style={active?.id === a.id ? { background: 'var(--surface-2)' } : undefined}
              onClick={() => {
                setActive(a.id);
                // Where only one overlay fits (phone, narrow tablet), selecting would swap this panel for the inspector, so just fly there
                const st = useShellStore.getState();
                if (dualOverlay(st.viewport, st.width, st.workspace)) engineInstance.selection.selectSingle(a.id);
                engineInstance.flyToObject(a.id);
                st.setDrawerOpen(true);
              }}>
              <TrainFrontTunnel size={16} aria-hidden className="text-text-2 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-body text-text-1 truncate">{a.name}</span>
                <span className="block text-meta text-text-2">{alignmentRowSummary(ALIGNMENT_KIND_LABEL[a.alignmentKind], p)}</span>
              </span>
              <CertaintyBadge certainty={cert} compact />
            </button>
          </li>
        );
      })}
    </ul>
  );
};

function useEditingMode(): EditingMode {
  const [m, setM] = useState<EditingMode>(() => engineInstance.editing.getMode());
  useEffect(() => engineInstance.editing.onChange(() => setM(engineInstance.editing.getMode())), []);
  return m;
}

function useHistoryState() {
  const [s, setS] = useState(() => ({ undo: engineInstance.history.canUndo(), redo: engineInstance.history.canRedo() }));
  useEffect(() => engineInstance.history.onChange(() => setS({ undo: engineInstance.history.canUndo(), redo: engineInstance.history.canRedo() })), []);
  return s;
}

const DRAW_HINT: Partial<Record<EditingMode, string>> = {
  draw_underground: 'Click plan points on the map, double-click (or Enter) to finish. Esc cancels. Depth and size below apply to the new alignment; you can change them per vertex afterwards.',
  draw_utility: 'Click points along the pipe or cable, double-click (or Enter) to finish. Esc cancels.',
};

/** First-time entry: what this workspace is for, as three actions (UNDERGROUND_AUDIT F3). */
const GetStarted: React.FC<{ onLook: () => void }> = ({ onLook }) => (
  <div className="uos-card flex flex-col gap-2" data-testid="ug-get-started">
    <p className="text-body text-text-1">1 · See what is already recorded underground here. 2 · Sketch a proposed tunnel or utility and set its depth. 3 · Check it for conflicts.</p>
    <div className="flex flex-col gap-1.5">
      <button type="button" className="uos-btn justify-start" data-testid="ug-start-look" onClick={onLook}>
        <Search size={14} aria-hidden /> See existing records in this view
      </button>
      <button type="button" className="uos-btn justify-start" data-testid="underground-draw-alignment" onClick={() => engineInstance.editing.setMode('draw_underground')}>
        <TrainFrontTunnel size={14} aria-hidden /> Draw a proposed tunnel or metro
      </button>
      <button type="button" className="uos-btn justify-start" data-testid="ug-start-utility" onClick={() => engineInstance.editing.setMode('draw_utility')}>
        <Cable size={14} aria-hidden /> Lay a proposed pipe or cable
      </button>
    </div>
    <p className="text-meta text-text-3">Depths are metres below ground. Results are screening only, never an engineering approval.</p>
  </div>
);

/** Counts the legend can show from what the panel already holds (records in the work area, alignments, utilities, metro). */
function useLegendCounts(alignments: UndergroundAlignmentObject[], utils: UtilityObject[]): LegendCounts {
  const all = useEngineObjects();
  const records = useUndergroundStore(s => s.records);
  const datasets = useUndergroundStore(s => s.datasets);
  const recordsState = useUndergroundStore(s => s.recordsState);
  const recordCounts = useMemo(() => (recordsState === 'loaded'
    ? Object.fromEntries(summariseRecords(records, datasets).map(l => [l.key, l.inArea])) as LegendCounts['records'] : undefined), [records, datasets, recordsState]);
  // metro objects change rarely: recount only when the set of metro ids changes (the panel re-renders often)
  const metro = all.filter(o => o.type === 'metro_line' || o.type === 'metro_station');
  const metroKey = metro.map(o => o.id).join(',');
  const metroCounts = useMemo(() => {
    const tunnels = metro.filter(isUnmappedMetroTunnel);
    return { metroTunnels: tunnels.length, metroStations: metro.filter(o => o.type === 'metro_station' && unmappedUndergroundStation(o, tunnels) !== null).length };
  }, [metroKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const count = <K extends string>(keys: K[]) => keys.reduce<Partial<Record<K, number>>>((m, k) => { m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return { records: recordCounts, alignments: count(alignments.map(a => a.alignmentKind)), utilities: count(utils.map(u => u.utilityType)), ...metroCounts };
}

function useLayerVisible(id: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => engineInstance.layers.isVisible(id));
  useEffect(() => engineInstance.layers.onChange(() => setV(engineInstance.layers.isVisible(id))), [id]);
  return [v, (on: boolean) => engineInstance.layers.setVisibility(id, on)];
}

/**
 * Underground workspace (docs/urbanos/UNDERGROUND_WORKSPACE.md, UNDERGROUND_AUDIT.md): get-started actions, view and
 * cutaway, what is already recorded here, the proposed alignments with their single editor, conflict check, drawn utilities.
 */
export const UndergroundContext: React.FC = () => {
  const utils = useEngineObjects(isUtility);
  const { alignments, active } = useActiveAlignment();
  const selectedId = useSelectedId();
  const selectedUtil = utils.find(u => u.id === selectedId) ?? null;
  const mode = useEditingMode();
  const hist = useHistoryState();
  const legendCounts = useLegendCounts(alignments, utils);
  const [metroOn, setMetroOn] = useLayerVisible('metro');
  const { reload } = useSubsurfaceRecords();
  const recordsRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLDivElement>(null);
  // The records follow the work area: re-list when the alignments' extent changes
  const rectKey = alignmentsRect([...alignments, ...utils], 250)?.map(v => v.toFixed(4)).join(',') ?? '';
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } void reload(); }, [rectKey, reload]);
  const drawing = mode === 'draw_underground' || mode === 'draw_utility';
  // Finishing a line in Underground ends the drawing and opens the new object's editor (one at a time here,
  // unlike Design's stay-active tools), so the depth/size editing is the obvious next step
  const known = useRef<Set<string> | null>(null);
  const idsKey = [...alignments.map(a => a.id), ...utils.map(u => u.id)].join(',');
  useEffect(() => {
    const ids = new Set(idsKey ? idsKey.split(',') : []);
    const prev = known.current;
    known.current = ids;
    if (!prev) return;
    const added = [...ids].filter(id => !prev.has(id));
    if (added.length !== 1 || useShellStore.getState().workspace !== 'underground') return;
    const m = engineInstance.editing.getMode();
    if (m !== 'draw_underground' && m !== 'draw_utility') return;
    engineInstance.editing.setMode('select');
    const id = added[0];
    if (alignments.some(a => a.id === id)) useUndergroundStore.getState().setActive(id);
    engineInstance.selection.selectSingle(id);
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = () => { void reload(); recordsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1.5" data-testid="ug-history">
        <button type="button" className="uos-btn uos-btn-sm" disabled={!hist.undo} onClick={() => engineInstance.history.undo()} data-testid="ug-undo" title="Undo (Ctrl+Z)"><Undo2 size={14} aria-hidden /> Undo</button>
        <button type="button" className="uos-btn uos-btn-sm" disabled={!hist.redo} onClick={() => engineInstance.history.redo()} data-testid="ug-redo" title="Redo (Ctrl+Y)"><Redo2 size={14} aria-hidden /> Redo</button>
        <span className="flex-1" />
        {(alignments.length > 0 || utils.length > 0) && (
          <button type="button" className="uos-btn uos-btn-sm uos-btn-primary" data-testid="ug-goto-check" title="Screen your proposed objects against existing records, metro and buildings"
            onClick={() => checkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <ShieldQuestion size={14} aria-hidden /> Check conflicts
          </button>
        )}
      </div>
      {drawing && (
        <PanelSection title={mode === 'draw_underground' ? 'Drawing a proposed alignment' : 'Laying a proposed utility'}>
          <div className="flex flex-col gap-2" data-testid="ug-drawing">
            <p className="text-label text-text-2">{DRAW_HINT[mode]}</p>
            <ToolSettings mode={mode} />
            <button type="button" className="uos-btn uos-btn-sm self-start" onClick={() => { engineInstance.editing.cancelDrawing(); engineInstance.editing.setMode('select'); }} data-testid="ug-draw-cancel">Stop drawing</button>
          </div>
        </PanelSection>
      )}
      {!drawing && alignments.length === 0 && utils.length === 0 && <GetStarted onLook={look} />}
      <PanelSection title="View">
        <ViewControls alignments={alignments} utilities={utils} />
        {/* open by default in Underground: the colour key is how the 3D view is read (UNDERGROUND_VISUAL_FIXES.md) */}
        <Disclosure summary="Legend" open data-testid="ug-legend-disclosure">
          <UndergroundLegend counts={legendCounts} metroLayer={{ visible: metroOn, onToggle: setMetroOn }} />
        </Disclosure>
      </PanelSection>
      <PanelSection title="Proposed alignments" aside={`${alignments.length}`}>
        <AlignmentList />
        {alignments.length > 0 && !drawing && (
          <button type="button" className="uos-btn uos-btn-sm" onClick={() => engineInstance.editing.setMode('draw_underground')} data-testid="underground-draw-another">
            <TrainFrontTunnel size={14} aria-hidden /> Draw another
          </button>
        )}
      </PanelSection>
      <div ref={checkRef} data-testid="ug-check-section">
        <PanelSection title="Check for conflicts">
          <ConflictCheck a={active} />
        </PanelSection>
      </div>
      {selectedUtil ? (
        <PanelSection title={`Selected · ${selectedUtil.name || 'Utility'}`}>
          <p className="text-label text-text-2" data-testid="ug-utility-selected-note">A drawn utility is selected: edit its depths, status and evidence in the inspector on the right. The Profile and Cross-section below show this utility. Select an alignment to edit it here.</p>
        </PanelSection>
      ) : active && (
        <PanelSection title={`Edit · ${active.name}`}>
          <AlignmentEditor key={active.id} a={active} />
        </PanelSection>
      )}
      <div ref={recordsRef}>
        <PanelSection title="Already recorded here">
          <SubsurfaceRecords />
        </PanelSection>
      </div>
      <PanelSection title="Utilities drawn in this alternative" aside={`${utils.length}`}>
        {utils.length === 0 ? (
          <EmptyState icon={Cable} title="No utilities drawn in this alternative"
            action={{ label: 'Lay a pipe or cable', onClick: () => engineInstance.editing.setMode('draw_utility'), 'data-testid': 'underground-draw-utility' }}>
            Your own utility lines (proposed). Existing records are under "Already recorded here".
          </EmptyState>
        ) : (
          <ul className="space-y-1" data-testid="underground-utilities">
            {utils.map(u => {
              const s = utilitySummary(u);
              return (
                <li key={u.id}>
                  <button type="button" onClick={() => focus(u.id)} className="uos-row w-full text-left" data-testid={`ug-utility-${u.id}`}>
                    <Cable size={16} aria-hidden className="text-text-2 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-text-1 truncate">{u.name || 'Utility'}</span>
                      <span className="block text-meta text-text-2">
                        {UTILITY_LABEL[u.utilityType] ?? u.utilityType} · {STATUS_LABEL[s.z.status].toLowerCase()} · <span className="tabular-nums">top {topText(s)} below ground</span>
                        {s.defaults ? <span className="text-warn"> (default — adjust)</span> : ''}
                      </span>
                    </span>
                    <CertaintyBadge certainty={worstCertainty(s.z.depths.map(d => d.certainty))} compact />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {utils.length > 0 && !drawing && (
          <button type="button" className="uos-btn uos-btn-sm self-start" onClick={() => engineInstance.editing.setMode('draw_utility')} data-testid="underground-draw-utility">
            <Cable size={14} aria-hidden /> Lay another pipe or cable
          </button>
        )}
      </PanelSection>
      <Disclosure>
        <p className="text-label text-text-2">Depth = metres below ground, positive down. In the 3D view ground is the scene ground (flat when no terrain service is available; each buried object is drawn at its typed depth below it at every point); in the Profile and the editor it is the Copernicus GLO-30 DSM v3 (m EGM2008; a surface model that includes roofs and trees, ±2–4 m, screening only), so "below ground" can be measured from a rooftop. Where the DSM does not cover a point its ground is UNKNOWN. Geology between boreholes, settlement, structural adequacy and engineering clearances are not modelled. PMC sewer levels are published design values without a stated vertical datum (QL-D).</p>
      </Disclosure>
    </div>
  );
};
