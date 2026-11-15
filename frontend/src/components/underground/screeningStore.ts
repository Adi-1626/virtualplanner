import { create } from 'zustand';
import type { ScreeningRun } from '../../lib/coordinationApi';

/** Where a shown result came from: this session's check, or the last saved run reopened (stale = objects / records changed since). */
export interface RunOrigin { restored: boolean; stale: boolean; staleReasons: string[]; /** when the stale verdict was made (later edits → stale) */ comparedAt: string }

/** Last underground screening per alternative (kept across panel remounts), and the finding being looked at. */
export interface ScreeningState {
  runs: Record<string, { run: ScreeningRun; at: string; origin?: RunOrigin }>;
  selectedFindingId: string | null;
  setRun: (scenarioId: string, run: ScreeningRun, origin?: RunOrigin, at?: string) => void;
  select: (id: string | null) => void;
}

export const useScreeningStore = create<ScreeningState>(set => ({
  runs: {},
  selectedFindingId: null,
  setRun: (sid, run, origin, at) => set(s => ({ runs: { ...s.runs, [sid]: { run, at: at ?? new Date().toISOString(), origin } }, selectedFindingId: null })),
  select: id => set({ selectedFindingId: id }),
}));
