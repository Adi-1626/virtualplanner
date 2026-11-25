import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import http from 'http';
import zlib from 'zlib';
import { ObjectManager } from '../objects/ObjectManager';
import type { CityObject, RoadObject } from '../objects/types';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import { LocalOsmIndex } from '../editing/LocalOsmIndex';
import { SimulationMode, type SimulationContext } from '../simulation/SimulationMode';
import { TrafficSignalSource } from '../simulation/trafficSignals';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';
import { isSampleObject } from '../objects/sampleObjects';
import { isDrivable, type DrivableObject, type StudyArea } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan, type DemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, subareaDemand, type AssignmentResult } from '../simulation/staticAssignment';
import { TrafficMicroSim, STEP_S, type MicroSimOptions } from '../simulation/TrafficMicroSim';
import type { TimePeriod } from '../objects/demandTypes';
import type { RoadSection } from '../simulation/roadSection';
import type { BuildingPoint } from '../simulation/indianSupply';
import { DEFAULT_SUPPLY } from '../simulation/supplyParams';
import { SYNTHETIC_PARAMS } from '../calibration/syntheticDemandDecision';
import { decodeSyntheticDemand, rebalance, syntheticAreaPlan, type AreaPaths, type SyntheticCity, type SyntheticTripEnd } from '../demand/syntheticDemand';
import { evaluateBands, type AreaHourMetrics } from './citywide/citywideBands';

/**
 * Opt-in harness for p16 (docs/urbanos/CITYWIDE_P16.md): the city-wide robustness test set (citywideAreas.json, 41 study
 * areas across Pune sampled by road class and place type) run the way the app runs the city-wide land-use model in demo
 * mode: the area built by the app's own SimulationMode (as P13Validation.test.ts builds its records), the synthetic area
 * plan of the clock hour (syntheticAreaPlan with the recorded SYNTHETIC_PARAMS, or a candidate), the area's static user
 * equilibrium on the p14 supply (staticAssignment.ts) and a short micro-simulation of the selected road's corridor
 * (700 m, as analysisJob.ts: the assignment's paths cut to the corridor, p14 desired speeds, inferred signals, Indo-HCM PCU).
 * Every area x hour is scored against the plausibility bands written before any tuning (citywide/citywideBands.ts).
 *
 *   P16=1 P16_MODE=build   P16_DB (city_objects dump), P16_API (backend serving the OSM index), P16_AREAS, P16_ONLY,
 *                          P16_CACHE (v8 file written)
 *   P16=1 P16_MODE=eval    P16_CACHE_READ (cache files), P16_ASSET, P16_ENDS, P16_OUT (JSON lines), P16_SET (JSON
 *                          candidate overriding SYNTHETIC_PARAMS), P16_HOURS, P16_ITERS (60), P16_MICRO (1: corridor
 *                          micro-simulation, 2 seeds), P16_MICRO_S (warm-up and measured seconds, default 300,300)
 */
const env = process.env;
if (env.P16 && env.P16_API) {
  const base = new URL(env.P16_API);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise((resolve, reject) => {
    const u = new URL(String(input instanceof Request ? input.url : input), base);
    const method = (init?.method ?? 'GET').toUpperCase();
    // Writes of loaded roads are not sent: the harness keeps its roads in memory and the backend's database copy stays as it was
    if (method !== 'GET' && u.pathname.startsWith('/api/objects')) {
      resolve({ ok: true, status: 200, statusText: 'OK (not sent)', text: async () => '{}', json: async () => ({}), headers: { get: () => null } } as unknown as Response);
      return;
    }
    const req = http.request({ host: base.hostname, port: base.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8'), status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, statusText: res.statusMessage ?? '', text: async () => body, json: async () => JSON.parse(body), headers: { get: (k: string) => (res.headers[k.toLowerCase()] as string) ?? null } } as unknown as Response);
      });
    });
    req.on('error', reject);
    if (init?.signal) init.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (init?.body) req.write(init.body as string);
    req.end();
  })) as typeof fetch;
}

