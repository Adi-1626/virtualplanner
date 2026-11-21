import { describe, it, expect, beforeAll } from 'vitest';
import type { RoadObject } from '../objects/types';
import type { DrivableObject } from '../simulation/StudyAreaExplorer';
import { SimulationMode } from '../simulation/SimulationMode';
import { STEP_S, type VehicleView } from '../simulation/TrafficMicroSim';
import { LiveTrafficCore, FRAME_STRIDE, NO_SIGNAL, readVehicle, type LiveFrame, type LiveInit } from '../simulation/liveTrafficCore';
import { attachLiveWorker, type LiveWorkerScope } from '../simulation/liveTrafficWorkerMain';
import { createLiveRun, FrameInterpolator, InlineLiveRun, WorkerLiveRun, type LiveRunEvents } from '../simulation/liveTrafficRun';
import type { LiveCommand, LiveEvent } from '../simulation/liveTrafficProtocol';

/**
 * The live view's simulation in a Web Worker (liveTraffic*.ts, docs/urbanos/SIMULATE_WORKSPACE.md developer
 * appendix). Node has no module workers, so a stand-in worker runs the real worker code (attachLiveWorker) and
 * structured-clones every message both ways, as a browser does: what cannot cross a thread boundary fails here too.
 */

const LAT0 = 18.5;
const M_LAT = 1 / 111320;
const M_LNG = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180));
const pt = (x: number, y: number): [number, number, number] => [73.8 + x * M_LNG, LAT0 + y * M_LAT, 0];
const road = (id: string, a: [number, number], b: [number, number]): RoadObject => ({
  id, type: 'road', name: id, layerId: 'roads', scenarioId: 'base', coordinates: [pt(...a), pt(...b)],
  roadClass: 'arterial', width: 10, laneCount: 2, laneWidth: 3.5, hasDivider: false, dividerWidth: 0, hasFootpath: false, footpathWidth: 0,
  speedLimit: 50, isOneWay: false, trafficCapacity: 2000, connectedJunctions: [], createdAt: '', updatedAt: '',
});
const corridor = (): DrivableObject[] => {
  const roads: DrivableObject[] = [road('mid', [0, 0], [600, 0])];
  for (let x = 0; x > -3000; x -= 250) roads.push(road(`w${-x}`, [x - 250, 0], [x, 0]));
  for (let x = 600; x < 3600; x += 250) roads.push(road(`e${x}`, [x, 0], [x + 250, 0]));
  return roads;
};
const until = async (cond: () => boolean, ms = 90000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};

