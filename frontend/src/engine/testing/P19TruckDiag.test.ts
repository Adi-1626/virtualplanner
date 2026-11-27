/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P19 truck-starvation diagnosis (opt-in: P19TRUCK=<micro dump from P16_MICRO_DUMP>, P18_NODE, P19_EXIT=<exit link id>,
 * GW=1 ENTRY_GIVE_WAY, RA=1 ROOM_ANY_LANE): prints the long vehicles held for room at the node and every vehicle that
 * enters the exit link (which approach it came from, or a trip entering at the node), so who takes the room is visible.
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import { TrafficMicroSim, STEP_S, ENTRY_GIVE_WAY, ROOM_ANY_LANE } from '../simulation/TrafficMicroSim';
const env = process.env;
describe.skipIf(!env.P19TRUCK)('p19 truck diag', () => {
  it('who takes the room', () => {
    ENTRY_GIVE_WAY.enabled = env.GW === '1'; ROOM_ANY_LANE.enabled = env.RA === '1';
    const d = v8.deserialize(fs.readFileSync(env.P19TRUCK!)) as any;
    const sim = new TrafficMicroSim(d.corridor, d.roads, { ...d.simOptions, seed: Number(env.P18_SEED ?? 42), watchSegmentKeys: d.watch, demandTrips: d.micro, desiredSpeedKmh: d.desired, pcuSet: 'indo-hcm' } as never);
    sim.setHourFactor(1);
    const s = sim as any;
    for (let i = 0; i < Math.round(Number(env.P18_T ?? 480) / STEP_S); i++) sim.step();
    const node = env.P18_NODE!;
    const exit = s.links.find((l: any) => l.id === env.P19_EXIT);
    const srcAt = s.sources.filter((x: any) => x.nodeId.includes(node) || x.nodeId === exit.from).map((x: any) => x.nodeId + ' q' + x.queue.length);
    console.log('exit', exit.id, 'from', exit.from, 'sources', JSON.stringify(srcAt));
    const seen = new Set<any>(exit.lanes.flat());
    const log: string[] = [];
    for (let i = 0; i < Math.round(Number(env.P18_TRACE ?? 60) / STEP_S); i++) {
      sim.step();
      for (const l of s.links) if (l.to === exit.from) for (const ln of l.lanes) { const f = ln[0]; if (f && f.waitS > 60 && f.type.lengthM > 6 && i % 20 === 0) log.push(`t${s.t.toFixed(1)} front ${l.id} lane ${f.lane} len ${f.type.lengthM} hold ${f.hold} holdNext ${s.links[f.holdNext]?.id} grant ${f.grantLane} w${f.waitS.toFixed(0)}`); }
      exit.lanes.forEach((ln: any[], k: number) => ln.forEach((v: any) => { if (!seen.has(v)) { seen.add(v); log.push(`t${s.t.toFixed(1)} NEW lane ${k} pos ${v.pos.toFixed(1)} routeIdx ${v.routeIdx} prev ${s.links[v.route[v.routeIdx - 1]]?.id} len ${v.type.lengthM} kind ${v.type.kind}`); } }));
    }
    console.log(log.join('\n'));
  });
});
