import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import zlib from 'zlib';
import { snapDemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, buildAssignmentNetwork } from '../simulation/staticAssignment';
import { inferredSignalPoints } from '../simulation/indianSupply';
import { DEFAULT_SUPPLY } from '../simulation/supplyParams';
import { SYNTHETIC_PARAMS } from '../calibration/syntheticDemandDecision';
import { decodeSyntheticDemand, eighthHourScale, rebalance, syntheticAreaPlan, type SyntheticTripEnd } from '../demand/syntheticDemand';

/** p17 diagnosis (opt-in, P17DIAG=1): where the zero-flow time of the slowest decile comes from (running / signal / junction control). */
const env = process.env;
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 111320);
function wq(vals: number[], w: number[], q: number) {
  const idx = vals.map((_, i) => i).filter(i => w[i] > 0).sort((a, b) => vals[a] - vals[b]);
  const tot = idx.reduce((s, i) => s + w[i], 0); let acc = 0;
  for (const i of idx) { acc += w[i]; if (acc >= q * tot) return +vals[i].toFixed(2); }
  return null;
}
describe.skipIf(!env.P17DIAG)('p17 diag', () => {
  it('decomposes', () => {
    const out = env.P17_OUT!;
    const log = (o: unknown) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
    const only = env.P16_ONLY ? new Set(env.P16_ONLY.split(',')) : null;
    const city = rebalance(decodeSyntheticDemand(JSON.parse(fs.readFileSync(env.P16_ASSET!, 'utf8'))), SYNTHETIC_PARAMS.betaMult);
    const lines = zlib.gunzipSync(fs.readFileSync(env.P16_ENDS!)).toString('utf8').split('\n');
    const ends: SyntheticTripEnd[] = [];
    for (let i = 1; i < lines.length; i++) { if (!lines[i]) continue; const r = lines[i].split(',').map(Number); ends.push({ lon: r[0], lat: r[1], zone: r[2], res: r[3], jobs: r[4], svc: r[5], seats: r[6], ind: r[7] }); }
    const hour = Number(env.P17_HOUR ?? 9), iters = Number(env.P16_ITERS ?? 60);
    for (const f of env.P16_CACHE_READ!.split(',')) {
      const list = (v8.deserialize(fs.readFileSync(f)) as any[]).filter(b => !only || only.has(b.rec.id));
      for (const b of list) {
        const segs = new Set(b.area.segments.map((s: any) => s.key));
        const set: any = { ...SYNTHETIC_PARAMS }; const supply = { ...DEFAULT_SUPPLY, ...(set.supply ?? {}) };
        const aopts = { ...(set.localCostFactor ? { localCostFactor: set.localCostFactor } : {}), signalPoints: b.signals, junctionEdits: b.simOptions.junctionEdits, supply, supplyModel: 'p14' as const, buildings: b.buildings, maxIterations: iters, maxMs: 1e9, targetGap: 1e-3 };
        const plan = syntheticAreaPlan(city, b.area, b.roads, ends, { hour, scale: set.scale, ...(set.gatewayBalance ? { gatewayBalance: set.gatewayBalance } : {}), ...(set.gatewayReachM !== undefined ? { gatewayReachM: set.gatewayReachM } : {}), ...(set.cityCongestion ? { cityCongestion: set.cityCongestion } : {}), ...(set.cityVdf ? { cityVdf: set.cityVdf } : {}), ...(set.gatewayMeter ? { gatewayMeter: set.gatewayMeter } : {}) } as never, {});
        const trips = snapDemandPlan(plan!, b.area.network, 250, segs as Set<string>, { preferMainNetwork: true });
        const ws = SYNTHETIC_PARAMS.signalWarrant ? eighthHourScale(city, hour) : null;
        const a = assignTraffic(b.area, b.roads, trips, { ...aopts, ...(ws ? { signalWarrantScale: ws } : {}) });
        const warranted = a.warrantedSignalPoints ?? [];
        const zsig = warranted.length ? [...(b.signals ?? []), ...warranted] : b.signals;
        const z = assignTraffic(b.area, b.roads, trips.map((t: any) => ({ ...t, vehiclesPerHour: 1e-6 })), { ...aopts, signalPoints: zsig, maxIterations: 2 });
        const inferred = inferredSignalPoints(b.area, b.roads, zsig);
        const net = buildAssignmentNetwork(b.area, b.roads, [...(zsig ?? []), ...inferred], b.simOptions.junctionEdits, supply, { buildings: b.buildings });
        // signal source per signalised node: mapped (nearest node to that point or not), inferred, warranted
        const mapped: readonly (readonly number[])[] = b.signals ?? [];
        const nodeC = (id: string) => b.area.network.nodes.get(id)?.coordinates as number[];
        const nearestOf = new Map<number, string>();
        mapped.forEach((p, k) => { let bd = 35, bn: string | null = null; for (const n of net.signalised) { const d = distM(p, nodeC(n)); if (d < bd) { bd = d; bn = n; } } if (bn) nearestOf.set(k, bn); });
        const nearestSet = new Set(nearestOf.values());
        const src = (n: string) => { const c = nodeC(n); if (warranted.some(p => distM(p, c) < 35)) return 'warranted'; if (mapped.some(p => distM(p, c) < 35)) return nearestSet.has(n) ? 'mappedNearest' : 'mappedNotNearest'; return 'inferred'; };
        const srcCount: Record<string, number> = {};
        for (const n of net.signalised) srcCount[src(n)] = (srcCount[src(n)] ?? 0) + 1;
        const L = a.links.length, w: number[] = [], kFree: number[] = [], kRun: number[] = [], kRunSig: number[] = [], kRunJ: number[] = [], kHour: number[] = [];
        const slow: Record<string, number> = {}, slowCls: Record<string, number> = {}, slowSrc: Record<string, number> = {};
        const rows: { i: number; kmh: number }[] = [];
        for (let i = 0; i < L; i++) {
          const l = a.links[i], run = l.lengthM / (l.freeSpeedKmh / 3.6), sig = l.t0 - run, jd = z.junctionDelayS ? z.junctionDelayS[i] : 0;
          w.push(a.volVeh[i] * l.lengthM / 1000);
          kFree.push(l.lengthM / z.timeS[i] * 3.6); kRun.push(l.lengthM / run * 3.6); kRunSig.push(l.lengthM / (run + sig) * 3.6); kRunJ.push(l.lengthM / (run + jd) * 3.6); kHour.push(l.lengthM / a.timeS[i] * 3.6);
          rows.push({ i, kmh: kFree[i] });
        }
        const p10 = wq(kFree, w, 0.1)!;
        // what makes up the zero-flow time of links below the zero-flow p10 (vkm-weighted, seconds per km)
        let wsum = 0;
        for (const { i, kmh } of rows) {
          if (kmh > p10 || !(w[i] > 0)) continue;
          const l = a.links[i], run = l.lengthM / (l.freeSpeedKmh / 3.6), sig = l.t0 - run, jd = z.junctionDelayS ? z.junctionDelayS[i] : 0;
          const per = w[i] / l.lengthM * 1000;
          slow.run = (slow.run ?? 0) + run * per; slow.sig = (slow.sig ?? 0) + sig * per; slow.junction = (slow.junction ?? 0) + jd * per; slow.lenM = (slow.lenM ?? 0) + l.lengthM * w[i];
          wsum += w[i];
          const r = b.roads.get(l.roadId); const hw = r?.osmProvenance?.originalTags?.highway ?? 'drawn';
          slowCls[hw] = (slowCls[hw] ?? 0) + w[i];
          const to = a.nodes[l.to];
          const s = sig > 0.01 ? 'sig:' + src(to) : jd > 0 ? 'ctl:' + (l.junction ?? '?') : 'none';
          slowSrc[s] = (slowSrc[s] ?? 0) + w[i];
        }
        // the slowest decile at the hour: where its time comes from (running x VDF, signal x VDF, junction delay)
        const p10h = wq(kHour, w, 0.1)!;
        const hs: Record<string, number> = {}, hCtl: Record<string, number> = {}, hCls: Record<string, number> = {};
        let hw = 0;
        for (let i = 0; i < L; i++) {
          if (!(w[i] > 0) || kHour[i] > p10h) continue;
          const l = a.links[i], run = l.lengthM / (l.freeSpeedKmh / 3.6), sig = l.t0 - run, jd = a.junctionDelayS ? a.junctionDelayS[i] : 0;
          const vc = a.volPcu[i] / Math.max(1, l.capacityPcu), mult = (a.timeS[i] - jd) / l.t0;
          const per = w[i] / l.lengthM * 1000;
          hs.run = (hs.run ?? 0) + run * mult * per; hs.sig = (hs.sig ?? 0) + sig * mult * per; hs.junction = (hs.junction ?? 0) + jd * per;
          hs.vcOver1 = (hs.vcOver1 ?? 0) + (vc > 1 ? w[i] : 0); hs.stopLineBinds = (hs.stopLineBinds ?? 0) + (l.stopLinePcu != null && l.stopLinePcu < l.midblockPcu ? w[i] : 0);
          hs.vc = (hs.vc ?? 0) + vc * w[i]; hs.lenM = (hs.lenM ?? 0) + l.lengthM * w[i];
          const to = a.nodes[l.to];
          const s = sig > 0.01 ? 'sig:' + src(to) : jd > 0 ? 'ctl:' + (l.junction ?? '?') : 'none';
          hCtl[s] = (hCtl[s] ?? 0) + w[i];
          const r = b.roads.get(l.roadId); const hwy = r?.osmProvenance?.originalTags?.highway ?? 'drawn'; hCls[hwy] = (hCls[hwy] ?? 0) + w[i];
          hw += w[i];
        }
        const normH = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / hw).toFixed(3)]));
        const peak = { p10: p10h, sPerVkm: normH({ run: hs.run, sig: hs.sig, junction: hs.junction }), vcOver1: +(hs.vcOver1 / hw).toFixed(3), stopLineBinds: +(hs.stopLineBinds / hw).toFixed(3), meanVc: +(hs.vc / hw).toFixed(2), meanLenM: Math.round(hs.lenM / hw), byControl: normH(hCtl), byClass: normH(hCls) };
        // zero-flow slow decile: link lengths and examples
        const lenBins: Record<string, number> = {}; const ex: unknown[] = [];
        for (const { i, kmh } of rows) {
          if (kmh > p10 || !(w[i] > 0)) continue;
          const l = a.links[i], bin = l.lengthM < 16 ? '<16' : l.lengthM < 30 ? '16-30' : l.lengthM < 60 ? '30-60' : l.lengthM < 100 ? '60-100' : '100+';
          lenBins[bin] = (lenBins[bin] ?? 0) + w[i];
          if (ex.length < 25 && env.P17_EX) { const r = b.roads.get(l.roadId); const to = a.nodes[l.to];
            ex.push({ id: l.id, hw: r?.osmProvenance?.originalTags?.highway, name: r?.name, len: Math.round(l.lengthM), ffs: +l.freeSpeedKmh.toFixed(1), sig: +(l.t0 - l.lengthM / (l.freeSpeedKmh / 3.6)).toFixed(1), jd: +(z.junctionDelayS?.[i] ?? 0).toFixed(1), ctl: l.junction, arms: net.signalised.has(to) ? 'S' : '', toC: a.nodeCoords[l.to].slice(0, 2).map(x => +x.toFixed(5)), kmh: +kmh.toFixed(1), vkm: +w[i].toFixed(1) }); }
        }
        const norm = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / wsum).toFixed(k === 'lenM' ? 0 : 3)]));
        log({ area: b.rec.id, hour, signalPointsMapped: mapped.length, signalisedNodes: net.signalised.size, srcCount, inferred: inferred.length, warranted: warranted.length,
          p10: { free: p10, runOnly: wq(kRun, w, 0.1), runSig: wq(kRunSig, w, 0.1), runJunction: wq(kRunJ, w, 0.1), hour: wq(kHour, w, 0.1) },
          median: { free: wq(kFree, w, 0.5), hour: wq(kHour, w, 0.5) },
          slowDecile: { sPerVkmShare: norm({ run: slow.run, sig: slow.sig, junction: slow.junction }), meanLenM: +(slow.lenM / wsum).toFixed(0), byClass: norm(slowCls), byControl: norm(slowSrc), lenBins: norm(lenBins) }, peak, ex });
      }
    }
  }, 3600_000);
});