export interface CitywideArea {
  id: string; stratum: string; roadClass: string; osmHighway: string; roadName: string | null; seedRoadIds: string[]; centre: [number, number];
  jurisdiction: string; loadBox: { minLng: number; minLat: number; maxLng: number; maxLat: number }; range: number; hours: number[]; why: string;
}
interface Built {
  rec: CitywideArea; area: StudyArea; corridor: StudyArea; section: RoadSection; roads: Map<string, DrivableObject>;
  signals: readonly (readonly [number, number])[] | undefined; buildings: readonly BuildingPoint[] | null;
  simOptions: Omit<MicroSimOptions, 'demandTrips'>;
}
/** A candidate model (as SYNTHETIC_PARAMS, plus p16 options). */
export interface CandidateSet {
  name: string; scale: number; betaMult: number; supply?: { capacityFactor?: number; signalSatFactor?: number }; localCostFactor?: number;
  gatewayBalance?: number; gatewayReachM?: number; cityCongestion?: number; [k: string]: unknown;
}

const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320);

/** Keep what the assignment and the corridor simulation read: the area's edges and nodes, and their roads. */
function trim(b: Built): Built {
  const keep = (a: StudyArea) => {
    const inc = new Set(a.segments.map(s => s.key));
    const edges = new Map([...a.network.edges].filter(([, e]) => inc.has(segKey(e.id))));
    const ids = new Set([...edges.values()].flatMap(e => [e.fromNodeId, e.toNodeId]));
    return { ...a, network: { ...a.network, edges, nodes: new Map([...a.network.nodes].filter(([id]) => ids.has(id))) } } as StudyArea;
  };
  const area = keep(b.area), corridor = b.corridor === b.area ? area : keep(b.corridor);
  const roadIds = new Set([...area.network.edges.values(), ...corridor.network.edges.values()].map(e => e.roadId));
  return { ...b, area, corridor, roads: new Map([...b.roads].filter(([id]) => roadIds.has(id))) };
}

function readEnds(file: string): SyntheticTripEnd[] {
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n');
  const out: SyntheticTripEnd[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const r = lines[i].split(',').map(Number);
    out.push({ lon: r[0], lat: r[1], zone: r[2], res: r[3], jobs: r[4], svc: r[5], seats: r[6], ind: r[7] });
  }
  return out;
}

/** Weighted quantile (values with weights). */
function wq(vals: number[], w: number[], q: number): number | null {
  const idx = vals.map((_, i) => i).filter(i => w[i] > 0 && Number.isFinite(vals[i])).sort((a, b) => vals[a] - vals[b]);
  const tot = idx.reduce((s, i) => s + w[i], 0);
  if (!(tot > 0)) return null;
  let acc = 0;
  for (const i of idx) { acc += w[i]; if (acc >= q * tot) return vals[i]; }
  return vals[idx[idx.length - 1]];
}

