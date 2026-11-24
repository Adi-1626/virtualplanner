/**
 * Before / after traffic report (p11): a printable HTML page and CSV tables built from one Simulate comparison
 * (ScenarioComparison.compareAnalyses + comparisonTables). Plain JSON in (`ComparisonReportData`), so the Reports
 * workspace can rebuild it after a reload from what Simulate saved. Every figure is labelled modelled, the demand
 * source is named, and the traffic model's validation verdict is printed on the page: it is never hidden.
 */
import type { ComparisonResult, Delta } from '../simulation/ScenarioComparison';
import { comparisonCsvs, type ComparisonTables } from '../simulation/comparisonTables';

export interface ComparisonReportData {
  schema: 'twincity.comparison_report/v1';
  generatedAt: string;
  title: string;
  /** Study area: the road(s) picked and the range. */
  area: { roads: string[]; rangeM: number; bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number } };
  hour: number;
  day: string | null;
  proposal: string;
  demand: { label: string; source: string; vph: number; estimated: boolean };
  verdict: ComparisonResult['verdict'];
  confidence: ComparisonResult['confidence'];
  kind: ComparisonResult['kind'];
  section: Delta[];
  network: Delta[];
  areaDeltas: Delta[];
  newBottlenecks: { roadName: string; vc: number }[];
  emissions: Delta[];
  tables: ComparisonTables | null;
  caveats: string[];
  validation: { verdict: string; summary: string; standard: string };
}

