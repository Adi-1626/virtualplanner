import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import http from 'http';
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
import { snapDemandPlan } from '../simulation/StudyDemand';
import { assignTraffic } from '../simulation/staticAssignment';
import { hourFactor, COUNT_HOURS } from '../simulation/timeOfDay';
import type { MicroDemandTrip } from '../simulation/TrafficMicroSim';
import type { TimePeriod } from '../objects/demandTypes';
import { DEFAULT_SUPPLY, SUPPLY_BOUNDS, SUPPLY_KEYS, supplyToVector, vectorToSupply, type SupplyParams } from '../simulation/supplyParams';
import { scoreProjectCheck, geh, type ProjectObs } from '../calibration/projectCheck';
import { areaOdProblem } from '../demand/odmeAssignment';
import { estimateOd, matrixChangeStats, type OdmeCount } from '../demand/odme';

/**
 * Opt-in harness for the p13 project-level validation (docs/urbanos/VALIDATION_P13.md): P13=1.
 *
 * Builds every record's study area once with the app's own SimulationMode (as NetworkValidation.test.ts does, on a copy
 * of the project database served by P13_API), keeps the area, its roads, mapped signals and its demand at each record
 * hour, then re-runs only the area assignment (staticAssignment.ts) for each parameter set. Nothing here changes an app
 * default; the parameter sets are the ESTIMATED tuned sets of supplyParams.ts.
 *
 *   P13_DB       JSON dump of city_objects (as VAL24_DB)
 *   P13_RECORDS  records.json (urbanos-data/estimated/validation-v1): journey-time corridors and published counts, with split
 *   P13_MODE     eval | tune | odme (Spiess ODME on each calibration count's area, with the first P13_PARAMS set; P13_ODME = {bounds, mu, iterations})
 *   P13_PARAMS   eval: JSON list of {name, params} to evaluate (default: the defaults only)
 *   P13_OUT      JSON-lines output (appended)
 *   P13_ITERS    assignment iterations (fixed, so every evaluation is deterministic; default 30)
 *   P13_SPSA     tune: JSON {seeds:[..], iterations, a, c, lambda}
 *   P13_ONLY     comma-separated record ids
 *   P13_CACHE    file holding the built areas (v8-serialised); built and written when missing, read when present
 *   P13_CACHE_READ comma-separated cache files to read (areas built in chunks)
 */
if (process.env.P13 && process.env.P13_API) {
  const base = new URL(process.env.P13_API);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise((resolve, reject) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const req = http.request({ host: base.hostname, port: base.port, path: u.pathname + u.search, method: init?.method ?? 'GET', headers: { 'Content-Type': 'application/json' } }, res => {
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

interface RecordSpec {
  id: string; kind: 'jt' | 'count'; split: 'calibration' | 'holdout'; roadClass: string; area: string; seedRoadIds: string[];
  loadBox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null; range: number; hours: number[];
  jt?: { o: [number, number]; d: [number, number]; googleKm: Record<string, number>; targetMin: Record<string, number>; rangeMin: Record<string, [number, number]> };
  count?: { ways: number[]; target: number; target2021: number; hour: number; overlapsOfficial: string };
}
interface Built { rec: RecordSpec; area: StudyArea; roads: Map<string, DrivableObject>; signals: readonly (readonly [number, number])[] | undefined; trips: Map<number, MicroDemandTrip[]> }

const wayOf = (id: string) => { const m = /^osm_(\d+)/.exec(id); return m ? Number(m[1]) : null; };
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320);

/** Evaluate one record at one hour under a parameter set. */
function evaluate(b: Built, hour: number, p: Readonly<SupplyParams>, iters: number): ProjectObs | null {
  const trips = (b.trips.get(hour) ?? []).map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * p.demandScale }));
  const a = assignTraffic(b.area, b.roads, trips, { signalPoints: b.signals, supply: p, maxIterations: iters, maxMs: 1e9, targetGap: 1e-3 });
  const base = { id: `${b.rec.id}@${hour}`, record: b.rec.id, split: b.rec.split, roadClass: b.rec.roadClass, area: b.rec.area, hour };
  if (b.rec.kind === 'count' && b.rec.count) {
    const ways = new Set(b.rec.count.ways);
    const best = new Map<string, number>();
    a.links.forEach((l, i) => { const w = wayOf(l.id); if (w === null || !ways.has(w)) return; const k = `${w}${l.id.endsWith('_bwd') ? 'b' : 'f'}`; best.set(k, Math.max(best.get(k) ?? 0, a.volVeh[i])); });
    if (!best.size) return null;
    const model = [...best.values()].reduce((n, v) => n + v, 0);
    return { ...base, kind: 'count', observed: b.rec.count.target, model };
  }
  if (b.rec.kind === 'jt' && b.rec.jt) {
    const N = a.nodes.length;
    const outs: number[][] = Array.from({ length: N }, () => []), ins = new Uint8Array(N);
    a.links.forEach(l => { if (!l.restricted) { outs[l.from].push(l.index); ins[l.to] = 1; } });
    const near = (ll: [number, number], needOut: boolean) => {
      let bi = -1, bd = Infinity;
      for (let i = 0; i < N; i++) { if (needOut ? !outs[i].length : !ins[i]) continue; const d = distM(a.nodeCoords[i], [ll[1], ll[0]]); if (d < bd) { bd = d; bi = i; } }
      return { i: bi, d: bd };
    };
    const o = near(b.rec.jt.o, true), d = near(b.rec.jt.d, false);
    if (o.i < 0 || d.i < 0 || o.d > 150 || d.d > 150) return { ...base, kind: 'jt', observed: b.rec.jt.targetMin[String(hour)], model: null, note: `O/D not on the area network (${Math.round(o.d)} m / ${Math.round(d.d)} m)` };
    const dist = new Float64Array(N).fill(Infinity), len = new Float64Array(N), done = new Uint8Array(N);
    dist[o.i] = 0;
    // Dijkstra (dense scan is fine for one query per record; areas hold a few thousand nodes)
    const heap: [number, number][] = [[0, o.i]];
    while (heap.length) {
      let m = 0; for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0]) m = k;
      const [du, u] = heap[m]; heap[m] = heap[heap.length - 1]; heap.pop();
      if (done[u]) continue; done[u] = 1;
      if (u === d.i) break;
      for (const li of outs[u]) { const l = a.links[li]; const nd = du + a.timeS[li]; if (nd < dist[l.to]) { dist[l.to] = nd; len[l.to] = len[u] + l.lengthM; heap.push([nd, l.to]); } }
    }
    if (!Number.isFinite(dist[d.i])) return { ...base, kind: 'jt', observed: b.rec.jt.targetMin[String(hour)], model: null, note: 'no route in the area network' };
    return { ...base, kind: 'jt', observed: b.rec.jt.targetMin[String(hour)], model: dist[d.i] / 60, routeKm: len[d.i] / 1000, googleKm: b.rec.jt.googleKm[String(hour)], range: b.rec.jt.rangeMin[String(hour)] };
  }
  return null;
}

