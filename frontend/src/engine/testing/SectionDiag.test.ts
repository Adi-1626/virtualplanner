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
import { screenlineChecks, type ScreenlineFile } from '../calibration/screenlines';
import { snapDemandPlan } from '../simulation/StudyDemand';
import { assignTraffic, PCU as ASSIGN_PCU } from '../simulation/staticAssignment';
import { cordonOf, EDGE_FLOW_PER_LANE_VPH } from '../simulation/AreaDemand';
import { VEHICLE_TYPES } from '../simulation/TrafficMicroSim';
import { corridorPlanOf, type AnalysisJob } from '../simulation/analysisJob';
import type { MicroDemandTrip } from '../simulation/TrafficMicroSim';
import { TrafficMicroSim } from '../simulation/TrafficMicroSim';
import { hourFactor, COUNT_HOURS } from '../simulation/timeOfDay';
import type { TimePeriod } from '../objects/demandTypes';

/**
 * Opt-in harness for docs/OVERHAUL.md §24 (validation against observations): VAL24=1.
 *
 * Runs the app's own SimulationMode (the code behind the Simulate panel) headlessly on a copy of the
 * project database, with the backend serving the local OSM index (roads added around the study area,
 * signals), the hour-of-day profile, the count file, the correction layer and the screenlines, as the
 * browser does. Nothing here changes a model parameter.
 *
 *   VAL24_DB    JSON dump of the database's city_objects ({objects: [...]}, properties unpacked as the app does)
 *   VAL24_RUNS  JSON list of runs: {id, seedRoadIds, hour, range?, ways?: {obsId: [osm way ids]}, hours?: number[] (assignment-only sweep)}
 *   VAL24_OUT   output JSON-lines file (appended)
 *   VAL24_ONLY  comma-separated run ids
 *   VAL24_SEEDS seeds (default 42,7,11)
 *   VAL24_API   backend base URL every /api/ request is sent to
 *
 * HYPOTHETICAL prototypes of proposed calibrations (§24.6). Off unless set; they change only this harness's
 * copy of the inputs, never a default, and every output row records them under `hypothetical`:
 *   VAL24_HYPO_SCALE     the app's own hypothetical demand multiplier (Details -> demand settings), e.g. 1.8
 *   VAL24_HYPO_SPEEDCAP  cap every OSM-tagged maxspeed at this km/h (the urban ceiling now applies to untagged roads only)
 *   VAL24_HYPO_PCU       'trr2021': PCU per vehicle at the mid-points of the dynamic PCU ranges measured at Indian signals by
 *                        Patel & Dhamaniya, TRR 2675(11), 2021, doi:10.1177/03611981211018694 (two-wheeler 0.22, three-wheeler 0.62,
 *                        bus/truck 5.0, car 1.0), swapped into this process's assignment and simulator tables (all links, not signals only)
 *   VAL24_HYPO_EDGE      multiply the edge (cordon) flow per lane of every road class by this factor (AreaDemand EDGE_FLOW_PER_LANE_VPH)
 *
 * Runs with `hours` (assignment-only sweep) also report, per hour, the section's assigned speed and, with `ways`, the assigned
 * volume of each way group and its distance to the nearest cordon point (where edge demand enters), plus the plan's components.
 */
