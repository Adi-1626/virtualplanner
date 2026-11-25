import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import zlib from 'zlib';
import type { DrivableObject, StudyArea } from '../simulation/StudyAreaExplorer';
import { reachability } from '../simulation/AreaDemand';
import type { SyntheticTripEnd } from '../demand/syntheticDemand';

/**
 * p16 diagnosis of R2 (trips left out: no drivable way) and R3 (building ends far from their node). Opt-in P16ENDS=1,
 * reads P16_CACHE_READ, P16_ONLY. Per area: building ends inside the bounds, distance to the nearest ground node of the
 * area, whether that node is in the area's largest strongly connected component (SCC), distance to the nearest node of
 * that SCC, distance to the nearest vertex of any drivable road object (mapped road, in the area or not), SCC sizes.
 */
const env = process.env;
interface Built { rec: { id: string }; area: StudyArea; roads: Map<string, DrivableObject> }
const M = 111320;
const dist = (a: readonly number[], b: readonly number[]) => { const dx = (a[0] - b[0]) * M * Math.cos(a[1] * Math.PI / 180), dy = (a[1] - b[1]) * M; return Math.hypot(dx, dy); };

describe.skipIf(!env.P16ENDS)('p16 building-end / route diagnosis (opt-in)', () => {
  it('diagnoses', () => {
    const out = env.P16_OUT!;
    const lines = zlib.gunzipSync(fs.readFileSync(env.P16_ENDS!)).toString('utf8').split('\n');
    const ends: SyntheticTripEnd[] = lines.slice(1).filter(Boolean).map(l => { const r = l.split(',').map(Number); return { lon: r[0], lat: r[1], zone: r[2], res: r[3], jobs: r[4], svc: r[5], seats: r[6], ind: r[7] }; });
    const only = env.P16_ONLY ? new Set(env.P16_ONLY.split(',')) : null;
    for (const f of env.P16_CACHE_READ!.split(',')) for (const b of (v8.deserialize(fs.readFileSync(f)) as Built[]).filter(x => !only || only.has(x.rec.id))) {
      const net = b.area.network, inc = new Set(b.area.segments.map(s => s.key));
      const segKey = (id: string) => id.replace(/_(fwd|bwd)$/, '');
      const fwd = new Map<string, string[]>(); const nodeIds = new Set<string>();
      for (const e of net.edges.values()) if (inc.has(segKey(e.id))) { (fwd.get(e.fromNodeId) ?? fwd.set(e.fromNodeId, []).get(e.fromNodeId)!).push(e.toNodeId); nodeIds.add(e.fromNodeId); nodeIds.add(e.toNodeId); }
      const canReach = reachability(fwd);
      // SCC classes by mutual reachability against a sample representative set
      const reps: string[] = []; const comp = new Map<string, number>();
      for (const id of nodeIds) { let c = reps.findIndex(r => canReach(r, id) && canReach(id, r)); if (c < 0) { reps.push(id); c = reps.length - 1; } comp.set(id, c); }
      const size = reps.map((_, i) => [...comp.values()].filter(c => c === i).length);
      const big = size.indexOf(Math.max(...size));
      const nodes = [...nodeIds].map(id => net.nodes.get(id)!).filter(n => n && Math.abs(n.coordinates[2] || 0) <= 3);
      const allNodes = [...net.nodes.values()].filter(n => Math.abs(n.coordinates[2] || 0) <= 3);
      const roadPts: number[][] = [];
      for (const r of b.roads.values()) for (const p of ((r as unknown as { coordinates?: number[][] }).coordinates ?? [])) roadPts.push(p);
      const bb = b.area.bounds;
      const hist = { n: 0, act: 0, near100: 0, inBig: 0, bigNear100: 0, anyNode100: 0, road100: 0, road250: 0, nearNotBig: 0 };
      const farEx: unknown[] = [];
      for (const e of ends) {
        if (e.lon < bb.minLng || e.lon > bb.maxLng || e.lat < bb.minLat || e.lat > bb.maxLat) continue;
        const act = e.res + e.jobs + e.seats + e.ind; if (!(act > 0)) continue;
        const p = [e.lon, e.lat];
        let bd = Infinity, bn = ''; for (const n of nodes) { if (Math.abs(n.coordinates[0] - e.lon) > 0.004 || Math.abs(n.coordinates[1] - e.lat) > 0.004) continue; const d = dist(p, n.coordinates); if (d < bd) { bd = d; bn = n.id; } }
        if (bd > 250) continue; // outside access: buildingsNoRoad
        let bg = Infinity; for (const n of nodes) { if (comp.get(n.id) !== big) continue; if (Math.abs(n.coordinates[0] - e.lon) > 0.004 || Math.abs(n.coordinates[1] - e.lat) > 0.004) continue; const d = dist(p, n.coordinates); if (d < bg) bg = d; }
        let ba = Infinity; for (const n of allNodes) { if (Math.abs(n.coordinates[0] - e.lon) > 0.002 || Math.abs(n.coordinates[1] - e.lat) > 0.002) continue; const d = dist(p, n.coordinates); if (d < ba) ba = d; }
        let br = Infinity; for (const q of roadPts) { if (Math.abs(q[0] - e.lon) > 0.003 || Math.abs(q[1] - e.lat) > 0.003) continue; const d = dist(p, q); if (d < br) br = d; }
        hist.n++; hist.act += act;
        if (bd <= 100) hist.near100 += act; if (comp.get(bn) === big) hist.inBig += act; else if (bd <= 100) hist.nearNotBig += act;
        if (bg <= 100) hist.bigNear100 += act; if (ba <= 100) hist.anyNode100 += act; if (br <= 100) hist.road100 += act; if (br <= 250) hist.road250 += act;
        if (bd > 100 && farEx.length < 8) farEx.push({ p, bd: Math.round(bd), road: Math.round(br), anyNode: Math.round(ba) });
      }
      const sh = (x: number) => +(x / Math.max(1, hist.act)).toFixed(3);
      fs.appendFileSync(out, JSON.stringify({ area: b.rec.id, nodes: nodeIds.size, sccs: size.length, bigScc: size[big], small: size.filter((s, i) => i !== big).sort((a, c) => c - a).slice(0, 8),
        boundary: b.area.boundary.length, boundaryInBig: b.area.boundary.filter(x => comp.get(x.nodeId) === big).length,
        ends: hist.n, near100: sh(hist.near100), inBigScc: sh(hist.inBig), nearButNotBig: sh(hist.nearNotBig), bigSccNode100: sh(hist.bigNear100), anyNetNode100: sh(hist.anyNode100), roadVertex100: sh(hist.road100), roadVertex250: sh(hist.road250), farEx }) + '\n');
    }
  });
});
