/**
 * P17 junction diagnosis (opt-in: P17DIAG=<dump files, comma-separated>, written by P16Citywide P16_MICRO_DUMP).
 * Runs the corridor micro-simulation as the p16 harness does (seeds 42, 7; P17_S warm,measured seconds) and prints,
 * for every front vehicle standing over 180 s at the end, its wait-for chain: link, length, junctions at both ends and
 * their distance, why it is held, and the front vehicle of the lane it waits on, until the chain closes or ends.
 * P17_OPTS: JSON merged into the micro-simulation options (to compare variants).
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import { TrafficMicroSim, STEP_S } from '../simulation/TrafficMicroSim';

const env = process.env;
const files = env.P17DIAG ? env.P17DIAG.split(',') : [];

describe.skipIf(!files.length)('p17 junction diagnosis', () => {
  it('prints gridlock wait-for chains', () => {
    const [warmS, measS] = (env.P17_S ?? '300,300').split(',').map(Number);
    const extra = env.P17_OPTS ? JSON.parse(env.P17_OPTS) : {};
    for (const f of files) {
      const d = v8.deserialize(fs.readFileSync(f)) as { corridor: never; roads: never; simOptions: Record<string, unknown>; watch: string[]; micro: never; desired: Record<string, number> };
      for (const seed of (env.P17_SEEDS ?? '42,7').split(',').map(Number)) {
        const t0 = Date.now();
        const sim = new TrafficMicroSim(d.corridor, d.roads, { ...d.simOptions, seed, watchSegmentKeys: d.watch, demandTrips: d.micro, desiredSpeedKmh: d.desired, pcuSet: 'indo-hcm', ...extra } as never);
        sim.setHourFactor(1);
        for (let i = 0; i < Math.round(warmS / STEP_S); i++) sim.step();
        sim.startAnalysis();
        const m0 = sim.getMetrics();
        for (let i = 0; i < Math.round(measS / STEP_S); i++) sim.step();
        const m1 = sim.getMetrics();
        const acc = m1.accounting as unknown as Record<string, unknown>;
        console.log(`\n=== ${f.split('/').pop()} seed ${seed}: waiting ${m0.waitingToEnter} -> ${m1.waitingToEnter}, onNet ${m1.onNetwork}, gridlockedNow ${acc.gridlockedNow}, events ${acc.gridlockEvents} ${JSON.stringify(acc.gridlockEventsByCause)}, watched ${m1.watched.meanSpeedKmh?.toFixed(1)} km/h, trip ${m1.tripSpeedKmh.toFixed(1)}, ${Date.now() - t0} ms`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const s = sim as any;
        const coord = (n: string) => sim.nodeCoordinates((s.junctionMembers.get(n)?.[0]) ?? n);
        const dist = (a: string, b: string) => { const p = coord(a), q = coord(b); if (!p || !q) return NaN; return Math.hypot((p[0] - q[0]) * 105600, (p[1] - q[1]) * 111320); };
        const desc = (li: number) => { const l = s.links[li]; const c = s.controls.get(l.to); return `${l.id}(${l.length.toFixed(0)}m,${l.lanes.length}ln,${l.from.slice(5, 22)}->${l.to.slice(5, 22)} ${c ? c.kind + (c.box ? '/box' : '') : 'none'} jdist ${dist(l.from, l.to).toFixed(0)})`; };
        // Edge queues: sources with vehicles waiting to enter, by the link each would enter
        for (const src of s.sources) {
          if (src.queue.length < 15) continue;
          const by = new Map<number, number>();
          for (const v of src.queue) by.set(v.link, (by.get(v.link) ?? 0) + 1);
          const head = src.queue[0].link;
          console.log(`  Q ${src.nodeId.slice(5, 22)} waiting ${src.queue.length}: ${[...by.entries()].map(([li, n]) => `${s.links[li].id}${li === head ? '(head)' : ''} ${n} [${s.links[li].length.toFixed(0)}m ${s.links[li].lanes.map((x: unknown[]) => x.length).join('/')}]`).join(', ')}`);
        }
        if (env.P17_WATCH) {
          // The watched section: each of its links with its queue, the front vehicle's hold and what lies beyond
          const keys = new Set(d.watch);
          const holds = new Map<string, number>();
          for (const l of s.links) {
            if (!keys.has(l.segmentKey)) continue;
            const c = s.controls.get(l.to);
            const vs = l.lanes.flat() as { v: number }[];
            const fronts = l.lanes.map((ln: { hold?: string; holdNext?: number; waitS: number; v: number }[]) => ln[0] ? `${ln[0].hold ?? '-'}${ln[0].holdNext !== undefined ? '>' + s.links[ln[0].holdNext].id + '(' + s.links[ln[0].holdNext].lanes.map((x: unknown[]) => x.length).join('/') + ' of ' + s.links[ln[0].holdNext].length.toFixed(0) + 'm,' + s.links[ln[0].holdNext].lanes.length + 'ln)' : ''} w${ln[0].waitS.toFixed(0)}` : '-');
            const sig = c?.kind === 'signal' ? ` cycle ${c.cycleS?.toFixed(0)} greens ${(c.greens ?? []).map((g: number) => g.toFixed(0)).join('/')} grp ${c.groups.get(l.index)} gr ${s.greenRatio(l.index)?.toFixed(2)}` : '';
            console.log(`  W ${l.id} ${l.length.toFixed(0)}m ${l.lanes.length}ln veh ${vs.length} mean ${(vs.reduce((a, v) => a + v.v, 0) / Math.max(1, vs.length) * 3.6).toFixed(1)} km/h -> ${l.to.slice(5, 22)} ${c ? c.kind + (c.box ? '/box' : '') : 'none'}${sig} outs ${s.links.filter((o: { from: string }) => o.from === l.to).map((o: { id: string; length: number; lanes: unknown[][] }) => o.id + ':' + o.length.toFixed(0) + 'm/' + o.lanes.map(x => x.length).join('/')).join(' ')} | fronts ${fronts.join(' ; ')}`);
          }
          void holds;
          // Downstream of each watched link: follow its front vehicles' next links (6 hops)
          const linkLine = (li: number) => { const l = s.links[li]; const c = s.controls.get(l.to); const vs = l.lanes.flat() as { v: number }[];
            const sig = c?.kind === 'signal' ? ` cyc ${c.cycleS?.toFixed(0)} gr ${s.greenRatio(l.index)?.toFixed(2)} st ${s.signalState(l.index)}${c.box ? ' box' : ''}` : c ? ' ' + c.kind : ' none';
            const fr = l.lanes.map((ln: { hold?: string; holdNext?: number; waitS: number; route: number[]; routeIdx: number; type: { kind: string }; grantLane: number | null }[]) => ln[0] ? `${ln[0].type.kind}:${ln[0].grantLane !== null ? 'granted' : ln[0].hold ?? '-'}>${ln[0].holdNext !== undefined ? s.links[ln[0].holdNext].id : ln[0].routeIdx + 1 < ln[0].route.length ? s.links[ln[0].route[ln[0].routeIdx + 1]].id : 'exit'} w${ln[0].waitS.toFixed(0)}` : '-');
            return `${l.id} ${l.length.toFixed(0)}m ${l.lanes.length}ln n=${l.lanes.map((x: unknown[]) => x.length).join('/')} ${(vs.reduce((a, v) => a + v.v, 0) / Math.max(1, vs.length) * 3.6).toFixed(1)}km/h${sig} | ${fr.join(' ; ')}`; };
          const boxesShown = new Set<string>();
          for (const l of s.links) {
            if (!keys.has(l.segmentKey)) continue;
            let li = l.index; const seen = new Set<number>([li]);
            for (let h = 0; h < 7; h++) {
              const cnt = new Map<number, number>();
              for (const ln of s.links[li].lanes) for (const v of ln) { const nx = v.route[v.routeIdx + 1]; if (nx !== undefined) cnt.set(nx, (cnt.get(nx) ?? 0) + 1); }
              const nx = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
              if (nx === undefined || seen.has(nx)) break;
              seen.add(nx); li = nx;
              console.log(`    D${h + 1} ${linkLine(li)} (${cnt.get(nx)} of the previous link's vehicles head here)`);
              const c = s.controls.get(s.links[li].to);
              if (c?.kind === 'signal' && !boxesShown.has(c.box ?? s.links[li].to)) {
                boxesShown.add(c.box ?? s.links[li].to);
                const assigned = s.assignedLinkPcu();
                const members = [...s.controls.entries()].filter(([n, x]: [string, { box?: string }]) => c.box ? x.box === c.box : n === s.links[li].to);
                console.log(`      signal ${c.box ?? s.links[li].to}: members ${members.length}, cycle ${c.cycleS?.toFixed(0)}, greens ${(c.greens ?? []).map((g: number) => g.toFixed(1)).join('/')}, design ${JSON.stringify(c.design ?? null).slice(0, 300)}`);
                for (const [n, x] of members as [string, { groups: Map<number, number> }][]) for (const [i, g] of x.groups) { const l = s.links[i]; console.log(`        ${n.slice(5, 22)} in ${l.id} ${l.length.toFixed(0)}m ${l.lanes.length}ln w${(l.lanes.length * l.laneWidth).toFixed(1)} grp ${g} assigned ${assigned[i].toFixed(0)} pcu/h design ${s.designFlows.get(i) ?? '-'} queue ${l.lanes.map((q: unknown[]) => q.length).join('/')}`); }
              }
            }
          }
        }
        const shown = new Set<unknown>();
        for (const i of s.busy) {
          for (const lane of s.links[i].lanes) {
            const v = lane[0];
            if (!v || v.waitS <= 180 || shown.has(v)) continue;
            const chain: string[] = [];
            let cur = v, li = i, hops = 0;
            while (cur && hops++ < 8) {
              shown.add(cur);
              const nx = cur.route[cur.routeIdx + 1];
              chain.push(`[${cur.type.kind} w${cur.waitS.toFixed(0)} pos${cur.pos.toFixed(0)} hold=${cur.hold ?? (cur.grantLane !== null ? 'granted' : '-')} arr=${!!cur.arriving}] on ${desc(li)} -> next ${nx !== undefined ? desc(nx) : 'exit'} lanes ${s.links[li].lanes.map((x: unknown[]) => x.length).join('/')}`);
              if (cur.hold === 'conflict' || cur.hold === 'give-way') {
                const node = s.links[li].to;
                for (const r of s.reservations) if (r.node === node && r.from !== li) chain.push(`      claim ${s.links[r.from].id}->${s.links[r.toLink].id} ${r.veh.type.kind} v${r.veh.v.toFixed(1)} w${r.veh.waitS.toFixed(0)} ${r.veh.reservation === r ? 'approaching pos' + r.veh.pos.toFixed(0) + ' on ' + s.links[r.veh.link].id : 'in-box on ' + s.links[r.veh.link].id + ' pos' + r.veh.pos.toFixed(1)}`);
              }
              const target = cur.holdNext ?? nx;
              if (target === undefined) break;
              const tl = s.links[target];
              // front vehicle of the busiest lane of the link it waits on
              let best: { v: unknown; w: number } | null = null;
              for (const ln of tl.lanes) if (ln[0] && (!best || ln[0].waitS > best.w)) best = { v: ln[0], w: ln[0].waitS };
              if (!best || shown.has(best.v)) { if (best) chain.push(`  ... back to an earlier vehicle (cycle)`); break; }
              cur = best.v; li = target;
            }
            console.log('  ' + chain.join('\n    -> '));
          }
        }
      }
    }
  }, 3600_000);
});
