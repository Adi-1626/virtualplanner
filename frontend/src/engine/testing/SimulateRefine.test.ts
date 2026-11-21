import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoadObject } from '../objects/types';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode } from '../simulation/SimulationMode';
import { ObjectManager, classifyObjectChange, VIEW_ONLY_CHANGE } from '../objects/ObjectManager';
import { emissionDeltas, type Delta } from '../simulation/ScenarioComparison';
import { DeltaRows } from '../../components/ScenarioDeltaTable';
import { fmtDeltaValue, readableLoadError } from '../../components/simulate/format';
import { EmissionsCompare, GetStartedCard, ComparisonHourNote, EvidenceTag } from '../../components/simulate/SimulatePieces';

/**
 * Fixes of the Simulate refinement (docs/urbanos/SIMULATE_AUDIT.md): a workspace switch is not a network change; a
 * baseline or proposal run is never computed twice; every unit is printed; emissions are shown as relative change
 * with the distance driven; the comparison names its hour; every result says how it is known.
 */

const LAT0 = 18.5;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [73.8 + x * M_LNG, LAT0 + y * M_LAT, 0];
const road = (id: string, a: [number, number], b: [number, number], extra: Partial<RoadObject> = {}): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: [pt(...a), pt(...b)],
  roadClass: 'arterial', width: 10, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [], createdAt: '', updatedAt: '', ...extra,
});
const corridor = (): DrivableObject[] => {
  const roads: DrivableObject[] = [road('mid', [0, 0], [600, 0])];
  for (let x = 0; x > -3000; x -= 250) roads.push(road(`w${-x}`, [x - 250, 0], [x, 0]));
  for (let x = 600; x < 3600; x += 250) roads.push(road(`e${x}`, [x, 0], [x + 250, 0]));
  return roads;
};
const until = async (cond: () => boolean, ms = 90000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
const newMode = (roads: DrivableObject[]) => {
  const mode = new SimulationMode(() => roads, null, null, () => ({}), () => Promise.reject(new Error('no counts')), null, null);
  mode.analysisSeeds = [42];
  mode.enter();
  mode.setRange(500);
  mode.selectRoad('mid', false);
  return mode;
};

describe('a workspace switch is not a network change', () => {
  it('notifyViewOnly carries only the view marker, which the engine treats as "redraw only"', () => {
    const om = new ObjectManager();
    const seen: string[][] = [];
    om.onChange(t => seen.push([...t]));
    om.notifyViewOnly();
    expect(seen).toEqual([[VIEW_ONLY_CHANGE]]);
    expect(classifyObjectChange(new Set([VIEW_ONLY_CHANGE]))).toBe('view');
  });
  it('roads, junctions, flyovers and an unspecified change are network changes; buildings are not', () => {
    expect(classifyObjectChange(new Set())).toBe('network');
    expect(classifyObjectChange(new Set(['road']))).toBe('network');
    expect(classifyObjectChange(new Set(['junction', 'building']))).toBe('network');
    expect(classifyObjectChange(new Set(['metro_flyover']))).toBe('network');
    expect(classifyObjectChange(new Set(['building']))).toBe('other');
    expect(classifyObjectChange(new Set([VIEW_ONLY_CHANGE, 'road']))).toBe('network');
  });
});

describe('baseline and proposal runs are never computed twice', () => {
  beforeEach(() => { vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {}); });
  afterEach(() => vi.unstubAllGlobals());

  it('Save existing city reuses the analysis on show; Compare reuses the re-analysis of the edited network', async () => {
    const roads = corridor();
    const mode = newMode(roads);
    await until(() => mode.getState().analysis.status === 'ready');
    const existing = mode.getState().analysis.output;
    const baseline = await mode.captureBaseline();
    expect(baseline).not.toBeNull();
    expect(mode.lastRunReused).toBe(true);
    expect(baseline!.analysis).toBe(existing);
    // Editing the network after the baseline is the intended step: no "run it again" message yet
    const i = roads.findIndex(r => r.id === 'mid');
    roads[i] = { ...(roads[i] as RoadObject), laneCount: 4, width: 14 };
    mode.networkChanged();
    expect(mode.getState().comparison.staleReason).toBeNull();
    await until(() => mode.getState().analysis.status === 'ready' && !mode.getState().analysis.outdated && mode.getState().comparison.showingProposal);
    const proposal = mode.getState().analysis.output;
    const current = await mode.runComparison();
    expect(current).not.toBeNull();
    expect(mode.lastRunReused).toBe(true);
    expect(current!.analysis).toBe(proposal);
    const c = mode.getState().comparison;
    expect(c.result?.inputs?.matched).toBe(true);
    expect(c.current?.networkKey).not.toBe(c.baseline?.networkKey);
    // A further edit makes the comparison on show out of date, and says so
    roads[i] = { ...(roads[i] as RoadObject), laneCount: 3, width: 12 };
    mode.networkChanged();
    expect(mode.getState().comparison.result).toBeNull();
    expect(mode.getState().comparison.staleReason).toMatch(/since this comparison/);
    mode.dispose();
  }, 180000);

  it('Compare pressed while the re-analysis runs waits for it instead of starting a second job', async () => {
    const roads = corridor();
    const mode = newMode(roads);
    await until(() => mode.getState().analysis.status === 'ready');
    await mode.captureBaseline();
    const i = roads.findIndex(r => r.id === 'mid');
    roads[i] = { ...(roads[i] as RoadObject), laneCount: 4, width: 14 };
    mode.networkChanged();
    await until(() => mode.getState().analysis.status === 'running');
    let secondJob = false;
    const pending = mode.runComparison();
    const watch = setInterval(() => { if (mode.resources().comparisonRunning) secondJob = true; }, 5);
    const current = await pending;
    clearInterval(watch);
    expect(secondJob).toBe(false);
    expect(current).not.toBeNull();
    expect(mode.lastRunReused).toBe(true);
    expect(current!.analysis).toBe(mode.getState().analysis.output);
    mode.dispose();
  }, 180000);

  it('a run that differs from the analysis (other seeds) runs on its own and leaves the analysis alone', async () => {
    const roads = corridor();
    const mode = newMode(roads);
    await until(() => mode.getState().analysis.status === 'ready');
    const shown = mode.getState().analysis.output;
    await mode.captureBaseline();
    expect(mode.lastRunReused).toBe(true);
    mode.analysisSeeds = [7];
    const other = await mode.captureBaseline();
    expect(mode.lastRunReused).toBe(false);
    expect(other!.analysis).not.toBe(shown);
    expect(other!.inputs?.seeds).toEqual([7]);
    mode.dispose();
  }, 180000);
});

