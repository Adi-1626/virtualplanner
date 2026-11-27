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
