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
import { describeFailure, friendlyText, isNetworkFailureText, ERROR_CATALOGUE, type ErrorContext, type FriendlyError } from './errorCatalogue';

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
  /** Backend machine code (backend/app_errors.py), e.g. NOT_FOUND, SIM_FAILED; null when the body had none. */
  public readonly code: string | null;
  /** X-Request-ID of the failed request (the same id is on its line in backend/logs/urbanos.log). */
  public readonly requestId: string | null;
  /** Invalid field names of a 422. */
  public readonly fields: string[];
  /** The server's own detail, path-redacted, for developers (console); never shown as the message. */
  public readonly serverDetail: string;
  /** What the planner reads (lib/errorCatalogue.ts). `message` is its one-line text. */
  public readonly friendly: FriendlyError;

  constructor(
    status: number,
    endpoint: string,
    body: string,
    requestId: string | null = null,
    context?: ErrorContext,
  ) {
    let parsed: { code?: unknown; request_id?: unknown; fields?: unknown; detail?: unknown } | null = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }
    const code = typeof parsed?.code === 'string' ? parsed.code : null;
    const rid = requestId ?? (typeof parsed?.request_id === 'string' ? parsed.request_id : null);
    const fields = Array.isArray(parsed?.fields) ? parsed!.fields.filter((f): f is string => typeof f === 'string') : [];
    const friendly = describeFailure({ kind: 'http', status, code, fields, requestId: rid, context });
    super(friendlyText(friendly));
    this.name = 'ApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.code = code;
    this.requestId = rid;
    this.fields = fields;
    // the body can carry a server path (an exception text): keep it off the UI, redacted even for the console
    const d = parsed?.detail;
    this.serverDetail = redactPaths(typeof d === 'string' ? d : d != null ? JSON.stringify(d) : body).slice(0, 500);
    this.friendly = friendly;
  }
}

/** An ApiError from a failed Response (reads the body; never throws itself). For the feature clients' own fetch helpers. */
export async function apiErrorFromResponse(res: Response, endpoint: string, context?: ErrorContext): Promise<ApiError> {
  const body = await res.text().catch(() => '');
  const err = new ApiError(res.status, endpoint, body, res.headers.get('X-Request-ID'), context);
  console.warn(`[API ${res.status}] ${endpoint} code=${err.code ?? '-'} request_id=${err.requestId ?? '-'}: ${err.serverDetail}`);
  return err;
}

// ──────────────────────────────────────────────────────────────────────────────
// Connection-state store (lightweight — no Zustand dependency here)
// Phase 1 will subscribe to this to surface the "offline" badge.
// ──────────────────────────────────────────────────────────────────────────────

export type ConnectionState = 'online' | 'saving' | 'offline';

type StateListener = (state: ConnectionState) => void;

let activeWrites = 0;

/** Writes in flight (what the header's "Saving…" reflects); exported for tests. */
export const pendingWrites = () => activeWrites;

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
export const SERVER_UNREACHABLE = `${ERROR_CATALOGUE.UNAVAILABLE.message} ${ERROR_CATALOGUE.UNAVAILABLE.action}`;

/** What to say when fetch() threw: offline when the browser says so, else the server is not responding (errorCatalogue). */
export function networkFailureMessage(): string {
  return friendlyText(describeFailure({ kind: 'unreachable' }));
}

/** A cancelled or timed-out request is not the server being down. */
const isAbortOrTimeout = (e: unknown) => ['AbortError', 'TimeoutError'].includes((e as Error)?.name);

/** The browser's own network-failure messages (fetch threw before any HTTP response). */
export const isNetworkFailure = (e: unknown) =>
  e instanceof TypeError || isNetworkFailureText(String((e as Error)?.message ?? e));

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
    throw new Error(networkFailureMessage());
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

  // "Saving…" counts writes only, and every way a write ends clears it: before p11 a slow read in flight (an area's roads,
  // a dataset) kept the header on "Saving…" after the save itself had finished, and an aborted write never cleared it.
  if (isWrite) { activeWrites++; connectionState.set('saving'); }
  const writeDone = () => { if (isWrite) activeWrites = Math.max(0, activeWrites - 1); };

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
    writeDone();
    if (isAbortOrTimeout(networkErr)) {
      if (activeWrites === 0 && connectionState.current === 'saving') connectionState.set('online');
      throw networkErr;
    }
    connectionState.set('offline');
    // The browser's own "Failed to fetch" means nothing to a planner (Final QA 2026-11-21: it was on screen in
    // Explore, Projects → Data, Reports and the Data catalogue with the server stopped).
    throw new Error(networkFailureMessage());
  }

  writeDone();
  // Any HTTP response (even an error status) proves the server is reachable, so a previous "offline" state is cleared
  // here; "Saving…" stays only while another write is still in flight. HTTP errors reach the caller as ApiError.
  if (activeWrites === 0 ? connectionState.current !== 'online' : connectionState.isCurrentlyOffline) {
    connectionState.set(activeWrites === 0 ? 'online' : 'saving');
  }

  if (!res.ok) throw await apiErrorFromResponse(res, path);

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
