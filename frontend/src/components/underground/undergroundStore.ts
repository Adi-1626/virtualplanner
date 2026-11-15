import { create } from 'zustand';
import type { CoordinationRun, ProposalElement, SubsurfaceDataset, SubsurfaceRecord } from '../../lib/coordinationApi';

/** UI state of the Underground workspace (docs/urbanos/UNDERGROUND_WORKSPACE.md). Objects themselves live in the engine. */
export interface UndergroundUiState {
  /** Alignment the profile / section / conflict check work on (an object id in the active alternative). */
  activeId: string | null;
  /** Chainage (m) of the cross-section. */
  sectionChainageM: number;
  /** Half-width (m) of the cross-section window. */
  sectionHalfWidthM: number;
  records: SubsurfaceRecord[];
  datasets: SubsurfaceDataset[];
  recordsState: 'idle' | 'loading' | 'loaded' | 'error';
  recordsError: string | null;
  /** Area the records are listed for [W,S,E,N] (the work area); null = none yet (zoomed out too far / map not ready). */
  recordsArea: [number, number, number, number] | null;
  /** What the area is: around the alignments, or the current map view. */
  recordsAreaSource: 'alignments' | 'view' | null;
  /** Why no area could be chosen (e.g. zoomed out). */
  recordsAreaNote: string | null;
  /** Last conflict check per alignment id: the element registered and the detection run. */
  checks: Record<string, { projectId: string; element: ProposalElement; run: CoordinationRun; at: string }>;
  setActive: (id: string | null) => void;
  setSectionChainage: (m: number) => void;
  setSectionHalfWidth: (m: number) => void;
  setRecords: (p: Partial<Pick<UndergroundUiState, 'records' | 'datasets' | 'recordsState' | 'recordsError' | 'recordsArea' | 'recordsAreaSource' | 'recordsAreaNote'>>) => void;
  setCheck: (alignmentId: string, c: UndergroundUiState['checks'][string]) => void;
}

export const useUndergroundStore = create<UndergroundUiState>(set => ({
  activeId: null,
  sectionChainageM: 0,
  sectionHalfWidthM: 30,
  records: [],
  datasets: [],
  recordsState: 'idle',
  recordsError: null,
  recordsArea: null,
  recordsAreaSource: null,
  recordsAreaNote: null,
  checks: {},
  setActive: id => set(s => (s.activeId === id ? s : { activeId: id, sectionChainageM: 0 })),
  setSectionChainage: m => set({ sectionChainageM: Number.isFinite(m) && m >= 0 ? m : 0 }),
  setSectionHalfWidth: m => set({ sectionHalfWidthM: Number.isFinite(m) && m > 0 ? Math.min(m, 500) : 30 }),
  setRecords: p => set(p),
  setCheck: (id, c) => set(s => ({ checks: { ...s.checks, [id]: c } })),
}));
