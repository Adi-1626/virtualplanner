import { engineInstance } from '../engine/TwinCityEngine';
import { sessionTripStorage } from '../engine/simulation/roundTrip';
import { RoundTripController } from './roundTripController';
import { browserRoundTripNav } from './roundTripNav';
import { useShellStore } from './useShellStore';

/** The app's round trip controller (docs/urbanos/SIM_FLOW_P12.md), made on first use once the engine exists. */
let controller: RoundTripController | null = null;

export function roundTrip(): RoundTripController {
  if (controller) return controller;
  const e = engineInstance;
  controller = new RoundTripController({
    sim: e.simMode,
    scenarios: e.scenarios,
    objects: e.objects,
    history: e.history,
    createProposal: async (name, description) => { const s = await e.createScenarioFrom(null, { name, description, year: new Date().getFullYear() }); return { id: s.id, name: s.name }; },
    deleteProposal: async id => { await e.deleteScenario(id); },
    goTo: ws => useShellStore.getState().setWorkspace(ws),
    workspace: () => useShellStore.getState().workspace,
    appMode: () => e.getAppMode(),
    onAppMode: cb => e.subscribeAppMode(cb),
    setSimulateTab: t => useShellStore.getState().setSimulateTab(t),
    focusInDesign: (target, studyRoadIds) => {
      if (target) e.focusInDesign(target.roadIds, target.at, { junction: target.junction });
      else e.focusInDesign(studyRoadIds, null);
    },
    setEditingLocked: locked => { e.editing.setLocked(locked); e.history.setLocked(locked); },
    storage: sessionTripStorage,
    now: () => new Date().toISOString(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    nav: browserRoundTripNav(),
  });
  return controller;
}