/** A worker stand-in: the real worker code on the other side, messages cloned (and delivered later) both ways. */
class FakeWorker {
  onmessage: ((e: MessageEvent<LiveEvent>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly commands: LiveCommand[] = [];
  readonly events: LiveEvent[] = [];
  private readonly scope: LiveWorkerScope;
  private readonly stop: () => void;
  constructor() {
    this.scope = {
      onmessage: null,
      postMessage: (message: LiveEvent) => {
        const data = structuredClone(message);
        setTimeout(() => { if (!this.terminated) { this.events.push(data); this.onmessage?.({ data } as MessageEvent<LiveEvent>); } }, 0);
      },
    };
    this.stop = attachLiveWorker(this.scope);
  }
  postMessage(command: LiveCommand) {
    const data = structuredClone(command);
    this.commands.push(data);
    setTimeout(() => { if (!this.terminated) this.scope.onmessage?.({ data } as MessageEvent<LiveCommand>); }, 0);
  }
  terminate() { this.terminated = true; this.stop(); }
}

const recorder = () => {
  const log: string[] = [];
  let lastError = '';
  const events: LiveRunEvents = {
    progress: () => { log.push('progress'); },
    ready: () => { log.push('ready'); },
    empty: () => { log.push('empty'); },
    metrics: () => { log.push('metrics'); },
    error: m => { log.push('error'); lastError = m; },
  };
  return { log, events, error: () => lastError };
};

/** The live run the Simulate panel starts on the test corridor, through a fake worker; its init is kept for the other tests. */
let init: LiveInit;
let modeRun: { threaded: boolean | null | undefined; vehicles: number; terminatedOnStop: boolean; stoppedClean: boolean };

beforeAll(async () => {
  const roads = corridor();
  const mode = new SimulationMode(() => roads);
  mode.analysisSeeds = [42];
  const workers: FakeWorker[] = [];
  mode.liveWorkerFactory = () => { const w = new FakeWorker(); workers.push(w); return w as unknown as Worker; };
  mode.enter();
  mode.setRange(500);
  mode.selectRoad('mid', false);
  mode.setTrafficSpeed(5);
  mode.startTraffic();
  await until(() => mode.getState().traffic.status === 'running');
  await until(() => mode.resources().vehicles > 0, 20000);
  const r = mode.resources();
  const first = workers[0].commands.find(c => c.type === 'init');
  init = (first as Extract<LiveCommand, { type: 'init' }>).init;
  mode.stopTraffic();
  const after = mode.resources();
  modeRun = { threaded: r.liveThreaded, vehicles: r.vehicles, terminatedOnStop: workers[0].terminated, stoppedClean: !after.liveSim && after.liveThreaded === null && after.vehicles === 0 };
  mode.dispose();
}, 180000);

describe('Simulate starts its live view in the worker', () => {
  it('the panel run goes through the worker, shows vehicles from its frames, and Stop terminates it', () => {
    expect(modeRun.threaded).toBe(true);
    expect(modeRun.vehicles).toBeGreaterThan(0);
    expect(modeRun.terminatedOnStop).toBe(true);
    expect(modeRun.stoppedClean).toBe(true);
  });
  it('the init crosses a thread boundary (structured clone) with its maps intact', () => {
    expect(init.roads instanceof Map).toBe(true);
    expect(init.roads.size).toBeGreaterThan(0);
    expect(init.plan.trips.length).toBeGreaterThan(0);
    // Only the corridor's roads go to the worker, not the whole city
    expect(init.roads.size).toBeLessThan(corridor().length);
  });
});

describe('the worker run through attachLiveWorker', () => {
  it('warms up, then streams frames and metrics; pause holds, speed and demand reach the worker; dispose terminates', async () => {
    const rec = recorder();
    let worker: FakeWorker | null = null;
    const run = createLiveRun(structuredClone(init), 10, rec.events, () => (worker = new FakeWorker()) as unknown as Worker);
    expect(run).toBeInstanceOf(WorkerLiveRun);
    expect(run.threaded).toBe(true);
    run.start();
    expect(run.warming()).toBe(true);
    await until(() => rec.log.includes('ready'), 60000);
    expect(run.warming()).toBe(false);
    // The worker sends a frame as soon as the warm-up ends: vehicles are on the roads before Start
    await until(() => run.vehicleCount() > 0, 5000);
    run.run();
    await until(() => rec.log.includes('metrics') && run.ratios() !== null, 5000);
    const t1 = worker!.events.filter(e => e.type === 'frame').length;
    await new Promise(r => setTimeout(r, 200));
    expect(worker!.events.filter(e => e.type === 'frame').length).toBeGreaterThan(t1);
    let seen = 0;
    run.forEachVehicle(v => { seen++; expect(Number.isFinite(v.lng) && Number.isFinite(v.lat)).toBe(true); });
    expect(seen).toBe(run.vehicleCount());

    run.pause();
    await new Promise(r => setTimeout(r, 120));
    const paused = worker!.events.filter(e => e.type === 'frame').length;
    await new Promise(r => setTimeout(r, 200));
    expect(worker!.events.filter(e => e.type === 'frame').length).toBe(paused);

    run.setSpeed(20);
    run.setDemand(0.5, 0);
    await new Promise(r => setTimeout(r, 50));
    expect(worker!.commands.map(c => c.type)).toEqual(expect.arrayContaining(['init', 'run', 'pause', 'speed', 'demand']));
    run.dispose();
    expect(worker!.terminated).toBe(true);
    expect(run.warming()).toBe(false);
  }, 90000);

  it('an init the worker cannot use reports an error and ends the worker', async () => {
    const rec = recorder();
    let worker: FakeWorker | null = null;
    const run = createLiveRun({} as LiveInit, 5, rec.events, () => (worker = new FakeWorker()) as unknown as Worker);
    run.start();
    await until(() => rec.log.includes('error'), 5000);
    expect(rec.error().length).toBeGreaterThan(0);
    expect(worker!.terminated).toBe(true);
  });

  it('without workers (Node) the run is inline on this thread, with the same events', async () => {
    const rec = recorder();
    const run = createLiveRun(structuredClone(init), 5, rec.events);
    expect(run).toBeInstanceOf(InlineLiveRun);
    expect(run.threaded).toBe(false);
    run.start();
    await until(() => rec.log.includes('ready'), 60000);
    expect(run.vehicleCount()).toBeGreaterThan(0);
    run.dispose();
    expect(run.vehicleCount()).toBe(0);
  }, 90000);
});

describe('step budget', () => {
  it('steps the real time passed × speed, clamps a long gap, and falls behind (dropping steps) when the budget is spent', () => {
    const core = new LiveTrafficCore(structuredClone(init));
    // 0.1 s at 5× = 0.5 s simulated = 2 steps
    expect(core.advance(0.1, 5, 1000)).toBe(2);
    expect(core.behind).toBe(false);
    // A background tab's 30 s gap counts as 0.25 s: 0.25 s × 4 = 1 s = 4 steps, not 480
    expect(core.advance(30, 4, 1000)).toBe(Math.round(1 / STEP_S));
    // No budget: nothing steps, the debt is dropped (not carried into the next frame) and the run says it is behind
    expect(core.advance(0.25, 20, 0)).toBe(0);
    expect(core.behind).toBe(true);
    expect(core.aheadS()).toBe(0);
    // Keeping up again clears the flag
    expect(core.advance(0.25, 1, 1000)).toBe(1);
    expect(core.behind).toBe(false);
    // A negative gap (clock jitter) steps nothing
    expect(core.advance(-1, 5, 1000)).toBe(0);
  });

  it('frames pack every vehicle (STRIDE numbers each) and read back unchanged', () => {
    const core = new LiveTrafficCore(structuredClone(init));
    while (core.warmUp(50) < 1) { /* warm up */ }
    const views: VehicleView[] = [];
    core.sim.forEachVehicle(v => views.push({ ...v }), core.aheadS());
    const f = core.frame();
    expect(f.count).toBe(views.length);
    expect(f.data.length).toBe(views.length * FRAME_STRIDE);
    const out = {} as VehicleView;
    views.forEach((v, i) => {
      readVehicle(f.data, i, out);
      expect(out).toEqual({ id: v.id, kind: v.kind, lng: v.lng, lat: v.lat, z: v.z, heading: v.heading, pitch: v.pitch, speedKmh: v.speedKmh, speedRatio: v.speedRatio, opacity: v.opacity, focus: !!v.focus });
    });
  });
});

describe('frame interpolation', () => {
  const frame = (timeS: number, vehicles: [number, number, number, number][], signals: number[] = [], newHeads: LiveFrame['newHeads'] = []): LiveFrame => {
    const data = new Float64Array(vehicles.length * FRAME_STRIDE);
    vehicles.forEach(([id, lng, lat, heading], i) => data.set([id, 1, lng, lat, 0, heading, 0, 30, 0.6, 1, 0], i * FRAME_STRIDE));
    return { timeS, count: vehicles.length, data, signalStates: Uint8Array.from(signals), newHeads, behind: false };
  };
  const positions = (f: FrameInterpolator) => { const r: Record<number, [number, number, number]> = {}; f.forEachVehicle(v => { r[v.id] = [v.lng, v.lat, v.heading]; }); return r; };

  it('the first frame is drawn as it is', () => {
    const f = new FrameInterpolator();
    f.push(frame(0, [[1, 10, 20, 0]]), 1000);
    f.at(1010);
    expect(positions(f)[1]).toEqual([10, 20, 0]);
  });

  it('between two frames a vehicle moves linearly over the measured interval; a new vehicle appears where it is', () => {
    const f = new FrameInterpolator();
    f.push(frame(0, [[1, 0, 0, 0]]), 1000);
    f.push(frame(1, [[1, 10, 20, 0], [2, 5, 5, 0]]), 1040);
    f.at(1040);
    expect(positions(f)[1]).toEqual([0, 0, 0]);
    f.at(1060);
    expect(positions(f)[1][0]).toBeCloseTo(5);
    expect(positions(f)[1][1]).toBeCloseTo(10);
    expect(positions(f)[2]).toEqual([5, 5, 0]);
    // Past the interval it stops at the latest frame (never extrapolates)
    f.at(5000);
    expect(positions(f)[1]).toEqual([10, 20, 0]);
    // A vehicle that left is not drawn
    f.push(frame(2, [[2, 6, 6, 0]]), 1080);
    f.at(1080);
    expect(Object.keys(positions(f))).toEqual(['2']);
    expect(f.count()).toBe(1);
    expect(f.timeS()).toBe(2);
  });

  it('heading turns the short way across ±π', () => {
    const f = new FrameInterpolator();
    f.push(frame(0, [[1, 0, 0, Math.PI - 0.1]]), 0);
    f.push(frame(1, [[1, 0, 0, -Math.PI + 0.1]]), 100);
    f.at(150);
    const h = positions(f)[1][2];
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(1e-9);
  });

  it('signal heads: sent once, kept, and lamps not shown now are skipped', () => {
    const f = new FrameInterpolator();
    const head = (id: string) => ({ id, lng: 1, lat: 2, z: 0, heading: 0 });
    f.push(frame(0, [], [2], [head('a')]), 0);
    f.push(frame(1, [], [0, NO_SIGNAL], [head('b')]), 33);
    const seen: [string, string][] = [];
    f.forEachSignal((id, _at, state) => seen.push([id, state]));
    expect(seen).toEqual([['a', 'red']]);
  });
});
