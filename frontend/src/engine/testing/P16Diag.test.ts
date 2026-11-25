import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import zlib from 'zlib';
import type { DrivableObject, StudyArea } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, subareaDemand } from '../simulation/staticAssignment';
import { TrafficMicroSim, STEP_S } from '../simulation/TrafficMicroSim';
import { DEFAULT_SUPPLY } from '../simulation/supplyParams';
import { SYNTHETIC_PARAMS } from '../calibration/syntheticDemandDecision';
import { decodeSyntheticDemand, eighthHourScale, rebalance, syntheticAreaPlan, type SyntheticTripEnd } from '../demand/syntheticDemand';

/**
 * p16 diagnosis (docs/urbanos/CITYWIDE_P16.md §5): where an area's delay at an hour comes from. Opt-in P16DIAG=1, reads
 * the P16 cache (P16_CACHE_READ), P16_ONLY areas, P16_HOURS. For each area x hour: excess vehicle-hours (time above the
 * zero-flow time) split by OSM class, by cause (link congestion vs unsignalised-junction delay), and by where the link
 * sits (touching a building trip-end node, a boundary road node, or neither); the worst links.
 */
const env = process.env;
interface Built { rec: { id: string; hours: number[] }; area: StudyArea; corridor: StudyArea; section: { segmentKeys: string[] }; roads: Map<string, DrivableObject>; signals?: readonly (readonly [number, number])[]; buildings: unknown; simOptions: { junctionEdits?: unknown; signalPoints?: readonly (readonly [number, number])[]; [k: string]: unknown } }