const d = (label: string, before: number | null, after: number | null, unit: string, extra: Partial<Delta> = {}): Delta =>
  ({ label, before, after, unit, lowerIsBetter: true, change: before && after !== null ? (after - before) / before : null, good: null, ...extra });

describe('units, emissions, hour and evidence labels', () => {
  it('every comparison row prints its unit', () => {
    const html = renderToStaticMarkup(createElement(DeltaRows, { rows: [d('Fuel', 1975.6, 1994.6, 'L/h'), d('CO₂', 4646.7, 4689.2, 'kg/h'), d('NOx', 9918.7, 9866.8, 'g/h'),
      d('Traffic routed along it', 6584, 6584, 'veh/h'), d('Trips completed', 2666, 2613, 'trips'), d('Road stretches over capacity', 721, 721, 'stretches')] }));
    for (const s of ['1,976 L/h', '1,995 L/h', '4,647 kg/h', '9,919 g/h', '6,584 veh/h', '2,613 trips', '721 stretches']) expect(html).toContain(s);
    expect(fmtDeltaValue(d('Speed', 8.64, 8.25, 'km/h'), 8.64)).toBe('8.6 km/h');
    expect(fmtDeltaValue(d('Share', 62.1, 61.7, '%'), 62.1)).toBe('62%');
    expect(fmtDeltaValue(d('Removed', 0, 0, 'veh'), 3)).toBe('3 veh');
  });

  it('emissions compare shows distance and CO₂ per vehicle-km as relative change; totals only under "not for quoting"', () => {
    const em = (vkm: number, co2: number, vkmSeeds: number[]) => ({ model: { model: 'HBEFA4', url: 'u' }, windowS: 900,
      perHour: { vkm, co2G: co2, fuelL: co2 / 2392, noxG: co2 / 470, pmG: co2 / 3200, idleS: 3600 },
      perSeed: vkmSeeds.map((v, k) => ({ seed: [42, 7, 11][k], vkm: v / 4, co2G: (co2 / vkm) * v / 4, fuelL: 1, noxG: 1, pmG: 1 })) });
    const before = { emissions: em(8119, 4646656, [8100, 8119, 8138]) }, after = { emissions: em(8060, 4689225, [8050, 8060, 8070]) };
    const out = emissionDeltas(before as never, after as never, true)!;
    const deltas = out.deltas;
    expect(deltas[0].label).toMatch(/Distance driven/);
    expect(deltas[0].unit).toBe('veh·km/h');
    expect(deltas[0].good).toBeNull();
    expect(deltas[0].agreement).toEqual({ same: 3, of: 3 });
    expect(deltas[1].label).toBe('CO₂ per vehicle-km');
    expect(deltas[1].unit).toBe('g/veh·km');
    expect(deltas[1].change).toBeCloseTo((4689225 / 8060) / (4646656 / 8119) - 1, 6);
    expect(out.note).toMatch(/not for quoting/);
    const rows = deltas;
    const html = renderToStaticMarkup(createElement(EmissionsCompare, { c: { emissions: { deltas: rows, model: 'HBEFA4', source: 'u', note: 'MODELLED note' } } as never }));
    expect(html).toContain('Distance driven');
    expect(html).toContain('CO₂ per vehicle-km');
    expect(html).toContain('Model totals (not for quoting)');
    expect(html).toContain('data-evidence="modelled"');
    // The relative rows carry no absolute value; totals sit inside the disclosure
    const relative = html.slice(0, html.indexOf('Model totals'));
    expect(relative).not.toMatch(/kg\/h/);
    expect(relative).toMatch(/[+−-]\d+(\.\d)?%|no change/);
  });

  it('the comparison names its hour and warns when the panel shows another', () => {
    const same = renderToStaticMarkup(createElement(ComparisonHourNote, { comparisonHour: 9, currentHour: 9 }));
    expect(same).toContain('09:00');
    expect(same).not.toContain('comparison-hour-mismatch');
    const other = renderToStaticMarkup(createElement(ComparisonHourNote, { comparisonHour: 9, currentHour: 19 }));
    expect(other).toContain('comparison-hour-mismatch');
    expect(other).toContain('This comparison is for 09:00; the panel now shows 19:00');
  });

  it('the get-started card states the four steps and that results are modelled', () => {
    const html = renderToStaticMarkup(createElement(GetStartedCard));
    for (const s of ['Click a road on the map', 'Save the existing city', 'in Design', 'Compare', 'Modelled']) expect(html).toContain(s);
    expect(html).not.toMatch(/Build\b/);
    expect(html).not.toMatch(/\.md|§/);
  });

  it('evidence tags: measured, modelled, hypothetical', () => {
    expect(renderToStaticMarkup(createElement(EvidenceTag, { kind: 'measured' }))).toContain('Measured');
    expect(renderToStaticMarkup(createElement(EvidenceTag, { kind: 'modelled' }))).toContain('fails validation');
    expect(renderToStaticMarkup(createElement(EvidenceTag, { kind: 'hypothetical' }))).toContain('Hypothetical');
  });
});

describe('load errors in plain words', () => {
  it('a network failure says the server could not be reached; other messages are kept', () => {
    expect(readableLoadError('Failed to fetch')).toBe('the server could not be reached.');
    expect(readableLoadError('NetworkError when attempting to fetch resource.')).toBe('the server could not be reached.');
    expect(readableLoadError('HTTP 500: overpass timeout')).toBe('HTTP 500: overpass timeout');
    expect(readableLoadError(null)).toBe('');
  });
});
