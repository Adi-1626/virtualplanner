import type { MicroSimMetrics, SignalState, VehicleView } from './TrafficMicroSim';
import { LiveTrafficCore, readVehicle, FRAME_STRIDE, SIGNAL_CODES, NO_SIGNAL, type LiveFrame, type LiveInit, type SignalHeadInfo } from './liveTrafficCore';
import { INLINE_STEP_BUDGET_MS, INLINE_WARMUP_SLICE_MS, LIVE_TICK_MS, type LiveCommand, type LiveEvent } from './liveTrafficProtocol';

/** What the vehicle drawing reads: TrafficMicroSim itself, or a live run's latest frames. */
export interface VehicleSource {
  forEachVehicle(visit: (vehicle: Readonly<VehicleView>) => void, aheadS?: number): void;
  forEachSignal(visit: (linkId: string, at: { lng: number; lat: number; z: number; heading: number }, state: SignalState) => void): void;
}

export interface LiveRunEvents {
  /** Warm-up progress, 0–1. */
  progress(share: number): void;
  /** The warm-up is done: the run can be shown and started. */
  ready(metrics: MicroSimMetrics): void;
  /** No traffic enters the corridor at this hour: nothing to show. */
  empty(): void;
  metrics(metrics: MicroSimMetrics, behind: boolean): void;
  error(message: string): void;
}

/**
 * One live run of the selected road's neighbourhood (docs/urbanos/SIMULATE_WORKSPACE.md, developer appendix). The
 * simulation runs in a Web Worker when the browser has them (WorkerLiveRun), else on this thread (InlineLiveRun,
 * tests). Either way the map only draws: `advance` is called once per animation frame.
 */
export interface LiveRun extends VehicleSource {
  readonly threaded: boolean;
  start(): void;
  run(): void;
  pause(): void;
  setSpeed(speed: number): void;
  setDemand(level: number, focusLoad: number): void;
  /** Once per animation frame (real time `nowMs`): the inline run steps here, the worker run picks what to draw. */
  advance(nowMs: number): void;
  /** Speed as a share of the limit per road stretch, latest (null before the first). */
  ratios(): Map<string, number> | null;
  metrics(): MicroSimMetrics | null;
  /** The run fell behind real time at the chosen speed (the machine cannot step it fast enough). */
  behind(): boolean;
  vehicleCount(): number;
  warming(): boolean;
  dispose(): void;
}

const canUseWorker = () => typeof Worker !== 'undefined' && typeof window !== 'undefined' && !(globalThis as { __VP_NO_WORKER__?: boolean }).__VP_NO_WORKER__;

/** A live run: in a worker when possible. `makeWorker` is for tests. */
export function createLiveRun(init: LiveInit, speed: number, events: LiveRunEvents, makeWorker?: () => Worker): LiveRun {
  if (makeWorker || canUseWorker()) {
    try {
      const worker = makeWorker ? makeWorker() : new Worker(new URL('./liveTraffic.worker.ts', import.meta.url), { type: 'module' });
      return new WorkerLiveRun(worker, init, speed, events);
    } catch {
      // No module workers here: run on this thread
    }
  }
  return new InlineLiveRun(init, speed, events);
}

/** On the calling thread: the warm-up in short slices, then budgeted steps in each animation frame. */
export class InlineLiveRun implements LiveRun {
  readonly threaded = false;
  private core: LiveTrafficCore | null;
  private warmupHandle: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private running = false;
  private speed: number;
  private readonly events: LiveRunEvents;

  constructor(init: LiveInit, speed: number, events: LiveRunEvents) {
    this.core = new LiveTrafficCore(init);
    this.speed = speed;
    this.events = events;
  }

  start() {
    const core = this.core;
    if (!core) return;
    if (core.entries() === 0) { this.events.empty(); return; }
    const slice = () => {
      this.warmupHandle = null;
      if (this.core !== core) return;
      const p = core.warmUp(INLINE_WARMUP_SLICE_MS);
      if (p < 1) { this.events.progress(p); this.warmupHandle = setTimeout(slice, 0); return; }
      this.events.ready(core.metrics());
    };
    this.warmupHandle = setTimeout(slice, 0);
  }
  run() { this.running = true; this.lastFrameAt = performance.now(); }
  pause() { this.running = false; }
  setSpeed(speed: number) { this.speed = speed; }
  setDemand(level: number, focusLoad: number) { this.core?.setDemand(level, focusLoad); }
  advance(nowMs: number) {
    if (!this.core || !this.running) return;
    const dt = (nowMs - this.lastFrameAt) / 1000;
    this.lastFrameAt = nowMs;
    this.core.advance(dt, this.speed, INLINE_STEP_BUDGET_MS);
  }
  forEachVehicle(visit: (v: Readonly<VehicleView>) => void) { this.core?.sim.forEachVehicle(visit, this.core.aheadS()); }
  forEachSignal(visit: Parameters<VehicleSource['forEachSignal']>[0]) { this.core?.sim.forEachSignal(visit); }
  ratios() { return this.core ? this.core.ratios() : null; }
  metrics() { return this.core ? this.core.metrics() : null; }
  behind() { return this.core?.behind ?? false; }
  vehicleCount() { let n = 0; this.core?.sim.forEachVehicle(() => { n++; }); return n; }
  warming() { return this.warmupHandle !== null; }
  dispose() {
    if (this.warmupHandle !== null) clearTimeout(this.warmupHandle);
    this.warmupHandle = null;
    this.core = null;
    this.running = false;
  }
}

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

/**
 * Draws a worker's frames: between the last two frames received, vehicles move linearly over one tick (so the map
 * runs at its own frame rate while frames arrive about 30 times a second, one tick behind the simulation).
 */