/** Static metrics of one assignment against the area's zero-flow times. */
export function staticMetrics(a: AssignmentResult, free: Float64Array, roads: ReadonlyMap<string, DrivableObject>, section: RoadSection | null) {
  const n = a.links.length;
  const ratio: number[] = [], kmh: number[] = [], vkm: number[] = [];
  let lenAll = 0, lenOver = 0, vkmOver = 0, vkmAll = 0;
  const byClass: Record<string, { vkm: number; vht: number; vhtFree: number }> = {};
  for (let i = 0; i < n; i++) {
    const l = a.links[i], v = a.volVeh[i], km = l.lengthM / 1000;
    const r = Math.min(1, free[i] / Math.max(1e-6, a.timeS[i]));
    const vc = a.volPcu[i] / Math.max(1, l.capacityPcu);
    ratio.push(r); kmh.push(l.lengthM / Math.max(1e-6, a.timeS[i]) * 3.6); vkm.push(v * km);
    if (v > 0.5) { lenAll += km; if (vc > 1.2) { lenOver += km; vkmOver += v * km; } }
    vkmAll += v * km;
    const road = roads.get(l.roadId);
    const hw = ((road?.type === 'road' ? road.osmProvenance?.originalTags?.highway : undefined) ?? 'drawn').replace(/_link$/, '');
    const c = byClass[hw] ?? (byClass[hw] = { vkm: 0, vht: 0, vhtFree: 0 });
    c.vkm += v * km; c.vht += v * a.timeS[i] / 3600; c.vhtFree += v * free[i] / 3600;
  }
  let secRatio: number | null = null, secVc: number | null = null, secKmh: number | null = null;
  if (section) {
    const keys = new Set(section.segmentKeys);
    let tf = 0, tc = 0, len = 0, mx = 0;
    a.links.forEach((l, i) => { if (keys.has(l.segmentKey)) { tf += free[i]; tc += a.timeS[i]; len += l.lengthM; mx = Math.max(mx, a.volPcu[i] / Math.max(1, l.capacityPcu)); } });
    if (tc > 0) { secRatio = +(tf / tc).toFixed(3); secVc = +mx.toFixed(2); secKmh = +(len / tc * 3.6).toFixed(1); }
  }
  const vht = Object.values(byClass).reduce((s, c) => s + c.vht, 0), vhtFree = Object.values(byClass).reduce((s, c) => s + c.vhtFree, 0);
  return {
    speedRatioMedian: wq(ratio, vkm, 0.5), speedRatioP10: wq(ratio, vkm, 0.1), speedKmhP10: wq(kmh, vkm, 0.1), speedKmhMedian: wq(kmh, vkm, 0.5),
    networkSpeedRatio: vht > 0 ? vhtFree / vht : null, networkKmh: vht > 0 ? vkmAll / vht : null,
    overLenShare: lenAll > 0 ? lenOver / lenAll : 0, overVkmShare: vkmAll > 0 ? vkmOver / vkmAll : 0,
    vkm: Math.round(vkmAll), byClass: Object.fromEntries(Object.entries(byClass).map(([k, c]) => [k, { vkm: Math.round(c.vkm), ratio: c.vht > 0 ? +(c.vhtFree / c.vht).toFixed(3) : null }])),
    section: { ratio: secRatio, maxVc: secVc, kmh: secKmh },
    iterations: a.iterations, gap: a.relativeGap,
  };
}

/** Where the plan's building ends start / end: share of building-end veh/h on a node within 100 m of the building. */
function buildingEnds(plan: DemandPlan, area: StudyArea): { share: number | null; vph: number; noRoadShare: number | null } {
  let near = 0, tot = 0;
  for (const t of plan.trips as (DemandPlan['trips'][number] & { part?: string })[]) {
    const ends: (readonly number[])[] = [];
    if (t.part === 'internal' || t.part === 'outbound') ends.push(t.from);
    if (t.part === 'internal' || t.part === 'inbound') ends.push(t.to);
    for (const p of ends) {
      tot += t.vehiclesPerHour;
      // the node syntheticAreaPlan snapped the building to: the nearest ground node within 250 m (recomputed here)
      let bd = Infinity;
      for (const nd of area.network.nodes.values()) { if (Math.abs(nd.coordinates[0] - p[0]) > 0.003 || Math.abs(nd.coordinates[1] - p[1]) > 0.003) continue; const d = distM(p, nd.coordinates); if (d < bd) bd = d; }
      if (bd <= 100) near += t.vehiclesPerHour;
    }
  }
  const syn = plan.provenance.synthetic as { buildingsIn?: number; buildingsNoRoad?: number } | undefined;
  const bi = syn?.buildingsIn ?? 0, bn = syn?.buildingsNoRoad ?? 0;
  return { share: tot > 0 ? near / tot : null, vph: Math.round(tot), noRoadShare: bi + bn > 0 ? bn / (bi + bn) : null };
}

