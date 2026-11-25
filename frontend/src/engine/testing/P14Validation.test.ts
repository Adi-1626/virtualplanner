import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import zlib from 'zlib';
import type { DrivableObject, StudyArea } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, selectLink } from '../simulation/staticAssignment';
import type { MicroDemandTrip } from '../simulation/TrafficMicroSim';
import { DEFAULT_SUPPLY } from '../simulation/supplyParams';
import { scoreProjectCheck, sectionCount, sectionCountGrouped, wayBearing, type ProjectObs } from '../calibration/projectCheck';
import http from 'http';
import { LocalOsmIndex } from '../editing/LocalOsmIndex';
import { TrafficSignalSource } from '../simulation/trafficSignals';
import { decodeSyntheticDemand, eighthHourScale, rebalance, syntheticAreaPlan, type AreaPaths, type SyntheticCity, type SyntheticTripEnd } from '../demand/syntheticDemand';

/**
 * Opt-in harness for p14 (docs/urbanos/DEMAND_P14.md): the p13 project check (same records, same 50/50 seed-13 split,
 * same criteria in projectCheck.ts) with the SYNTHETIC land-use 4-step demand in place of the area estimate. P14=1.
 *
 * It reads the p13 study areas as built and cached by P13Validation.test.ts (the same networks, roads and mapped signals the
 * p13 baseline ran on), cuts the synthetic city OD to each area at the record's hour (syntheticAreaPlan, the function the
 * app uses) and runs the area assignment with the default supply parameters. Tuning (P14_MODE=tune) sees CALIBRATION
 * records only.
 *
 *   P14_CACHE_READ  comma-separated p13 cache files (v8-serialised areas)
 *   P14_RECORDS     records.json (urbanos-data/estimated/validation-v1)
 *   P14_ASSET       the synthetic demand asset (JSON); P14_ENDS trip_ends.csv.gz
 *   P14_MODE        eval | tune
 *   P14_SETS        eval: JSON list of {name, scale, betaMult} (default: [{name:'synthetic', scale:1, betaMult:1}])
 *   P14_GRID        tune: JSON {scale:[..], betaMult:[..]}
 *   P14_ITERS       assignment iterations (default 30)
 *   P14_OUT         JSON-lines output (appended)
 *   P14_ONLY        comma-separated record ids
 *   P14_SUPPLY_MODEL p14: run the area assignment with the p14-supply branch's Indian urban supply model (only on a branch
 *                   that has it merged); its side-friction inference reads each area's OSM building centroids from P14_API
 *                   (a backend serving the OSM index) through the app's own loader, as the p13 harness on p14-supply does.
 */
if (process.env.P14 && process.env.P14_API) {
  const base = new URL(process.env.P14_API);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise((resolve, reject) => {
    const u = new URL(String(input instanceof Request ? input.url : input), base);
    const req = http.request({ host: base.hostname, port: base.port, path: u.pathname + u.search, method: 'GET' }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8'), status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, statusText: res.statusMessage ?? '', text: async () => body, json: async () => JSON.parse(body), headers: { get: (k: string) => (res.headers[k.toLowerCase()] as string) ?? null } } as unknown as Response);
      });
    });
    req.on('error', reject);
    if (init?.signal) init.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
    req.end();
  })) as typeof fetch;
}
interface RecordSpec {
  id: string; kind: 'jt' | 'count'; split: 'calibration' | 'holdout'; roadClass: string; area: string; hours: number[];
  jt?: { o: [number, number]; d: [number, number]; googleKm: Record<string, number>; targetMin: Record<string, number>; rangeMin: Record<string, [number, number]> };
  count?: { ways: number[]; target: number; carriageways?: number[][] };
}
interface Built { rec: RecordSpec; area: StudyArea; roads: Map<string, DrivableObject>; signals: readonly (readonly [number, number])[] | undefined; trips: Map<number, MicroDemandTrip[]>; oldVph?: Record<number, number>; buildings?: unknown }

