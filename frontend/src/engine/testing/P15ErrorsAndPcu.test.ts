/**
 * p15 (docs/urbanos/DEMO_P15.md): failures in the Simulate screens use the calm ErrorNotice (no red, no raw runtime text),
 * and the micro-simulator counts in the Indo-HCM PCU sets when it runs on the p14 Indian road supply.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoadObject } from '../objects/types';
import { userErrorText, isFriendlyErrorText } from '../../lib/errorCatalogue';
import { ErrorNotice } from '../../components/ui/ErrorNotice';
import { StudyAreaExplorer, type StudyArea } from '../simulation/StudyAreaExplorer';
import { TrafficMicroSim, OD_REFERENCE_LEVEL, STEP_S, type MicroDemandTrip, type VehicleKind } from '../simulation/TrafficMicroSim';
import { P14 } from '../simulation/supplyConfig';

describe('p15 error text in the Simulate screens', () => {
  it('our own words pass; a runtime fault never reaches the planner', () => {
    const friendly = "We couldn't complete this. Try again. If it keeps happening, share the reference. Reference: 3f2a9c1e.";
    expect(userErrorText(friendly)).toBe(friendly);
    expect(userErrorText('No traffic is routed through this road\'s neighbourhood at this hour, so there is nothing to show.')).toContain('No traffic is routed');
    for (const raw of ["Cannot read properties of undefined (reading 'lanes')", 'x.map is not a function', 'Maximum call stack size exceeded',
      'TypeError: undefined is not an object', 'at assignTraffic (staticAssignment.ts:412:9)']) {
      const t = userErrorText(raw);
      expect(t, raw).not.toMatch(/undefined|not a function|stack|staticAssignment|lanes/i);
      expect(isFriendlyErrorText(t)).toBe(true);
    }
    expect(userErrorText(null)).toMatch(/simulation couldn't start/);
  });

  it('the notice is neutral: no red class, no alert role, prefix and reference with Copy', () => {
    const html = renderToStaticMarkup(createElement(ErrorNotice, { prefix: 'The analysis could not run.', message: userErrorText('Something failed. Reference: 3f2a9c1e.'), context: 'simulate' }));
    expect(html).toContain('uos-notice');
    expect(html).toContain('The analysis could not run.');
    expect(html).toContain('3f2a9c1e');
    expect(html).toContain('Copy');
    expect(html).not.toMatch(/rose|red-|uos-banner-fail|role="alert"|--fail/);
  });

  it('SimulationPanel, RoadAnalysisPanel and the Simulate context show failures with ErrorNotice, never red failure styling', () => {
    const src = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    const panel = src('components/SimulationPanel.tsx'), analysis = src('components/RoadAnalysisPanel.tsx'), ctx = src('shell/contexts/SimulateContext.tsx');
    for (const [name, s] of [['SimulationPanel', panel], ['RoadAnalysisPanel', analysis], ['SimulateContext', ctx]] as const) {
      expect(s, name).not.toMatch(/tone="bad"[^>]*>[^<]*\{[^}]*error/);
      expect(s, name).not.toContain('uos-banner-fail');
      expect(s, name).not.toMatch(/text-rose-\d+[^>]*>\{[a-z.]*error\}/);
    }
    expect(panel).toContain('<ErrorNotice message={userErrorText(sim.error)}');
    expect(panel).toContain('<ErrorNotice message={userErrorText(t.error)}');
    expect(analysis).toContain('message={userErrorText(a.error)}');
    expect(analysis).toContain('message={userErrorText(tl.error)}');
    expect(ctx).toContain('message={userErrorText(sim.demandModel.error');
  });
});

// A two-road signalised crossing (as SignalBox.test.ts), two-wheeler heavy
const LAT0 = 18.52, M_LAT = 1 / 111320, M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [+(73.85 + x * M_LNG).toFixed(7), +(LAT0 + y * M_LAT).toFixed(7), 0];
let osm = 91000;
const road = (id: string, points: [number, number][]): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: points.map(([x, y]) => pt(x, y)),
  roadClass: 'arterial', width: 7, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: 40, isOneWay: true, trafficCapacity: 2000, connectedJunctions: [], createdAt: '', updatedAt: '',
  osmProvenance: { osmId: osm++, originalTags: { highway: 'secondary', oneway: 'yes', name: id }, layer: 0, bridge: false, tunnel: false, roundabout: false },
});
const roads = [road('North', [[0, -400], [0, 0], [0, 400]]), road('East', [[-400, 0], [0, 0], [400, 0]])];
const nodeAt = (area: StudyArea, x: number, y: number) => {
  const [lng, lat] = pt(x, y); let best = '', bd = Infinity;
  area.network.nodes.forEach(n => { const d = Math.hypot(n.coordinates[0] - lng, n.coordinates[1] - lat); if (d < bd) { bd = d; best = n.id; } });
  return best;
};
function make(pcuSet?: 'irc' | 'indo-hcm') {
  const area = new StudyAreaExplorer().explore(roads, 1, { seedRoadIds: ['North'], rangeMeters: 420, direction: 'both' });
  const mix: [VehicleKind, number][] = [['two_wheeler', 0.6], ['car', 0.3], ['auto', 0.1]];
  const pairs: [string, string, number][] = [[nodeAt(area, 0, -400), nodeAt(area, 0, 400), 700], [nodeAt(area, -400, 0), nodeAt(area, 400, 0), 500]];
  const trips: MicroDemandTrip[] = pairs.flatMap(([a, b, v]) => mix.map(([kind, sh]) => ({ fromNodeId: a, toNodeId: b, vehiclesPerHour: v * sh, kind })));
  return new TrafficMicroSim(area, new Map(roads.map(r => [r.id, r])), {
    demandLevel: OD_REFERENCE_LEVEL, seed: 7, demandTrips: trips, signalPoints: [[pt(0, 0)[0], pt(0, 0)[1]]], signalTiming: 'webster', ...(pcuSet ? { pcuSet } : {}),
  });
}

describe('p15 micro-simulator PCU set (p14 supply: Indo-HCM)', () => {
  it('Webster design flows are in Indo-HCM signal PCUs (the saturation flow\'s unit) with the p14 supply; IRC:106 otherwise', () => {
    const irc = make().signalPlans()[0], hcm = make('indo-hcm').signalPlans()[0];
    expect(irc.flowRatioSum).not.toBeNull();
    const meanIrc = 0.6 * 0.75 + 0.3 * 1.0 + 0.1 * 2.0;
    const sig = P14.pcuSignal.value as Record<string, number>;
    const meanSig = 0.6 * sig.two_wheeler + 0.3 * sig.car + 0.1 * sig.auto;
    expect(hcm.flowRatioSum! / irc.flowRatioSum!).toBeCloseTo(meanSig / meanIrc, 2);
    expect(hcm.flowRatioSum!).toBeLessThan(irc.flowRatioSum!);
    expect(make('irc').signalPlans()[0].flowRatioSum).toBeCloseTo(irc.flowRatioSum!, 9);
  });
  it('counted link PCUs are mid-block Indo-HCM PCUs with the p14 supply', () => {
    const run = (s?: 'indo-hcm') => {
      const sim = make(s);
      for (let i = 0; i < 120 / STEP_S; i++) sim.step();
      sim.startAnalysis();
      for (let i = 0; i < 300 / STEP_S; i++) sim.step();
      return sim.analysisCounts()!.links.reduce((a, l) => ({ veh: a.veh + l.entries, pcu: a.pcu + l.pcuEntries }), { veh: 0, pcu: 0 });
    };
    const a = run(), b = run('indo-hcm');
    expect(a.veh).toBeGreaterThan(0);
    expect(b.veh).toBe(a.veh); // driving is unaffected
    const mid = P14.pcuMidblock.value as Record<string, number>;
    expect(b.pcu / b.veh).toBeLessThan(a.pcu / a.veh);
    expect(b.pcu / b.veh).toBeGreaterThan(Math.min(mid.two_wheeler, mid.auto) - 1e-9);
    expect(b.pcu / b.veh).toBeLessThan(mid.car + 1e-9);
  }, 60_000);
});
