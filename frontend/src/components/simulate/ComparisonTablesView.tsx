import React from 'react';
import { FileDown, Table2 } from 'lucide-react';
import type { ComparisonTables, LinkRow, JunctionRow } from '../../engine/simulation/comparisonTables';
import type { SimulationModeState } from '../../engine/simulation/SimulationMode';
import { engineInstance } from '../../engine/TwinCityEngine';
import { Button } from '../ui/kit';
import { Chip, Disclosure } from '../ui/viz';
import { downloadReportFile, rememberReport } from './comparisonExport';

const n0 = (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : Math.round(v).toLocaleString('en-IN'));
const n1 = (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const pc = (v: number) => `${Math.round(v * 100)}%`;
/** Change from b to a, coloured: green when it is an improvement, rose when worse, grey when neither or too small. */
function Change({ b, a, lowerIsBetter, rel = 0.05 }: { b: number | null; a: number | null; lowerIsBetter: boolean | null; rel?: number }) {
  if (b === null || a === null || !Number.isFinite(b) || !Number.isFinite(a)) return <span className="text-slate-500">–</span>;
  const d = a - b, r = Math.abs(b) > 1e-9 ? d / Math.abs(b) : (d === 0 ? 0 : Infinity);
  const small = Math.abs(r) < rel;
  const good = lowerIsBetter === null || small ? null : (d < 0) === lowerIsBetter;
  const cls = good === null ? 'text-slate-400' : good ? 'text-emerald-300' : 'text-rose-300';
  return <span className={`${cls} whitespace-nowrap`}>{Number.isFinite(r) ? `${r >= 0 ? '+' : '−'}${Math.abs(r * 100).toFixed(0)}%` : 'new'}</span>;
}
const LOS_TONE: Record<string, string> = { A: 'text-emerald-300', B: 'text-emerald-300', C: 'text-lime-300', D: 'text-amber-300', E: 'text-orange-300', F: 'text-rose-300' };
const Los = ({ v }: { v: string | null }) => <span className={`font-semibold ${v ? LOS_TONE[v] ?? '' : 'text-slate-500'}`}>{v ?? '–'}</span>;

const th = 'text-right font-medium px-1 py-0.5 whitespace-nowrap';
const td = 'text-right px-1 py-0.5 tabular-nums whitespace-nowrap';

function LinksTable({ rows, onShow }: { rows: LinkRow[]; onShow: (r: LinkRow) => void }) {
  return (
    <div className="overflow-x-auto" data-testid="results-links">
      <table className="w-full text-[11px] text-slate-300">
        <thead><tr className="text-slate-500"><th className="text-left font-medium px-1">Road</th><th className={th} title="Busiest stretch in each direction, added (both carriageways of a divided road), vehicles per hour">veh/h</th><th className={th} title="Volume / capacity on the busiest stretch">v/c</th><th className={th} title="Traffic-weighted speed over the road's stretches">km/h</th><th className={th} title="Vehicle-hours above free flow on the road">Delay veh·h</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.road} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer" onClick={() => onShow(r)} title={`${r.road}: show on the map`}>
            <td className="px-1 py-0.5 max-w-[9rem] truncate">{r.road}</td>
            <td className={td}>{n0(r.vphBefore)}→{n0(r.vphAfter)}</td>
            <td className={td}><span className={r.vcAfter > 1 ? 'text-rose-300' : r.vcAfter > 0.85 ? 'text-amber-300' : ''}>{pc(r.vcBefore)}→{pc(r.vcAfter)}</span></td>
            <td className={td}>{n0(r.speedBefore)}→{n0(r.speedAfter)} <Change b={r.speedBefore} a={r.speedAfter} lowerIsBetter={false} /></td>
            <td className={td}>{n1(r.delayVehHBefore)}→{n1(r.delayVehHAfter)} <Change b={r.delayVehHBefore} a={r.delayVehHAfter} lowerIsBetter rel={0.1} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function JunctionsTable({ rows }: { rows: JunctionRow[] }) {
  return (
    <div className="overflow-x-auto" data-testid="results-junctions">
      <table className="w-full text-[11px] text-slate-300">
        <thead><tr className="text-slate-500"><th className="text-left font-medium px-1">Junction</th><th className={th} title="Control delay per vehicle (s)">Delay s</th><th className={th} title="Level of service from control delay">LOS</th><th className={th} title="Longest queue on its approaches (m)">Queue m</th><th className={th} title="Vehicles through the junction in the measured window">Veh</th></tr></thead>
        <tbody>{rows.map((j, i) => (
          <tr key={`${j.label}-${i}`} className="border-t border-white/5">
            <td className="px-1 py-0.5 max-w-[9rem] truncate" title={j.label}>{j.label}{j.only && <span className="text-slate-500"> ({j.only === 'after' ? 'new' : 'removed'})</span>}<span className="block text-[10px] text-slate-500">{j.signalised ? 'signal' : 'priority'}</span></td>
            <td className={td}>{n0(j.delayBefore)}→{n0(j.delayAfter)} <Change b={j.delayBefore} a={j.delayAfter} lowerIsBetter rel={0.1} /></td>
            <td className={td}><Los v={j.losBefore} />→<Los v={j.losAfter} /></td>
            <td className={td}>{n0(j.queueBefore)}→{n0(j.queueAfter)}</td>
            <td className={td}>{n0(j.vehBefore)}→{n0(j.vehAfter)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Result tables of a comparison and the report export (p11). Every figure is modelled; the tables say from which model part. */
export const ComparisonTablesView: React.FC<{ t: ComparisonTables; sim: SimulationModeState }> = ({ t, sim }) => {
  const [allLinks, setAllLinks] = React.useState(false);
  const [allJ, setAllJ] = React.useState(false);
  // The comparison on show is what Reports offers: kept as soon as it exists
  React.useEffect(() => { rememberReport(sim); }, [sim.comparison.result]); // eslint-disable-line react-hooks/exhaustive-deps
  const links = allLinks ? t.links : t.links.slice(0, 10);
  const junctions = allJ ? t.junctions : t.junctions.slice(0, 8);
  const exportFile = (f: string) => { const r = rememberReport(sim); if (r) downloadReportFile(r, f); };
  return (
    <div className="space-y-2.5" data-testid="comparison-tables">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1"><Table2 size={12} aria-hidden />Results</p>
        <Chip tone="neutral" title="Modelled from estimated demand; the traffic model fails validation (TAG M3.1)">Modelled</Chip>
      </div>
      <div className="overflow-x-auto" data-testid="results-summary">
        <table className="w-full text-[11px] text-slate-300">
          <thead><tr className="text-slate-500"><th className="text-left font-medium px-1">Measure</th><th className={th}>Existing</th><th className={th}>Proposal</th><th className={th}>Change</th></tr></thead>
          <tbody>{t.summary.map(s => (
            <tr key={s.label} className="border-t border-white/5">
              <td className="px-1 py-0.5">{s.label}<span className="block text-[10px] text-slate-500">{s.source === 'routed' ? 'whole area, routed' : 'neighbourhood, simulated'}</span></td>
              <td className={td}>{s.unit === 's' || s.unit === 'km/h' || s.unit === 'veh·h/h' ? n1(s.before) : n0(s.before)} <span className="text-slate-500">{s.unit}</span></td>
              <td className={td}>{s.unit === 's' || s.unit === 'km/h' || s.unit === 'veh·h/h' ? n1(s.after) : n0(s.after)}</td>
              <td className={td}><Change b={s.before} a={s.after} lowerIsBetter={s.lowerIsBetter} rel={0.01} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <Disclosure title={`Roads: volume, load, speed and delay (${t.links.length})`} testId="results-links-disclosure" defaultOpen>
        {t.links.length ? <LinksTable rows={links} onShow={r => { engineInstance.highlightRoads([...new Set(r.segmentKeys.map(k => k.replace(/_seg_\d+(?:\.\d+)?$/, '')))], 'binding'); }} /> : <p className="text-[11px] text-slate-500">No named roads in the area routing.</p>}
        {t.links.length > 10 && <button type="button" className="mt-1 text-[11px] text-cyan-300 hover:text-white cursor-pointer" onClick={() => setAllLinks(v => !v)}>{allLinks ? 'Show the first 10' : `Show all ${t.links.length}`}</button>}
        <p className="mt-1 text-[10px] text-slate-500">Area routing on the frozen demand. Sorted by the change in delay. Click a road to see it on the map.</p>
      </Disclosure>
      <Disclosure title={`Junctions: delay, level of service, queues (${t.junctions.length})`} testId="results-junctions-disclosure" defaultOpen>
        {t.junctions.length ? <JunctionsTable rows={junctions} /> : <p className="text-[11px] text-slate-500">No simulated junctions in the neighbourhood.</p>}
        {t.junctions.length > 8 && <button type="button" className="mt-1 text-[11px] text-cyan-300 hover:text-white cursor-pointer" onClick={() => setAllJ(v => !v)}>{allJ ? 'Show the first 8' : `Show all ${t.junctions.length}`}</button>}
        <p className="mt-1 text-[10px] text-slate-500">Neighbourhood micro-simulation, mean over the runs.</p>
      </Disclosure>
      {t.classMix.length > 0 && (
        <Disclosure title="By vehicle class" testId="results-classes">
          <ul className="text-[11px] text-slate-300 space-y-0.5 tabular-nums">{t.classMix.map(c => <li key={c.kind} className="flex justify-between"><span className="capitalize">{c.kind.replace('_', ' ')}</span><span>{n0(c.vph)} veh/h</span></li>)}</ul>
          <p className="mt-1 text-[10px] text-slate-500">Demand by class, the same in both runs. The model routes all classes on shared paths, so travel times by class are not modelled.</p>
        </Disclosure>
      )}
      <Disclosure title="How these figures are made" tone="subtle">{t.notes.map((x, i) => <p key={i} className="text-[11px] text-slate-400">{x}</p>)}</Disclosure>
      <div className="flex flex-wrap gap-1.5 items-center" data-testid="comparison-export">
        <Button size="sm" icon={FileDown} onClick={() => exportFile('report.html')} data-testid="export-report-html">Report (HTML)</Button>
        <Button size="sm" variant="ghost" icon={FileDown} onClick={() => exportFile('links.csv')} data-testid="export-links-csv">Roads CSV</Button>
        <Button size="sm" variant="ghost" icon={FileDown} onClick={() => exportFile('junctions.csv')} data-testid="export-junctions-csv">Junctions CSV</Button>
        <Button size="sm" variant="ghost" icon={FileDown} onClick={() => exportFile('summary.csv')} data-testid="export-summary-csv">Summary CSV</Button>
      </div>
      <p className="text-[10px] text-slate-500">Also in Reports → Scenario traffic report.</p>
    </div>
  );
};
