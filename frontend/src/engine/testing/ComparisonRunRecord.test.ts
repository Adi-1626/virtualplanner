import { describe, it, expect } from 'vitest';
import { comparisonRunRecord, type TrafficRunSnapshot } from '../simulation/SimulationMode';
import type { ComparisonResult, Delta } from '../simulation/ScenarioComparison';

// p11: the summary stored with the proposal's run record, which the backend planning-project report prints (§5)
const d = (label: string, before: number | null, after: number | null, unit = 's'): Delta => ({ label, before, after, unit, lowerIsBetter: true, change: null, good: null });
const link = (road: string, b: number, a: number) => ({ road, vphBefore: b, vphAfter: a, vcBefore: b / 1000, vcAfter: a / 1000, speedBefore: 30, speedAfter: 25.04, delayVehHBefore: 0, delayVehHAfter: 0, lengthKm: 1, segmentKeys: [] });

describe('comparisonRunRecord (p11)', () => {
  it('keeps the verdict, the estimated-demand label and the roads / junctions that changed most, compactly', () => {
    const c = {
      verdict: { overall: 'better', section: 'better', network: 'no_change', area: 'mixed', summary: 'Less delay.' },
      confidence: { level: 'medium', text: '3 of 3 runs agree.' },
      section: [d('Time to drive it', 120.456, 80.04)], network: [d('Mean delay', 30, 31)], area: [d('Vehicle-km', 1000, 1010, 'veh-km')],
      caveats: Array.from({ length: 12 }, (_, i) => `caveat ${i}`),
      tables: {
        links: Array.from({ length: 20 }, (_, i) => link(`Road ${i}`, 500, 500 + i * 10)),
        junctions: [{ label: 'Chowk A', coordinates: [73.85, 18.5], signalised: true, delayBefore: 50, delayAfter: 20, losBefore: 'E', losAfter: 'C', queueBefore: null, queueAfter: null, vehBefore: null, vehAfter: null }],
        summary: [], classMix: [], notes: [],
      },
    } as unknown as ComparisonResult;
    const baseline = { hour: 9, runId: 'run_abc', analysis: { result: { evidence: { demand: { label: 'Area demand (estimated, project-level, not for decisions)' } } } } } as unknown as TrafficRunSnapshot;
    const r = comparisonRunRecord(c, baseline, ['osm_1']);
    expect(r.schema).toBe('twincity.comparison_summary/v1');
    expect(r.baselineRunId).toBe('run_abc');
    expect(r.verdict.overall).toBe('better');
    expect(r.demandEstimated).toBe(true);
    expect(r.deltas.map(x => x.group)).toEqual(['Selected road', 'Neighbourhood', 'Whole area']);
    expect(r.deltas[0].before).toBe(120.5);
    expect(r.roads).toHaveLength(15);
    expect(r.roads[0].road).toBe('Road 19'); // largest change first
    expect(r.roads[0].speedAfter).toBe(25);
    expect(r.junctions[0]).toMatchObject({ label: 'Chowk A', delayBefore: 50, delayAfter: 20, losAfter: 'C' });
    expect(r.caveats).toHaveLength(8);
    expect(JSON.stringify(r).length).toBeLessThan(6000);
  });
});
