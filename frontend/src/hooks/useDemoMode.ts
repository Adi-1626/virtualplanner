import { useSyncExternalStore } from 'react';
import { demoModeStore } from '../engine/simulation/demoMode';

/** True while the city-wide land-use model (demo mode) is the active traffic model. */
export function useDemoMode(): boolean {
  return useSyncExternalStore(demoModeStore.subscribe, demoModeStore.get, demoModeStore.get);
}