describe.skipIf(!env.P16)('p16 city-wide robustness harness (opt-in)', () => {
  it('builds / evaluates the city-wide areas', async () => {
    const out = env.P16_OUT ?? '/dev/null';
    const log = (o: unknown) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
    const mode = env.P16_MODE ?? 'eval';
    if (mode === 'build') {
      const db = JSON.parse(fs.readFileSync(env.P16_DB!, 'utf8')) as { objects: (CityObject & Record<string, unknown>)[] };
      const om = new ObjectManager();
      for (const obj of db.objects) {
        const o = { ...obj, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as unknown as CityObject;
        if (o.type === 'road') om.syncRoadProperties(o as RoadObject);
        (om as unknown as { objects: Map<string, CityObject> }).objects.set(o.id, o);
      }
      om.liftBridges();
      const localOsm = new LocalOsmIndex();
      const editing = new EditingEngine(om, new HistoryManager(om), () => null, localOsm);
      const scenarioId = 'base';
      const ctx = (): SimulationContext => {
        const objects = filterObjectsForScenario(om.getAll(), scenarioId).filter(o => !isSampleObject(o)) as (CityObject & Record<string, any>)[];
        const flows = (values: Record<string, number>) => Object.fromEntries((['AM_Peak', 'PM_Peak', 'Midday', 'Night'] as TimePeriod[]).map(p => [p, Math.max(0, values?.[p] || 0)])) as Record<TimePeriod, number>;
        return {
          scenarioId,
          junctions: objects.filter(o => o.type === 'junction') as never,
          buildings: objects.filter(o => o.type === 'building') as never,
          zones: objects.filter(o => o.type === 'zone').map(z => ({ id: z.id, name: z.name, boundaryPolygon: z.coordinates, totalPopulation: z.totalPopulation || 0, totalEmployment: z.totalEmployment || 0,
            landUseMix: z.landUseMix, gateways: z.gateways || [], provenance: z.provenance || { source: 'estimated', confidence: 0, updatedAt: z.updatedAt } })) as never,
          gateways: objects.filter(o => o.type === 'gateway').map(g => ({ id: g.id, name: g.name, coordinates: g.coordinates[0], connectedNodeId: g.connectedNodeId,
            inboundFlows: flows(g.inboundFlows), outboundFlows: flows(g.outboundFlows), modeSplit: g.modeSplit,
            provenance: g.provenance || { source: 'estimated', confidence: 0, updatedAt: g.updatedAt } })) as never,
        };
      };
      const sm = new SimulationMode(
        () => filterObjectsForScenario(om.getAll(), scenarioId).filter(isDrivable).filter(o => !isSampleObject(o)) as DrivableObject[],
        { load: (boxes, signal) => editing.loadOsmRoadsForStudyArea(boxes, signal) },
        new TrafficSignalSource(localOsm),
        ctx,
      );
      om.onChange((types: Set<string>) => { if (types.has('road') || types.size === 0 || types.has('junction')) sm.networkChanged(); });
      sm.useEstimatedTraffic = false;
      sm.enter();
      const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
      const settle = async () => {
        for (let i = 0; i < 900; i++) {
          const s = sm.getState();
          if (s.osmRoads.status !== 'loading' && s.signals.status !== 'loading' && s.timeOfDay.status === 'ready' && s.edgeFlows.status !== 'loading' && s.area && s.section && s.corridor) return true;
          await sleep(200);
        }
        return false;
      };
      const only = env.P16_ONLY ? new Set(env.P16_ONLY.split(',')) : null;
      const areas = (JSON.parse(fs.readFileSync(env.P16_AREAS!, 'utf8')) as { areas: CitywideArea[] }).areas.filter(a => !only || only.has(a.id));
      const src = new TrafficSignalSource(localOsm);
      const built: Built[] = [];
      for (const rec of areas) {
        const t0 = Date.now();
        try {
          await editing.loadOsmRoadsForStudyArea([rec.loadBox]);
          const present = new Set((sm as unknown as { getRoads(): DrivableObject[] }).getRoads().map(r => r.id));
          const seeds = rec.seedRoadIds.filter(id => present.has(id));
          if (!seeds.length) { log({ build: rec.id, error: 'seed road not loaded' }); continue; }
          sm.clearSeeds();
          sm.setRange(rec.range);
          seeds.forEach((id, i) => sm.selectRoad(id, i > 0));
          sm.setHour(9);
          const ok = await settle();
          await sleep(500);
          await settle();
          const st = sm.getState();
          if (!st.area || !st.section) { log({ build: rec.id, error: st.error ?? 'no area', settled: ok }); continue; }
          const area = st.area, corridor = st.corridor ?? st.area;
          const all = new Map((sm as unknown as { getRoads(): DrivableObject[] }).getRoads().map(r => [r.id, r]));
          const used = new Set([...area.network.edges.values(), ...corridor.network.edges.values()].map(e => e.roadId));
          const roads = new Map([...all].filter(([id]) => used.has(id)));
          const simOptions = structuredClone((sm as unknown as { simOptions(): Built['simOptions'] }).simOptions());
          const buildings = await src.buildingPointsIn(area.bounds);
          built.push(trim({ rec, area, corridor, section: st.section, roads, signals: sm.mappedSignalPoints() ?? undefined, buildings, simOptions }));
          log({ build: rec.id, settled: ok, segments: area.segments.length, corridorSegments: corridor.segments.length, roads: roads.size, buildings: buildings?.length ?? null, signals: sm.mappedSignalPoints()?.length ?? 0, ms: Date.now() - t0 });
        } catch (e) {
          log({ build: rec.id, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 });
        }
      }
      sm.exit();
      fs.writeFileSync(env.P16_CACHE!, v8.serialize(built));
      return;
    }

    // ── evaluation ──
    const iters = Number(env.P16_ITERS ?? 60);
    const hoursOnly = env.P16_HOURS ? env.P16_HOURS.split(',').map(Number) : null;
    const set: CandidateSet = env.P16_SET ? JSON.parse(env.P16_SET) : { name: 'recorded', ...SYNTHETIC_PARAMS };
    const only = env.P16_ONLY ? new Set(env.P16_ONLY.split(',')) : null;
    const city0 = decodeSyntheticDemand(JSON.parse(fs.readFileSync(env.P16_ASSET!, 'utf8')));
    const city: SyntheticCity = rebalance(city0, set.betaMult);
    const ends = readEnds(env.P16_ENDS!);
    const [warmS, measS] = (env.P16_MICRO_S ?? '300,300').split(',').map(Number);
    const supply = { ...DEFAULT_SUPPLY, ...(set.supply ?? {}) };
    for (const f of env.P16_CACHE_READ!.split(',')) {
      const list = (v8.deserialize(fs.readFileSync(f)) as Built[]).filter(b => !only || only.has(b.rec.id));
      for (const b of list) {
        const cache: { paths?: AreaPaths } = {};
        const segs = new Set(b.area.segments.map(s => s.key));
        const aopts = { signalPoints: b.signals, junctionEdits: b.simOptions.junctionEdits, supply, supplyModel: 'p14' as const, buildings: b.buildings, maxIterations: iters, maxMs: 1e9, targetGap: 1e-3,
          ...(set.localCostFactor ? { localCostFactor: set.localCostFactor } : {}), ...(set.p16 ? { p16: set.p16 } : {}) };
        // Zero-flow reference: the same network with no traffic (free running, signal delay, junction control at zero flow)
        let free: Float64Array | null = null;
        for (const hour of hoursOnly ?? b.rec.hours) {
          const t0 = Date.now();
          const row: Record<string, unknown> = { area: b.rec.id, stratum: b.rec.stratum, roadClass: b.rec.roadClass, jurisdiction: b.rec.jurisdiction, hour, set: set.name };
          try {
            const plan = syntheticAreaPlan(city, b.area, b.roads, ends, { hour, scale: set.scale, ...(set.gatewayBalance ? { gatewayBalance: set.gatewayBalance } : {}),
              ...(set.gatewayReachM !== undefined ? { gatewayReachM: set.gatewayReachM } : {}), ...(set.cityCongestion ? { cityCongestion: set.cityCongestion } : {}), ...(set.p16demand ? { p16: set.p16demand } : {}) } as never, cache);
            if (!plan) { row.ok = false; row.error = 'no plan (no trip ends or no roads)'; log(row); continue; }
            const trips = snapDemandPlan(plan, b.area.network, 250, segs);
            const totVph = trips.reduce((s, t) => s + t.vehiclesPerHour, 0);
            if (!free) {
              const z = assignTraffic(b.area, b.roads, trips.map(t => ({ ...t, vehiclesPerHour: 1e-6 })), { ...aopts, maxIterations: 2 });
              free = Float64Array.from(z.timeS);
            }
            const a = assignTraffic(b.area, b.roads, trips, aopts);
            const sm = staticMetrics(a, free, b.roads, b.section);
            const be = buildingEnds(plan, b.area);
            const comp = plan.provenance.components!;
            Object.assign(row, { ok: true, demandVph: Math.round(plan.provenance.vehiclesPerHour), snappedVph: Math.round(totVph), unroutedVph: Math.round(a.unroutedVeh),
              noEdgeRouteVph: Math.round(comp.noEdgeRoute ?? 0), parts: { internal: Math.round(comp.internal), outbound: Math.round(comp.outbound), inbound: Math.round(comp.inbound), through: Math.round(comp.through) },
              ...sm, buildingEnds: be, assignMs: Date.now() - t0 });
            if (env.P16_MICRO === '1') {
              // The corridor run as analysisJob.ts does it, two seeds, a short warm-up and measured window
              const inside = new Set(b.corridor.segments.map(s => s.key));
              const ctrips = subareaDemand(a, inside);
              const cplan: DemandPlan = { trips: ctrips, provenance: { ...plan.provenance, vehiclesPerHour: ctrips.reduce((s, t) => s + t.vehiclesPerHour, 0), pairCount: ctrips.length } };
              const micro = snapDemandPlan(cplan, b.corridor.network, 60, inside);
              const desired = Object.fromEntries(a.links.filter(l => l.carFfsKmh).map(l => [l.id, l.carFfsKmh!]));
              const sig = a.inferredSignalPoints?.length && b.simOptions.signalPoints ? [...b.simOptions.signalPoints, ...a.inferredSignalPoints] : b.simOptions.signalPoints;
              const runs: Record<string, unknown>[] = [];
              const t1 = Date.now();
              for (const seed of [42, 7]) {
                const sim = new TrafficMicroSim(b.corridor, b.roads, { ...b.simOptions, signalPoints: sig, seed, watchSegmentKeys: b.section.segmentKeys, demandTrips: micro, desiredSpeedKmh: desired, pcuSet: 'indo-hcm' });
                sim.setHourFactor(1);
                const warm = Math.round(warmS / STEP_S), meas = Math.round(measS / STEP_S);
                for (let i = 0; i < warm; i++) sim.step();
                sim.startAnalysis();
                const m0 = sim.getMetrics();
                for (let i = 0; i < meas; i++) sim.step();
                const m1 = sim.getMetrics();
                const ld = sim.analysisCounts()?.load;
                runs.push({ seed, inflowVph: Math.round(m1.inflowVph), waiting0: m0.waitingToEnter, waiting1: m1.waitingToEnter, onNetwork: m1.onNetwork, completed: ld?.completedInWindow ?? null,
                  tripKmh: m1.tripSpeedKmh, delayIndex: m1.delayIndex, gridlockRemovals: m1.gridlockRemovals, gridlockEvents: m1.accounting.gridlockEvents ?? null, gridlockedNow: m1.accounting.gridlockedNow ?? null,
                  unroutable: m1.unroutable, watchedKmh: m1.watched.meanSpeedKmh });
              }
              row.micro = { corridorVph: Math.round(cplan.provenance.vehiclesPerHour), warmS, measS, runs, ms: Date.now() - t1 };
            }
          } catch (e) {
            row.ok = false; row.error = e instanceof Error ? `${e.message} ${e.stack?.split('\n')[1] ?? ''}` : String(e);
          }
          row.bands = evaluateBands(row as unknown as AreaHourMetrics);
          row.ms = Date.now() - t0;
          log(row);
        }
      }
    }
  }, 48 * 3600_000);
});
