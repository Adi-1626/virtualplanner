import React from 'react';
import { OctagonAlert, MousePointerClick } from 'lucide-react';
import { PanelSection } from '../../components/ui/Panel';
import { Disclosure } from '../../components/ui/Disclosure';
import { useSimulationMode } from '../../hooks/useSimulationMode';
import { useShellStore } from '../useShellStore';
import { TrafficCountsNotice } from '../../components/data/TrafficCountsNotice';
import { TRAFFIC_VALIDATION, TRAFFIC_VALIDATION_SUMMARY, RIVER_SCREENLINE_TEXT, COUNTS_ALL, COUNTS_CALIBRATION, COUNTS_HOLDOUT } from '../../components/ui/badges/trafficValidation';
import { bannerText, projectScoreFor, PROJECT_CHECK, PROJECT_DATA_NOTE } from '../../components/ui/badges/projectValidation';
import { engineInstance } from '../../engine/TwinCityEngine';
import { demandProjectScore, syntheticDemandBannerLine, SYNTHETIC_DEMAND_CHECK, SYNTHETIC_DEMAND_NAME, SYNTHETIC_DEMAND_NOTE } from '../../components/ui/badges/syntheticDemandCheck';
import { SourceBadge } from '../../components/ui/SourceBadge';

/**
 * Simulate context panel: the model list with each model's standing, and how to start. The study itself
 * (SimulationPanel, unchanged) is the inspector on the right.
 */
export const SimulateContext: React.FC = () => {
  const sim = useSimulationMode();
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
  return (
    <div className="space-y-5">
      <div className="uos-banner-fail" role="status" data-testid="simulate-validation-banner">
        <OctagonAlert size={16} aria-hidden className="shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium" data-testid="validation-banner-headline">{banner.headline}.</p>
          <p data-testid="validation-banner-official">Official-count check ({TRAFFIC_VALIDATION.standard}): {TRAFFIC_VALIDATION.verdict === 'fails_validation' ? 'fails' : 'meets the criteria'}: {TRAFFIC_VALIDATION_SUMMARY}.</p>
          {demandLine ? <p data-testid="validation-banner-demand">{demandLine}</p> : <p data-testid="validation-banner-project">{banner.project}</p>}
          <p data-testid="validation-banner-meaning">{banner.meaning}</p>
        </div>
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
      {PROJECT_CHECK.tunedAvailable && (
        <PanelSection title="Traffic parameters">
          <label className="flex items-start gap-2 text-label text-text-1">
            <input type="checkbox" data-testid="tuned-supply-toggle" checked={using === 'tuned'} disabled={synthetic} onChange={e => engineInstance.simMode.setTunedSupply(e.target.checked)} />
            <span>Tuned parameters (estimated): speeds, capacities and demand fitted to Google journey times and published counts.</span>
          </label>
          <p className="text-meta text-text-3 mt-1.5">{PROJECT_CHECK.tunedDecision.on ? 'On by default: ' : 'Off by default: '}{PROJECT_CHECK.tunedDecision.reason}. Changing it needs a new baseline.</p>
        </PanelSection>
      )}
      <PanelSection title="Demo model">
        <label className="flex items-start gap-2 text-label text-text-1">
          <input type="checkbox" data-testid="synthetic-demand-toggle" checked={synthetic} onChange={e => engineInstance.simMode.setSyntheticDemand(e.target.checked)} />
          <span className="flex-1">{SYNTHETIC_DEMAND_NAME} <SourceBadge source="synthetic" /></span>
        </label>
        <p className="text-meta text-text-3 mt-1.5">{SYNTHETIC_DEMAND_NOTE}</p>
        {synthetic && sim.demandModel.status === 'loading' && <p className="text-meta text-text-2 mt-1.5" data-testid="synthetic-demand-status">Loading the synthetic demand; the area estimate runs until it is ready.</p>}
        {synthetic && sim.demandModel.status === 'none' && <p className="text-meta text-warn mt-1.5" data-testid="synthetic-demand-status">The synthetic demand is not installed here ({sim.demandModel.error ?? 'no data'}): the area estimate runs instead.</p>}
        <p className="text-meta text-text-3 mt-1.5" data-testid="synthetic-demand-decision">{SYNTHETIC_DEMAND_CHECK.decision.on ? 'On by default: ' : 'Off by default (area estimate, p13 roads): '}{SYNTHETIC_DEMAND_CHECK.decision.reason}. Changing it needs a new baseline.</p>
      </PanelSection>
      <PanelSection title="Data">
        <TrafficCountsNotice compact />
        <p className="text-meta text-text-3 mt-1.5">{PROJECT_DATA_NOTE}</p>
        <p className="text-meta text-text-3 mt-1.5">Pune has no openly published official traffic counts. The checks use research transcriptions (6 junctions, NICMAR 2025; 8 CCTV cameras, 2023; the 2008 river-bridge counts), so the model is compared with old or partial counts only.</p>
      </PanelSection>
      <Disclosure>
        <p className="text-label text-text-2">How the model was checked against Pune: traffic counts within GEH 5 at {COUNTS_ALL.withinGeh5} of {COUNTS_ALL.n} sites (85% needed), {COUNTS_CALIBRATION.withinGeh5} of the {COUNTS_CALIBRATION.n} calibration sites and {COUNTS_HOLDOUT.withinGeh5} of the {COUNTS_HOLDOUT.n} hold-out sites that are never fitted; {RIVER_SCREENLINE_TEXT}; section speeds within 15% at 4 of 21 (85% needed). Criteria: UK DfT TAG unit M3.1 (May 2026). The counts are from 2008 and 2017, the speeds from 2025–2026. Emissions are computed from the simulated traffic, so they carry the same limitation. Feasibility screening never declares a proposal feasible.</p>
      </Disclosure>
    </div>
  );
};