export class FrameInterpolator {
  private prev: LiveFrame | null = null;
  private cur: LiveFrame | null = null;
  private prevIndex = new Map<number, number>();
  private receivedAt = 0;
  private interval = LIVE_TICK_MS;
  private alpha = 1;
  private readonly heads: SignalHeadInfo[] = [];
  private readonly view: VehicleView = { id: 0, kind: 'car', lng: 0, lat: 0, z: 0, heading: 0, pitch: 0, speedRatio: 0, speedKmh: 0, opacity: 1, focus: false };
  private readonly other: VehicleView = { id: 0, kind: 'car', lng: 0, lat: 0, z: 0, heading: 0, pitch: 0, speedRatio: 0, speedKmh: 0, opacity: 1, focus: false };

  push(frame: LiveFrame, nowMs: number) {
    for (const h of frame.newHeads) this.heads.push(h);
    if (this.cur) {
      this.interval = Math.max(8, Math.min(250, nowMs - this.receivedAt));
      this.prev = this.cur;
      this.prevIndex.clear();
      const d = this.prev.data;
      for (let i = 0; i < this.prev.count; i++) this.prevIndex.set(d[i * FRAME_STRIDE], i);
    }
    this.cur = frame;
    this.receivedAt = nowMs;
    this.alpha = this.prev ? 0 : 1;
  }

  /** Sets the drawing time: how far from the previous frame to the latest. */
  at(nowMs: number) {
    this.alpha = this.prev ? Math.max(0, Math.min(1, (nowMs - this.receivedAt) / this.interval)) : 1;
  }

  count() { return this.cur?.count ?? 0; }
  timeS() { return this.cur?.timeS ?? null; }

  forEachVehicle(visit: (v: Readonly<VehicleView>) => void) {
    const cur = this.cur;
    if (!cur) return;
    const t = this.alpha, v = this.view, o = this.other;
    for (let i = 0; i < cur.count; i++) {
      readVehicle(cur.data, i, v);
      const j = t < 1 && this.prev ? this.prevIndex.get(v.id) : undefined;
      if (j !== undefined) {
        readVehicle(this.prev!.data, j, o);
        v.lng = o.lng + (v.lng - o.lng) * t;
        v.lat = o.lat + (v.lat - o.lat) * t;
        v.z = o.z + (v.z - o.z) * t;
        v.heading = lerpAngle(o.heading, v.heading, t);
        v.pitch = o.pitch + (v.pitch - o.pitch) * t;
        v.opacity = o.opacity + (v.opacity - o.opacity) * t;
      }
      visit(v);
    }
  }

  forEachSignal(visit: Parameters<VehicleSource['forEachSignal']>[0]) {
    const s = this.cur?.signalStates;
    if (!s) return;
    for (let i = 0; i < s.length && i < this.heads.length; i++) {
      if (s[i] === NO_SIGNAL) continue;
      const h = this.heads[i];
      visit(h.id, h, SIGNAL_CODES[s[i]]);
    }
  }
}

/** In a Web Worker: this thread only receives frames and draws them. */
export class WorkerLiveRun implements LiveRun {
  readonly threaded = true;
  private worker: Worker | null;
  private readonly frames = new FrameInterpolator();
  private lastMetrics: MicroSimMetrics | null = null;
  private lastRatios: Map<string, number> | null = null;
  private isBehind = false;
  private isWarming = false;
  private readonly events: LiveRunEvents;
  private readonly init: LiveInit;
  private speed: number;

  constructor(worker: Worker, init: LiveInit, speed: number, events: LiveRunEvents) {
    this.worker = worker;
    this.init = init;
    this.speed = speed;
    this.events = events;
    worker.onmessage = (e: MessageEvent<LiveEvent>) => this.onEvent(e.data);
    worker.onerror = ev => { this.events.error(ev.message || 'The live view stopped: its worker failed.'); this.dispose(); };
  }

  private send(c: LiveCommand) { this.worker?.postMessage(c); }

  private onEvent(e: LiveEvent) {
    if (!this.worker) return;
    switch (e.type) {
      case 'init':
        this.lastMetrics = e.metrics;
        if (e.entries === 0) { this.isWarming = false; this.events.empty(); this.dispose(); }
        break;
      case 'progress': this.events.progress(e.share); break;
      case 'ready': this.isWarming = false; this.lastMetrics = e.metrics; this.events.ready(e.metrics); break;
      case 'frame': this.frames.push(e.frame, performance.now()); if (e.frame.behind !== this.isBehind) this.isBehind = e.frame.behind; break;
      case 'metrics': this.lastMetrics = e.metrics; this.isBehind = e.behind; this.events.metrics(e.metrics, e.behind); break;
      case 'ratios': this.lastRatios = e.ratios; break;
      case 'error': this.events.error(e.error); this.dispose(); break;
    }
  }

  start() { this.isWarming = true; this.send({ type: 'init', init: this.init, speed: this.speed }); }
  run() { this.send({ type: 'run' }); }
  pause() { this.send({ type: 'pause' }); }
  setSpeed(speed: number) { this.speed = speed; this.send({ type: 'speed', speed }); }
  setDemand(level: number, focusLoad: number) { this.send({ type: 'demand', level, focusLoad }); }
  advance(nowMs: number) { this.frames.at(nowMs); }
  forEachVehicle(visit: (v: Readonly<VehicleView>) => void) { this.frames.forEachVehicle(visit); }
  forEachSignal(visit: Parameters<VehicleSource['forEachSignal']>[0]) { this.frames.forEachSignal(visit); }
  ratios() { return this.lastRatios; }
  metrics() { return this.lastMetrics; }
  behind() { return this.isBehind; }
  vehicleCount() { return this.frames.count(); }
  warming() { return this.isWarming; }
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.isWarming = false;
  }
}
