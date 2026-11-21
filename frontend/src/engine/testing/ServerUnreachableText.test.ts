import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVER_UNREACHABLE, apiGet, isNetworkFailure } from '../../lib/api';
import { datasetsApi } from '../../lib/datasetsApi';
import { freshnessApi } from '../../lib/freshnessApi';
import { trafficApi } from '../data/trafficData';

// Final QA 2026-11-21: with the server stopped, Explore, Projects → Data, Reports and the Data catalogue (Fact updates)
// showed the browser's own "Failed to fetch".
describe('server down: planners read a plain sentence, never "Failed to fetch"', () => {
  afterEach(() => vi.unstubAllGlobals());
  const down = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

  it('every API client turns the network failure into the plain message', async () => {
    down();
    for (const call of [() => apiGet('/api/objects'), () => datasetsApi.list(), () => freshnessApi.status(), () => freshnessApi.proposals(), () => trafficApi.createDataset({} as never)]) {
      const e = await call().then(() => null, (x: Error) => x);
      expect(e?.message).toBe(SERVER_UNREACHABLE);
      expect(isNetworkFailure(e)).toBe(true);
    }
  });

  it('a cancelled request stays a cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    const e = await apiGet('/api/objects').then(() => null, (x: Error) => x);
    expect(e?.name).toBe('AbortError');
  });
});
