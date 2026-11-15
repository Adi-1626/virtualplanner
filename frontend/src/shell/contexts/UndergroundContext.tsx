import React, { useEffect, useRef, useState } from 'react';
import { Cable, CircleHelp, FlaskConical, Redo2, Search, TrainFrontTunnel, Undo2 } from 'lucide-react';
import { engineInstance } from '../../engine/TwinCityEngine';
import type { CityObject, UtilityObject } from '../../engine/objects/types';
import { PanelSection } from '../../components/ui/Panel';
import { EmptyState } from '../../components/ui/EmptyState';
import { Disclosure } from '../../components/ui/Disclosure';
import { CertaintyBadge } from '../../components/ui/badges/CertaintyBadge';
import { useEngineObjects } from '../useEngineObjects';
import { dualOverlay, useShellStore } from '../useShellStore';
import { lengthM } from './geo';
import { DEFAULT_DEPTH_M, UTILITY_LABEL, utilityCertainty } from './utilityCertainty';
import { ALIGNMENT_KIND_LABEL, alignmentProfile, alignmentRowSummary, worstCertainty } from '../../engine/underground/alignmentGeometry';
import { useActiveAlignment } from '../../components/underground/common';
import { useUndergroundStore } from '../../components/underground/undergroundStore';
import { AlignmentEditor } from '../../components/underground/AlignmentForms';
import { ViewControls } from '../../components/underground/ViewControls';
import { SubsurfaceRecords } from '../../components/underground/SubsurfaceRecords';
import { useSubsurfaceRecords } from '../../components/underground/useSubsurfaceRecords';
import { ToolSettings } from '../../components/design/ToolSettings';
import type { EditingMode } from '../../engine/editing/EditingEngine';
import { alignmentsRect } from '../../engine/underground/viewRect';
import { RECORD_COLOR } from '../../engine/underground/UndergroundRenderer';
import { LAYER_LABEL } from '../../engine/underground/recordsSummary';
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
      <thead><tr><th>Name</th><th>Type</th><th className="num">Depth (m)</th><th className="num">Length (m)</th><th className="num">Capacity</th><th>Certainty</th></tr></thead>
      <tbody>
        {utils.map(u => {
          const c = utilityCertainty(u);
          const len = lengthM(u.coordinates);
          return (
            <tr key={u.id} onClick={() => focus(u.id)} className="cursor-pointer">
              <td>{u.name || 'Utility'}</td>
              <td>{UTILITY_LABEL[u.utilityType] ?? u.utilityType}</td>
              <td className="num">{Number.isFinite(u.depth) ? u.depth.toFixed(1) : '—'}{u.depth === DEFAULT_DEPTH_M ? ' (default)' : ''}</td>
              <td className="num">{len == null ? '—' : Math.round(len).toLocaleString('en-IN')}</td>
              <td className="num" title="Capacity units as entered; no unit is defined in the model">{u.capacity}</td>
              <td><CertaintyText {...c} /></td>
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
    <p className="text-body text-text-1">Check what is already underground here, then sketch a proposal and inspect its depth.</p>
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

/** Line style = status, colour = type, opacity = evidence (research §5). */
const Legend: React.FC = () => (
  <div className="flex flex-col gap-1 text-meta text-text-2" data-testid="ug-legend">
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="3" /></svg>Existing (records)</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="3" strokeDasharray="6 3" /></svg>Proposed</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="3" strokeDasharray="1.5 3" /></svg>Conceptual</span>
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {(['sewer', 'storm_drain', 'water', 'power', 'gas', 'telecom'] as const).map(k => (
        <span key={k} className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: RECORD_COLOR[k] }} aria-hidden />{LAYER_LABEL[k]}</span>
      ))}
    </div>
    <div className="text-text-3">Paler = less certain (records only, QL-D, or user-drawn). Records with no depth are drawn on the surface, not at a guessed depth.</div>
  </div>
);

/**
 * Underground workspace (docs/urbanos/UNDERGROUND_WORKSPACE.md, UNDERGROUND_AUDIT.md): get-started actions, view and
 * cutaway, what is already recorded here, the proposed alignments with their single editor, conflict check, drawn utilities.
 */
export const UndergroundContext: React.FC = () => {
  const utils = useEngineObjects(isUtility);
  const { alignments, active } = useActiveAlignment();
  const mode = useEditingMode();
  const hist = useHistoryState();
  const { reload } = useSubsurfaceRecords();
  const recordsRef = useRef<HTMLDivElement>(null);
  // The records follow the work area: re-list when the alignments' extent changes
  const rectKey = alignmentsRect(alignments, 250)?.map(v => v.toFixed(4)).join(',') ?? '';
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
        <span className="text-meta text-text-3 ml-auto">Changes save automatically</span>
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
        <ViewControls alignments={alignments} />
        <Disclosure summary="Legend"><Legend /></Disclosure>
      </PanelSection>
      <PanelSection title="Proposed alignments" aside={`${alignments.length}`}>
        <AlignmentList />
        {alignments.length > 0 && !drawing && (
          <button type="button" className="uos-btn uos-btn-sm" onClick={() => engineInstance.editing.setMode('draw_underground')} data-testid="underground-draw-another">
            <TrainFrontTunnel size={14} aria-hidden /> Draw another
          </button>
        )}
      </PanelSection>
      {active && (
        <PanelSection title={`Edit · ${active.name}`}>
          <AlignmentEditor key={active.id} a={active} />
        </PanelSection>
      )}
      {active && (
        <PanelSection title="Conflict check">
          <ConflictCheck key={active.id} a={active} />
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
              const c = utilityCertainty(u);
              return (
                <li key={u.id}>
                  <button type="button" onClick={() => focus(u.id)} className="uos-row w-full text-left">
                    <Cable size={16} aria-hidden className="text-text-2 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-text-1 truncate">{u.name || 'Utility'}</span>
                      <span className="block text-meta text-text-2">
                        {UTILITY_LABEL[u.utilityType] ?? u.utilityType} · <span className="tabular-nums">{Number.isFinite(u.depth) ? `${u.depth.toFixed(1)} m below ground` : 'depth —'}</span>
                        {u.depth === DEFAULT_DEPTH_M ? ' (drawing default)' : ''}
                      </span>
                    </span>
                    <CertaintyText {...c} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PanelSection>
      <Disclosure>
        <p className="text-label text-text-2">Depth = metres below ground, positive down. In the 3D view ground is the scene ground; in the Profile and the editor it is the Copernicus GLO-30 DSM v3 (m EGM2008; a surface model that includes roofs and trees, ±2–4 m, screening only), so "below ground" can be measured from a rooftop. Where the DSM does not cover a point its ground is UNKNOWN. Geology between boreholes, settlement, structural adequacy and engineering clearances are not modelled. PMC sewer levels are published design values without a stated vertical datum (QL-D).</p>
      </Disclosure>
    </div>
  );
};
