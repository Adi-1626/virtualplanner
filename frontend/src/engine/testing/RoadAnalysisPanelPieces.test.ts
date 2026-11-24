import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DirectionFlow, LoadCheck, RoadAnalysisResult } from '../simulation/RoadAnalysis';
import {
  StatusHeader, WorstKpis, DirectionsGrid, WhyCard, LoadCard, SourcesCard, BottlenecksCard, SuggestionCard, PerRunDetail, type AnalysisActions,
} from '../../components/RoadAnalysisPieces';
import { explainedDirection, causeLine } from '../../components/roadAnalysisView';
import { improvementsFor } from '../simulation/improvements';
import { stopLineWords } from '../simulation/stopLineWords';
import { laneInsights } from '../simulation/ScenarioComparison';
import { Disclosure } from '../../components/ui/viz';

/** A Sangamwadi-like result: two directions, some delay eastbound, overloaded neighbourhood. */
const dir = (over: Partial<DirectionFlow>): DirectionFlow => ({
  label: 'westbound', bearingDeg: 258, compass: 'west', labelBearingDeg: 258, towards: { kind: 'junction', name: 'Old Pune–Mumbai Highway' } as DirectionFlow['towards'], paths: [],
  vph: 579, vphRange: [560, 600], pcuph: 400, demandVph: 558, demandPcu: 590, lanes: 2, midblockPcu: 2571, stopLinePcu: null, capacityPcu: 2571, capacityBasis: 'midblock',
  vc: 0.23, servedVc: 0.2, meanSpeedKmh: 26, speedRange: [25, 27], freeSpeedKmh: 30, speedRatio: 0.86, travelTimeS: 77, freeTimeS: 66, los: 'A', losBySeed: ['A', 'A', 'A'],
  vphBySeed: [560, 577, 600], speedBySeed: [25, 26, 27], delay: { signal: 2, blocked: 1, giveWay: 1, conflict: 0, other: 7, total: 11 }, queuedNow: 0, ...over,
});
const load = (entered: number, overloaded: boolean, message: string | null): LoadCheck => ({ demandVph: 19314, enteredVph: entered, servedShare: entered / 19314, waitingToEnter: 4165, atVehicleLimit: 0, gridlockRemovalsVph: 0, overloaded, message });
const MSG = 'More traffic is routed here than the simulated junctions can pass: 6,620 of the 19,314 veh/h routed into the simulated neighbourhood (34%) got onto its roads. Volumes shown are what got through.';
const result = (over: Partial<RoadAnalysisResult> = {}): RoadAnalysisResult => ({
  windowS: 900, seeds: [42, 7, 1234],
  section: { name: 'Sangamwadi Bridge', lengthM: 500, carriageways: 1, endsAt: [], segmentKeys: [] },
  directions: [
    dir({ label: 'eastbound', bearingDeg: 78, compass: 'east', labelBearingDeg: 78, towards: null, vph: 900, demandVph: 950, meanSpeedKmh: 37, freeSpeedKmh: 50, speedRatio: 0.74, los: 'C', travelTimeS: 49, freeTimeS: 36, vc: 0.41, delay: { signal: 6, blocked: 3, giveWay: 1, conflict: 1, other: 4, total: 15 } }),
    dir({}),
  ],
  totalVph: 1479, status: 'moderate', statusConsistent: true, statusBySeed: ['moderate', 'moderate', 'moderate'],
  headline: 'Eastbound traffic moves with some delay: 37 km/h against a free-flow 50 km/h (level of service C).',
  reasons: ['Eastbound: 950 veh/h routed along it.', MSG],
  cause: { kind: 'mixed', text: 'The delay (15 s per vehicle) is spread over causes: signal 6 s, queue from further on 3 s, giving way 2 s, slow moving traffic 4 s.', chain: null },
  explainedDirection: 'eastbound',
  bottleneck: null,
  origins: [{ label: 'From beyond the area, east, via Airport Road', coordinates: [73.9, 18.5, 0], vph: 600, share: 0.6, edge: true }],
  destinations: [{ label: 'To streets about 300 m west, near Mangaldas Road', coordinates: [73.8, 18.5, 0], vph: 300, share: 0.3, edge: false }],
  composition: { throughShare: 0.93, localShare: 0.07 }, feeders: [], nearby: [], junctions: [],
  selectLinkVph: new Map(), areaVc: new Map(), linkVph: new Map(), areaLinkVph: new Map(),
  areaBottlenecks: [{ label: 'Airport Road at its signal, north-east of the road, 800 m', roadName: 'Airport Road', coordinates: [73.9, 18.55, 0], vc: 1.31, delayVehH: 40, segmentKeys: [], atJunction: true }],
  network: {} as RoadAnalysisResult['network'],
  load: { ...load(6620, true, MSG), servedShare: 0.34 },
  loadBySeed: [load(6620, true, MSG), load(6700, true, MSG), load(6540, true, MSG)],
  assignment: { iterations: 30, relativeGap: 0.001, demandVph: 50000, unroutedVph: 0, overCapacityLinks: 347, totalVehHours: 1000, elapsedMs: 1000 },
  corridor: { roads: 100, demandVph: 19314, rangeM: 700 },
  perSeed: [42, 7, 1234].map(seed => ({ seed, sectionVph: 1479, sectionTimeS: 63, completedTrips: 100, meanTravelTimeS: 200, meanDelayS: 50, servedShare: 0.34, gridlockRemovals: 0, endDelayS: 20 })),
  evidence: { demand: null, notes: [] },
  ...over,
});
const actions = (): AnalysisActions => ({ hoverDirection: vi.fn(), pinDirection: vi.fn(), flyTo: vi.fn(), setOverlay: vi.fn(), editInBuild: vi.fn() });
const doc = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

