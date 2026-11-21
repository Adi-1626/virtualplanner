import type { MicroSimMetrics } from './TrafficMicroSim';
import type { LiveFrame, LiveInit } from './liveTrafficCore';

/** Messages between the live view (main thread) and its worker (liveTraffic.worker.ts). */
export type LiveCommand =
  | { type: 'init'; init: LiveInit; speed: number }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'speed'; speed: number }
  | { type: 'demand'; level: number; focusLoad: number };

export type LiveEvent =
  | { type: 'init'; entries: number; metrics: MicroSimMetrics }
  | { type: 'progress'; share: number }
  | { type: 'ready'; metrics: MicroSimMetrics }
  | { type: 'frame'; frame: LiveFrame }
  | { type: 'metrics'; metrics: MicroSimMetrics; behind: boolean }
  | { type: 'ratios'; ratios: Map<string, number> }
  | { type: 'error'; error: string };

/** Worker tick (real ms): one frame of vehicles per tick, about 30 a second. */
export const LIVE_TICK_MS = 33;
/** Most real ms the worker spends stepping per tick; beyond it the run falls behind real time. */
export const LIVE_STEP_BUDGET_MS = 28;
/** Warm-up slice in the worker (real ms) between progress messages. */
export const LIVE_WARMUP_SLICE_MS = 60;
/** On the main thread (no workers: tests, old browsers): warm-up slice and stepping budget per frame. */
export const INLINE_WARMUP_SLICE_MS = 14;
export const INLINE_STEP_BUDGET_MS = 10;
