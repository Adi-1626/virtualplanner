import type { RoundTripNav } from './roundTripController';

const STATE_KEY = 'uosRoundTrip';
const legOf = (st: unknown): string | null => (st && typeof st === 'object' && typeof (st as Record<string, unknown>)[STATE_KEY] === 'string' ? (st as Record<string, string>)[STATE_KEY] : null);

/**
 * Browser history for a leg (RoundTripNav): pushState adds an entry with the leg id (same URL, so nothing reloads); after
 * a reload the entry is still there and is adopted, not added twice. Taking it off goes back one entry, and that
 * popstate is ours, so it is skipped.
 */
export function browserRoundTripNav(w: Pick<Window, 'history' | 'addEventListener' | 'removeEventListener'> = window): RoundTripNav {
  let marked: string | null = null;
  let skip = 0;
  return {
    mark(id) {
      marked = id;
      if (legOf(w.history.state) === id) return;
      try { w.history.pushState({ ...(w.history.state ?? {}), [STATE_KEY]: id }, ''); } catch { /* history unavailable */ }
    },
    unmark() {
      const id = marked;
      marked = null;
      if (id && legOf(w.history.state) === id) { skip++; w.history.back(); }
    },
    onBack(cb) {
      const h = (e: PopStateEvent) => {
        if (skip > 0) { skip--; return; }
        if (marked && legOf(e.state) !== marked) { marked = null; cb(); }
      };
      w.addEventListener('popstate', h);
      return () => w.removeEventListener('popstate', h);
    },
  };
}
