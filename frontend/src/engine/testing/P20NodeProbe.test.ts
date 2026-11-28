/**
 * P20 probe (opt-in: P20PROBE=<micro dump from P16_MICRO_DUMP>, P18_SEED, P20_NODETURN): runs the corridor
 * micro-simulation of a dump as the harness does (warm 300 s + measured 300 s) and prints the gridlock sites at the end
 * (node, vehicles, longest stand), so a fix can be checked on the dump before a harness run.
 */
import { describe, it } from 'vitest';
import fs from 'fs';
import v8 from 'v8';
import { TrafficMicroSim, STEP_S, NODE_TURNS } from '../simulation/TrafficMicroSim';

const env = process.env;
describe.skipIf(!env.P20PROBE)('p20 node probe', () => {
  it('prints gridlock sites at the end of the window', () => {
    if (env.P20_NODETURN) NODE_TURNS.enabled = env.P20_NODETURN === '1';
    const d = v8.deserialize(fs.readFileSync(env.P20PROBE!)) as { corridor: never; roads: never; simOptions: Record<string, unknown>; watch: string[]; micro: never; desired: Record<string, number> };
    for (const seed of (env.P18_SEED ?? '42,7').split(',').map(Number)) {
      const sim = new TrafficMicroSim(d.corridor, d.roads, { ...d.simOptions, seed, watchSegmentKeys: d.watch, demandTrips: d.micro, desiredSpeedKmh: d.desired, pcuSet: 'indo-hcm' } as never);
      sim.setHourFactor(1);
      for (let i = 0; i < Math.round(Number(env.P18_T ?? 600) / STEP_S); i++) sim.step();
      const g = sim.gridlockSites().slice(0, 4).map(x => `${x.node.slice(5, 27)} n${x.vehicles} ${Math.round(x.longestS)}s`);
      console.log(`PROBE seed ${seed} NODE_TURNS ${NODE_TURNS.enabled} sites ${g.join(' | ') || '-'}`);
    }
  });
});
