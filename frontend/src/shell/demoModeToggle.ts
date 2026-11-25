import { engineInstance } from '../engine/TwinCityEngine';
import { persistDemoMode, readPersistedDemoMode } from '../engine/simulation/demoMode';

/** One click: the city-wide land-use demand with the p14 Indian road supply (one switch in SimulationMode), persisted. */
export function setDemoMode(on: boolean) {
  persistDemoMode(on);
  engineInstance.simMode.setSyntheticDemand(on);
}

/** At start-up: re-applies the persisted choice. */
export function applyPersistedDemoMode() {
  if (readPersistedDemoMode()) engineInstance.simMode.setSyntheticDemand(true);
}
