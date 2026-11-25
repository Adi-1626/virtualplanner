import React from 'react';
import { TriangleAlert, MousePointerClick } from 'lucide-react';
import { PanelSection } from '../../components/ui/Panel';
import { Disclosure } from '../../components/ui/Disclosure';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { useShellStore } from '../useShellStore';
import { TrafficCountsNotice } from '../../components/data/TrafficCountsNotice';
import { TRAFFIC_VALIDATION, TRAFFIC_VALIDATION_SUMMARY, RIVER_SCREENLINE_TEXT, COUNTS_ALL, COUNTS_CALIBRATION, COUNTS_HOLDOUT } from '../../components/ui/badges/trafficValidation';
import { bannerText, projectScoreFor, PROJECT_CHECK, PROJECT_DATA_NOTE } from '../../components/ui/badges/projectValidation';
import { engineInstance } from '../../engine/TwinCityEngine';
import { demandProjectScore, syntheticDemandBannerLine } from '../../components/ui/badges/syntheticDemandCheck';
import { useDemoMode } from '../../hooks/useDemoMode';
import { setDemoMode } from '../demoModeToggle';
import { simulateNoteState, CITY_MODEL_LABEL, CITY_MODEL_NOTE } from '../../components/ui/badges/demoStates';

/**
 * Simulate context panel: the model list, how to start, and the traffic model switch. The study itself (SimulationPanel)
 * is the inspector on the right.
 */
