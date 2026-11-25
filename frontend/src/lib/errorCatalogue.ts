/**
 * frontend/src/lib/errorCatalogue.ts
 * ═════════════════════════════════
 * The one place that turns a failed request into words a planner reads: a short, specific message, a suggested action,
 * and the request's reference (its X-Request-ID, the same id as the line in backend/logs/urbanos.log).
 *
 * Inputs: the HTTP status, the backend's stable `code` (backend/app_errors.py ERROR_CODES), the invalid `fields` of a
 * 422, the request id, and what the app was doing (`context`: save, export, simulate, …). No internals reach the user:
 * no stack traces, server paths or raw response bodies. The raw detail stays on the error object for developers.
 *
 * Shown by components/ui/ErrorNotice.tsx (inline and in the toast). Pure module: no imports from the rest of the app.
 */

export type ErrorContext = 'load' | 'save' | 'export' | 'simulate' | 'tiles' | 'upload';

export type FailureKind = 'offline' | 'timeout' | 'unreachable' | 'http' | 'local';

export interface FailureInfo {
  kind: FailureKind;
  status?: number;
  /** Backend machine code (AREA_TOO_LARGE, NOT_FOUND, …) or a frontend one (TILES_FAILED). */
  code?: string | null;
  /** Names of invalid fields (422). */
  fields?: readonly string[] | null;
  requestId?: string | null;
  context?: ErrorContext;
  /** For kind 'local': an app-authored message, shown as it is. */
  message?: string;
}

export interface FriendlyError {
  /** What happened, in one short sentence. */
  message: string;
  /** What to do next, in one short sentence ('' when there is nothing to suggest). */
  action: string;
  /** Short reference to quote or look up in the log (first 8 characters of the request id), if the server answered. */
  reference?: string;
  /** The full request id (copied by the Copy button). */
  requestId?: string;
  /** Trying the same thing again may work (shows Retry where the caller offers one). */
  retryable: boolean;
  /** Reloading the page is the suggested fix (409). */
  reload?: boolean;
  /** The catalogue key used (stable; for tests and analytics). */
  key: string;
}

interface Entry { message: string; action: string; retryable: boolean; reload?: boolean }

/** Every message the app shows for a failed request. Keys are backend codes or frontend-only keys. */
export const ERROR_CATALOGUE: Readonly<Record<string, Entry>> = {
  // connection
  OFFLINE: { message: "You're offline.", action: 'Check your internet connection.', retryable: true },
  TIMEOUT: { message: 'This is taking longer than usual.', action: 'Try again.', retryable: true },
  UNAVAILABLE: { message: "The server isn't responding right now.", action: 'Try again in a moment.', retryable: true },
  // by status
  BAD_REQUEST: { message: "This request couldn't be processed.", action: 'Check what you entered and try again.', retryable: false },
  UNAUTHORIZED: { message: "You don't have access to this.", action: 'Ask your administrator for access.', retryable: false },
  FORBIDDEN: { message: "You don't have access to this.", action: 'Ask your administrator for access.', retryable: false },
  NOT_FOUND: { message: "We couldn't find that item.", action: 'It may have been moved or deleted.', retryable: false },
  CONFLICT: { message: 'This was changed elsewhere.', action: 'Reload to see the latest.', retryable: false, reload: true },
  TOO_LARGE: { message: 'That file is too large.', action: 'Choose a smaller file.', retryable: false },
  VALIDATION_ERROR: { message: "Some details aren't valid.", action: 'Check what you entered and try again.', retryable: false },
  RATE_LIMITED: { message: 'Too many requests.', action: 'Wait a few seconds, then try again.', retryable: true },
  INTERNAL: { message: "We couldn't complete this.", action: 'Try again. If it keeps happening, share the reference.', retryable: true },
  // domain
  AREA_TOO_LARGE: { message: 'This area is too large.', action: 'Draw a smaller area and try again.', retryable: false },
  AREA_NOT_COVERED: { message: "Map data for this area isn't available here.", action: 'Try an area inside the city.', retryable: false },
  NO_ROADS_IN_AREA: { message: 'There are no roads in the selected area.', action: 'Select an area that includes roads.', retryable: false },
  DATA_NOT_AVAILABLE: { message: "This data isn't installed on the server yet.", action: 'Ask your administrator to add it.', retryable: false },
  FILE_TOO_LARGE: { message: 'That file is too large.', action: 'Choose a smaller file.', retryable: false },
  SIM_UNAVAILABLE: { message: "The simulation engine isn't available on this server.", action: 'Ask your administrator to install it.', retryable: false },
  SIM_FAILED: { message: "The simulation couldn't start.", action: 'Try again. If it keeps happening, share the reference.', retryable: true },
  SAVE_FAILED: { message: "Your changes weren't saved.", action: 'Try again.', retryable: true },
  EXPORT_FAILED: { message: "The export didn't finish.", action: 'Try again.', retryable: true },
  LOAD_FAILED: { message: "We couldn't load this.", action: 'Try again.', retryable: true },
  UPLOAD_FAILED: { message: "The file wasn't uploaded.", action: 'Try again.', retryable: true },
  TILES_FAILED: { message: "The map tiles didn't load.", action: 'Check your connection and try again.', retryable: true },
};

