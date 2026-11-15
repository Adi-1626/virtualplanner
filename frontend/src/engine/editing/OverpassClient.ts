import { API_BASE } from '../../lib/api';

/** Public Overpass instances (usage policy: < 10 000 queries/day, one at a time; OSM data is ODbL). */
// Private.coffee (formerly overpass.kumi.systems) first; overpass-api.de discourages apps using it as their backend.
// Not overpass.osm.ch: it holds Switzerland only and answers "nothing here" for everywhere else.
export const PUBLIC_OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

/**
 * The backend's cached, rate-limited Overpass proxy (backend/osm/overpass.py). Tried first: answers are
 * cached on disk, so an area is fetched from the public servers once. When the backend is unreachable
 * (or too old to have the proxy) the public servers are asked directly.
 */
export const BACKEND_OVERPASS_PROXY = `${API_BASE}/api/osm/overpass`;

export const DEFAULT_OVERPASS_ENDPOINTS = [BACKEND_OVERPASS_PROXY, ...PUBLIC_OVERPASS_ENDPOINTS];

/** Where the last answer came from. */
export interface OverpassAnswerInfo {
  via: 'backend' | 'direct';
  host: string;
  /** Backend proxy only: served from its disk cache ('hit') or fetched now ('miss'). */
  cache?: 'hit' | 'miss';
  fetchedAt?: string;
}

export class OverpassCancelledError extends Error {
  constructor() {
    super('Import cancelled.');
    this.name = 'OverpassCancelledError';
  }
}

export interface OverpassClientOptions {
  endpoints?: string[];
  /** Per-request timeout. Queries ask the server for [timeout:50], so allow a little more. */
  requestTimeoutMs?: number;
  /** Endpoints that are the backend proxy (it tries every mirror itself, so it gets a longer timeout and
   *  its "all mirrors failed" answer is final instead of being repeated against the mirrors). */
  proxyEndpoints?: string[];
  proxyTimeoutMs?: number;
  /** Base delay before trying the next mirror; doubles each attempt (with jitter). */
  backoffBaseMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new OverpassCancelledError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new OverpassCancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Overpass API client that is polite to the public mirrors (item 33):
 * - every request has a timeout, so a hung mirror can't hang the UI forever;
 * - HTTP 429/503/504 put that mirror in a cooldown (honouring Retry-After) with
 *   exponential growth on repeat offences, so we don't hammer mirrors back to back;
 * - attempts are spaced by exponential backoff with jitter;
 * - callers can cancel through an AbortSignal.
 */
export class OverpassClient {
  private endpoints: string[];
  private requestTimeoutMs: number;
  private backoffBaseMs: number;
  private fetchImpl: typeof fetch;
  private now: () => number;
  private sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private cooldownUntil = new Map<string, number>();
  private strikes = new Map<string, number>();
  private proxyEndpoints: Set<string>;
  private proxyTimeoutMs: number;
  /** Where the last successful answer came from (for honest source labels in the UI). */
  public lastAnswer: OverpassAnswerInfo | null = null;

  constructor(opts: OverpassClientOptions = {}) {
    this.endpoints = opts.endpoints ?? DEFAULT_OVERPASS_ENDPOINTS;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 180_000;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? abortableSleep;
    this.proxyEndpoints = new Set(opts.proxyEndpoints ?? (opts.endpoints ? [] : [BACKEND_OVERPASS_PROXY]));
    this.proxyTimeoutMs = opts.proxyTimeoutMs ?? 400_000; // the backend may try two mirrors at 180 s each
  }

  /** Seconds until the soonest mirror leaves cooldown (0 if one is available now). */
  public secondsUntilAvailable(): number {
    const now = this.now();
    const waits = this.endpoints.map(e => Math.max(0, (this.cooldownUntil.get(e) ?? 0) - now));
    return Math.ceil(Math.min(...waits) / 1000);
  }

