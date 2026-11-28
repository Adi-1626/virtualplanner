/**
 * P18 stuck-vehicle diagnosis (opt-in: P18STUCK=<dump file written by P16Citywide P16_MICRO_DUMP>, P18_NODE=<sim node id>).
 * Runs the corridor micro-simulation as the harness does and prints the control at the node (kind, phases, greens,
 * groups of its approach links, signal state of each approach over one cycle) so a front vehicle held there for
 * minutes can be traced to its cause.
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import { TrafficMicroSim, STEP_S, NODE_TURNS } from '../simulation/TrafficMicroSim';

const env = process.env;
describe.skipIf(!env.P18STUCK)('p18 stuck diagnosis', () => {
  it('prints the control of a node', () => {
    if (env.P20_NODETURN) NODE_TURNS.enabled = env.P20_NODETURN === '1';
    const d = v8.deserialize(fs.readFileSync(env.P18STUCK!)) as { corridor: never; roads: never; simOptions: Record<string, unknown>; watch: string[]; micro: never; desired: Record<string, number> };
    const sim = new TrafficMicroSim(d.corridor, d.roads, { ...d.simOptions, seed: Number(env.P18_SEED ?? 42), watchSegmentKeys: d.watch, demandTrips: d.micro, desiredSpeedKmh: d.desired, pcuSet: 'indo-hcm' } as never);
    sim.setHourFactor(1);
    for (let i = 0; i < Math.round(Number(env.P18_T ?? 600) / STEP_S); i++) sim.step();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = sim as any;
    const node = env.P18_NODE!;
    for (const [id, c] of s.controls as Map<string, Record<string, unknown>>) {
      if (!id.includes(node)) continue;
      const groups = c.groups as Map<number, number>;
      console.log(`control ${id}: ${JSON.stringify({ ...c, groups: undefined, design: undefined })}`);
      console.log(`  design ${JSON.stringify(c.design)}`);
      for (const l of s.links) {
        if (l.to !== id) continue;
        const seq: string[] = [];
        const t0 = s.t;
        for (let k = 0; k < 240; k += 5) { s.t = t0 + k; seq.push((sim.signalState(l.index) ?? '-')[0]); }
        s.t = t0;
        console.log(`  in ${l.id} ${l.length.toFixed(0)}m grp ${groups.get(l.index)} veh ${l.lanes.flat().length} front ${l.lanes.map((ln: { hold?: string; waitS: number; pos: number }[]) => ln[0] ? ln[0].hold + ' w' + ln[0].waitS.toFixed(0) + ' pos' + ln[0].pos.toFixed(0) : '-').join(';')} states ${seq.join('')}`);
      }
      for (const l of s.links) if (l.from === id) console.log(`  out ${l.id} ${l.length.toFixed(0)}m lanes ${l.lanes.map((x: unknown[]) => x.length).join('/')}`);
    }
    // Trace the longest-waiting front vehicle at the node: every grant request and refusal over P18_TRACE seconds
    let worst: { v: Record<string, unknown>; l: { id: string } } | null = null;
    for (const l of s.links) if (l.to.includes(node)) for (const ln of l.lanes) if (ln[0] && (!worst || ln[0].waitS > (worst.v.waitS as number))) worst = { v: ln[0], l };
    if (!worst) return;
    const veh = worst.v, log: string[] = [];
    const others = new Set<unknown>((worst.l as unknown as { lanes: unknown[][] }).lanes.map(ln => ln[0]).filter(v => v && v !== veh));
    const tg = s.tryGrant.bind(s), rf = s.refuse.bind(s);
    s.tryGrant = (v: unknown, link: { id: string }, dist: number) => { if (v === veh || others.has(v)) log.push(`${v === veh ? 'ME' : 'OT'} t${s.t.toFixed(1)} ask d${dist.toFixed(1)} sig ${sim.signalState((link as unknown as { index: number }).index)}`); return tg(v, link, dist); };
    s.refuse = (link: unknown, reason: string, v: unknown, next: unknown) => { if (v === veh || others.has(v)) log.push(`   -> ${reason}`); return rf(link, reason, v, next); };
    const er = s.exitRoom.bind(s), hf = s.heldFor.bind(s), pi = s.pendingInto.bind(s), bs = s.backSpace.bind(s);
    s.exitRoom = (v: unknown, next: { id: string; lanes: unknown[][] }, k: number, dd: number, con: unknown) => { const r = er(v, next, k, dd, con); if (v === veh || others.has(v)) log.push(`   room ${next.id}[${k}] = ${r.toFixed(1)} held ${hf(next, k, v)} pending ${pi((next as unknown as { index: number }).index, k, v).toFixed(1)} back ${bs(next.lanes[k]).toFixed(1)} need ${s.exitNeed(v, con).toFixed(1)} in-lane ${(next.lanes[k] as { route: number[]; routeIdx: number; pos: number; v: number }[]).map(x => s.links[x.route[x.routeIdx - 1]]?.id?.slice(4, 20) + '@' + x.pos.toFixed(0) + 'v' + x.v.toFixed(1)).join(',')}`); return r; };
    sim.traceGrants();
    let calls = 0;
    for (let i = 0; i < Math.round(Number(env.P18_TRACE ?? 60) / STEP_S); i++) { sim.step(); calls++; }
    console.log(`trace ${worst.l.id} lane ${veh.lane} pos ${(veh.pos as number).toFixed(1)} v ${(veh.v as number).toFixed(2)} route ${(veh.route as number[]).slice(veh.routeIdx as number, (veh.routeIdx as number) + 3).map(i => s.links[i].id).join('>')} conn ${JSON.stringify(veh.connector ?? null)?.slice(0, 200)} grantLane ${veh.grantLane}`);
    console.log(log.slice(0, Number(env.P18_LOGN ?? 400)).join('\n'));
    console.log('grants ' + JSON.stringify([...(sim.grantOutcomes().get(worst.l.id) ?? new Map())]));
  });
});