export const SimulateContext: React.FC<{ demo?: boolean }> = ({ demo: demoProp }) => {
  const sim = useSimulationMode();
  const live = useDemoMode();
  const demo = demoProp ?? live;
  const setInspectorOpen = useShellStore(s => s.setInspectorOpen);
  const inspectorOpen = useShellStore(s => s.inspectorOpen);
  // p14: with the synthetic demo model in use the project check is the one run with it (unchecked counts as failing); it
  // carries its own supply parameters, so the p13 tuned set does not apply to it
  const synthetic = sim.demandModel.model === 'synthetic';
  const using = synthetic ? 'default' : sim.supplySet;
  const demandScore = demandProjectScore(synthetic, using);
  const projectScore = demandScore === undefined ? projectScoreFor(using) : demandScore ?? { ...projectScoreFor(using), pass: false };
  const banner = bannerText(TRAFFIC_VALIDATION.verdict === 'meets_criteria', projectScore, using);
  const demandLine = syntheticDemandBannerLine(synthetic, using);
  const note = simulateNoteState(demo);
  return (
    <div className="space-y-5">
      {note === 'limitation' && (
        <div className="uos-banner-warn" role="status" data-testid="simulate-validation-banner" data-state="limitation">
          <TriangleAlert size={15} aria-hidden className="shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <p className="font-medium" data-testid="validation-banner-headline">Compare options; do not quote the numbers.</p>
            <p className="text-text-2" data-testid="validation-banner-meaning">{banner.meaning}</p>
            <Disclosure summary="About these numbers" data-testid="about-these-numbers">
              <div className="space-y-1 text-text-2">
                <p>{banner.headline}.</p>
                <p data-testid="validation-banner-official">Official-count check ({TRAFFIC_VALIDATION.standard}): {TRAFFIC_VALIDATION.verdict === 'fails_validation' ? 'fails' : 'meets the criteria'}: {TRAFFIC_VALIDATION_SUMMARY}.</p>
                {demandLine ? <p data-testid="validation-banner-demand">{demandLine}</p> : <p data-testid="validation-banner-project">{banner.project}</p>}
              </div>
            </Disclosure>
          </div>
        </div>
      )}
      {sim.demandModel.model === 'synthetic' && sim.demandModel.status === 'none' && (
        <div className="uos-banner-fail" role="alert" data-testid="city-model-error">
          <TriangleAlert size={15} aria-hidden className="shrink-0 mt-0.5" />
          <p>The city-wide model could not be loaded ({sim.demandModel.error ?? 'no data'}): the area estimate runs instead.</p>
        </div>
      )}
      <PanelSection title="Study">
        {sim.seedRoadIds.length === 0
          ? <p className="text-label text-text-2 flex items-center gap-2"><MousePointerClick size={14} aria-hidden />Click a road, bridge or flyover on the map. The steps are in the panel on the right.</p>
          : inspectorOpen ? <p className="text-label text-text-2">The study is in the panel on the right.</p>
          : <button type="button" className="uos-btn uos-btn-sm" onClick={() => setInspectorOpen(true)}>Show the study panel</button>}
      </PanelSection>
      <PanelSection title="Traffic model">
        <label className="flex items-start gap-2 text-label text-text-1">
          <input type="checkbox" data-testid="demo-mode-toggle" checked={synthetic} onChange={e => setDemoMode(e.target.checked)} />
          <span className="flex-1">{CITY_MODEL_LABEL}</span>
        </label>
        <p className="text-meta text-text-3 mt-1.5">{CITY_MODEL_NOTE}</p>
        {synthetic && sim.demandModel.status === 'loading' && <p className="text-meta text-text-2 mt-1.5" data-testid="synthetic-demand-status">Loading the city-wide model; the area estimate runs until it is ready.</p>}
        {!demo && PROJECT_CHECK.tunedAvailable && (
          <label className="flex items-start gap-2 text-label text-text-1 mt-2.5">
            <input type="checkbox" data-testid="tuned-supply-toggle" checked={using === 'tuned'} disabled={synthetic} onChange={e => engineInstance.simMode.setTunedSupply(e.target.checked)} />
            <span>Tuned parameters (estimated): speeds, capacities and demand fitted to Google journey times and published counts. {PROJECT_CHECK.tunedDecision.on ? 'On by default' : 'Off by default'}; changing it needs a new baseline.</span>
          </label>
        )}
      </PanelSection>
      <PanelSection title="Models">
        <ul className="space-y-1.5 text-label" data-testid="models-list">
          <li className="uos-row"><span className="flex-1 text-text-1">Traffic micro-simulation (IDM)</span>{!demo && <span className="text-warn font-medium">Not validated</span>}</li>
          <li className="uos-row"><span className="flex-1 text-text-1">Static assignment / ODME</span>{!demo && <span className="text-warn font-medium">Not validated</span>}</li>
          <li className="uos-row"><span className="flex-1 text-text-1">Emissions (HBEFA 4)</span>{!demo && <span className="text-text-2 font-medium">Inherits traffic model</span>}</li>
          <li className="uos-row"><span className="flex-1 text-text-1">Feasibility screening</span><span className="text-text-2 font-medium">Screening only</span></li>
        </ul>
      </PanelSection>
      {!demo && (
        <PanelSection title="Data">
          <TrafficCountsNotice compact />
          <p className="text-meta text-text-3 mt-1.5">{PROJECT_DATA_NOTE}</p>
          <p className="text-meta text-text-3 mt-1.5">Pune has no openly published official traffic counts. The checks use research transcriptions (6 junctions, NICMAR 2025; 8 CCTV cameras, 2023; the 2008 river-bridge counts), so the model is compared with old or partial counts only.</p>
        </PanelSection>
      )}
      {!demo && <Disclosure>
        <p className="text-label text-text-2">How the model was checked against Pune: traffic counts within GEH 5 at {COUNTS_ALL.withinGeh5} of {COUNTS_ALL.n} sites (85% needed), {COUNTS_CALIBRATION.withinGeh5} of the {COUNTS_CALIBRATION.n} calibration sites and {COUNTS_HOLDOUT.withinGeh5} of the {COUNTS_HOLDOUT.n} hold-out sites that are never fitted; {RIVER_SCREENLINE_TEXT}; section speeds within 15% at 4 of 21 (85% needed). Criteria: UK DfT TAG unit M3.1 (May 2026). The counts are from 2008 and 2017, the speeds from 2025–2026. Emissions are computed from the simulated traffic, so they carry the same limitation. Feasibility screening never declares a proposal feasible.</p>
      </Disclosure>}
    </div>
  );
};
