import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterFailure, baseMapLabel, baseMapNotice, createTileHealth, getBaseMapState, groundColorFor, initialBaseMap,
  installBaseMapFallback, watchTileHealth, OSM_MAX_LEVEL, OSM_TILE_URL, setBaseMapState, type BaseMapState,
} from '../../lib/baseMap';

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));

describe('base map fallback decision', () => {
  it('starts on ion only with a token, else on OpenStreetMap', () => {
    expect(initialBaseMap(true)).toEqual({ source: 'ion', reason: null });
    expect(initialBaseMap(false)).toEqual({ source: 'osm', reason: 'no-token' });
  });
  it('ion → OSM → none, and none stays none (no loop back to ion)', () => {
    const s1 = afterFailure({ source: 'ion', reason: null });
    expect(s1).toEqual({ source: 'osm', reason: 'ion-failed' });
    const s2 = afterFailure(s1);
    expect(s2).toEqual({ source: 'none', reason: 'osm-failed' });
    expect(afterFailure(s2).source).toBe('none');
  });
  it('labels the active source in plain words, no CLI hints', () => {
    const labels = (['ion', 'osm', 'none'] as const).map(source => baseMapLabel({ source, reason: source === 'osm' ? 'ion-failed' : null }));
    expect(labels).toEqual(['Satellite (Cesium ion)', 'OpenStreetMap map (fallback: ion unavailable)', 'No base map']);
    expect(baseMapLabel({ source: 'osm', reason: 'no-token' })).toBe('OpenStreetMap map (fallback: ion unavailable)');
    expect(baseMapLabel({ source: 'osm', reason: null })).toBe('OpenStreetMap map');
    for (const l of labels) expect(l).not.toMatch(/VITE_|\\.env|npm|token/i);
  });
  it('OSM tiles follow the tile usage policy: standard server, max zoom 19', () => {
    expect(OSM_TILE_URL).toBe('https://tile.openstreetmap.org/');
    expect(OSM_MAX_LEVEL).toBe(19);
  });
  it('the map notice shows only when there is no base map after failures', () => {
    expect(baseMapNotice({ source: 'none', reason: 'osm-failed' })).toMatch(/No base map/);
    expect(baseMapNotice({ source: 'osm', reason: 'ion-failed' })).toBeNull();
  });
});

describe('ground colour per visual style', () => {
  it('Realistic is an earthy grey-beige, Schematic a muted neutral; never blue', () => {
    expect(groundColorFor('realistic')).toBe('#8a8a80');
    expect(groundColorFor('schematic')).toBe('#6e7072');
    for (const style of ['realistic', 'schematic'] as const) {
      const [r, g, b] = hex(groundColorFor(style));
      expect(b).toBeLessThanOrEqual(Math.max(r, g) + 4); // blue never dominates
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(16); // low saturation
    }
  });
});

describe('OSM tile health', () => {
  it('gives up once after the limit of failures with no tile loaded', () => {
    const h = createTileHealth(3);
    expect([h.failure(), h.failure(), h.failure(), h.failure()]).toEqual([false, false, true, false]);
  });
  it('never gives up once a tile has loaded (single missing tiles are normal)', () => {
    const h = createTileHealth(2);
    h.success();
    expect([h.failure(), h.failure(), h.failure()]).toEqual([false, false, false]);
  });
});