const wayOf = (id: string) => { const m = /^osm_(\d+)/.exec(id); return m ? Number(m[1]) : null; };
const countBearing = (b: Built, linkId: string) => wayBearing(b.roads.get(linkId.replace(/_seg_\d+_(fwd|bwd)$/, '').replace(/_(fwd|bwd)$/, ''))?.coordinates as number[][] | undefined, linkId.endsWith('_bwd'));
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320);

/** As P13Validation.test.ts evaluate(): one cross-section per direction for counts, the shortest converged-time path for journey times. */
/** A candidate model: demand scale and beta multiplier, and supply parameters (p13 SupplyParams within SUPPLY_BOUNDS) and the local-road route-choice factor. */
interface CandidateSet { name: string; scale: number; betaMult: number; capacityFactor?: number; signalSatFactor?: number; speedFactor?: [number, number, number]; localCostFactor?: number; gatewayBalance?: number; gatewayReachM?: number; cityCongestion?: number; cityVdf?: 'bpr' | 'p14'; gatewayMeter?: number; signalWarrant?: boolean }
let CURRENT: CandidateSet | null = null;
let WARRANT_CITY: SyntheticCity | null = null;
function evaluate(b: Built, hour: number, trips: MicroDemandTrip[], iters: number): ProjectObs | null {
  // p14-supply's model where merged (P14_SUPPLY_MODEL=p14); passed untyped so this file also compiles on the demand branch alone
  const extra: Record<string, unknown> = process.env.P14_SUPPLY_MODEL === 'p14' ? { supplyModel: 'p14', buildings: b.buildings ?? null } : {};
  if (process.env.P14_LOCAL_FACTOR) extra.localCostFactor = Number(process.env.P14_LOCAL_FACTOR);
  if (CURRENT?.localCostFactor) extra.localCostFactor = CURRENT.localCostFactor;
  // p16: IRC:93 volume-warranted signals at the record's hour (CITYWIDE_P16.md §5)
  if (CURRENT?.signalWarrant && WARRANT_CITY) { const w = eighthHourScale(WARRANT_CITY, hour); if (w) extra.signalWarrantScale = w; }
  const supply = { ...DEFAULT_SUPPLY, ...(CURRENT?.capacityFactor ? { capacityFactor: CURRENT.capacityFactor } : {}), ...(CURRENT?.signalSatFactor ? { signalSatFactor: CURRENT.signalSatFactor } : {}), ...(CURRENT?.speedFactor ? { speedFactor: CURRENT.speedFactor } : {}) };
  const a = assignTraffic(b.area, b.roads, trips, { signalPoints: b.signals, supply, maxIterations: iters, maxMs: 1e9, targetGap: 1e-3, ...extra });
  const base = { id: `${b.rec.id}@${hour}`, record: b.rec.id, split: b.rec.split, roadClass: b.rec.roadClass, area: b.rec.area, hour };
  if (b.rec.kind === 'count' && b.rec.count) {
    const ways = new Set(b.rec.count.ways);
    const flows: { way: number; bearing: number; vph: number }[] = [];
    a.links.forEach((l, i) => { const w = wayOf(l.id); if (w === null || !ways.has(w)) return; flows.push({ way: w, bearing: countBearing(b, l.id), vph: a.volVeh[i] }); });
    if (!flows.length) return null;
    return { ...base, kind: 'count', observed: b.rec.count.target, model: sectionCountGrouped(flows, b.rec.count.carriageways) };
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
    if (o.i < 0 || d.i < 0 || o.d > 150 || d.d > 150) return { ...base, kind: 'jt', observed: b.rec.jt.targetMin[String(hour)], model: null, note: 'O/D not on the area network' };
    const dist = new Float64Array(N).fill(Infinity), len = new Float64Array(N), done = new Uint8Array(N);
    dist[o.i] = 0;
    const heap: [number, number][] = [[0, o.i]];
    while (heap.length) {
      let m = 0; for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0]) m = k;
      const [du, u] = heap[m]; heap[m] = heap[heap.length - 1]; heap.pop();
      if (done[u]) continue; done[u] = 1;
      if (u === d.i) break;
      for (const li of outs[u]) { const l = a.links[li]; const nd = du + a.timeS[li]; if (nd < dist[l.to]) { dist[l.to] = nd; len[l.to] = len[u] + l.lengthM; heap.push([nd, l.to]); } }
    }
    if (!Number.isFinite(dist[d.i])) return { ...base, kind: 'jt', observed: b.rec.jt.targetMin[String(hour)], model: null, note: 'no route' };
    if (process.env.P14_ROUTE_DIAG) {
      // Where the route's time goes: free running, congestion (speed-flow), junction delay; the worst links by v/c
      const path: number[] = []; let u = d.i;
      const predL = new Int32Array(N).fill(-1);
      { const dd = new Float64Array(N).fill(Infinity), dn = new Uint8Array(N); dd[o.i] = 0; const hp: [number, number][] = [[0, o.i]];
        while (hp.length) { let m = 0; for (let k = 1; k < hp.length; k++) if (hp[k][0] < hp[m][0]) m = k; const [du, x] = hp[m]; hp[m] = hp[hp.length - 1]; hp.pop(); if (dn[x]) continue; dn[x] = 1; if (x === d.i) break;
          for (const li of outs[x]) { const l = a.links[li]; const nd = du + a.timeS[li]; if (nd < dd[l.to]) { dd[l.to] = nd; predL[l.to] = li; hp.push([nd, l.to]); } } } }
      while (u !== o.i && predL[u] >= 0) { path.push(predL[u]); u = a.links[predL[u]].from; }
      let free = 0, junc = 0, tot = 0, sig = 0;
      const worst: { id: string; vc: number; tr: number; cap: number; pcu: number; j: number; jn?: string; hw?: string; lanes: number }[] = [];
      for (const li of path) {
        const l = a.links[li], j = a.junctionDelayS?.[li] ?? 0;
        free += l.lengthM / (l.freeSpeedKmh / 3.6); sig += l.t0 - l.lengthM / (l.freeSpeedKmh / 3.6); junc += j; tot += a.timeS[li];
        const r = b.roads.get(l.roadId);
        worst.push({ id: l.id, vc: +(a.volPcu[li] / Math.max(1, l.capacityPcu)).toFixed(2), tr: +((a.timeS[li] - j) / l.t0).toFixed(2), cap: Math.round(l.capacityPcu), pcu: Math.round(a.volPcu[li]), j: Math.round(j), jn: l.junction, hw: r?.type === 'road' ? r.osmProvenance?.originalTags?.highway : undefined, lanes: l.lanes });
      }
      worst.sort((x, y) => y.vc - x.vc);
      (globalThis as unknown as { __routeDiag?: unknown[] }).__routeDiag = [{ id: base.id, totS: Math.round(tot), freeS: Math.round(free), signalS: Math.round(sig), junctionS: Math.round(junc), congestionS: Math.round(tot - free - sig - junc), links: path.length, worst: worst.slice(0, 8) }];
    }
    return { ...base, kind: 'jt', observed: b.rec.jt.targetMin[String(hour)], model: dist[d.i] / 60, routeKm: len[d.i] / 1000, googleKm: b.rec.jt.googleKm[String(hour)] };
  }
  return null;
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