const CONTEXT_KEY: Record<ErrorContext, string> = {
  load: 'LOAD_FAILED', save: 'SAVE_FAILED', export: 'EXPORT_FAILED', simulate: 'SIM_FAILED', tiles: 'TILES_FAILED', upload: 'UPLOAD_FAILED',
};

const STATUS_KEY: Record<number, string> = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'BAD_REQUEST', 408: 'TIMEOUT', 409: 'CONFLICT',
  413: 'TOO_LARGE', 416: 'AREA_NOT_COVERED', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 502: 'UNAVAILABLE', 503: 'UNAVAILABLE', 504: 'TIMEOUT',
};

/** The short reference shown to a planner: the first 8 characters of a UUID, or the id itself when short. */
export function shortReference(requestId: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(requestId) ? requestId.slice(0, 8) : requestId.slice(0, 24);
}

/** 'width_m' → 'width', 'items.lane_count' → 'lane count', 'scenarioId' → 'scenario'. */
export function fieldLabel(field: string): string {
  const last = field.split('.').filter(Boolean).pop() ?? field;
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[_\s-]+/).map(w => w.toLowerCase()).filter(Boolean);
  while (words.length > 1 && ['m', 'km', 's', 'h', 'ms', 'deg', 'pct', 'id', 'ids'].includes(words[words.length - 1])) words.pop();
  return words.join(' ') || 'the details';
}

