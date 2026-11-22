import { describe, it } from 'vitest';
import fs from 'fs';
import http from 'http';
import { ObjectManager } from '../objects/ObjectManager';
import type { CityObject, RoadObject } from '../objects/types';
import { HistoryManager } from '../history/HistoryManager';
import { EditingEngine } from '../editing/EditingEngine';
import { LocalOsmIndex } from '../editing/LocalOsmIndex';
import { SimulationMode, type SimulationContext } from '../simulation/SimulationMode';
import { TrafficSignalSource } from '../simulation/trafficSignals';
import { filterObjectsForScenario } from '../scenarios/scenarioFilter';
import { isSampleObject } from '../objects/sampleObjects';
import { isDrivable, type DrivableObject } from '../simulation/StudyAreaExplorer';
import { snapDemandPlan } from '../simulation/StudyDemand';
import { splitJunctionObjects } from '../simulation/junctionControl';
import { hourFactor, COUNT_HOURS } from '../simulation/timeOfDay';
import { areaOdProblem, countsBeforeAfter } from '../demand/odmeAssignment';
import { estimateOd, matrixChangeStats, modelledAt, type OdmeCount } from '../demand/odme';
import type { TimePeriod } from '../objects/demandTypes';

/**
 * Opt-in WINDOW calibration of central-Pune edge flows (docs/urbanos/TRAFFIC_CALIBRATION_P9.md): WINCAL=1.
 *
 * Why: every study area's demand is edge-to-edge traffic placed at a class-typical flow per lane wherever the
 * selected area's edge cuts a road (AreaDemand.cordonOf), so a bridge's volume was a property of the selected
 * area (OVERHAUL §24.3b) and morning = evening. Standard remedy (sub-area / windowing): fix the flows on a larger
 * network once, then cut study areas from it. Here:
 *  1. ONE large window round all count sites is built with the app's own SimulationMode (same network, OSM index,
 *     signals, hour profile as the browser);
 *  2. per period (AM at 10:00, PM at 18:00) its prior demand is estimated from counts with the app's ODME
 *     (Spiess 1990) using ONLY the sites marked `role: calibration` in pune_network_validation_v1.json;
 *     `holdout` sites are passed as held out (estimateOd refuses them) and only evaluated;
 *  3. the estimated window assignment's link volumes, divided back to the period's reference hour, are written as
 *     calibrated edge flows (backend/data/calibrated_flows/pune_central_window_v1.json) that AreaDemand uses at the
 *     cordon of any study area inside the window. Outside it the class-per-lane flows still apply.
 *     NOT SHIPPED (p9): on the 8 hold-out counts every window option did worse than the class-per-lane flows
 *     (docs/urbanos/TRAFFIC_CALIBRATION_P9.md §4); a file is used only if installed and checked on the hold-out.
 *
 * Counts are compared in motor vehicles (veh_motorised: cycles and carts removed, see the file); a count made at
 * another hour than the model hour is moved to it with the Pune weekday hourly profile (assumed: the profile is the
 * app's own, built partly from the Gunjan Chowk 2017 counts). Sambhaji (no two-wheelers in the count) is compared
 * with the model's non-two-wheeler volume.
 *
 *   WINCAL_DB     JSON dump {objects: [...]} of a COPY of the project database
 *   WINCAL_API    backend base URL (local OSM index + signals + hour profile)
 *   WINCAL_SEEDS  comma-separated seed road ids of the window
 *   WINCAL_RANGE  window range (m)
 *   WINCAL_OUT    output report JSON
 *   WINCAL_FLOWS  output calibrated-flows JSON (written only when both periods ran)
 *   WINCAL_MAXIT  ODME iterations (default 12)
 */
if (process.env.WINCAL && process.env.WINCAL_API) {
  const base = new URL(process.env.WINCAL_API);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => new Promise((resolve, reject) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const req = http.request({ host: base.hostname, port: base.port, path: u.pathname + u.search, method: init?.method ?? 'GET', headers: { 'Content-Type': 'application/json' } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8'), status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, statusText: res.statusMessage ?? '', text: async () => body, json: async () => JSON.parse(body), headers: { get: (k: string) => (res.headers[k.toLowerCase()] as string) ?? null } } as unknown as Response);
      });
    });
    req.on('error', reject);
    if (init?.signal) init.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
    if (init?.body) req.write(init.body as string);
    req.end();
  })) as typeof fetch;
}

interface Obs {
  id: string; name: string; osmWays: number[]; hour: number; veh: number; veh_motorised?: number; grade: string; source: string;
  role?: string; class_filter?: string; parts?: { name: string; hour: number; veh_motorised: number }[];
}

