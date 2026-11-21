/**
 * Performance helpers for the Environment workspace (pure parts are unit-tested in EnvTreeTiles.test.ts).
 *
 * Render on demand: while the user is in Environment (and no traffic simulation is animating), the Cesium scene draws a
 * frame only when something changed (Scene.requestRenderMode) instead of 60 times a second over a still map. Cesium
 * itself requests a frame for camera moves and tile / imagery / model loads; this module adds a request for user input,
 * data-source and imagery-layer changes and shell state changes, plus a 1 s heartbeat as a safety net for any other
 * change (so nothing can stay stale for more than a second). Leaving Environment restores continuous rendering exactly
 * as before, so Design, Underground and Simulate are unaffected.
 */
import type { DataSource, Viewer } from 'cesium';

/** Workspaces whose panels draw the Environment layers; elsewhere they are freed (and drawn again on return). */
export const ENV_WORKSPACES = new Set(['environment', 'explore']);

/** Two view boxes [w,s,e,n] are the same draw when no edge moved more than `tol` of the box size. */
export function sameBox(a: number[] | null | undefined, b: number[] | null | undefined, tol = 0.01): boolean {
  if (!a || !b || a.length !== 4 || b.length !== 4) return false;
  const w = Math.max(1e-9, Math.abs(a[2] - a[0])), h = Math.max(1e-9, Math.abs(a[3] - a[1]));
  return Math.abs(a[0] - b[0]) <= tol * w && Math.abs(a[2] - b[2]) <= tol * w && Math.abs(a[1] - b[1]) <= tol * h && Math.abs(a[3] - b[3]) <= tol * h;
}

/** Whether render-on-demand should be on: only in Environment, never while a simulation animates vehicles. */
export const wantsOnDemand = (workspace: string, simAnimating: boolean) => workspace === 'environment' && !simAnimating;

export const HEARTBEAT_MS = 1000;

/**
 * Turns render-on-demand on for `viewer`; returns the function that turns it off again (idempotent). The caller runs the
 * 1 s heartbeat (a render request, and a check that a simulation has not started animating).
 */
export function enableRenderOnDemand(v: Viewer, subscribe: (fn: () => void) => () => void): () => void {
  const scene = v.scene;
  const req = () => { if (!v.isDestroyed()) scene.requestRender(); };
  const offs: (() => void)[] = [];
  const onWin = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'resize'] as const;
  for (const t of onWin) { window.addEventListener(t, req, { passive: true }); offs.push(() => window.removeEventListener(t, req)); }
  const watchDs = (ds: DataSource) => { offs.push(ds.entities.collectionChanged.addEventListener(req)); offs.push(ds.changedEvent.addEventListener(req)); };
  for (let i = 0; i < v.dataSources.length; i++) watchDs(v.dataSources.get(i));
  offs.push(v.dataSources.dataSourceAdded.addEventListener((_c: unknown, ds: DataSource) => { watchDs(ds); req(); }));
  offs.push(v.dataSources.dataSourceRemoved.addEventListener(req));
  offs.push(v.entities.collectionChanged.addEventListener(req));
  const il = v.imageryLayers;
  offs.push(il.layerAdded.addEventListener(req), il.layerRemoved.addEventListener(req), il.layerMoved.addEventListener(req), il.layerShownOrHidden.addEventListener(req));
  offs.push(subscribe(req));
  let off = false;
  const stop = () => {
    if (off) return;
    off = true;
    for (const f of offs) { try { f(); } catch { /* viewer gone */ } }
    if (!v.isDestroyed()) { scene.requestRenderMode = false; scene.requestRender(); }
  };
  scene.maximumRenderTimeChange = Number.POSITIVE_INFINITY;
  scene.requestRenderMode = true;
  req();
  return stop;
}

/** The camera counts as still when its view has not changed for this long (no pick pass while it moves). */
export const STILL_MS = 150;

/**
 * Whether the camera is still, judged from its view matrix itself (sampled on each call), not from Cesium's
 * moveStart / moveEnd: moveEnd is only raised from a later Scene.render, so with render-on-demand or a paused render
 * loop it can arrive late or never, and a flag waiting for it blocked every hover pick.
 */
export function stillness(view: () => ArrayLike<number>, now: () => number = () => performance.now()) {
  const v0 = view();
  const last = Float64Array.from({ length: 16 }, (_, i) => v0[i]);
  let changedAt = -Infinity;
  return () => {
    const m = view();
    let moved = false;
    for (let i = 0; i < 16; i++) if (Math.abs(m[i] - last[i]) > 1e-9 * Math.max(1, Math.abs(last[i]))) { moved = true; break; }
    if (moved) { for (let i = 0; i < 16; i++) last[i] = m[i]; changedAt = now(); }
    return now() - changedAt >= STILL_MS;
  };
}