function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function keyFor(f: FailureInfo): string {
  if (f.kind === 'offline') return 'OFFLINE';
  if (f.kind === 'timeout') return 'TIMEOUT';
  if (f.kind === 'unreachable') return 'UNAVAILABLE';
  const status = f.status ?? 500;
  const key = (f.code && ERROR_CATALOGUE[f.code] ? f.code : null) ?? STATUS_KEY[status] ?? (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST');
  // "something failed on the server" says less than what the app was doing (save, export, …)
  return key === 'INTERNAL' && f.context ? CONTEXT_KEY[f.context] : key;
}

/** The friendly message, action and reference for one failure. `online` defaults to navigator.onLine. */
export function describeFailure(f: FailureInfo, online: boolean = typeof navigator === 'undefined' || navigator.onLine !== false): FriendlyError {
  const reference = f.requestId ? shortReference(f.requestId) : undefined;
  if (f.kind === 'local') {
    return { message: f.message || ERROR_CATALOGUE.LOAD_FAILED.message, action: '', retryable: false, key: 'LOCAL', reference, requestId: f.requestId ?? undefined };
  }
  const key = (f.kind === 'unreachable' || f.kind === 'timeout') && !online ? 'OFFLINE' : keyFor(f);
  const e = ERROR_CATALOGUE[key];
  let message = e.message;
  if (key === 'VALIDATION_ERROR' && f.fields?.length) {
    const labels = [...new Set(f.fields.map(fieldLabel))];
    message = `Please check ${listOf(labels.slice(0, 3))}.`;
  }
  return { message, action: e.action, retryable: e.retryable, reload: e.reload, key, reference, requestId: f.requestId ?? undefined };
}

/** One line for places that show plain text: "We couldn't complete this. Try again. Reference: 3f2a9c1e." */
export function friendlyText(e: FriendlyError): string {
  return [e.message, e.action, e.reference ? `Reference: ${e.reference}.` : ''].filter(Boolean).join(' ');
}

/** Splits "… Reference: 3f2a9c1e." off a message (for text that has travelled through string-only code paths). */
export function splitReference(text: string): { text: string; reference?: string } {
  const m = /\s*Reference:\s*([A-Za-z0-9._:-]+?)\.?\s*$/.exec(text);
  return m ? { text: text.slice(0, m.index).trim(), reference: m[1] } : { text };
}

const FRIENDLY_MESSAGES = new Set(Object.values(ERROR_CATALOGUE).map(e => e.message));

/** Whether a message is one of ours (catalogue text or carries a reference): shown neutrally, never as a red alert. */
export function isFriendlyErrorText(text: string): boolean {
  const { text: rest, reference } = splitReference(text);
  if (reference) return true;
  for (const m of FRIENDLY_MESSAGES) if (rest.startsWith(m) || rest.includes(`: ${m}`)) return true;
  return false;
}

/** The browser's own network-failure messages (fetch threw before any HTTP response), and our own words for them. */
export const isNetworkFailureText = (msg: string) =>
  /failed to fetch|networkerror|network request failed|load failed|err_connection|could not be reached|isn't responding|you're offline/i.test(msg);

/** Anything thrown → a friendly error. ApiError-like objects carry `friendly`; timeouts and network errors are mapped. */
export function describeError(err: unknown, context?: ErrorContext): FriendlyError {
  const anyErr = err as { friendly?: FriendlyError; name?: string; message?: string; status?: number; code?: string; requestId?: string; fields?: string[] } | null;
  if (anyErr && typeof anyErr === 'object' && anyErr.friendly) {
    // the error's own words stand, unless they only say "failed on the server" and the caller knows what was being done
    if (!context || !anyErr.status || anyErr.friendly.key !== 'INTERNAL') return anyErr.friendly;
    return describeFailure({ kind: 'http', status: anyErr.status, code: anyErr.code, fields: anyErr.fields, requestId: anyErr.requestId, context });
  }
  if (anyErr?.name === 'TimeoutError') return describeFailure({ kind: 'timeout', context });
  const msg = typeof err === 'string' ? err : String(anyErr?.message ?? err ?? '');
  if (err instanceof TypeError || isNetworkFailureText(msg)) return describeFailure({ kind: 'unreachable', context });
  const { text, reference } = splitReference(msg);
  if (reference) return { message: text, action: '', reference, retryable: true, key: 'TEXT' };
  return describeFailure({ kind: 'local', message: msg || (context ? ERROR_CATALOGUE[CONTEXT_KEY[context]].message : '') });
}

/** For the notice: the thrown error when there is one, else a message string ("… Reference: x." at its end is picked up). */
export function friendlyFrom(error: unknown, message: string | null | undefined, context?: ErrorContext): FriendlyError {
  if (error !== undefined && error !== null) return describeError(error, context);
  const { text, reference } = splitReference(message ?? '');
  return { message: text, action: '', reference, requestId: reference, retryable: true, key: 'TEXT' };
}

/** Text a JavaScript runtime writes for a code fault (never shown to a planner). */
const INTERNAL_FAULT_TEXT = /\b(undefined|null) is not|cannot read propert|cannot set propert|is not a function|is not defined|is not iterable|maximum call stack|out of memory|unexpected token|invalid array length|\bat [\w.$<>]+ \(|\.(ts|tsx|js|mjs):\d+/i;

/**
 * p15: an error string that has travelled through string-only state (a simulation or analysis failure) → what the
 * notice shows. Our own words (catalogue text, app-authored sentences, "… Reference: x.") pass unchanged; a runtime
 * fault's raw text is replaced by the catalogue message for what the app was doing.
 */
export function userErrorText(text: string | null | undefined, context: ErrorContext = 'simulate'): string {
  const t = (text ?? '').trim();
  if (!t) return friendlyText(describeFailure({ kind: 'http', status: 500, context }));
  if (isFriendlyErrorText(t)) return t;
  if (INTERNAL_FAULT_TEXT.test(t)) return friendlyText(describeFailure({ kind: 'http', status: 500, context }));
  return t;
}