describe.skipIf(!process.env.P13)('p13 project-level validation against estimated data (opt-in)', () => {
  it('builds every record area and evaluates / tunes', async () => {
    const out = process.env.P13_OUT!;
    const log = (o: unknown) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
    const db = JSON.parse(fs.readFileSync(process.env.P13_DB!, 'utf8')) as { objects: (CityObject & Record<string, unknown>)[] };
    const om = new ObjectManager();
    for (const obj of db.objects) {
      const o = { ...obj, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as unknown as CityObject;
      if (o.type === 'road') om.syncRoadProperties(o as RoadObject);
      (om as unknown as { objects: Map<string, CityObject> }).objects.set(o.id, o);
    }
    om.liftBridges();
    const history = new HistoryManager(om);
    const localOsm = new LocalOsmIndex();
    const editing = new EditingEngine(om, history, () => null, localOsm);
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
    const mode = new SimulationMode(
      () => filterObjectsForScenario(om.getAll(), scenarioId).filter(isDrivable).filter(o => !isSampleObject(o)) as DrivableObject[],
      { load: (boxes, signal) => editing.loadOsmRoadsForStudyArea(boxes, signal) },
      new TrafficSignalSource(localOsm),
      ctx,
    );
    om.onChange((types: Set<string>) => { if (types.has('road') || types.size === 0 || types.has('junction')) mode.networkChanged(); });
    mode.useEstimatedTraffic = false; // the shipped configuration: class-typical edge flows
    mode.enter();
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const settle = async () => {
      for (let i = 0; i < 600; i++) {
        const s = mode.getState();
        if (s.osmRoads.status !== 'loading' && s.signals.status !== 'loading' && s.timeOfDay.status === 'ready' && s.edgeFlows.status !== 'loading' && s.estimatedTraffic.status !== 'loading' && s.area && s.section) return true;
        await sleep(200);
      }
      return false;
    };
    const iters = Number(process.env.P13_ITERS ?? 30);
    const only = process.env.P13_ONLY ? new Set(process.env.P13_ONLY.split(',')) : null;
    const records = (JSON.parse(fs.readFileSync(process.env.P13_RECORDS!, 'utf8')) as RecordSpec[]).filter(r => !only || only.has(r.id));
    const cacheFile = process.env.P13_CACHE;
    // P13_CACHE_READ: several cache files (built in chunks) read together instead of P13_CACHE
    const readFiles = process.env.P13_CACHE_READ ? process.env.P13_CACHE_READ.split(',') : cacheFile && fs.existsSync(cacheFile) ? [cacheFile] : [];
    const built: Built[] = readFiles.flatMap(f => v8.deserialize(fs.readFileSync(f)) as Built[]).filter(b => records.some(r => r.id === b.rec.id));
    // A cached area keeps its demand and network; the record (split, targets) is always taken from the current records file
    for (const b of built) b.rec = records.find(r => r.id === b.rec.id)!;
    if (built.length) log({ cache: cacheFile, records: built.length });
    for (const rec of (built.length ? [] : records)) {
      const t0 = Date.now();
      if (rec.loadBox) await editing.loadOsmRoadsForStudyArea([rec.loadBox]);
      const roadsNow = new Set(mode['getRoads']().map(r => r.id));
      const seeds = rec.seedRoadIds.filter(id => roadsNow.has(id));
      if (!seeds.length) { log({ build: rec.id, error: 'no seed road present' }); continue; }
      mode.clearSeeds();
      mode.setRange(rec.range);
      seeds.forEach((id, i) => mode.selectRoad(id, i > 0));
      mode.setHour(rec.hours[0]);
      const ok = await settle();
      await sleep(500);
      await settle();
      const st = mode.getState();
      if (!st.area) { log({ build: rec.id, error: 'no area', settled: ok }); continue; }
      const area = st.area, profile = st.timeOfDay.profile!;
      // Only the roads the area network uses (the assignment reads no other), so the cache stays small
      const used = new Set([...area.network.edges.values()].map(e => e.roadId));
      const roads = new Map(mode['getRoads']().filter(r => used.has(r.id)).map(r => [r.id, r]));
      const segs = new Set(area.segments.map(s => s.key));
      const trips = new Map<number, MicroDemandTrip[]>();
      for (const h of rec.hours) {
        const plan = mode.studyPlan(area, h < 12 ? 'AM_Peak' : 'PM_Peak')!;
        const f = hourFactor(profile, h, COUNT_HOURS[h < 12 ? 'AM' : 'PM'], st.timeOfDay.day);
        trips.set(h, snapDemandPlan(plan, area.network, 250, segs).map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * f })));
      }
      built.push({ rec, area, roads, signals: mode.mappedSignalPoints() ?? undefined, trips });
      log({ build: rec.id, settled: ok, seeds: seeds.length, of: rec.seedRoadIds.length, segments: area.segments.length, demandVph: Object.fromEntries([...trips].map(([h, t]) => [h, Math.round(t.reduce((n, x) => n + x.vehiclesPerHour, 0))])), ms: Date.now() - t0 });
    }
    mode.exit();
    if (cacheFile && !fs.existsSync(cacheFile)) fs.writeFileSync(cacheFile, v8.serialize(built));

    const evalAll = (p: Readonly<SupplyParams>, which: (b: Built) => boolean) => {
      const obs: ProjectObs[] = [];
      for (const b of built) if (which(b)) for (const h of b.rec.hours) { const r = evaluate(b, h, p, iters); if (r) obs.push(r); }
      return obs;
    };
    const modeName = process.env.P13_MODE ?? 'eval';
    if (modeName === 'eval') {
      const sets = process.env.P13_PARAMS ? JSON.parse(fs.readFileSync(process.env.P13_PARAMS, 'utf8')) as { name: string; params: SupplyParams }[] : [{ name: 'default', params: { ...DEFAULT_SUPPLY } }];
      for (const s of sets) {
        const t0 = Date.now();
        const obs = evalAll(s.params, () => true);
        log({ eval: s.name, params: s.params, ms: Date.now() - t0, obs, score: scoreProjectCheck(obs) });
      }
    } else if (modeName === 'odme') {
      // Spiess (1990) gradient ODME (demand/odme.ts) on each CALIBRATION count's own area matrix, cell factors bounded, optional
      // regularisation toward the prior; TAG M3.1 Table 5 matrix-change checks per area. Hold-out records are never passed in.
      const set = process.env.P13_PARAMS ? (JSON.parse(fs.readFileSync(process.env.P13_PARAMS, 'utf8')) as { name: string; params: SupplyParams }[])[0] : { name: 'default', params: { ...DEFAULT_SUPPLY } };
      const cfg = { bounds: [0.5, 2] as [number, number], mu: 0, iterations: 8, ...(process.env.P13_ODME ? JSON.parse(process.env.P13_ODME) : {}) };
      for (const b of built) {
        if (b.rec.kind !== 'count' || b.rec.split !== 'calibration' || !b.rec.count) continue;
        const h = b.rec.hours[0];
        const trips = (b.trips.get(h) ?? []).map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * set.params.demandScale }));
        const prob = areaOdProblem(b.area, b.roads, trips, { signalPoints: b.signals, supply: set.params, maxIterations: iters, maxMs: 1e9, targetGap: 1e-3 });
        const groups: number[][] = [];
        for (const w of b.rec.count.ways) for (const dir of ['_fwd', '_bwd']) {
          const g = prob.linkIds.map((id, i) => (wayOf(id) === w && (dir === '_bwd' ? id.endsWith('_bwd') : !id.endsWith('_bwd')) ? i : -1)).filter(i => i >= 0);
          if (g.length) groups.push(g);
        }
        if (!groups.length) { log({ odme: b.rec.id, error: 'counted way not in the area network' }); continue; }
        const counts: OdmeCount[] = [{ id: b.rec.id, groups, observed: b.rec.count.target, datasetId: 'p13_published_counts_calibration' }];
        const est = estimateOd(prob, counts, { cellFactorBounds: cfg.bounds, priorWeight: cfg.mu, maxIterations: cfg.iterations, heldOutDatasetIds: ['p13_published_counts_holdout'] });
        const stats = matrixChangeStats(prob.prior, est.matrix, prob.cells);
        const tot = (m: ArrayLike<number>) => Array.from(m).reduce((n, x) => n + x, 0);
        log({ odme: b.rec.id, set: set.name, cfg, fit: est.fit.map(f => ({ ...f, gehBefore: +geh(f.before, f.observed).toFixed(2), gehAfter: +geh(f.after, f.observed).toFixed(2) })),
          totalFactor: +(tot(est.matrix) / Math.max(1e-9, tot(prob.prior))).toFixed(4), boundedCells: est.boundedCells, cells: prob.prior.length, stopReason: est.stopReason, iterations: est.iterations.length,
          tag: stats.map(t => ({ name: t.name, value: +Number(t.value).toFixed(4), limit: t.limit, within: t.within })) });
      }
    } else if (modeName === 'tune') {
      // SPSA (Spall 1998) in the unit box of SUPPLY_BOUNDS, on the calibration records only; robust loss + drift regulariser
      const cfg = { seeds: [1], iterations: 24, a: 0.08, c: 0.08, A: 4, alpha: 0.602, gamma: 0.101, lambda: 0.5, ...(process.env.P13_SPSA ? JSON.parse(process.env.P13_SPSA) : {}) };
      const lo = SUPPLY_KEYS.map(k => SUPPLY_BOUNDS[k][0]), hi = SUPPLY_KEYS.map(k => SUPPLY_BOUNDS[k][1]);
      const toUnit = (v: number[]) => v.map((x, i) => (x - lo[i]) / (hi[i] - lo[i]));
      const fromUnit = (u: number[]) => u.map((x, i) => lo[i] + Math.min(1, Math.max(0, x)) * (hi[i] - lo[i]));
      const u0 = toUnit(supplyToVector(DEFAULT_SUPPLY));
      const cal = (b: Built) => b.rec.split === 'calibration';
      const objective = (u: number[]) => {
        const obs = evalAll(vectorToSupply(fromUnit(u)), cal);
        const s = scoreProjectCheck(obs);
        const drift = u.reduce((n, x, i) => n + (x - u0[i]) ** 2, 0);
        return { J: s.loss + cfg.lambda * drift, loss: s.loss, drift, s };
      };
      for (const seed of cfg.seeds) {
        let state = seed * 2654435761 % 2 ** 32;
        const rnd = () => { state = (1664525 * state + 1013904223) % 2 ** 32; return state / 2 ** 32; };
        let u = [...u0];
        const f0 = objective(u);
        let best = { u: [...u], ...f0 };
        log({ tune: seed, k: 0, params: vectorToSupply(fromUnit(u)), J: f0.J, loss: f0.loss, cal: f0.s.summary });
        for (let k = 1; k <= cfg.iterations; k++) {
          const ak = cfg.a / (k + cfg.A) ** cfg.alpha, ck = cfg.c / k ** cfg.gamma;
          const delta = u.map(() => (rnd() < 0.5 ? -1 : 1));
          const up = u.map((x, i) => x + ck * delta[i]), dn = u.map((x, i) => x - ck * delta[i]);
          const op = objective(up), om2 = objective(dn), fp = op.J, fm = om2.J;
          // The two perturbed points are real evaluations: keep the best seen (no extra evaluation at the centre)
          if (fp < best.J) best = { u: up.map(x => Math.min(1, Math.max(0, x))), ...op };
          if (fm < best.J) best = { u: dn.map(x => Math.min(1, Math.max(0, x))), ...om2 };
          u = u.map((x, i) => Math.min(1, Math.max(0, x - ak * (fp - fm) / (2 * ck * delta[i]))));
          log({ tune: seed, k, params: vectorToSupply(fromUnit(u)), fp, fm, best: best.J, bestCal: best.s.summary });
        }
        log({ tuned: seed, params: vectorToSupply(fromUnit(best.u)), J: best.J, loss: best.loss, cal: best.s.summary });
      }
    }
  }, 48 * 3600_000);
});
