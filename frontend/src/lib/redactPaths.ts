/**
 * Raw filesystem paths never reach the UI (docs/urbanos/UNDERGROUND_VISUAL_FIXES.md, "Charts and legend").
 * The backend redacts its own messages (backend/datasets/public_text.py); this is the client-side guard for anything
 * that still slips through (an older backend, an exception text, a stored note). Mirrors the backend rules.
 */

// Windows drive paths (C:\x\y, C:/x/y) and UNC paths (\\server\share\x)
const WIN = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)[^\s'"<>|,;)]*/g;
// POSIX absolute paths with at least two segments; not URLs (://), not /api/... routes, not "km/h"
const POSIX = /(?<![\w:/.])\/(?!api\/)(?:[\w.@~+-]+\/)+[\w.@~+-]*/g;

const isWin = (s: string) => s.includes('\\') || /^[A-Za-z]:/.test(s);
const lastSegment = (s: string) => {
  const parts = s.replace(/[\\/]+$/, '').split(isWin(s) ? /[\\/]/ : '/');
  return parts[parts.length - 1] ?? '';
};

/** Replace absolute filesystem paths in a message with the file name (or "a local folder" for a directory). */
export function redactPaths(text: string): string;
export function redactPaths(text: string | null | undefined): string | null | undefined;
export function redactPaths(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  const sub = (m: string) => { const n = lastSegment(m); return n.includes('.') ? n : 'a local folder'; };
  return text.replace(WIN, sub).replace(POSIX, sub);
}

/** True when a string contains an absolute filesystem path. */
export const hasLocalPath = (text: string | null | undefined): boolean => !!text && redactPaths(text) !== text;

/** A path fit to show: as given when relative, else just the file name. */
export function displayPath(p: string | null | undefined): string {
  if (!p) return '';
  const abs = p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
  return abs ? lastSegment(p) : p;
}
