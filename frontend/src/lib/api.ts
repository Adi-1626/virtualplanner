/**
 * frontend/src/lib/api.ts
 * ═══════════════════════
 * Centralised, typed HTTP client for the TwinCity FastAPI backend.
 *
 * ALL fetch calls in the codebase must go through this module — never
 * call `fetch()` directly with a hardcoded URL.
 *
 * Configuration
 * ─────────────
 * Set VITE_API_BASE in .env (default: http://localhost:8000).
 *
 * Usage
 * ─────
 * import { apiGet, apiPost, apiDelete, apiPostBatch, apiDeleteBatch } from '@/lib/api';
 *
 * const obj  = await apiGet<CityObject>('/api/objects/abc');
 * const objs = await apiGet<CityObject[]>('/api/objects');
 * await apiPost('/api/objects', payload);
 * await apiDelete('/api/objects/abc');
 */

import { redactPaths } from './redactPaths';

// ──────────────────────────────────────────────────────────────────────────────
// Base URL — read once at module load
// ──────────────────────────────────────────────────────────────────────────────

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8000';

// ──────────────────────────────────────────────────────────────────────────────
// Error type
// ──────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  public readonly status: number;
  public readonly endpoint: string;

  constructor(
    status: number,
    endpoint: string,
    message: string,
  ) {
    // the body can carry a server path (an exception text): never let it reach the UI
    super(`[API ${status}] ${endpoint}: ${redactPaths(message)}`);
    this.name = 'ApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Connection-state store (lightweight — no Zustand dependency here)
// Phase 1 will subscribe to this to surface the "offline" badge.
// ──────────────────────────────────────────────────────────────────────────────

export type ConnectionState = 'online' | 'saving' | 'offline';

type StateListener = (state: ConnectionState) => void;

let activeRequests = 0;

class ConnectionStateStore {
  private state: ConnectionState = 'online';
  private listeners: Set<StateListener> = new Set();
  private isOffline = false;

  get current(): ConnectionState {
    return this.state;
  }

  get isCurrentlyOffline(): boolean {
    return this.isOffline;
  }

  set(next: ConnectionState): void {
    if (next === 'offline') {
      this.isOffline = true;
    } else if (next === 'online') {
      this.isOffline = false;
    }

    if (this.state !== next) {
      this.state = next;
      this.listeners.forEach((l) => l(next));
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Actively ping the backend to verify connection status.
   */
  async checkConnection(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${API_BASE}/api/sim/status`, {
        signal: controller.signal,
      }).catch(() => null);
      clearTimeout(timeoutId);

      if (res && res.ok) {
        this.set('online');
        return true;
      }
    } catch {
      // ignore
    }
    this.set('offline');
    return false;
  }
}

export const connectionState = new ConnectionStateStore();

/** What a planner reads when the browser could not reach the UrbanOS server (instead of the browser's "Failed to fetch"). */
export const SERVER_UNREACHABLE = 'The UrbanOS server could not be reached. Check that it is running, then try again.';

/** A cancelled or timed-out request is not the server being down. */
const isAbortOrTimeout = (e: unknown) => ['AbortError', 'TimeoutError'].includes((e as Error)?.name);

/** The browser's own network-failure messages (fetch threw before any HTTP response). */
export const isNetworkFailure = (e: unknown) =>
  e instanceof TypeError || /failed to fetch|networkerror|network request failed|load failed|err_connection|could not be reached/i.test(String((e as Error)?.message ?? e));

/**
 * fetch() for the feature API clients (coordination, terrain, …) that do not go through request(): a network failure marks
 * the header "Offline" and throws SERVER_UNREACHABLE; any HTTP response (even an error status) proves the server is
 * reachable and clears "Offline". Before this, Underground calls failed with "Failed to fetch" while the header said Online.
 */
export async function trackedFetch(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbortOrTimeout(e)) throw e;
    connectionState.set('offline');
    throw new Error(SERVER_UNREACHABLE);
  }
  if (connectionState.isCurrentlyOffline) connectionState.set('online');
  return res;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Core fetch wrapper.
 * - Resolves path relative to API_BASE
 * - Checks `res.ok` and throws `ApiError` on non-2xx
 * - Updates `connectionState` so the rest of the UI can react
 */
async function request<T = void>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const isWrite = (init.method ?? 'GET') !== 'GET';

  activeRequests++;
  if (isWrite) connectionState.set('saving');

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
  } catch (networkErr) {
    // fetch itself threw — network unreachable, DNS failure, etc.
    activeRequests--;
    if (isAbortOrTimeout(networkErr)) throw networkErr;
    connectionState.set('offline');
    // The browser's own "Failed to fetch" means nothing to a planner (Final QA 2026-11-21: it was on screen in
    // Explore, Projects → Data, Reports and the Data catalogue with the server stopped).
    throw new Error(SERVER_UNREACHABLE);
  }

  activeRequests--;
  // Any HTTP response (even an error status) proves the server is reachable,
  // so a previous "offline" state is cleared here. HTTP errors are reported
  // to the caller via ApiError rather than by marking the connection offline.
  if (activeRequests === 0) {
    connectionState.set('online');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '(no body)');
    throw new ApiError(res.status, path, body);
  }

  const text = await res.text();
  if (!text) {
    return undefined as unknown as T;
  }
  return JSON.parse(text) as T;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/** GET /api/<path> */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/** POST /api/<path> with JSON body */
export function apiPost<T = void>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** DELETE /api/<path> */
export function apiDelete(path: string): Promise<void> {
  return request<void>(path, { method: 'DELETE' });
}

/** POST /api/<path>/batch (array body) */
export function apiPostBatch<T = void>(path: string, items: unknown[]): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(items),
  });
}

/** POST /api/<path>/batch/delete (array of IDs) */
export function apiDeleteBatch(path: string, ids: string[]): Promise<void> {
  return request<void>(`${path}/batch/delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}