describe('base map fallback controller', () => {
  const layer = (base = true) => {
    const fns: ((e: unknown) => void)[] = [];
    return { isBaseLayer: () => base, errorEvent: { addEventListener: (f: (e: unknown) => void) => { fns.push(f); } }, fail: (e: unknown) => fns.forEach(f => f(e)) };
  };
  const setup = (hasIonToken: boolean) => {
    const ion = { name: 'Bing Maps Aerial' }, osm = { name: 'OpenStreetMap' };
    const first = layer();
    const added: ((l: unknown) => void)[] = [];
    const layers = { length: 1, get: () => first, layerAdded: { addEventListener: (f: (l: unknown) => void) => { added.push(f); return () => {}; } } };
    const picker = { selectedImagery: (hasIonToken ? ion : osm) as unknown };
    const globe = { showGroundAtmosphere: true };
    const notify = vi.fn();
    const ctl = installBaseMapFallback({ layers, picker, ionModels: hasIonToken ? [ion] : [], osmModel: osm, hasIonToken, globe, notify });
    // the picker replaces the base layer whenever its selection changes
    const pickerSwap = () => { const next = layer(); added.forEach(f => f(next)); return next; };
    return { ctl, first, picker, globe, notify, ion, osm, pickerSwap };
  };
  beforeEach(() => setBaseMapState({ source: 'none', reason: null } as BaseMapState));

  it('ion fails (401) → switches the picker once to OSM and says so', () => {
    const t = setup(true);
    expect(getBaseMapState()).toEqual({ source: 'ion', reason: null });
    t.first.fail({ statusCode: 401 });
    expect(t.picker.selectedImagery).toBe(t.osm);
    expect(getBaseMapState()).toEqual({ source: 'osm', reason: 'ion-failed' });
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.mock.calls[0][0]).toMatch(/HTTP 401.*OpenStreetMap/);
    t.first.fail({ statusCode: 401 }); // late error of the replaced layer: ignored
    t.pickerSwap();
    expect(t.notify).toHaveBeenCalledTimes(1);
    expect(t.globe.showGroundAtmosphere).toBe(true);
  });

  it('then OSM unreachable → no base map, ground atmosphere off, never back to ion', () => {
    const t = setup(true);
    t.first.fail({ statusCode: 401 });
    t.pickerSwap();
    t.ctl.tilesUnreachable('osm', {});
    expect(t.picker.selectedImagery).toBeUndefined();
    expect(getBaseMapState()).toEqual({ source: 'none', reason: 'osm-failed' });
    expect(t.globe.showGroundAtmosphere).toBe(false);
    t.ctl.tilesUnreachable('osm', {});
    t.ctl.tilesUnreachable('ion', {}); // a late report from the replaced source: ignored
    expect(t.notify).toHaveBeenCalledTimes(2);
  });

  it('no token: starts on OSM (no ion request), and an OSM provider failure goes to none', () => {
    const t = setup(false);
    expect(getBaseMapState()).toEqual({ source: 'osm', reason: 'no-token' });
    t.first.fail({});
    expect(getBaseMapState().source).toBe('none');
    expect(t.picker.selectedImagery).toBeUndefined();
  });

  it('ion provider starts fine but its tiles never load → OSM, once', () => {
    const t = setup(true);
    t.ctl.tilesUnreachable('ion', { statusCode: 404 });
    expect(getBaseMapState()).toEqual({ source: 'osm', reason: 'ion-failed' });
    expect(t.notify.mock.calls[0][0]).toMatch(/HTTP 404.*OpenStreetMap/);
    t.first.fail({}); // the old layer's late error: ignored
    expect(t.notify).toHaveBeenCalledTimes(1);
  });

  it('a map the user picks updates the state; picking ion again restores atmosphere', () => {
    const t = setup(true);
    t.ctl.pickerChanged({ name: 'Open\u00adStreet\u00adMap x' });
    expect(getBaseMapState()).toMatchObject({ source: 'other', otherName: 'OpenStreetMap x' });
    t.ctl.pickerChanged(undefined);
    expect(t.globe.showGroundAtmosphere).toBe(false);
    t.ctl.pickerChanged(t.ion);
    expect(getBaseMapState().source).toBe('ion');
    expect(t.globe.showGroundAtmosphere).toBe(true);
  });
});

describe('watchTileHealth', () => {
  const provider = (results: boolean[]) => {
    const errs: ((e: { retry?: boolean; error?: unknown }) => void)[] = [];
    let i = 0;
    const p = {
      requestImage: () => { const ok = results[i++ % results.length]; return ok ? Promise.resolve({}) : Promise.reject(new Error('x')); },
      errorEvent: { addEventListener: (f: (e: { retry?: boolean; error?: unknown }) => void) => { errs.push(f); } },
      // what Cesium does after a failed request: raise the provider's errorEvent
      fail: (statusCode: number) => { const e: { retry?: boolean; error?: unknown } = { retry: true, error: { statusCode } }; errs.forEach(f => f(e)); return e; },
    };
    return p;
  };
  it('reports once after the limit of failed tiles, and turns retries off', async () => {
    const p = provider([false]); const gone = vi.fn();
    watchTileHealth(p, gone, 3);
    const e = p.fail(404); p.fail(404); p.fail(404); p.fail(404);
    expect(e.retry).toBe(false);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(gone.mock.calls[0][0]).toEqual({ statusCode: 404 });
  });
  it('a loaded tile means the source works; later failures are ignored', async () => {
    const p = provider([true]); const gone = vi.fn();
    watchTileHealth(p, gone, 2);
    await p.requestImage();
    p.fail(404); p.fail(404); p.fail(404);
    expect(gone).not.toHaveBeenCalled();
  });
  it('hooks a provider given as a promise (ion)', async () => {
    const p = provider([false]); const gone = vi.fn();
    const out = watchTileHealth(Promise.resolve(p), gone, 1);
    await out;
    p.fail(500);
    expect(gone).toHaveBeenCalledTimes(1);
  });
});
