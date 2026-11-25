import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ERROR_CATALOGUE, describeError, describeFailure, fieldLabel, friendlyText, isFriendlyErrorText, shortReference, splitReference,
} from '../../lib/errorCatalogue';
import { ApiError, SERVER_UNREACHABLE, apiGet, isNetworkFailure, networkFailureMessage } from '../../lib/api';

const RID = '3f2a9c1e-7b4d-4c1a-9e2f-0123456789ab';

describe('error catalogue: one specific message per failure kind', () => {
  const http = (status: number, extra: Record<string, unknown> = {}) => describeFailure({ kind: 'http', status, requestId: RID, ...extra }, true);

  it('connection failures', () => {
    expect(describeFailure({ kind: 'unreachable' }, false).message).toBe("You're offline.");
    expect(describeFailure({ kind: 'unreachable' }, false).action).toBe('Check your internet connection.');
    expect(describeFailure({ kind: 'offline' }, true).key).toBe('OFFLINE');
    expect(friendlyText(describeFailure({ kind: 'timeout' }, true))).toBe('This is taking longer than usual. Try again.');
    expect(friendlyText(describeFailure({ kind: 'unreachable' }, true))).toBe("The server isn't responding right now. Try again in a moment.");
  });

  it('HTTP statuses', () => {
    expect(http(502).message).toBe("The server isn't responding right now.");
    expect(http(503).key).toBe('UNAVAILABLE');
    expect(http(504).key).toBe('TIMEOUT');
    expect(http(401).message).toBe("You don't have access to this.");
    expect(http(403).message).toBe("You don't have access to this.");
    expect(friendlyText(http(404))).toBe("We couldn't find that item. It may have been moved or deleted. Reference: 3f2a9c1e.");
    expect(http(409)).toMatchObject({ message: 'This was changed elsewhere.', action: 'Reload to see the latest.', reload: true });
    expect(http(413).message).toBe('That file is too large.');
    expect(http(429)).toMatchObject({ message: 'Too many requests.', retryable: true });
    expect(friendlyText(http(500))).toBe("We couldn't complete this. Try again. If it keeps happening, share the reference. Reference: 3f2a9c1e.");
    expect(http(599).key).toBe('INTERNAL');
    expect(http(418).key).toBe('BAD_REQUEST');
  });

  it('422 names the fields in plain words, never their values', () => {
    expect(http(422, { fields: ['width_m'] }).message).toBe('Please check width.');
    expect(http(422, { fields: ['items.lane_count', 'scenarioId', 'name'] }).message).toBe('Please check lane count, scenario and name.');
    expect(http(422).message).toBe("Some details aren't valid.");
    expect(fieldLabel('body')).toBe('body');
  });

  it('backend codes win over the status; unknown codes fall back to the status', () => {
    expect(http(500, { code: 'SIM_FAILED' }).message).toBe("The simulation couldn't start.");
    expect(http(503, { code: 'SIM_UNAVAILABLE' }).key).toBe('SIM_UNAVAILABLE');
    expect(http(416, { code: 'AREA_NOT_COVERED' }).key).toBe('AREA_NOT_COVERED');
    expect(http(400, { code: 'AREA_TOO_LARGE' }).message).toBe('This area is too large.');
    expect(http(404, { code: 'NO_ROADS_IN_AREA' }).message).toBe('There are no roads in the selected area.');
    expect(http(404, { code: 'SOMETHING_NEW' }).key).toBe('NOT_FOUND');
  });

  it('the app context makes a generic server failure specific', () => {
    expect(http(500, { context: 'save' }).message).toBe("Your changes weren't saved.");
    expect(http(500, { code: 'INTERNAL', context: 'export' }).message).toBe("The export didn't finish.");
    expect(http(500, { context: 'simulate' }).key).toBe('SIM_FAILED');
    expect(http(500, { context: 'tiles' }).message).toBe("The map tiles didn't load.");
    expect(http(404, { context: 'save' }).key).toBe('NOT_FOUND');  // a specific status keeps its own words
  });

  it('references: short form, split back out of plain text', () => {
    expect(shortReference(RID)).toBe('3f2a9c1e');
    expect(shortReference('client-req-1')).toBe('client-req-1');
    expect(splitReference("We couldn't complete this. Try again. Reference: 3f2a9c1e.")).toEqual({ text: "We couldn't complete this. Try again.", reference: '3f2a9c1e' });
    expect(splitReference('no reference here')).toEqual({ text: 'no reference here' });
    expect(isFriendlyErrorText('Could not load data: Reference: abc.')).toBe(true);
    expect(isFriendlyErrorText("Your changes weren't saved. Try again.")).toBe(true);
    expect(isFriendlyErrorText('Place at least 3 points on the map.')).toBe(false);
  });

  it('every catalogue entry is short and free of internals', () => {
    for (const [k, e] of Object.entries(ERROR_CATALOGUE)) {
      expect(e.message.length, k).toBeLessThanOrEqual(60);
      expect(`${e.message} ${e.action}`, k).not.toMatch(/HTTP|\d{3}|exception|traceback|stack|undefined|null|\//i);
    }
  });
});

describe('ApiError and describeError', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ApiError reads code, request id and fields from the JSON body; message is the friendly text', () => {
    const e = new ApiError(422, '/api/items', JSON.stringify({ detail: [{ loc: ['body', 'width_m'], input: 'SECRET' }], code: 'VALIDATION_ERROR', fields: ['width_m'], request_id: RID }));
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.requestId).toBe(RID);
    expect(e.message).toBe('Please check width. Check what you entered and try again. Reference: 3f2a9c1e.');
    expect(e.message).not.toContain('SECRET');
    const e2 = new ApiError(500, '/api/x', '{"error":"Internal server error","code":"INTERNAL","request_id":"zz"}', RID, 'save');
    expect(e2.requestId).toBe(RID);  // the header wins over the body
    expect(e2.message).toBe("Your changes weren't saved. Try again. Reference: 3f2a9c1e.");
    const e3 = new ApiError(500, '/api/x', 'Traceback (most recent call last): /srv/app/main.py');
    expect(e3.message).not.toMatch(/Traceback|srv/);
    expect(e3.serverDetail).not.toContain('/srv/app');
  });

  it('describeError maps thrown things', () => {
    expect(describeError(new TypeError('Failed to fetch')).key).toBe('UNAVAILABLE');
    expect(describeError(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })).key).toBe('TIMEOUT');
    expect(describeError(new Error('Place at least 3 points on the map.'))).toMatchObject({ key: 'LOCAL', message: 'Place at least 3 points on the map.' });
    const api = new ApiError(500, '/api/x', '{}', RID);
    expect(describeError(api, 'export').key).toBe('EXPORT_FAILED');
    expect(describeError(new ApiError(404, '/api/x', '{}', RID), 'export').key).toBe('NOT_FOUND');
    expect(describeError(new Error("We couldn't complete this. Reference: abc.")).reference).toBe('abc');
  });

  it('a request that cannot reach the server says offline when the browser is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    vi.stubGlobal('navigator', { onLine: false });
    expect(networkFailureMessage()).toBe("You're offline. Check your internet connection.");
    await expect(apiGet('/api/x')).rejects.toThrow("You're offline.");
    vi.stubGlobal('navigator', { onLine: true });
    const e = await apiGet('/api/x').catch(x => x);
    expect(e.message).toBe(SERVER_UNREACHABLE);
    expect(isNetworkFailure(e)).toBe(true);
  });

  it('an HTTP failure carries the X-Request-ID header as its reference', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ detail: 'x', code: 'NOT_FOUND', request_id: 'body-id' }), { status: 404, headers: { 'X-Request-ID': RID } }))));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = await apiGet('/api/objects/1').catch(x => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(404);
    expect(e.requestId).toBe(RID);
    expect(e.friendly.reference).toBe('3f2a9c1e');
  });
});

describe('ErrorNotice markup', () => {
  it('neutral notice with message, action, reference + Copy, and Try again; no red, no raw text', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ErrorNotice } = await import('../../components/ui/ErrorNotice');
    const err = new ApiError(500, '/api/x', '{"detail":"KeyError: secret_col at /srv/app/x.py","code":"INTERNAL"}', RID, 'save');
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error: err, onRetry: () => {} }));
    expect(html).toContain('uos-notice');
    expect(html).toContain("Your changes weren&#x27;t saved. Try again.");
    expect(html).toContain('3f2a9c1e');
    expect(html).toContain('Copy');
    expect(html).toContain('Try again');
    expect(html).not.toMatch(/fail|alert|KeyError|srv|secret/);
    const plain = renderToStaticMarkup(createElement(ErrorNotice, { error: new ApiError(404, '/api/x', '{}', RID), onRetry: () => {} }));
    expect(plain).not.toContain('error-retry');  // retrying a missing item cannot help
  });
});
