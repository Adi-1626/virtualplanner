import React from 'react';
import { OctagonAlert, MousePointerClick } from 'lucide-react';
import { PanelSection } from '../../components/ui/Panel';
import { Disclosure } from '../../components/ui/Disclosure';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { useShellStore } from '../useShellStore';
import { TrafficCountsNotice } from '../../components/data/TrafficCountsNotice';
import { TRAFFIC_VALIDATION, TRAFFIC_VALIDATION_SUMMARY, RIVER_SCREENLINE_TEXT, COUNTS_ALL, COUNTS_CALIBRATION, COUNTS_HOLDOUT } from '../../components/ui/badges/trafficValidation';

/**
 * Simulate context panel: the model list with each model's standing, and how to start. The study itself
 * (SimulationPanel, unchanged) is the inspector on the right.
 */
export const SimulateContext: React.FC = () => {
  const sim = useSimulationMode();
  const setInspectorOpen = useShellStore(s => s.setInspectorOpen);
  const inspectorOpen = useShellStore(s => s.inspectorOpen);
  return (
    <div className="space-y-5">
      <div className="uos-banner-fail" role="status" data-testid="simulate-validation-banner">
        <OctagonAlert size={16} aria-hidden className="shrink-0 mt-0.5" />
        <p>Traffic model {TRAFFIC_VALIDATION.verdict === 'fails_validation' ? 'fails validation' : 'meets the recorded criteria'} ({TRAFFIC_VALIDATION.standard}): {TRAFFIC_VALIDATION_SUMMARY}. Results are estimates for comparing options on the same inputs, not forecasts.</p>
      </div>
      <PanelSection title="Study">
        {sim.seedRoadIds.length === 0
          ? <p className="text-label text-text-2 flex items-center gap-2"><MousePointerClick size={14} aria-hidden />Click a road, bridge or flyover on the map. The steps are in the panel on the right.</p>
          : inspectorOpen ? <p className="text-label text-text-2">The study is in the panel on the right.</p>
          : <button type="button" className="uos-btn uos-btn-sm" onClick={() => setInspectorOpen(true)}>Show the study panel</button>}
      </PanelSection>
      <PanelSection title="Models">
        <ul className="space-y-1.5 text-label">
          <li className="uos-row"><span className="flex-1 text-text-1">Traffic micro-simulation (IDM)</span><span className="text-fail font-medium">Fails validation</span></li>
          <li className="uos-row"><span className="flex-1 text-text-1">Static assignment / ODME</span><span className="text-fail font-medium">Fails validation</span></li>
          <li className="uos-row"><span className="flex-1 text-text-1">Emissions (HBEFA 4)</span><span className="text-warn font-medium">Inherits traffic model</span></li>
          <li className="uos-row"><span className="flex-1 text-text-1">Feasibility screening</span><span className="text-text-2 font-medium">Screening only</span></li>
        </ul>
      </PanelSection>
      <PanelSection title="Data">
        <TrafficCountsNotice compact />
        <p className="text-meta text-text-3 mt-1.5">Pune has no openly published official traffic counts. The checks use research transcriptions (6 junctions, NICMAR 2025; 8 CCTV cameras, 2023; the 2008 river-bridge counts), so the model is compared with old or partial counts only.</p>
      </PanelSection>
      <Disclosure>
        <p className="text-label text-text-2">How the model was checked against Pune: traffic counts within GEH 5 at {COUNTS_ALL.withinGeh5} of {COUNTS_ALL.n} sites (85% needed), {COUNTS_CALIBRATION.withinGeh5} of the {COUNTS_CALIBRATION.n} calibration sites and {COUNTS_HOLDOUT.withinGeh5} of the {COUNTS_HOLDOUT.n} hold-out sites that are never fitted; {RIVER_SCREENLINE_TEXT}; section speeds within 15% at 4 of 21 (85% needed). Criteria: UK DfT TAG unit M3.1 (May 2026). The counts are from 2008 and 2017, the speeds from 2025–2026. Emissions are computed from the simulated traffic, so they carry the same limitation. Feasibility screening never declares a proposal feasible.</p>
      </Disclosure>
    </div>
  );
};