// The test setup replaces fetch with a 404 stub; this harness talks to its own backend (VAL24_API, e.g. http://127.0.0.1:8141)
if (process.env.SECDIAG && process.env.VAL24_API) {
  const base = new URL(process.env.VAL24_API);
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
const wayOf = (id: string) => { const m = /^osm_(\d+)/.exec(id); return m ? Number(m[1]) : null; };

/** Both directions of a set of ways: per way, the busiest piece of each direction, summed over ways (as screenlines.ts). */
function wayVolume(vph: ReadonlyMap<string, number>, ways: readonly number[]) {
  let total = 0, found = false;
  for (const w of ways) {
    let f = 0, b = 0;
    vph.forEach((v, id) => { if (wayOf(id) !== w) return; found = true; if (id.endsWith('_bwd')) b = Math.max(b, v); else f = Math.max(f, v); });
    total += f + b;
  }
  return found ? Math.round(total) : null;
}

describe.skipIf(!process.env.SECDIAG)('section diagnosis: why the micro-simulation passes what the assignment routes (opt-in)', () => {
  it('traces the vehicles routed over one road', async () => {
    const db = JSON.parse(fs.readFileSync(process.env.VAL24_DB!, 'utf8')) as { objects: (CityObject & Record<string, unknown>)[] };
    const om = new ObjectManager();
    for (const obj of db.objects) {
      const o = { ...obj, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as unknown as CityObject;
      if (o.type === 'road') om.syncRoadProperties(o as RoadObject);
      (om as unknown as { objects: Map<string, CityObject> }).objects.set(o.id, o);
    }
    // VAL24_CHANGES: a proposal's modifies/deletes of base objects (GET /api/scenario-changes rows), as the app loads them
    if (process.env.VAL24_CHANGES) om.loadChanges(JSON.parse(fs.readFileSync(process.env.VAL24_CHANGES, 'utf8')));
    if (process.env.VAL24_SCENARIO) om.setActiveScenario(process.env.VAL24_SCENARIO);
    om.liftBridges();
    const hypo: Record<string, number> = {};
    const capTags = (objs: readonly CityObject[]) => {
      if (hypo.speedCapKmh === undefined) return;
      for (const o of objs) {
        const tags = (o as RoadObject).osmProvenance?.originalTags as Record<string, string> | undefined;
        const v = tags?.maxspeed ? parseFloat(tags.maxspeed) : NaN;
        if (tags && Number.isFinite(v) && v > hypo.speedCapKmh) tags.maxspeed = String(hypo.speedCapKmh);
      }
    };
    if (process.env.VAL24_HYPO_SPEEDCAP) hypo.speedCapKmh = Number(process.env.VAL24_HYPO_SPEEDCAP);
    if (process.env.VAL24_HYPO_PCU === 'trr2021') {
      const trr: Record<string, number> = { two_wheeler: 0.22, auto: 0.62, car: 1.0, bus: 5.0, truck: 5.0, bus_auto: 0.62 };
      for (const t of VEHICLE_TYPES) if (trr[t.kind] !== undefined) { t.pcu = trr[t.kind]; ASSIGN_PCU[t.kind] = trr[t.kind]; }
      hypo.pcuTrr2021 = 1;
    }
    if (process.env.VAL24_HYPO_EDGE) {
      hypo.edgeFlowFactor = Number(process.env.VAL24_HYPO_EDGE);
      for (const k of Object.keys(EDGE_FLOW_PER_LANE_VPH)) EDGE_FLOW_PER_LANE_VPH[k] *= hypo.edgeFlowFactor;
    }
    const history = new HistoryManager(om);
    const localOsm = new LocalOsmIndex();
    const editing = new EditingEngine(om, history, () => null, localOsm);
    // VAL24_SCENARIO: run in a proposal (alternative) instead of the base city, e.g. to study a drawn flyover
    const scenarioId = process.env.VAL24_SCENARIO || 'base';
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
      () => { const rs = filterObjectsForScenario(om.getAll(), scenarioId).filter(isDrivable).filter(o => !isSampleObject(o)); capTags(rs); return rs as DrivableObject[]; },
      { load: (boxes, signal) => editing.loadOsmRoadsForStudyArea(boxes, signal) },
      new TrafficSignalSource(localOsm),
      ctx,
    );
    om.onChange((types: Set<string>) => { if (types.has('road') || types.size === 0 || types.has('junction')) mode.networkChanged(); });
    if (process.env.VAL24_SEEDS) mode.analysisSeeds = process.env.VAL24_SEEDS.split(',').map(Number);
    mode.enter();
    if (process.env.VAL24_HYPO_SCALE) { hypo.demandScale = Number(process.env.VAL24_HYPO_SCALE); mode.setDemandSettings({ hypotheticalScale: hypo.demandScale }); }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const settle = async () => {
      for (let i = 0; i < 600; i++) {
        const s = mode.getState();
        if (s.osmRoads.status !== 'loading' && s.signals.status !== 'loading' && s.timeOfDay.status === 'ready' && s.edgeFlows.status !== 'loading' && s.area && s.section && s.screenlines) return true;
        await sleep(200);
      }
      return false;
    };
    const seed = process.env.SECDIAG_ROAD!, hour = Number(process.env.SECDIAG_HOUR ?? 9);
    mode.selectRoad(seed);
    mode.setHour(hour);
    await settle(); await sleep(800); await settle();
    const st = mode.getState();
    const area = st.area!, section = st.section!;
    const plan = mode.studyPlan()!;
    const job = (mode as unknown as { analysisJob: (p: unknown, a: unknown, s: unknown) => AnalysisJob }).analysisJob(plan, area, section);
    const segs = new Set(job.area.segments.map(s => s.key));
    const trips = snapDemandPlan(job.plan, job.area.network, 250, segs).map(t => ({ ...t, vehiclesPerHour: t.vehiclesPerHour * job.hourFactor }));
    const assignment = assignTraffic(job.area, job.roads, trips, { signalPoints: job.options.signalPoints, junctionEdits: job.options.junctionEdits });
    const corridorPlan = corridorPlanOf(job, assignment);
    const corridorSegs = new Set(job.corridor.segments.map(s => s.key));
    const microTrips = snapDemandPlan(corridorPlan, job.corridor.network, 60, corridorSegs);
    const via = microTrips.filter(t => t.viaLinkIds?.some(id => id.startsWith(seed)));
    const sim = new TrafficMicroSim(job.corridor, job.roads, { ...job.options, seed: 42, watchSegmentKeys: job.section.segmentKeys, demandTrips: microTrips });
    sim.setHourFactor(1);
    const anySim = sim as unknown as { odArrivals: { trip: MicroDemandTrip; route: number[] }[]; links: { id: string; index: number; from: string; to: string; roadId: string }[]; junction: (n: string) => string };
    const arrivals = anySim.odArrivals.filter(a => a.trip.viaLinkIds?.some(id => id.startsWith(seed)));
    const net = job.corridor.network;
    const nodeInfo = (n: string) => {
      const node = net.nodes.get(n);
      const roadsAt = node ? [...new Set([...node.incomingSegments, ...node.outgoingSegments].map(id => net.edges.get(id)?.roadId))] : [];
      return { node: n, z: node?.coordinates[2], coord: node?.coordinates.slice(0, 2), roads: roadsAt.map(r => { const o = job.roads.get(r!); return { id: r, name: o?.name, cls: (o as { roadClass?: string })?.roadClass, access: (o as { osmProvenance?: { originalTags?: Record<string, string> } })?.osmProvenance?.originalTags?.access ?? null }; }) };
    };
    const seedEdges = [...net.edges.values()].filter(e => e.roadId === seed);
    const out = {
      corridorTripsVia: { n: via.length, vph: Math.round(via.reduce((n, t) => n + t.vehiclesPerHour, 0)) },
      viaMissingInSim: (() => { const ids = new Set(anySim.links.map(l => l.id)); const m = new Map<string, number>(); for (const a of arrivals) for (const id of a.trip.viaLinkIds ?? []) if (!ids.has(id)) m.set(id, (m.get(id) ?? 0) + a.trip.vehiclesPerHour); return [...m].map(([id, v]) => ({ id, vph: +v.toFixed(1) })); })(),
      missingWhere: (() => { const ids = new Set(anySim.links.map(l => l.id)); const miss = [...new Set(arrivals.flatMap(a => a.trip.viaLinkIds ?? []).filter(id => !ids.has(id)))];
        return miss.slice(0, 12).map(id => { const road = id.replace(/_seg_\d+_(fwd|bwd)$/, ''); return { id, inCorridorNet: job.corridor.network.edges.has(id), inCorridorSegs: corridorSegs.has(id.replace(/_(fwd|bwd)$/, '')), inAreaNet: job.area.network.edges.has(id),
          simLinksOfRoad: anySim.links.filter(l => l.roadId === road).map(l => l.id).slice(0, 12), corridorEdgesOfRoad: [...job.corridor.network.edges.keys()].filter(k => k.startsWith(road + '_')).slice(0, 12) }; }); })(),
      vphRouteUsesSeed: Math.round(arrivals.filter(a => a.route.some(i => anySim.links[i].roadId === seed)).reduce((n, a) => n + a.trip.vehiclesPerHour, 0)),
      arrivalsVia: { n: arrivals.length, withRoute: arrivals.filter(a => a.route.length).length, vphNoRoute: Math.round(arrivals.filter(a => !a.route.length).reduce((n, a) => n + a.trip.vehiclesPerHour, 0)),
        routeUsesSeed: arrivals.filter(a => a.route.some(i => anySim.links[i].roadId === seed)).length },
      sample: arrivals.slice(0, 6).map(a => ({ vph: +a.trip.vehiclesPerHour.toFixed(1), from: a.trip.fromNodeId, to: a.trip.toNodeId, via: a.trip.viaLinkIds, route: a.route.map(i => anySim.links[i].id) })),
      seedEdges: seedEdges.map(e => ({ id: e.id, from: nodeInfo(e.fromNodeId), to: nodeInfo(e.toNodeId), lanes: e.lanes })),
      seedLinksInSim: anySim.links.filter(l => l.roadId === seed).map(l => ({ id: l.id, from: l.from, to: l.to })),
    };
    // Run 20 simulated minutes and see where vehicles bound for the road are
    for (let k = 0; k < 600; k++) sim.step();
    sim.startAnalysis();
    for (let k = 0; k < 1800; k++) sim.step();
    const ac = sim.analysisCounts();
    const seedNodes = new Set(anySim.links.filter(l => l.roadId === seed).flatMap(l => [l.from, l.to]));
    (out as Record<string, unknown>).linksAtSeed = ac?.links.filter(l => l.roadId === seed || seedNodes.has(l.to) || seedNodes.has(l.from)).map(l => ({ id: l.id, roadId: l.roadId, entries: l.entries, onLinkNow: l.onLinkNow, queuedNow: l.queuedNow, hold: l.hold, blockedBy: l.blockedBy.slice(0, 3), from: l.from, to: l.to }));
    (out as Record<string, unknown>).load = ac?.load;
    const snap = (sim as unknown as { linkVph?: () => Map<string, number> });
    void snap;
    fs.writeFileSync(process.env.SECDIAG_OUT!, JSON.stringify({ ...out, stuck: (sim as unknown as { stuckReport?: () => unknown }).stuckReport?.() ?? null, accounting: (sim as unknown as { accounting?: unknown }).accounting ?? null }, null, 1));
    mode.exit();
  }, 3600_000);
});
