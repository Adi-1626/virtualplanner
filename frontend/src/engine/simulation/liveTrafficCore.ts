import type { StudyArea, DrivableObject } from './StudyAreaExplorer';
import { TrafficMicroSim, STEP_S, type MicroSimOptions, type MicroSimMetrics, type SignalState, type VehicleKind, type VehicleView } from './TrafficMicroSim';
import { snapDemandPlan, type DemandPlan } from './StudyDemand';

/**
 * The live view's simulation, without any drawing (docs/urbanos/SIMULATE_WORKSPACE.md, developer appendix). It runs
 * in a Web Worker (liveTraffic.worker.ts) so stepping 1,000–1,500 vehicles never blocks the map; without workers
 * (tests) the same class runs on the calling thread. Stepping is time-boxed: when a frame's budget is spent the run
 * falls behind real time (and says so) instead of freezing the page, which the previous main-thread loop did after
 * one slow frame (up to 20 steps × 51 ms per frame at 20× with 4× CPU throttling, headless; SIMULATE_AUDIT.md).
 */

export interface LiveInit {
  corridor: StudyArea;
  /** Roads of the corridor's network only (not the whole city), keyed by id. */
  roads: ReadonlyMap<string, DrivableObject>;
  options: Omit<MicroSimOptions, 'demandTrips'>;
  /** The analysis's corridor demand, snapped here (not on the main thread). */
  plan: DemandPlan;
  warmupS: number;
}

/** Numbers per vehicle in a frame: id, kind, lng, lat, z, heading, pitch, speedKmh, speedRatio, opacity, focus. */
export const FRAME_STRIDE = 11;
export const KIND_CODES: readonly VehicleKind[] = ['two_wheeler', 'car', 'auto', 'bus', 'truck', 'bus_auto'];
const KIND_INDEX = new Map(KIND_CODES.map((k, i) => [k, i]));
export const SIGNAL_CODES: readonly SignalState[] = ['red', 'amber', 'green'];

export interface SignalHeadInfo { id: string; lng: number; lat: number; z: number; heading: number }

/**
 * One picture of the vehicles at simulated time `timeS`, packed for a transfer between threads. `signalStates[i]` is
 * the lamp of signal head i (SIGNAL_CODES index; 255: not shown now); `newHeads` are heads first seen in this frame,
 * appended to the list in order.
 */
export interface LiveFrame { timeS: number; count: number; data: Float64Array; signalStates: Uint8Array; newHeads: SignalHeadInfo[]; behind: boolean }
export const NO_SIGNAL = 255;

/** Packs vehicles visited by `forEachVehicle` into a frame buffer. */
export function packVehicles(forEach: (visit: (v: Readonly<VehicleView>) => void) => void): { data: Float64Array; count: number } {
  const rows: number[] = [];
  forEach(v => {
    rows.push(v.id, KIND_INDEX.get(v.kind) ?? 1, v.lng, v.lat, v.z, v.heading, v.pitch, v.speedKmh, v.speedRatio, v.opacity, v.focus ? 1 : 0);
  });
  return { data: Float64Array.from(rows), count: rows.length / FRAME_STRIDE };
}

/** Reads vehicle `i` of a frame into `out`. */
export function readVehicle(data: Float64Array, i: number, out: VehicleView): VehicleView {
  const o = i * FRAME_STRIDE;
  out.id = data[o]; out.kind = KIND_CODES[data[o + 1]] ?? 'car';
  out.lng = data[o + 2]; out.lat = data[o + 3]; out.z = data[o + 4]; out.heading = data[o + 5]; out.pitch = data[o + 6];
  out.speedKmh = data[o + 7]; out.speedRatio = data[o + 8]; out.opacity = data[o + 9]; out.focus = data[o + 10] === 1;
  return out;
}

export class LiveTrafficCore {
  readonly sim: TrafficMicroSim;
  private readonly warmupSteps: number;
  private warmupDone = 0;
  private debtS = 0;
  /** The last advance could not keep up with real time at the chosen speed. */
  behind = false;
  private readonly heads: SignalHeadInfo[] = [];
  private readonly headIndex = new Map<string, number>();

  constructor(init: LiveInit) {
    const c = init.corridor;
    this.sim = new TrafficMicroSim(c, init.roads, {
      ...init.options,
      demandTrips: snapDemandPlan(init.plan, c.network, 60, new Set(c.segments.map(s => s.key))),
    });
    this.sim.setHourFactor(1);
    this.warmupSteps = Math.round(init.warmupS / STEP_S);
  }

  /** Traffic enters the corridor at all at this hour. */
  entries(): number {
    return this.sim.getMetrics().entries;
  }

  /** Simulates the warm-up for at most `budgetMs` of real time; returns its progress, 1 when done. */
  warmUp(budgetMs: number): number {
    const t0 = performance.now();
    while (this.warmupDone < this.warmupSteps && performance.now() - t0 < budgetMs) { this.sim.step(); this.warmupDone++; }
    return this.warmupSteps === 0 ? 1 : this.warmupDone / this.warmupSteps;
  }

  /**
   * Advances by `realDtS` of real time at `speed`× within `budgetMs`. The real gap is clamped (a background tab), and
   * steps that do not fit the budget are dropped rather than carried: the run then falls behind real time.
   */
  advance(realDtS: number, speed: number, budgetMs: number): number {
    this.debtS += Math.min(0.25, Math.max(0, realDtS)) * speed;
    const t0 = performance.now();
    let steps = 0;
    while (this.debtS >= STEP_S) {
      if (performance.now() - t0 >= budgetMs) { this.debtS = 0; this.behind = true; return steps; }
      this.sim.step();
      this.debtS -= STEP_S;
      steps++;
    }
    if (steps > 0) this.behind = false;
    return steps;
  }

  /** Simulated time since the last step, for drawing between steps. */
  aheadS(): number {
    return this.debtS;
  }

  frame(): LiveFrame {
    const { data, count } = packVehicles(visit => this.sim.forEachVehicle(visit, this.debtS));
    const newHeads: SignalHeadInfo[] = [];
    const lit = new Map<number, number>();
    this.sim.forEachSignal((id, at, state) => {
      let i = this.headIndex.get(id);
      if (i === undefined) {
        i = this.heads.length;
        const head = { id, lng: at.lng, lat: at.lat, z: at.z, heading: at.heading };
        this.heads.push(head);
        this.headIndex.set(id, i);
        newHeads.push(head);
      }
      lit.set(i, SIGNAL_CODES.indexOf(state));
    });
    const signalStates = new Uint8Array(this.heads.length).fill(NO_SIGNAL);
    lit.forEach((code, i) => { signalStates[i] = code; });
    return { timeS: this.sim.timeS, count, data, signalStates, newHeads, behind: this.behind };
  }

  metrics(): MicroSimMetrics {
    return this.sim.getMetrics();
  }

  ratios(): Map<string, number> {
    return this.sim.segmentSpeedRatios();
  }

  setDemand(level: number, focusLoad: number) {
    this.sim.setDemandLevel(level);
    this.sim.setFocusLoad(focusLoad);
  }
}
