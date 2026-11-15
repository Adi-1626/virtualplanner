import { create } from 'zustand';
import type { ScreeningRun } from '../../lib/coordinationApi';

/** Last underground screening per alternative (kept across panel remounts), and the finding being looked at. */
export interface ScreeningState {
  runs: Record<string, { run: ScreeningRun; at: string }>;
  selectedFindingId: string | null;
  setRun: (scenarioId: string, run: ScreeningRun) => void;
  select: (id: string | null) => void;
}

export const useScreeningStore = create<ScreeningState>(set => ({
  runs: {},
  selectedFindingId: null,
  setRun: (sid, run) => set(s => ({ runs: { ...s.runs, [sid]: { run, at: new Date().toISOString() } }, selectedFindingId: null })),
  select: id => set({ selectedFindingId: id }),
}));