describe('road analysis panel pieces', () => {
  it('status header: severity chip, one short line, run agreement chip', () => {
    const d = doc(renderToStaticMarkup(createElement(StatusHeader, { r: result(), when: 'Evening peak · 6 pm' })));
    expect(d.querySelector('[data-testid="road-status"]')!.getAttribute('data-status')).toBe('moderate');
    expect(d.body.textContent).toContain('Some delay');
    expect(d.querySelector('[data-testid="status-line"]')!.textContent).toBe('East: 37 km/h vs 50 free-flow');
    // Seed agreement is run-to-run stability, not accuracy (docs/urbanos/UX_ARCHITECTURE.md §4)
    expect(d.querySelector('[data-testid="status-consistency"]')!.textContent).toBe('Run-to-run stability 3/3');
    expect(d.querySelector('[data-testid="status-consistency"]')!.getAttribute('title')).toContain('not accuracy');
    // The model's validation verdict sits on the headline, not dismissable
    expect(d.querySelector('[data-testid="trust-headline"]')!.textContent).toContain('Fails validation (TAG M3.1)');
  });
  it('KPI cards are the explained direction\'s computed figures', () => {
    const d = doc(renderToStaticMarkup(createElement(WorstKpis, { r: result() })));
    // The verdict is on the headline just above; the KPI block does not repeat it (it showed twice)
    expect(d.querySelector('[data-testid="trust-kpis"]')).toBeNull();
    expect(d.querySelector('[data-testid="kpi-speed"]')!.textContent).toContain('37');
    expect(d.querySelector('[data-testid="kpi-delay"]')!.textContent).toContain('15');
    expect(d.querySelector('[data-testid="kpi-vc"]')!.textContent).toContain('41%');
    expect(d.querySelector('[data-testid="kpi-los"]')!.textContent).toContain('C');
  });
  it('the Simulate result shows the "Fails validation (TAG M3.1)" badge once (headline + KPI block)', () => {
    const r = result();
    const html = renderToStaticMarkup(createElement('div', null, createElement(StatusHeader, { r, when: 'Evening peak · 6 pm' }), createElement(WorstKpis, { r })));
    expect(html.split('Fails validation (TAG M3.1)').length - 1).toBe(1);
  });
  it('picks the direction the analysis explains, not just the longest delay', () => {
    const r = result({ explainedDirection: 'westbound' });
    expect(explainedDirection(r)!.d.label).toBe('westbound');
    expect(explainedDirection(result({ explainedDirection: undefined }))!.d.label).toBe('eastbound');
  });
  it('direction cards keep swatch glyph, compass, degrees, landmark and the hover/pin wiring', () => {
    const d = doc(renderToStaticMarkup(createElement(DirectionsGrid, { r: result(), heading: Math.PI / 2, focus: { hover: 1, pinned: null }, actions: actions() })));
    const cards = [...d.querySelectorAll('[data-testid="direction-card"]')];
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('[data-testid="direction-title"]')!.textContent).toBe('East · 78°');
    expect(cards[1].querySelector('[data-testid="direction-landmark"]')!.textContent).toBe('to the junction with Old Pune–Mumbai Highway');
    // Glyph rotation is bearing minus camera heading (90°): 78 - 90 = -12 → 348
    expect(cards[0].querySelector('[data-testid="direction-glyph"]')!.getAttribute('data-rotation')).toBe('348');
    expect(cards[1].getAttribute('data-active')).toBe('true');
    expect(cards[0].className).toContain('opacity-60');
  });
  it('why: one-line cause, stacked delay bar, prose collapsed and the load message not repeated', () => {
    const html = renderToStaticMarkup(createElement(WhyCard, { r: result(), overlay: 'none', actions: actions() }));
    const d = doc(html);
    expect(d.querySelector('[data-testid="cause-line"]')!.textContent).toBe('Spread over several causes');
    expect(d.querySelector('[data-testid="delay-breakdown"]')).not.toBeNull();
    const detail = d.querySelector('[data-testid="cause-detail"]')!;
    expect(detail.hasAttribute('open')).toBe(false);
    expect(detail.textContent).toContain('spread over causes');
    expect(html).not.toContain('6,620 of the 19,314');
  });
  it('names a queue cause with its run agreement', () => {
    const r = result({ cause: { kind: 'spillback', text: 'x', chain: { direction: 'eastbound', blockedShare: 0.6, root: { label: 'Bund Garden Road / Mangaldas Road', coordinates: [0, 0], cause: 'signal', delayS: 30 }, segmentKeys: [], agreement: 3, seeds: 3 } } });
    expect(causeLine(r)).toMatchObject({ text: 'Queue backing up from Bund Garden Road / Mangaldas Road (its signal)', agreement: '3/3 runs' });
  });
  it('says which kind of evidence is missing when no cause is named', () => {
    const slowMoving = result({ cause: { kind: 'insufficient', text: 'x', chain: null }, directions: [dir({ label: 'eastbound', delay: { signal: 0, blocked: 0, giveWay: 0, conflict: 0, other: 13, total: 13 } })] });
    expect(causeLine(slowMoving).text).toBe('Slow in moving traffic: no single junction stands out');
    const untraced = result({ cause: { kind: 'insufficient', text: 'x', chain: null }, directions: [dir({ label: 'eastbound', delay: { signal: 2, blocked: 8, giveWay: 0, conflict: 0, other: 2, total: 12 } })] });
    expect(causeLine(untraced).text).toBe('Queue from further on, not traced to one junction consistently');
  });
  it('demand vs throughput: one card with per-run bars and the explanation behind a toggle', () => {
    const html = renderToStaticMarkup(createElement(LoadCard, { r: result() }));
    const d = doc(html);
    expect(d.querySelectorAll('[data-testid="load-warning"]')).toHaveLength(1);
    expect(d.body.textContent).toContain('34%');
    expect(d.body.textContent).toContain('3/3 runs');
    expect(d.querySelectorAll('[data-testid="load-runs"] li')).toHaveLength(3);
    expect(d.body.textContent).toContain('4,165 queued at edge');
    // The explanation is closed by default
    expect(html).not.toContain('6,620 of the 19,314');
  });
  it('no load card when no run is overloaded', () => {
    const r = result({ load: load(19000, false, null), loadBySeed: [load(19000, false, null)] });
    expect(renderToStaticMarkup(createElement(LoadCard, { r }))).toBe('');
  });
  it('sources and bottlenecks render as bars with their shares', () => {
    const s = renderToStaticMarkup(createElement(SourcesCard, { r: result(), overlay: 'none', actions: actions() }));
    expect(s).toContain('93%');
    expect(s).toContain('60%');
    const b = renderToStaticMarkup(createElement(BottlenecksCard, { r: result(), overlay: 'none', actions: actions() }));
    expect(b).toContain('347 stretches over capacity');
    expect(b).toContain('131%');
    expect(b).toContain('Show Airport Road on the map');
  });
  it('sources card with no routed traffic says so instead of "0% through · 100% local" (QA 2026-11-22)', () => {
    const s = renderToStaticMarkup(createElement(SourcesCard, { r: result({ composition: { throughShare: 0, localShare: 0 }, origins: [], destinations: [] }), overlay: 'none', actions: actions() }));
    expect(s).toContain('No simulated traffic is routed over this road');
    expect(s).not.toContain('100%');
    expect(s).not.toContain('Show its routes on the map');
  });
  it('a bottleneck label with the forced-flow note fits: three lines, not cut at two (docs/OVERHAUL.md §16 merged-build check)', () => {
    const r = result();
    r.areaBottlenecks = [{ ...r.areaBottlenecks[0], label: 'Old Pune–Mumbai Highway, south-east of the road, 200 m (no other route in the model for 100% of its traffic)' }];
    const b = renderToStaticMarkup(createElement(BottlenecksCard, { r, overlay: 'none', actions: actions() }));
    const span = b.match(/<span[^>]*data-testid="bottleneck-label"[^>]*>/)![0];
    expect(span).toContain('line-clamp-3');
    expect(span).not.toContain('line-clamp-2');
  });
  it('a network gap behind a forced stretch has its own line, not the clamped label\'s last note (docs/OVERHAUL.md §19)', () => {
    const r = result();
    r.areaBottlenecks = [{ ...r.areaBottlenecks[0], roadName: 'COEP Road', vc: 6.7, demandOverCapacity: true, noAlternativeShare: 1,
      label: 'COEP Road, south-east of the road, 300 m (demand 6.7× its capacity: more than can pass, not a flow; no other route in the model for 100% of its traffic; network gap: Mokshagundam Vishweshvarayya Flyover ends without a connection 100 m away)',
      gap: { roadName: 'Mokshagundam Vishweshvarayya Flyover', title: 'Mokshagundam Vishweshvarayya Flyover ends without a connection', coordinates: [73.85, 18.53, 0], distanceM: 14 } }];
    const d = doc(renderToStaticMarkup(createElement(BottlenecksCard, { r, overlay: 'none', actions: actions() })));
    expect(d.querySelector('[data-testid="bottleneck-gap"]')?.textContent).toBe('Network gap: Mokshagundam Vishweshvarayya Flyover ends without a connection, 100 m away');
    const label = d.querySelector('[data-testid="bottleneck-label"]')!;
    expect(label.textContent).toBe('COEP Road, south-east of the road, 300 m (demand 6.7× its capacity: more than can pass, not a flow; no other route in the model for 100% of its traffic)');
    expect(label.getAttribute('title')).toContain('network gap: Mokshagundam');
  });
  it('suggestion card shows the headline figure and the CTAs', () => {
    const html = renderToStaticMarkup(createElement(SuggestionCard, { s: { kind: 'widen', title: 'Add a lane', evidence: 'e', why: 'w', figure: { value: '91%', label: 'of mid-block capacity' }, action: { label: 'Select the road in Design', roadIds: ['a'], at: null } }, onTest: () => {}, actions: actions() }));
    expect(html).toContain('91%');
    expect(html).toContain('Test it');
    expect(html).toContain('Select the road in Design');
  });
  it('"Give its approach more green time" opens the junction at the end of the direction its signal limits (browser workflow 2026-11-09: it had no Build action)', () => {
    const limited = dir({ label: 'towards the south-west', vc: 1.7, capacityBasis: 'signal', stopLinePcu: 1500, capacityPcu: 1500, paths: [[[73.86, 18.53, 0], [73.861, 18.531, 0]], [[73.861, 18.531, 0], [73.862, 18.532, 0]]] });
    const r = result({ directions: [limited, dir({})], status: 'severe', cause: { kind: 'insufficient', text: 't', chain: null } });
    const s = improvementsFor(r, ['osm_1', 'osm_2'], null).find(x => x.title === 'Give its approach more green time');
    expect(s?.action).toEqual({ label: 'Open the junction in Design', roadIds: ['osm_1', 'osm_2'], at: [73.862, 18.532, 0], junction: true });
    // Without geometry there is nowhere to open: no action rather than a wrong place
    const none = improvementsFor(result({ directions: [{ ...limited, paths: [] }, dir({})], status: 'severe', cause: { kind: 'insufficient', text: 't', chain: null } }), ['osm_1'], null).find(x => x.title === 'Give its approach more green time');
    expect(none).toBeDefined();
    expect(none?.action).toBeUndefined();
  });
  it('"more green time" opens the stop line that limits the direction, not the end of its drawn geometry (P12 test #2: Bharati Hospital junction, run without a signal)', () => {
    const paths: [number, number, number][][] = [[[73.86, 18.53, 0], [73.861, 18.531, 0]], [[73.861, 18.531, 0], [73.862, 18.532, 0]]];
    const cause = { kind: 'insufficient' as const, text: 't', chain: null };
    const find = (d: DirectionFlow, title = 'Give its approach more green time') => improvementsFor(result({ directions: [d, dir({})], status: 'severe', cause }), ['osm_1'], null).find(x => x.title === title);
    // The run's signal at the direction's end: there, even though the geometry ends 120 m further on
    const run = find(dir({ label: 'northbound', vc: 1.05, capacityBasis: 'signal', stopLinePcu: 1500, capacityPcu: 1500, paths, stopLine: { kind: 'signal', at: [73.8605, 18.5305], source: 'run' } }));
    expect(run?.action).toEqual({ label: 'Open the junction in Design', roadIds: ['osm_1'], at: [73.8605, 18.5305, 0], junction: true });
    expect(run?.evidence).toContain('what the signal at its end passes');
    // The assignment's tightest signal part-way along: there, and the words say "on its way"
    const mid = find(dir({ label: 'northbound', vc: 1.05, capacityBasis: 'signal', stopLinePcu: 1500, capacityPcu: 1500, paths, stopLine: { kind: 'signal', at: [73.8607, 18.5307], source: 'assignment' } }));
    expect(mid?.action?.at).toEqual([73.8607, 18.5307, 0]);
    expect(mid?.evidence).toContain('the signal part-way along it (assumed green split)');
    // A roundabout entry is not a green time; a signalised crossing has no junction to open
    const rb = find(dir({ vc: 1.2, capacityBasis: 'signal', stopLinePcu: 900, capacityPcu: 900, paths, stopLine: { kind: 'roundabout', at: [73.861, 18.531], source: 'assignment' } }), 'Give its roundabout entry more room');
    expect(rb?.action).toMatchObject({ at: [73.861, 18.531, 0], junction: true });
    const cx = find(dir({ vc: 1.2, capacityBasis: 'signal', stopLinePcu: 900, capacityPcu: 900, paths, stopLine: { kind: 'crossing', at: [73.8612, 18.5312], source: 'assignment' } }), 'Give the crossing on it a shorter cycle');
    expect(cx?.action).toEqual({ label: 'Select the road in Design', roadIds: ['osm_1'], at: [73.8612, 18.5312, 0] });
    // Known to have no located stop line: no action rather than the wrong junction
    const none = find(dir({ vc: 1.2, capacityBasis: 'signal', stopLinePcu: 900, capacityPcu: 900, paths, stopLine: null }));
    expect(none).toBeDefined();
    expect(none?.action).toBeUndefined();
  });
  it('stop line words say where the limiting stop line stands and whose timing it is (P12 S3: an assignment stop line mid-carriageway read "the signal at its end")', () => {
    const paths: [number, number, number][][] = [[[73.8354, 18.4935, 0], [73.8436, 18.4997, 0]]];
    expect(stopLineWords({ paths, stopLine: { kind: 'signal', at: [73.82759, 18.48326], source: 'run' } })).toBe('the signal at its end');
    expect(stopLineWords({ paths, stopLine: { kind: 'signal', at: [73.8436, 18.4997], source: 'assignment' } })).toBe('the signal at its end (assumed green split)');
    expect(stopLineWords({ paths, stopLine: { kind: 'signal', at: [73.83817, 18.49592], source: 'assignment' } })).toBe('the signal part-way along it (assumed green split)');
    expect(stopLineWords({ paths, stopLine: { kind: 'roundabout', at: [73.83817, 18.49592], source: 'assignment' } })).toBe('the roundabout entry part-way along it');
    expect(stopLineWords({ paths, stopLine: { kind: 'crossing', at: [73.83817, 18.49592], source: 'assignment' } })).toBe('the signalised crossing on it (assumed green split)');
    // Results saved before stopLine existed keep the old words
    expect(stopLineWords({ paths })).toBe('the signal at its end');
    const before = [dir({ label: 'towards the north-east', midblockPcu: 3857, capacityBasis: 'signal', stopLinePcu: 2499, roadIds: ['osm_1157871403'], bearingDeg: 45, lanesRange: [3, 3] })];
    const after = [dir({ label: 'towards the north-east', midblockPcu: 5143, capacityBasis: 'signal', stopLinePcu: 3332, roadIds: ['osm_1157871403'], bearingDeg: 45, lanesRange: [4, 4], paths, stopLine: { kind: 'signal', at: [73.83817, 18.49592], source: 'assignment' } })];
    const ins = laneInsights(before, after, { before: new Map([['osm_1157871403', { laneCount: 3, coordinates: [] } as never]]), after: new Map([['osm_1157871403', { laneCount: 4, coordinates: [] } as never]]) }, []);
    expect(ins[0].text).toContain('The signal part-way along it (assumed green split) passes 3,332 PCU/h at the stop line and limits it more than the road does.');
  });
  it('a flowing road whose routed traffic mostly did not get through is not "No pressing problem" (browser workflow 2026-11-09, Sangamwadi: 886 of 1,954 veh/h)', () => {
    const flowing = { status: 'flowing' as const, statusBySeed: ['flowing', 'flowing', 'flowing'] as RoadAnalysisResult['statusBySeed'], cause: { kind: 'mixed' as const, text: 't', chain: null }, headline: 'Eastbound traffic moves freely: 45 km/h against a free-flow 50 km/h (level of service A).' };
    const held = improvementsFor(result({ ...flowing, directions: [dir({ label: 'eastbound', vph: 886, demandVph: 1954, vc: 0.3 }), dir({})] }), ['osm_1'], null);
    expect(held.map(x => x.title)).toEqual(['The road flows, but traffic is held before it']);
    expect(held[0].evidence).toContain('Only 886 of the 1,954 veh/h routed eastbound got onto it');
    expect(held[0].figure?.value).toBe('45%');
    // Most of the routed traffic got through: the old wording stays
    const fine = improvementsFor(result({ ...flowing, directions: [dir({ label: 'eastbound', vph: 900, demandVph: 950, vc: 0.3 }), dir({})] }), ['osm_1'], null);
    expect(fine.map(x => x.title)).toEqual(['No pressing problem at this hour']);
  });
  it('disclosures are closed by default; per-run detail lists every seed', () => {
    expect(renderToStaticMarkup(createElement(Disclosure, { title: 'How this is calculated' }, 'x'))).not.toMatch(/<details[^>]*open/);
    const d = doc(renderToStaticMarkup(createElement(PerRunDetail, { r: result() })));
    expect(d.querySelector('details')!.hasAttribute('open')).toBe(false);
    expect(d.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(d.body.textContent).toContain('560–600 veh/h');
  });
});
