/** Underground final end-user pass (docs/urbanos/UNDERGROUND_QA.md "Final end-user pass"): one test per fix. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { distanceToObjectsM, workBoxes } from '../underground/viewRect';
import { countsByStatus, plainSummary } from '../../components/underground/conflictClasses';
import { SERVER_UNREACHABLE, connectionState, trackedFetch } from '../../lib/api';
import type { ScreeningFinding, ScreeningRun } from '../../lib/coordinationApi';

const LAT = 18.5;
const mE = (m: number) => m / (111320 * Math.cos((LAT * Math.PI) / 180));
const mN = (m: number) => m / 110574;
const line = (x0: number, y0: number, x1: number, y1: number) => ({ coordinates: [[73.85 + mE(x0), LAT + mN(y0)], [73.85 + mE(x1), LAT + mN(y1)]] });

describe('records work area: within 250 m of what was drawn, not a box around everything', () => {
  it('a remote pipe gets its own box instead of stretching one box over the gap', () => {
    const near = [line(0, 0, 200, 0), line(100, -50, 100, 50)];
    const remote = line(16000, 0, 16100, 0);
    expect(workBoxes(near, 250)).toHaveLength(1);
    const boxes = workBoxes([...near, remote], 250);
    expect(boxes).toHaveLength(2);
    // neither box spans the 16 km gap
    for (const b of boxes) expect((b[2] - b[0]) * 111320 * Math.cos((LAT * Math.PI) / 180)).toBeLessThan(1200);
  });
  it('plan distance from a record to the nearest drawn centreline (crossing = 0, parallel offset, point)', () => {
    const objs = [line(0, 0, 400, 0)];
    const g = (c: number[][]) => ({ type: 'LineString', coordinates: c.map(([x, y]) => [73.85 + mE(x), LAT + mN(y)]) });
    expect(distanceToObjectsM(g([[200, -100], [200, 100]]), objs)).toBe(0);
    expect(distanceToObjectsM(g([[0, 120], [400, 120]]), objs)!).toBeCloseTo(120, 0);
    expect(distanceToObjectsM(g([[0, 300], [400, 300]]), objs)!).toBeGreaterThan(250);           // in the box corner region but > 250 m
    expect(distanceToObjectsM({ type: 'Point', coordinates: [73.85 + mE(600), LAT] }, objs)!).toBeCloseTo(200, 0);
    expect(distanceToObjectsM(null, objs)).toBeNull();
    // a MultiLineString's parts are not joined into one phantom segment
    const multi = { type: 'MultiLineString', coordinates: [[[-600, -300], [-500, -300]], [[900, -300], [1000, -300]]].map(p => p.map(([x, y]) => [73.85 + mE(x), LAT + mN(y)])) };
    expect(distanceToObjectsM(multi, objs)!).toBeGreaterThan(250);
  });
});

describe('check summary and badges count the same findings', () => {
  const f = (id: string, pid: string, status: ScreeningFinding['status']) => ({ id, status, proposed: { id: pid } }) as unknown as ScreeningFinding;
  const findings = [f('1', 'T', 'requires_investigation'), f('2', 'T', 'insufficient_data'), f('3', 'W', 'insufficient_data'), f('4', 'W', 'insufficient_data')];
  const run = { summary: { counts: countsByStatus(findings), proposed_checked: [{ id: 'T', name: 'Tunnel A' }, { id: 'W', name: 'Water main' }] } } as unknown as ScreeningRun;
  it('all objects: the totals', () => {
    expect(plainSummary(run)).toBe('2 proposed objects checked: 1 needs investigation or a permission, 3 can\u2019t be judged because data is missing.');
  });
  it('one object: its own counts and its name, so the sentence agrees with the badges', () => {
    const scoped = findings.filter(x => x.proposed.id === 'T');
    const s = plainSummary(run, scoped, 'Tunnel A');
    expect(s).toBe('Tunnel A (1 of the 2 proposed objects checked): 1 needs investigation or a permission, 1 can\u2019t be judged because data is missing.');
    expect(countsByStatus(scoped).insufficient_data).toBe(1);
  });
});

describe('backend down: the header and the message say so', () => {
  afterEach(() => { vi.unstubAllGlobals(); connectionState.set('online'); });
  it('a network failure marks Offline and throws the plain message, a response clears it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(trackedFetch('http://x/api/coordination/subsurface/datasets')).rejects.toThrow(SERVER_UNREACHABLE);
    expect(connectionState.current).toBe('offline');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const r = await trackedFetch('http://x/api/coordination/subsurface/datasets');
    expect(r.status).toBe(500);
    expect(connectionState.current).toBe('online');
  });
});

describe('renderer: records, labels from below, drawn-utility toggle', () => {
  it('existing records are shown only in Underground (they stayed drawn in Design after a visit)', async () => {
    const { UndergroundRenderer } = await import('../underground/UndergroundRenderer');
    const r = new UndergroundRenderer();
    (r as unknown as { recordsDs: { show: boolean } }).recordsDs = { show: true };   // the data source attach() creates
    r.setGroupVisible('records', true);
    const recs = () => (r as unknown as { recordsDs: { show: boolean } }).recordsDs.show;
    r.setInUnderground(true);
    r.setInUnderground(false);
    expect(recs()).toBe(false);
    r.setInUnderground(true);
    expect(recs()).toBe(true);
    r.setGroupVisible('records', false);
    expect(recs()).toBe(false);
    r.setGroupVisible('records', true);
    r.setInUnderground(false);
    expect(recs()).toBe(false);
  });
  it('metro labels are capped near / below the ground and when looking level, not from a normal oblique view', async () => {
    const { labelRangeCap, LOW_VIEW_LABEL_RANGE_M } = await import('../underground/UndergroundRenderer');
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(labelRangeCap(-8, deg(-4))).toBe(LOW_VIEW_LABEL_RANGE_M);        // Look from below
    expect(labelRangeCap(30, deg(-60))).toBe(LOW_VIEW_LABEL_RANGE_M);       // just above the ground
    expect(labelRangeCap(900, deg(-5))).toBe(LOW_VIEW_LABEL_RANGE_M);       // looking at the horizon
    expect(labelRangeCap(900, deg(-35))).toBe(Number.POSITIVE_INFINITY);    // normal oblique
    expect(labelRangeCap(3000, deg(-90))).toBe(Number.POSITIVE_INFINITY);   // top-down
  });
  it('"Show drawn utilities" off also hides the to-scale pipe models (type opacity cap 0 = not built)', async () => {
    const { renderManagerInstance } = await import('../rendering/RenderManager');
    renderManagerInstance.setTypeOpacityCap('utility', 0);
    expect(renderManagerInstance.getTypeOpacityCap('utility')).toBe(0);
    renderManagerInstance.setTypeOpacityCap('utility', null);
    expect(renderManagerInstance.getTypeOpacityCap('utility')).toBeNull();
    const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '../rendering/renderers/TileBatchRenderer.ts'), 'utf8');
    expect(src).toMatch(/if \(opacity <= 0\) continue;/);
  });
});

describe('OSM metro import: no invented -6 m', () => {
  it('a tunnel is stored at level 0 with its tags and still read as an unmapped-depth tunnel', async () => {
    const { osmMetroLevel } = await import('../editing/EditingEngine');
    const { isUnmappedMetroTunnel } = await import('../underground/metroLevel');
    expect(osmMetroLevel({ railway: 'subway', tunnel: 'yes' })).toBe(0);
    expect(osmMetroLevel({ railway: 'subway', layer: '-2' })).toBe(0);
    expect(osmMetroLevel({ railway: 'subway', bridge: 'yes' })).toBe(12);
    expect(osmMetroLevel({ railway: 'subway' })).toBe(0);
    const line = { id: 'osm_m_way_1', type: 'metro_line', elevation: osmMetroLevel({ tunnel: 'yes' }), tags: { railway: 'subway', tunnel: 'yes' }, coordinates: [] };
    expect(isUnmappedMetroTunnel(line as never)).toBe(true);
    // older saved imports at -6 m are still recognised
    expect(isUnmappedMetroTunnel({ ...line, elevation: -6, tags: { railway: 'subway' } } as never)).toBe(true);
  });
});

describe('error sentences', () => {
  it('one full stop, never "try again.."', async () => {
    const { sentence } = await import('../../lib/format');
    expect(sentence(SERVER_UNREACHABLE)).toBe(SERVER_UNREACHABLE);
    expect(sentence('500: boom')).toBe('500: boom.');
    expect(sentence('x.. ')).toBe('x.');
    expect(sentence(null)).toBe('');
  });
});