describe.skipIf(!env.P16DIAG)('p16 diagnosis (opt-in)', () => {
  it('diagnoses', () => {
    const out = env.P16_OUT!;
    const log = (o: unknown) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
    const set = env.P16_SET ? JSON.parse(env.P16_SET) : SYNTHETIC_PARAMS;
    const city = rebalance(decodeSyntheticDemand(JSON.parse(fs.readFileSync(env.P16_ASSET!, 'utf8'))), set.betaMult);
    const lines = zlib.gunzipSync(fs.readFileSync(env.P16_ENDS!)).toString('utf8').split('\n');
    const ends: SyntheticTripEnd[] = lines.slice(1).filter(Boolean).map(l => { const r = l.split(',').map(Number); return { lon: r[0], lat: r[1], zone: r[2], res: r[3], jobs: r[4], svc: r[5], seats: r[6], ind: r[7] }; });
    const only = env.P16_ONLY ? new Set(env.P16_ONLY.split(',')) : null;
    const hours = env.P16_HOURS ? env.P16_HOURS.split(',').map(Number) : [9, 23];
    for (const f of env.P16_CACHE_READ!.split(',')) for (const b of (v8.deserialize(fs.readFileSync(f)) as Built[]).filter(x => !only || only.has(x.rec.id))) {
      const segs = new Set(b.area.segments.map(s => s.key));
      const supply = { ...DEFAULT_SUPPLY, ...(set.supply ?? {}) };
      const aopts = { signalPoints: b.signals, junctionEdits: b.simOptions.junctionEdits as never, supply, supplyModel: 'p14' as const, buildings: b.buildings as never, maxIterations: 60, maxMs: 1e9, targetGap: 1e-3,
        ...(set.localCostFactor ? { localCostFactor: set.localCostFactor } : {}), ...(set.p16 ? { p16: set.p16 } : {}) };
      for (const hour of hours) {
        const plan = syntheticAreaPlan(city, b.area, b.roads, ends, { hour, scale: set.scale, gatewayBalance: set.gatewayBalance, gatewayReachM: set.gatewayReachM, ...(set.cityCongestion ? { cityCongestion: set.cityCongestion } : {}), ...(set.cityVdf ? { cityVdf: set.cityVdf } : {}), ...(set.p16demand ? { p16: set.p16demand } : {}) } as never, {});
        if (!plan) continue;
        const trips = snapDemandPlan(plan, b.area.network, 250, segs);
        const ws = set.signalWarrant ? eighthHourScale(city, hour) : null;
        const a = assignTraffic(b.area, b.roads, trips, { ...aopts, ...(ws ? { signalWarrantScale: ws } : {}) });
        const zsig = a.warrantedSignalPoints?.length ? [...(b.signals ?? []), ...a.warrantedSignalPoints] : b.signals;
        const z = assignTraffic(b.area, b.roads, trips.map(t => ({ ...t, vehiclesPerHour: 1e-6 })), { ...aopts, signalPoints: zsig, maxIterations: 2 });
        // trip-end nodes (building cells) and boundary nodes
        const endNodes = new Map<string, number>(), gwNodes = new Map<string, number>();
        trips.forEach((t, i) => {
          const part = (plan.trips[i] as { part?: string }).part;
          const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + t.vehiclesPerHour);
          if (part === 'internal' || part === 'outbound') add(endNodes, t.fromNodeId); else add(gwNodes, t.fromNodeId);
          if (part === 'internal' || part === 'inbound') add(endNodes, t.toNodeId); else add(gwNodes, t.toNodeId);
        });
        const byClass: Record<string, number> = {}, byCause = { link: 0, junction: 0 }, byPlace = { tripEnd: 0, boundary: 0, other: 0 };
        const worst: unknown[] = [];
        let tot = 0;
        a.links.forEach((l, i) => {
          const ex = a.volVeh[i] * Math.max(0, a.timeS[i] - z.timeS[i]) / 3600;
          if (!(ex > 0)) return;
          tot += ex;
          const r = b.roads.get(l.roadId);
          const hw = (r?.type === 'road' ? r.osmProvenance?.originalTags?.highway : undefined) ?? 'drawn';
          byClass[hw] = (byClass[hw] ?? 0) + ex;
          const jd = (a.junctionDelayS?.[i] ?? 0) - (z.junctionDelayS?.[i] ?? 0);
          const jex = a.volVeh[i] * Math.max(0, jd) / 3600;
          byCause.junction += Math.min(ex, jex); byCause.link += ex - Math.min(ex, jex);
          const fromN = a.nodes[l.from], toN = a.nodes[l.to];
          const place = endNodes.has(fromN) || endNodes.has(toN) ? 'tripEnd' : gwNodes.has(fromN) || gwNodes.has(toN) ? 'boundary' : 'other';
          byPlace[place] += ex;
          worst.push({ id: l.id, hw, ex: +ex.toFixed(1), vph: Math.round(a.volVeh[i]), vc: +(a.volPcu[i] / Math.max(1, l.capacityPcu)).toFixed(2), cap: Math.round(l.capacityPcu), lanes: l.lanes,
            t: Math.round(a.timeS[i]), t0: Math.round(z.timeS[i]), jd: Math.round(jd), jn: l.junction ?? (l.stopLinePcu ? 'signal' : ''), place, endVph: Math.round((endNodes.get(fromN) ?? 0) + (endNodes.get(toN) ?? 0)), gwVph: Math.round((gwNodes.get(fromN) ?? 0) + (gwNodes.get(toN) ?? 0)) });
        });
        (worst as { ex: number }[]).sort((x, y) => y.ex - x.ex);
        let micro: unknown = null;
        if (env.P16_MICRODIAG) {
          // The corridor micro-simulation (as the harness): where vehicles stand gridlocked and why
          const inside = new Set(b.corridor.segments.map(s => s.key));
          const ctrips = subareaDemand(a, inside);
          const cplan = { trips: ctrips, provenance: { ...plan.provenance, vehiclesPerHour: ctrips.reduce((s, t) => s + t.vehiclesPerHour, 0), pairCount: ctrips.length } };
          const mt = snapDemandPlan(cplan, b.corridor.network, 60, inside);
          const desired = Object.fromEntries(a.links.filter(l => l.carFfsKmh).map(l => [l.id, l.carFfsKmh!]));
          const sig = a.inferredSignalPoints?.length && b.simOptions.signalPoints ? [...b.simOptions.signalPoints, ...a.inferredSignalPoints] : b.simOptions.signalPoints;
          const sim = new TrafficMicroSim(b.corridor, b.roads, { ...(b.simOptions as never as object), demandLevel: (b.simOptions as { demandLevel: number }).demandLevel, signalPoints: sig, seed: 42, watchSegmentKeys: b.section.segmentKeys, demandTrips: mt, desiredSpeedKmh: desired, pcuSet: 'indo-hcm' } as never);
          sim.setHourFactor(1);
          for (let i = 0; i < Math.round(600 / STEP_S); i++) sim.step();
          const m = sim.getMetrics();
          micro = { corridorVph: Math.round(cplan.provenance.vehiclesPerHour), gridlockedNow: m.accounting.gridlockedNow, events: m.accounting.gridlockEvents, byCause: m.accounting.gridlockEventsByCause, byPlace: m.accounting.gridlockEventsByPlace,
            waiting: m.waitingToEnter, onNetwork: m.onNetwork, sites: sim.gridlockSites().slice(0, 6) };
        }
        const nEnd = endNodes.size, nGw = gwNodes.size;
        const endV = [...endNodes.values()].sort((x, y) => y - x), gwV = [...gwNodes.values()].sort((x, y) => y - x);
        log({ area: b.rec.id, hour, warranted: a.warrantedSignalPoints?.length ?? 0, demand: Math.round(plan.provenance.vehiclesPerHour), parts: plan.provenance.components, excessVehH: Math.round(tot),
          byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, Math.round(v)])), byCause: { link: Math.round(byCause.link), junction: Math.round(byCause.junction) }, byPlace: Object.fromEntries(Object.entries(byPlace).map(([k, v]) => [k, Math.round(v)])),
          endNodes: nEnd, endTop: endV.slice(0, 5).map(Math.round), gwNodes: nGw, gwTop: gwV.slice(0, 5).map(Math.round), worst: worst.slice(0, 12), micro });
      }
    }
  }, 24 * 3600_000);
});
