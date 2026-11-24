import type { Delta } from '../../engine/simulation/ScenarioComparison';
import type { SimulationModeState } from '../../engine/simulation/SimulationMode';
import { formatDistanceM } from '../../lib/format';

const fmt = (n: number) => Math.round(n).toLocaleString();

/**
 * A value with its unit. Every unit is printed: fuel, CO₂, NOx, PM, veh/h, trips and stretches showed bare numbers
 * before (docs/urbanos/SIMULATE_AUDIT.md). Small values keep one decimal so a 0.4 → 0.5 is not shown as 0 → 0.
 */
export const fmtDeltaValue = (d: Delta, v: number | null) => {
  if (v === null) return '—';
  const n = Math.abs(v) < 10 && v !== 0 && d.unit !== 'veh' && d.unit !== 'trips' && d.unit !== 'stretches' ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : fmt(v);
  if (!d.unit) return n;
  return d.unit === '%' ? `${n}%` : `${n} ${d.unit}`;
};

/** A load error in words a planner can act on: the browser's "Failed to fetch" means the server could not be reached. */
export const readableLoadError = (error: string | null | undefined) =>
  /failed to fetch|networkerror|network request failed|load failed|err_connection|could not be reached/i.test(error ?? '') ? 'the server could not be reached.' : (error ?? '');

/**
 * The study's subtitle: its length and the area around it. A road the proposal closed has no length of its own here;
 * the section on show is the roads that joined it, so "100 m" under "Baba Bhide Bridge" (90 m) was another road's
 * length (p11 closure test).
 */
export function studySubtitle(sim: Pick<SimulationModeState, 'section' | 'closedRoads' | 'rangeMeters'>): string {
  const area = `area ${formatDistanceM(sim.rangeMeters)} around it`;
  if (sim.closedRoads.length) return `closed in this proposal · ${area}`;
  return `${sim.section ? `${formatDistanceM(sim.section.lengthM)}${sim.section.carriageways === 2 ? ', both carriageways' : ''} · ` : ''}${area}`;
}
