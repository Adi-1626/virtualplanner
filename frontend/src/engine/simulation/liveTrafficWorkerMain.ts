import { LiveTrafficCore, type LiveInit } from './liveTrafficCore';
import { LIVE_TICK_MS, LIVE_STEP_BUDGET_MS, LIVE_WARMUP_SLICE_MS, type LiveCommand, type LiveEvent } from './liveTrafficProtocol';

/** The side of a worker this code talks to: the worker's global scope, or a stand-in in tests. */
export interface LiveWorkerScope {
  postMessage(message: LiveEvent, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<LiveCommand>) => void) | null;
}

/**
 * The live view's simulation off the main thread (liveTrafficCore.ts). One worker per live run, terminated by Stop,
 * a new road or leaving Simulate. It warms up, then ticks: steps for the real time passed × speed within a budget,
 * and posts a frame (vehicles, signal lamps) every tick, metrics twice a second and road speeds once a second.
 * Returns a function that stops its timers (a terminated worker needs none; tests call it).
 */
export function attachLiveWorker(scope: LiveWorkerScope): () => void {
  const post = (e: LiveEvent, transfer: Transferable[] = []) => scope.postMessage(e, transfer);
  let core: LiveTrafficCore | null = null;
  let speed = 5;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0, lastMetrics = 0, lastRatios = 0;

  const sendFrame = () => {
    if (!core) return;
    const f = core.frame();
    post({ type: 'frame', frame: f }, [f.data.buffer, f.signalStates.buffer]);
  };

  const tick = () => {
    timer = null;
    if (!core || !running) return;
    const now = performance.now();
    core.advance((now - last) / 1000, speed, LIVE_STEP_BUDGET_MS);
    last = now;
    sendFrame();
    if (now - lastMetrics > 500) { lastMetrics = now; post({ type: 'metrics', metrics: core.metrics(), behind: core.behind }); }
    if (now - lastRatios > 1000) { lastRatios = now; post({ type: 'ratios', ratios: core.ratios() }); }
    timer = setTimeout(tick, LIVE_TICK_MS);
  };

  const warm = () => {
    timer = null;
    if (!core) return;
    const progress = core.warmUp(LIVE_WARMUP_SLICE_MS);
    if (progress < 1) { post({ type: 'progress', share: progress }); timer = setTimeout(warm, 0); return; }
    post({ type: 'ready', metrics: core.metrics() });
    sendFrame();
  };

  scope.onmessage = (e: MessageEvent<LiveCommand>) => {
    const c = e.data;
    try {
      if (c.type === 'init') {
        core = new LiveTrafficCore(c.init as LiveInit);
        speed = c.speed;
        const entries = core.entries();
        post({ type: 'init', entries, metrics: core.metrics() });
        if (entries > 0) timer = setTimeout(warm, 0);
      } else if (c.type === 'run') {
        if (!core || running) return;
        running = true;
        last = performance.now();
        timer = setTimeout(tick, 0);
      } else if (c.type === 'pause') {
        running = false;
        if (timer) { clearTimeout(timer); timer = null; }
        if (core) { post({ type: 'metrics', metrics: core.metrics(), behind: false }); sendFrame(); }
      } else if (c.type === 'speed') {
        speed = c.speed;
      } else if (c.type === 'demand') {
        core?.setDemand(c.level, c.focusLoad);
        if (core) post({ type: 'metrics', metrics: core.metrics(), behind: core.behind });
      }
    } catch (err) {
      post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };
  return () => { running = false; core = null; if (timer) { clearTimeout(timer); timer = null; } };
}
