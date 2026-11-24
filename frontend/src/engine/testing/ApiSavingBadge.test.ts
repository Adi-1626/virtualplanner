import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiGet, apiPost, connectionState, pendingWrites } from '../../lib/api';

/** p11 user test: the header kept "Saving…" after a save had finished, while a slow read was still in flight. */
type Deferred = { resolve: (r: Response) => void; reject: (e: unknown) => void };
const pending: Deferred[] = [];
const fakeFetch = () => new Promise<Response>((resolve, reject) => { pending.push({ resolve, reject }); });
const ok = () => new Response('{}', { status: 200 });

describe('connection badge: Saving… follows writes only', () => {
  afterEach(() => { vi.unstubAllGlobals(); pending.length = 0; connectionState.set('online'); });

  it('clears Saving… when the write finishes even though a slow read is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    const read = apiGet('/api/slow-read');
    const write = apiPost('/api/objects', { a: 1 });
    expect(connectionState.current).toBe('saving');
    pending[1].resolve(ok());
    await write;
    expect(pendingWrites()).toBe(0);
    expect(connectionState.current).toBe('online');
    pending[0].resolve(ok());
    await read;
    expect(connectionState.current).toBe('online');
  });

  it('stays on Saving… while a second write is still in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    const a = apiPost('/api/a', {}); const b = apiPost('/api/b', {});
    pending[0].resolve(ok()); await a;
    expect(connectionState.current).toBe('saving');
    pending[1].resolve(ok()); await b;
    expect(connectionState.current).toBe('online');
  });

  it('an aborted write does not leave Saving… behind', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    const w = apiPost('/api/a', {});
    const abort = new Error('aborted'); abort.name = 'AbortError';
    pending[0].reject(abort);
    await expect(w).rejects.toThrow('aborted');
    expect(connectionState.current).toBe('online');
  });

  it('a failed write marks Offline; the next answer clears it', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeFetch));
    const w = apiPost('/api/a', {});
    pending[0].reject(new TypeError('Failed to fetch'));
    await expect(w).rejects.toThrow();
    expect(connectionState.current).toBe('offline');
    const r = apiGet('/api/x'); pending[1].resolve(ok()); await r;
    expect(connectionState.current).toBe('online');
  });
});