describe.skipIf(!process.env.P14)('p14 project check with the synthetic land-use demand (opt-in)', () => {
  it('evaluates / tunes', async () => {
    const out = process.env.P14_OUT!;
    const log = (o: unknown) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
    const iters = Number(process.env.P14_ITERS ?? 30);
    const only = process.env.P14_ONLY ? new Set(process.env.P14_ONLY.split(',')) : null;
    const records = (JSON.parse(fs.readFileSync(process.env.P14_RECORDS!, 'utf8')) as RecordSpec[]).filter(r => !only || only.has(r.id));
    const city0 = decodeSyntheticDemand(JSON.parse(fs.readFileSync(process.env.P14_ASSET!, 'utf8')));
    WARRANT_CITY = city0;
    const ends = readEnds(process.env.P14_ENDS!);
    const built: Built[] = [];
    for (const f of process.env.P14_CACHE_READ!.split(',')) {
      for (const b of v8.deserialize(fs.readFileSync(f)) as Built[]) {
        const rec = records.find(r => r.id === b.rec.id);
        // The p13 area-estimate demand is kept only as its total (veh/h per hour), for the report
        if (rec) built.push({ ...b, rec, trips: new Map(), oldVph: Object.fromEntries([...b.trips].map(([h, t]) => [h, Math.round(t.reduce((n, x) => n + x.vehiclesPerHour, 0))])) });
      }
    }
    log({ records: built.length, asset: city0.id, supplyModel: process.env.P14_SUPPLY_MODEL ?? 'p13' });
    if (process.env.P14_SUPPLY_MODEL === 'p14') {
      const src = new TrafficSignalSource(new LocalOsmIndex()) as unknown as { buildingPointsIn?: (b: StudyArea['bounds']) => Promise<unknown> };
      if (!src.buildingPointsIn) throw new Error('P14_SUPPLY_MODEL=p14 needs the p14-supply branch merged');
      for (const b of built) { b.buildings = await src.buildingPointsIn(b.area.bounds); log({ buildings: b.rec.id, n: (b.buildings as unknown[] | null)?.length ?? null }); }
    }
    const pathsCache = new Map<string, { paths?: AreaPaths }>();
    const cities = new Map<number, SyntheticCity>();
    const cityFor = (m: number) => { let c = cities.get(m); if (!c) { c = rebalance(city0, m); cities.set(m, c); } return c; };
    // Synthetic trips per record and hour at scale 1 (the scale is linear), per beta multiplier
    const tripsMemo = new Map<string, { trips: MicroDemandTrip[]; vph: number; comp: unknown }>();
    const tripsFor = (b: Built, hour: number, betaMult: number) => {
      const gb = CURRENT?.gatewayBalance, cc = CURRENT?.cityCongestion, gr = CURRENT?.gatewayReachM, cv = CURRENT?.cityVdf, gm = CURRENT?.gatewayMeter;
      const key = `${b.rec.id}@${hour}@${betaMult}@${gb ?? ''}@${cc ?? ''}@${gr ?? ''}@${cv ?? ''}@${gm ?? ''}`;
      let t = tripsMemo.get(key);
      if (!t) {
        const cache = pathsCache.get(b.rec.id) ?? pathsCache.set(b.rec.id, {}).get(b.rec.id)!;
        const plan = syntheticAreaPlan(cityFor(betaMult), b.area, b.roads, ends, { hour, ...(gb ? { gatewayBalance: gb } : {}), ...(gr !== undefined ? { gatewayReachM: gr } : {}), ...(cc ? { cityCongestion: cc } : {}), ...(cv ? { cityVdf: cv } : {}), ...(gm ? { gatewayMeter: gm } : {}) }, cache);
        const segs = new Set(b.area.segments.map(s => s.key));
        const trips = plan ? snapDemandPlan(plan, b.area.network, 250, segs).map((x, i) => ({ ...x, part: (plan.trips[i] as { part?: string }).part })).filter(x => x.fromNodeId && x.toNodeId) : [];
        t = { trips, vph: plan?.provenance.vehiclesPerHour ?? 0, comp: plan ? { ...plan.provenance.components, ...(plan.provenance.synthetic?.gatewayBalance ? { gb: plan.provenance.synthetic.gatewayBalance } : {}), izEdge: plan.provenance.synthetic?.intrazonalEdgeVph, pairs: plan.provenance.pairCount } : undefined };
        tripsMemo.set(key, t);
      }
      return t;
    };
    const evalAll = (scale: number, betaMult: number, which: (b: Built) => boolean) => {
      const obs: ProjectObs[] = [];
      const demand: Record<string, unknown> = {};
      for (const b of built) if (which(b)) for (const h of b.rec.hours) {
        const t = tripsFor(b, h, betaMult);
        const trips = scale === 1 ? t.trips : t.trips.map(x => ({ ...x, vehiclesPerHour: x.vehiclesPerHour * scale }));
        const r = evaluate(b, h, trips, iters);
        if (r) obs.push(r);
        demand[`${b.rec.id}@${h}`] = { vph: Math.round(t.vph * scale), old: b.oldVph?.[h] ?? null, comp: t.comp };
      }
      return { obs, demand };
    };
    const mode = process.env.P14_MODE ?? 'eval';
    if (mode === 'eval') {
      const sets = process.env.P14_SETS ? JSON.parse(fs.readFileSync(process.env.P14_SETS, 'utf8')) as CandidateSet[] : [{ name: 'synthetic', scale: 1, betaMult: 1 }];
      for (const s of sets) {
        CURRENT = s;
        const t0 = Date.now();
        const { obs, demand } = evalAll(s.scale, s.betaMult, () => true);
        log({ eval: s.name, set: s, iters, ms: Date.now() - t0, obs, demand, score: scoreProjectCheck(obs) });
      }
    } else if (mode === 'diag') {
      // Structural diagnosis (DEMAND_P14.md §4): vehicle-km by OSM class, trip parts, and who loads each counted section
      if (process.env.P14_DIAG_SET) CURRENT = JSON.parse(process.env.P14_DIAG_SET) as CandidateSet;
      const scale = CURRENT?.scale ?? Number(process.env.P14_SCALE ?? 1), betaMult = CURRENT?.betaMult ?? Number(process.env.P14_BETA ?? 1);
      const extra: Record<string, unknown> = process.env.P14_SUPPLY_MODEL === 'p14' ? { supplyModel: 'p14' } : {};
      if (process.env.P14_LOCAL_FACTOR) extra.localCostFactor = Number(process.env.P14_LOCAL_FACTOR);
      if (CURRENT?.localCostFactor) extra.localCostFactor = CURRENT.localCostFactor;
      const dsupply = { ...DEFAULT_SUPPLY, ...(CURRENT?.capacityFactor ? { capacityFactor: CURRENT.capacityFactor } : {}), ...(CURRENT?.signalSatFactor ? { signalSatFactor: CURRENT.signalSatFactor } : {}) };
      for (const b of built) for (const h of b.rec.hours) {
        const t = tripsFor(b, h, betaMult);
        const trips = t.trips.map(x => ({ ...x, vehiclesPerHour: x.vehiclesPerHour * scale }));
        const a = assignTraffic(b.area, b.roads, trips, { signalPoints: b.signals, supply: dsupply, maxIterations: iters, maxMs: 1e9, targetGap: 1e-3, ...extra, ...(extra.supplyModel ? { buildings: b.buildings ?? null } : {}) });
        const hwOf = (roadId: string) => { const r = b.roads.get(roadId); return (r?.type === 'road' ? r.osmProvenance?.originalTags?.highway : undefined) ?? 'drawn'; };
        const vkt: Record<string, number> = {}, km: Record<string, number> = {};
        a.links.forEach((l, i) => { const c = hwOf(l.roadId).replace(/_link$/, ''); vkt[c] = (vkt[c] ?? 0) + a.volVeh[i] * l.lengthM / 1000; km[c] = (km[c] ?? 0) + l.lengthM / 1000; });
        const ob = evaluate(b, h, trips, iters);
        let sel: unknown = null;
        if (b.rec.kind === 'count' && b.rec.count) {
          // Parts of the trips crossing the counted section (by OD node pair; plan.trips and snapped trips share order before filtering)
          const ways = new Set(b.rec.count.ways);
          const set = new Set<number>(); a.links.forEach((l, i) => { const w = wayOf(l.id); if (w !== null && ways.has(w)) set.add(i); });
          const sl = selectLink(a, set);
          const partOf = new Map<string, Record<string, number>>();
          for (const x of trips as (MicroDemandTrip & { part?: string })[]) { const k = x.fromNodeId + '>' + x.toNodeId; const m = partOf.get(k) ?? partOf.set(k, {}).get(k)!; m[x.part ?? '?'] = (m[x.part ?? '?'] ?? 0) + x.vehiclesPerHour; }
          const byPart: Record<string, number> = {};
          for (const { od, veh } of sl.byOd) { const o = a.ods[od]; const m = partOf.get(a.nodes[o.from] + '>' + a.nodes[o.to]) ?? { '?': 1 }; const s = Object.values(m).reduce((x, y) => x + y, 0); for (const [p, v] of Object.entries(m)) byPart[p] = (byPart[p] ?? 0) + veh * v / s; }
          // Section links: flow, capacity, free speed, final time ratio
          const linksInfo = [...set].map(i => ({ id: a.links[i].id, hw: hwOf(a.links[i].roadId), vph: Math.round(a.volVeh[i]), pcu: Math.round(a.volPcu[i]), cap: Math.round(a.links[i].capacityPcu), ff: Math.round(a.links[i].freeSpeedKmh), tr: +(a.timeS[i] / a.links[i].t0).toFixed(2) }));
          sel = { byPart, links: linksInfo };
        }
        const totVkt = Object.values(vkt).reduce((x, y) => x + y, 0);
        const rd = (globalThis as unknown as { __routeDiag?: unknown[] }).__routeDiag; (globalThis as unknown as { __routeDiag?: unknown[] }).__routeDiag = undefined;
        log({ diag: `${b.rec.id}@${h}`, route: rd ?? null, split: b.rec.split, kind: b.rec.kind, scale, betaMult, obs: ob, vph: Math.round(t.vph * scale), comp: t.comp, vkt: Object.fromEntries(Object.entries(vkt).map(([k, v]) => [k, Math.round(v)])), km: Object.fromEntries(Object.entries(km).map(([k, v]) => [k, Math.round(v)])), totVkt: Math.round(totVkt), meanKm: +(totVkt / Math.max(1, trips.reduce((s, x) => s + x.vehiclesPerHour, 0))).toFixed(2), unrouted: Math.round(a.unroutedVeh), gap: a.relativeGap, sel });
      }
    } else if (mode === 'screen') {
      // Candidate sets (P14_SETS) scored on the CALIBRATION records only (the hold-out is never evaluated here)
      const sets = JSON.parse(fs.readFileSync(process.env.P14_SETS!, 'utf8')) as CandidateSet[];
      const cal = (b: Built) => b.rec.split === 'calibration';
      for (const s of sets) {
        CURRENT = s;
        const t0 = Date.now();
        const { obs } = evalAll(s.scale, s.betaMult, cal);
        const sc = scoreProjectCheck(obs);
        log({ screen: s, J: sc.loss, cal: sc.calibration, obs, ms: Date.now() - t0 });
      }
    } else if (mode === 'tune') {
      // Grid over the two demand parameters on the CALIBRATION records only (the hold-out is never evaluated here)
      const grid = { scale: [0.7, 0.85, 1, 1.15, 1.3], betaMult: [0.8, 1, 1.25], ...(process.env.P14_GRID ? JSON.parse(process.env.P14_GRID) : {}) } as { scale: number[]; betaMult: number[] };
      const cal = (b: Built) => b.rec.split === 'calibration';
      let best: { J: number; scale: number; betaMult: number } | null = null;
      for (const m of grid.betaMult) for (const s of grid.scale) {
        const t0 = Date.now();
        const { obs } = evalAll(s, m, cal);
        const sc = scoreProjectCheck(obs);
        log({ tune: { scale: s, betaMult: m }, J: sc.loss, cal: sc.calibration, ms: Date.now() - t0 });
        if (!best || sc.loss < best.J) best = { J: sc.loss, scale: s, betaMult: m };
      }
      log({ tuned: best });
    }
  }, 48 * 3600_000);
});
