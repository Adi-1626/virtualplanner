import { engineInstance } from '../../engine/TwinCityEngine';
import type { SimulationModeState } from '../../engine/simulation/SimulationMode';
import { comparisonReportData, comparisonReportFiles, saveLastComparisonReport, type ComparisonReportData } from '../../engine/report/comparisonReport';
import { TRAFFIC_VALIDATION, TRAFFIC_VALIDATION_SUMMARY } from '../ui/badges/trafficValidation';
import { studyRoadNames } from './format';

/** The report data of the comparison on show (null without one). */
export function reportDataOf(sim: SimulationModeState): ComparisonReportData | null {
  const c = sim.comparison;
  if (!c.result || !c.current || !c.baseline) return null;
  const names = studyRoadNames(sim, engineInstance.objects.getAll() as { id: string; name?: string }[]);
  const demand = c.baseline.analysis.result.evidence.demand;
  const scen = engineInstance.scenarios.get(c.current.scenarioId) ?? null;
  const proposal = scen ? (scen.isBase ? 'Base (existing city, edited)' : scen.name) : c.current.scenarioId;
  const b = sim.area?.bounds ?? { minLng: 0, minLat: 0, maxLng: 0, maxLat: 0 };
  return comparisonReportData(c.result, {
    generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    title: `${names.join(' / ') || 'Study area'}: existing city vs ${proposal}`,
    area: { roads: names, rangeM: sim.rangeMeters, bounds: b },
    hour: c.current.hour, day: sim.timeOfDay.day ?? null, proposal,
    demand: { label: demand?.label ?? '', source: demand?.source ?? 'unknown', vph: c.baseline.demandVph, estimated: /estimated/i.test(demand?.label ?? '') },
    validation: { verdict: TRAFFIC_VALIDATION.verdict, summary: TRAFFIC_VALIDATION_SUMMARY, standard: TRAFFIC_VALIDATION.standard },
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'comparison';

/** Saves one file of the report (report.html, links.csv, junctions.csv, summary.csv, report.json) as a download. */
export function downloadReportFile(r: ComparisonReportData, file: string) {
  const files = comparisonReportFiles(r);
  const body = files[file];
  if (body === undefined) return;
  const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.json') ? 'application/json' : 'text/csv';
  // CSV with a byte-order mark so spreadsheet programs read the units (·, ²) as UTF-8
  const blob = new Blob([type === 'text/csv' ? '\ufeff' + body : body], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${slug(r.title)}-${r.hour}h-${file}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Keeps the comparison on show for the Reports workspace (survives a reload). */
export function rememberReport(sim: SimulationModeState): ComparisonReportData | null {
  const r = reportDataOf(sim);
  if (r) saveLastComparisonReport(r);
  return r;
}