  public async query(query: string, signal?: AbortSignal): Promise<any> {
    const available = this.endpoints.filter(e => (this.cooldownUntil.get(e) ?? 0) <= this.now());
    if (available.length === 0) {
      throw new Error(`All Overpass mirrors are rate-limiting this connection. Try again in ${this.secondsUntilAvailable()} s.`);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < available.length; attempt++) {
      if (signal?.aborted) throw new OverpassCancelledError();
      if (attempt > 0) {
        const delay = this.backoffBaseMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
        await this.sleep(delay, signal);
      }

      const endpoint = available[attempt];
      const isProxy = this.proxyEndpoints.has(endpoint);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, isProxy ? this.proxyTimeoutMs : this.requestTimeoutMs);

      try {
        const res = await this.fetchImpl(`${endpoint}?data=${encodeURIComponent(query)}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (isProxy && res.status === 502) {
          // The backend already tried every public mirror: asking them again from here would double the load
          const body = await res.json().catch(() => null);
          const detail = body?.detail;
          if (detail?.upstream) throw Object.assign(new Error(`OpenStreetMap (Overpass) is unavailable: ${detail.message}`), { fatal: true });
          lastError = new Error(`The backend's Overpass proxy failed (HTTP 502).`);
          continue;
        }
        if (isProxy && res.status === 404) {
          lastError = new Error('The backend has no Overpass proxy (older version).');
          continue;
        }
        if (res.status === 429 || res.status === 503 || res.status === 504) {
          this.coolDown(endpoint, res.headers.get('Retry-After'));
          lastError = new Error(`${new URL(endpoint).host} is busy (HTTP ${res.status}).`);
          continue;
        }
        if (res.status === 400) {
          // A malformed query fails the same way everywhere — don't spread it across mirrors
          throw Object.assign(new Error(`Overpass rejected the query (HTTP 400): ${(await res.text()).slice(0, 200)}`), { fatal: true });
        }
        if (!res.ok) {
          lastError = new Error(`${new URL(endpoint).host} returned HTTP ${res.status}.`);
          continue;
        }

        const data = await res.json();
        if (typeof data?.remark === 'string' && /timeout|runtime error|out of memory/i.test(data.remark)) {
          this.coolDown(endpoint, null);
          lastError = new Error(`${new URL(endpoint).host} gave up on the query: ${data.remark}`);
          continue;
        }
        this.strikes.delete(endpoint);
        const cache = res.headers?.get?.('X-Overpass-Cache');
        this.lastAnswer = {
          via: isProxy ? 'backend' : 'direct',
          host: isProxy ? 'backend proxy' : new URL(endpoint).host,
          ...(cache === 'hit' || cache === 'miss' ? { cache } : {}),
          ...(res.headers?.get?.('X-Overpass-Fetched-At') ? { fetchedAt: res.headers.get('X-Overpass-Fetched-At')! } : {}),
        };
        return data;
      } catch (err: any) {
        if (signal?.aborted) throw new OverpassCancelledError();
        if (err?.fatal) throw err;
        if (timedOut) {
          this.coolDown(endpoint, null);
          lastError = new Error(`${new URL(endpoint).host} did not respond within ${Math.round((isProxy ? this.proxyTimeoutMs : this.requestTimeoutMs) / 1000)} s.`);
        } else {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastError ?? new Error('All Overpass API endpoints failed.');
  }

  private coolDown(endpoint: string, retryAfter: string | null) {
    const strikes = (this.strikes.get(endpoint) ?? 0) + 1;
    this.strikes.set(endpoint, strikes);
    const retrySeconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
    // 30 s, 60 s, 120 s … capped at 10 min, unless the server told us exactly
    const ms = retrySeconds !== null ? retrySeconds * 1000 : Math.min(30_000 * 2 ** (strikes - 1), 600_000);
    this.cooldownUntil.set(endpoint, this.now() + ms);
  }
}