const PERIODS: { period: TimePeriod; hour: number; sites: (o: Obs) => boolean }[] = [
  { period: 'AM_Peak', hour: 10, sites: o => o.hour < 12 },
  { period: 'PM_Peak', hour: 18, sites: o => o.hour >= 12 },
];

describe.skipIf(!process.env.WINCAL)('window calibration of central-Pune edge flows (opt-in)', () => {
  it('fits calibration sites only, reports hold-out separately, writes calibrated edge flows', async () => {
    const db = JSON.parse(fs.readFileSync(process.env.WINCAL_DB!, 'utf8')) as { objects: (CityObject & Record<string, unknown>)[] };
    const om = new ObjectManager();
    for (const obj of db.objects) {
      const o = { ...obj, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as unknown as CityObject;
      if (o.type === 'road') om.syncRoadProperties(o as RoadObject);
      (om as unknown as { objects: Map<string, CityObject> }).objects.set(o.id, o);
    }
    om.liftBridges();
    const history = new HistoryManager(om);
    const localOsm = new LocalOsmIndex();
    const editing = new EditingEngine(om, history, () => null, localOsm);
    const scenarioId = 'base';
    const ctx = (): SimulationContext => {
      const objects = filterObjectsForScenario(om.getAll(), scenarioId).filter(o => !isSampleObject(o)) as (CityObject & Record<string, any>)[];
      const flows = (values: Record<string, number>) => Object.fromEntries((['AM_Peak', 'PM_Peak', 'Midday', 'Night'] as TimePeriod[]).map(p => [p, Math.max(0, values?.[p] || 0)])) as Record<TimePeriod, number>;
      return {
        scenarioId,
        junctions: objects.filter(o => o.type === 'junction') as never,
        buildings: objects.filter(o => o.type === 'building') as never,
        zones: objects.filter(o => o.type === 'zone').map(z => ({ id: z.id, name: z.name, boundaryPolygon: z.coordinates, totalPopulation: z.totalPopulation || 0, totalEmployment: z.totalEmployment || 0,
          landUseMix: z.landUseMix, gateways: z.gateways || [], provenance: z.provenance || { source: 'estimated', confidence: 0, updatedAt: z.updatedAt } })) as never,
        gateways: objects.filter(o => o.type === 'gateway').map(g => ({ id: g.id, name: g.name, coordinates: g.coordinates[0], connectedNodeId: g.connectedNodeId,
          inboundFlows: flows(g.inboundFlows), outboundFlows: flows(g.outboundFlows), modeSplit: g.modeSplit,
          provenance: g.provenance || { source: 'estimated', confidence: 0, updatedAt: g.updatedAt } })) as never,
      };
    };
    const mode = new SimulationMode(
      () => filterObjectsForScenario(om.getAll(), scenarioId).filter(isDrivable).filter(o => !isSampleObject(o)) as DrivableObject[],
      { load: (boxes, signal) => editing.loadOsmRoadsForStudyArea(boxes, signal) },
      new TrafficSignalSource(localOsm),
      ctx,
    );
    // The window itself must be cut from the class-per-lane prior, never from an earlier calibration
    mode.useCalibratedEdgeFlows = false;
    om.onChange((types: Set<string>) => { if (types.has('road') || types.size === 0 || types.has('junction')) mode.networkChanged(); });
    mode.enter();
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const settle = async () => {
      for (let i = 0; i < 1800; i++) {
        const s = mode.getState();
        if (s.osmRoads.status !== 'loading' && s.signals.status !== 'loading' && s.timeOfDay.status === 'ready' && s.area && s.section) return true;
        await sleep(200);
      }
      return false;
    };
    const obsFile = JSON.parse(fs.readFileSync('../backend/data/observed_validation/pune_network_validation_v1.json', 'utf8')) as { counts: Obs[] };
    const scored = obsFile.counts.filter(o => o.role === 'calibration' || o.role === 'holdout');
    const seeds = process.env.WINCAL_SEEDS!.split(',');
    const range = Number(process.env.WINCAL_RANGE ?? 6500);
    const maxIterations = Number(process.env.WINCAL_MAXIT ?? 12);
    const report: Record<string, unknown> = { created: new Date().toISOString(), seeds, range, periods: {} };
    const priorFlows: Record<string, Record<string, number>> = {};
    const flows: Record<string, { modelHour: number; refHour: number; hourFactor: number; links: Record<string, number>; calibrationSites: string[]; holdoutSites: string[]; estimatedVph: number; priorVph: number }> = {};
    for (const P of PERIODS) {
      const t0 = Date.now();
      mode.setRange(range);
      seeds.forEach((id, i) => mode.selectRoad(id, i > 0));
      mode.setHour(P.hour);
      const ok1 = await settle(); await sleep(1500); const ok2 = await settle();
      const st = mode.getState();
      const area = st.area!;
      const profile = st.timeOfDay.profile!;
      const roads = new Map((mode as unknown as { getRoads: () => DrivableObject[] }).getRoads().map(r => [r.id, r]));
      const prior = mode.studyPlan(area, P.period, true)!;
      const f = st.timeOfDay.factor;
      const segs = new Set(area.segments.map(s => s.key));
      const trips = snapDemandPlan(prior, area.network, 250, segs).map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * f }));
      const tw = trips.filter(t => t.kind === 'two_wheeler').reduce((n, t) => n + t.vehiclesPerHour, 0);
      const twShare = tw / Math.max(1, trips.reduce((n, t) => n + t.vehiclesPerHour, 0));
      const problem = areaOdProblem(area, roads, trips, { signalPoints: mode.mappedSignalPoints() ?? undefined, junctionEdits: splitJunctionObjects(ctx().junctions).edits });
      // Count -> model hour: the motor-vehicle count moved from its own hour to the model hour with the hourly profile (assumed)
      const toModelHour = (o: Obs) => (o.parts ?? [{ hour: o.hour, veh_motorised: o.veh_motorised ?? o.veh }])
        .reduce((n, p) => n + p.veh_motorised * hourFactor(profile, P.hour, p.hour), 0);
      const groupsOf = (o: Obs) => {
        const groups: number[][] = [];
        for (const w of o.osmWays) for (const dir of ['fwd', 'bwd']) {
          const g = problem.linkIds.map((id, i) => [id, i] as const).filter(([id]) => new RegExp(`^osm_${w}(_[a-z0-9]+)*_seg_\\d+_${dir}$`).test(id)).map(([, i]) => i);
          if (g.length) groups.push(g);
        }
        return groups;
      };
      const sites = scored.filter(P.sites).map(o => ({ o, groups: groupsOf(o), observed: toModelHour(o) }));
      const missing = sites.filter(s => !s.groups.length).map(s => s.o.id);
      const asCount = (s: (typeof sites)[number], datasetId: string): OdmeCount => ({ id: s.o.id, groups: s.groups, observed: s.observed, datasetId });
      const cal = sites.filter(s => s.groups.length && s.o.role === 'calibration' && !s.o.class_filter).map(s => asCount(s, 'calibration'));
      const hold = sites.filter(s => s.groups.length && (s.o.role === 'holdout' || s.o.class_filter)).map(s => asCount(s, 'holdout'));
      const est = estimateOd(problem, cal, { heldOutDatasetIds: ['holdout'], maxIterations });
      const change = matrixChangeStats(problem.prior, est.matrix, problem.cells);
      const classOf = (id: string) => sites.find(s => s.o.id === id)!.o.class_filter === 'no_two_wheeler' ? 1 - twShare : 1;
      // Every scored site: model before/after at the model hour (class-filtered where the count is), observed at the model hour
      const evalRows = [...cal, ...hold].map(c => {
        const s = sites.find(x => x.o.id === c.id)!;
        const k = classOf(c.id);
        const b = modelledAt(c, est.priorLoad.linkFlow).value * k, a = modelledAt(c, est.load.linkFlow).value * k;
        // Back at the count's own hour (for the screen line and the per-site table): model x profile(own hour)/profile(model hour)
        const back = (s.o.parts ? s.o.parts.reduce((n, p) => n + p.veh_motorised, 0) : (s.o.veh_motorised ?? s.o.veh)) / s.observed;
        return { id: c.id, name: s.o.name, role: s.o.role, classFilter: s.o.class_filter ?? null, countHour: s.o.hour, modelHour: P.hour,
          observedAtModelHour: s.observed, beforeAtModelHour: b, afterAtModelHour: a,
          observedMotorised: s.o.parts ? s.o.parts.reduce((n, p) => n + p.veh_motorised, 0) : (s.o.veh_motorised ?? s.o.veh), observedVehPublished: s.o.veh,
          beforeAtCountHour: b * back, afterAtCountHour: a * back };
      });
      void countsBeforeAfter;
      report.periods = { ...(report.periods as object), [P.period]: {
        modelHour: P.hour, hourFactor: f, settled: ok1 && ok2, signals: st.signals.status, osmRoads: st.osmRoads.status, areaSegments: area.segments.length, bounds: area.bounds,
        components: prior.provenance.components, priorVph: Math.round(prior.provenance.vehiclesPerHour * f), estimatedVph: Math.round(est.matrix.reduce((n, v) => n + v, 0)),
        twoWheelerShare: twShare, cells: problem.prior.length, assignments: problem.assignments(),
        iterations: est.iterations.map(i => ({ it: i.iteration, z: Math.round(i.objective), meanGeh: +i.meanAbsGeh.toFixed(2), halvings: i.halvings, accepted: i.accepted, gap: i.assignmentGap })),
        stopReason: est.stopReason, boundedCells: est.boundedCells, factorRange: [Math.min(...est.factors), Math.max(...est.factors)], change, missing,
        calibration: cal.map(c => c.id), holdout: hold.map(c => c.id), sites: evalRows, wallMs: Date.now() - t0,
      } };
      // Calibrated edge flows at the period's reference hour (what AreaDemand's class-per-lane values stand for)
      const refHour = COUNT_HOURS[P.period === 'AM_Peak' ? 'AM' : 'PM'];
      const toRef = hourFactor(profile, refHour, P.hour);
      const links: Record<string, number> = {}, priorLinks: Record<string, number> = {};
      problem.linkIds.forEach((id, i) => { const v = est.load.linkFlow[i] * toRef; if (v >= 5) links[id] = Math.round(v); const w = est.priorLoad.linkFlow[i] * toRef; if (w >= 5) priorLinks[id] = Math.round(w); });
      priorFlows[P.period] = priorLinks;
      flows[P.period] = { modelHour: P.hour, refHour, hourFactor: toRef, links, calibrationSites: cal.map(c => c.id), holdoutSites: hold.map(c => c.id),
        estimatedVph: Math.round(est.matrix.reduce((n, v) => n + v, 0) * toRef), priorVph: Math.round(prior.provenance.vehiclesPerHour * f * toRef) };
      fs.writeFileSync(process.env.WINCAL_OUT!, JSON.stringify(report, null, 1));
      console.log(JSON.stringify({ period: P.period, wallMs: Date.now() - t0, segs: area.segments.length, cells: problem.prior.length, cal: cal.length, hold: hold.length, missing, stop: est.stopReason }));
    }
    if (process.env.WINCAL_FLOWS && flows.AM_Peak && flows.PM_Peak) {
      const st = mode.getState();
      fs.writeFileSync(process.env.WINCAL_FLOWS, JSON.stringify({
        schema: 'twincity.calibrated_edge_flows/v1', id: 'pune_central_window_v1', created: new Date().toISOString().slice(0, 10),
        status: 'estimated',
        method: 'Window (sub-area) calibration: the app\'s user-equilibrium assignment on one large central-Pune window, its edge-to-edge prior demand estimated per period with the app\'s ODME (Spiess 1990) on CALIBRATION count sites only; link volumes divided back to the period reference hour with the Pune weekday hourly profile. Used by AreaDemand as edge (cordon) flows of study areas inside the window.',
        counts: 'backend/data/observed_validation/pune_network_validation_v1.json (CMP 2008 screen-line counts; Gunjan Chowk 2017), motor vehicles; split recorded in that file',
        caveats: [
          'Fitted to 2008 counts on a 2026 network: traffic has grown and new crossings exist since; the fit reproduces 2008 levels at 7 sites, not 2026 traffic.',
          'The prior has no land use in central Pune: all window demand is edge-to-edge, so ODME only re-weights traffic entering and leaving the window.',
          'ODME is under-determined: with 3-4 counts per period many matrices fit equally; flows away from counted roads are not checked by any count.',
          'Counts at another hour were moved to the model hour with the app\'s hourly profile (assumed).',
        ],
        window: { seeds, rangeM: range, bounds: st.area?.bounds },
        periods: flows,
      }));
    }
    // The window's own assignment of its unfitted prior, in the same format (to separate the effect of windowing from that of fitting)
    if (process.env.WINCAL_FLOWS_PRIOR && flows.AM_Peak && flows.PM_Peak) {
      const doc = JSON.parse(fs.readFileSync(process.env.WINCAL_FLOWS!, 'utf8'));
      for (const k of Object.keys(doc.periods)) doc.periods[k] = { ...doc.periods[k], links: priorFlows[k], fitted: false };
      fs.writeFileSync(process.env.WINCAL_FLOWS_PRIOR, JSON.stringify({ ...doc, id: doc.id + '_prior', method: 'UNFITTED window prior (no ODME), for comparison only. ' + doc.method }));
    }
    mode.exit();
  }, 6 * 3600_000);
});