export function comparisonReportData(c: ComparisonResult, meta: Omit<ComparisonReportData, 'schema' | 'verdict' | 'confidence' | 'kind' | 'section' | 'network' | 'areaDeltas' | 'newBottlenecks' | 'emissions' | 'tables' | 'caveats'>): ComparisonReportData {
  return {
    schema: 'twincity.comparison_report/v1', ...meta, verdict: c.verdict, confidence: c.confidence, kind: c.kind,
    section: c.section, network: c.network, areaDeltas: c.area, newBottlenecks: c.newBottlenecks.map(b => ({ roadName: b.roadName, vc: b.vc })),
    emissions: c.emissions?.deltas ?? [], tables: c.tables ?? null, caveats: c.caveats,
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const num = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (b: number | null, a: number | null) => (b === null || a === null || !Number.isFinite(b) || !Number.isFinite(a) || Math.abs(b) < 1e-9 ? '–' : `${a >= b ? '+' : '−'}${Math.abs(100 * (a - b) / b).toFixed(1)}%`);
const VERDICT: Record<string, string> = { better: 'Better', worse: 'Worse', mixed: 'Mixed', no_change: 'No clear change' };
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

function deltaTable(title: string, rows: readonly Delta[], source: string) {
  if (!rows.length) return '';
  return `<h3>${esc(title)} <span class="b">${esc(source)}</span></h3><table><tr><th>Measure</th><th>Existing city</th><th>Proposal</th><th>Change</th><th>Runs agreeing</th></tr>
${rows.map(d => `<tr><td>${esc(d.label)}</td><td>${num(d.before, d.unit === 's' || d.unit === 'km/h' ? 1 : 0)} ${esc(d.unit)}</td><td>${num(d.after, d.unit === 's' || d.unit === 'km/h' ? 1 : 0)} ${esc(d.unit)}</td><td>${pct(d.before, d.after)}</td><td>${d.agreement ? `${d.agreement.same}/${d.agreement.of}` : '–'}</td></tr>`).join('')}</table>`;
}

export function comparisonReportHtml(r: ComparisonReportData): string {
  const t = r.tables;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.title)} – before / after traffic report</title>
<style>
body{font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:980px;margin:24px auto;padding:0 16px}
h1{font-size:21px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}h3{font-size:13px;margin:14px 0 4px}
table{border-collapse:collapse;width:100%;margin:4px 0 8px}th,td{border:1px solid #ccc;padding:3px 6px;text-align:right;vertical-align:top}th:first-child,td:first-child{text-align:left}th{background:#f2f2f2}
.muted{color:#555}.b{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;border-radius:4px;padding:0 5px;border:1px solid #3538cd;color:#3538cd}
.warn{border:1px solid #b42318;color:#7a271a;background:#fef3f2;padding:6px 8px;border-radius:6px}.est{border:1px solid #93370d;color:#93370d;background:#fffaeb;padding:6px 8px;border-radius:6px}
.v{font-size:15px;font-weight:700}@media print{body{margin:0}h2{break-after:avoid}table{break-inside:avoid}}
</style></head><body>
<h1>${esc(r.title)}</h1>
<p class="muted">Before / after traffic report · generated ${esc(r.generatedAt)} · VirtualPlanner (UrbanOS) Simulate</p>
<p class="warn"><strong>Traffic model: ${esc(r.validation.verdict === 'fails_validation' ? `fails validation (${r.validation.standard})` : r.validation.standard)}.</strong> ${esc(r.validation.summary)} Read the directions and relative sizes of changes; the absolute figures are not forecasts.</p>
${r.demand.estimated ? '<p class="est"><strong>Demand: estimated (project-level, not for decisions).</strong> Built from estimated land use and estimated road volumes, not from counts on these roads.</p>' : ''}
<h2>Study</h2>
<table><tr><th>Item</th><th>Value</th></tr>
<tr><td>Roads studied</td><td>${esc(r.area.roads.join(', ') || '–')}</td></tr>
<tr><td>Area</td><td>within ${num(r.area.rangeM)} m along the roads; ${r.area.bounds.minLat.toFixed(4)}–${r.area.bounds.maxLat.toFixed(4)} N, ${r.area.bounds.minLng.toFixed(4)}–${r.area.bounds.maxLng.toFixed(4)} E</td></tr>
<tr><td>Hour</td><td>${hh(r.hour)}${r.day ? ` (${esc(r.day)})` : ''}</td></tr>
<tr><td>Proposal</td><td>${esc(r.proposal)}</td></tr>
<tr><td>Demand (both runs, frozen)</td><td>${num(r.demand.vph)} veh/h · ${esc(r.demand.source)}</td></tr></table>
<p class="muted">${esc(r.demand.label)}</p>
<h2>Result</h2>
<p class="v">${esc(VERDICT[r.verdict.overall] ?? r.verdict.overall)} · confidence ${esc(r.confidence.level)}${r.kind === 'development' ? ' · development scenario (demand changed too)' : ''}</p>
<p>Selected road: ${esc(VERDICT[r.verdict.section])}; neighbourhood: ${esc(VERDICT[r.verdict.network])}; whole area: ${esc(VERDICT[r.verdict.area])}.</p>
<p>${esc(r.verdict.summary)}</p><p class="muted">${esc(r.confidence.text)}</p>
${r.newBottlenecks.length ? `<p><strong>New bottlenecks:</strong> ${r.newBottlenecks.map(b => `${esc(b.roadName)} (${Math.round(b.vc * 100)}% of capacity)`).join(', ')}</p>` : ''}
${deltaTable('Selected road', r.section, 'simulated')}
${deltaTable('Its neighbourhood', r.network, 'simulated')}
${deltaTable('Whole study area', r.areaDeltas, 'routed')}
${t ? `<h2>Summary measures <span class="b">modelled</span></h2><table><tr><th>Measure</th><th>Existing city</th><th>Proposal</th><th>Change</th><th>Source</th></tr>
${t.summary.map(s => `<tr><td>${esc(s.label)}</td><td>${num(s.before, 1)} ${esc(s.unit)}</td><td>${num(s.after, 1)} ${esc(s.unit)}</td><td>${pct(s.before, s.after)}</td><td>${esc(s.source)}</td></tr>`).join('')}</table>
<h2>Roads (volume, load, speed, delay) <span class="b">modelled · routed</span></h2>
<table><tr><th>Road</th><th>km</th><th>veh/h before</th><th>veh/h after</th><th>v/c before</th><th>v/c after</th><th>km/h before</th><th>km/h after</th><th>delay veh·h before</th><th>delay veh·h after</th></tr>
${t.links.slice(0, 40).map(l => `<tr><td>${esc(l.road)}</td><td>${num(l.lengthKm, 1)}</td><td>${num(l.vphBefore)}</td><td>${num(l.vphAfter)}</td><td>${num(l.vcBefore, 2)}</td><td>${num(l.vcAfter, 2)}</td><td>${num(l.speedBefore, 1)}</td><td>${num(l.speedAfter, 1)}</td><td>${num(l.delayVehHBefore, 1)}</td><td>${num(l.delayVehHAfter, 1)}</td></tr>`).join('')}</table>
${t.links.length > 40 ? `<p class="muted">${t.links.length - 40} more roads in links.csv.</p>` : ''}
<h2>Junctions (delay, level of service, queues) <span class="b">modelled · simulated</span></h2>
<table><tr><th>Junction</th><th>Control</th><th>Delay s before</th><th>Delay s after</th><th>LOS before</th><th>LOS after</th><th>Queue m before</th><th>Queue m after</th><th>Vehicles before</th><th>Vehicles after</th></tr>
${t.junctions.slice(0, 30).map(j => `<tr><td>${esc(j.label)}${j.only ? ` <span class="muted">(${j.only === 'after' ? 'new' : 'removed'})</span>` : ''}</td><td>${j.signalised ? 'Signal' : 'Priority'}</td><td>${num(j.delayBefore, 1)}</td><td>${num(j.delayAfter, 1)}</td><td>${esc(j.losBefore ?? '–')}</td><td>${esc(j.losAfter ?? '–')}</td><td>${num(j.queueBefore)}</td><td>${num(j.queueAfter)}</td><td>${num(j.vehBefore)}</td><td>${num(j.vehAfter)}</td></tr>`).join('') || '<tr><td colspan="10">No simulated junctions.</td></tr>'}</table>
${t.classMix.length ? `<h3>Demand by vehicle class (both runs) <span class="b">estimated</span></h3><table><tr><th>Class</th><th>veh/h</th></tr>${t.classMix.map(c => `<tr><td>${esc(c.kind.replace('_', ' '))}</td><td>${num(c.vph)}</td></tr>`).join('')}</table>` : ''}
<ul class="muted">${t.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="muted">No result tables in this comparison (computed by an older version): run Compare again.</p>'}
${r.emissions.length ? deltaTable('Fuel and emissions of the neighbourhood (relative; totals not for quoting)', r.emissions, 'simulated') : ''}
<h2>Assumptions and caveats</h2><ul>${r.caveats.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
</body></html>`;
}

export function comparisonReportFiles(r: ComparisonReportData): Record<string, string> {
  const base = r.tables ? comparisonCsvs(r.tables) : {};
  return { 'report.html': comparisonReportHtml(r), ...base, 'report.json': JSON.stringify(r, null, 1) };
}

/** Where Simulate keeps the last comparison report so Reports can offer it after a reload. */
export const LAST_COMPARISON_REPORT_KEY = 'vp-last-comparison-report';
export function saveLastComparisonReport(r: ComparisonReportData) {
  try { localStorage.setItem(LAST_COMPARISON_REPORT_KEY, JSON.stringify(r)); } catch { /* storage full or blocked: Reports shows the live comparison only */ }
}
export function loadLastComparisonReport(): ComparisonReportData | null {
  try {
    const raw = localStorage.getItem(LAST_COMPARISON_REPORT_KEY);
    const r = raw ? JSON.parse(raw) as ComparisonReportData : null;
    return r?.schema === 'twincity.comparison_report/v1' ? r : null;
  } catch { return null; }
}
