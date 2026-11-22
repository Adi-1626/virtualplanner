/**
 * Words for a failed base-map request (no network, an invalid or missing ion token: HTTP 401). The fallback itself
 * (ion → OpenStreetMap → plain ground) is in `baseMap.ts`; Cesium logs the raw RequestErrorEvent to the console unless
 * the layer's errorEvent has a listener, and that controller listens.
 */
function statusOf(err: unknown): unknown { return (err as { statusCode?: unknown } | null)?.statusCode; }

/** Why a request failed, in a few words: "access refused (HTTP 401)", "HTTP 503", "no response". */
export function baseImageryReason(err: unknown): string {
  const status = statusOf(err);
  return status === 401 || status === 403 ? `access refused (HTTP ${status})` : typeof status === 'number' ? `HTTP ${status}` : 'no response';
}
