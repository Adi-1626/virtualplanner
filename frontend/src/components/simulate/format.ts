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

/**
 * The studied roads by name, for reports and file names. A road the proposal closed is not in the network any more:
 * its name comes from the study (the closure report was titled "osm_53759174: existing city vs Baba Bhide Bridge
 * closure" and saved as osm-53759174-…, p11 closure test).
 */
export function studyRoadNames(sim: Pick<SimulationModeState, 'seedRoadIds' | 'closedRoads'>, objects: readonly { id: string; name?: string }[]): string[] {
  const want = new Set(sim.seedRoadIds);
  const roads = new Map(objects.filter(o => want.has(o.id)).map(o => [o.id, o.name ?? '']));
  const closed = new Map(sim.closedRoads.map(c => [c.id, c.name]));
  return [...new Set(sim.seedRoadIds.map(id => roads.get(id) || closed.get(id) || 'Unnamed road'))];
}
