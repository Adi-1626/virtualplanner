/**
 * p15 demo mode (docs/urbanos/DEMO_P15.md): on while the city-wide land-use demand model (the synthetic demo model,
 * demand/syntheticDemand.ts, on the p14 Indian road supply) is the active traffic model. A dependency-free store so badges
 * can read it without the engine. In demo mode the main screens show no validation chip or badge (the user's choice,
 * 2026-11-25); the disclosure of the model and its data lives in the Data catalogue and the docs. Nothing anywhere shows
 * a "validated" or pass state the record does not support.
 */
const KEY = 'urbanos.demoMode';
let on = false;
const subs = new Set<() => void>();

export const demoModeStore = {
  get: (): boolean => on,
  subscribe: (cb: () => void): (() => void) => { subs.add(cb); return () => { subs.delete(cb); }; },
  /** Set by SimulationMode whenever the active demand model changes (never call it to fake a state). */
  set(next: boolean) { if (on === next) return; on = next; subs.forEach(f => f()); },
};

/** The persisted choice (localStorage), false where storage is unavailable. */
export function readPersistedDemoMode(): boolean {
  try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; }
}
export function persistDemoMode(next: boolean) {
  try { globalThis.localStorage?.setItem(KEY, next ? '1' : '0'); } catch { /* storage unavailable: not persisted */ }
}
