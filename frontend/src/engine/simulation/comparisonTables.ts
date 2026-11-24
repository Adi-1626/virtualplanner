import type { RoadAnalysisResult, JunctionUse } from './RoadAnalysis';
import type { DrivableObject } from './StudyAreaExplorer';
import { isGenericRoadName } from './roadSection';

/**
 * Result tables of a before / after comparison (p11): what a planner reads off a traffic study. Every figure is
 * MODELLED (assignment or micro-simulation on estimated demand), never measured; each table says which.
 *
 *  - links (area assignment, the whole study area): per named road, its busiest stretch's volume and volume/capacity,
 *    the length-weighted speed over its stretches and the delay it causes (veh·h above free flow);
 *  - junctions (corridor micro-simulation, mean over seeds): control delay, level of service, longest queue and
 *    vehicles through, matched before / after by place;
 *  - summary: area speed and vehicle-hours, throughput of the neighbourhood (trips completed per hour) and delay.
 *
 * Per vehicle class: the demand's class mix is held fixed and every class shares the assigned paths, so the model has
 * no per-class travel times; the class split of the demand is reported instead (classMix), labelled so.
 */
export interface LinkRow {
  road: string;
  vphBefore: number; vphAfter: number;
  vcBefore: number; vcAfter: number;
  speedBefore: number | null; speedAfter: number | null;
  delayVehHBefore: number; delayVehHAfter: number;
  lengthKm: number;
  segmentKeys: string[];
}
export interface JunctionRow {
  label: string;
  coordinates: [number, number];
  signalised: boolean;
  delayBefore: number | null; delayAfter: number | null;
  losBefore: string | null; losAfter: string | null;
  queueBefore: number | null; queueAfter: number | null;
  vehBefore: number | null; vehAfter: number | null;
  /** Present in only one of the runs (a junction the proposal added or removed). */
  only?: 'before' | 'after';
}
export interface SummaryRow { label: string; before: number | null; after: number | null; unit: string; source: 'routed' | 'simulated'; lowerIsBetter: boolean | null }
export interface ComparisonTables {
  links: LinkRow[];
  junctions: JunctionRow[];
  summary: SummaryRow[];
  classMix: { kind: string; vph: number }[];
  notes: string[];
}

const M = 111320;
const near = (p: readonly number[], q: readonly number[], m: number) => Math.hypot((p[0] - q[0]) * M * Math.cos(p[1] * Math.PI / 180), (p[1] - q[1]) * M) < m;

interface RoadAgg { vph: number; vc: number; vkm: number; vh: number; delay: number; km: number; keys: Set<string> }
function byRoad(r: RoadAnalysisResult, roads: ReadonlyMap<string, DrivableObject>): Map<string, RoadAgg> {
  const out = new Map<string, RoadAgg>();
  const times = r.areaLinkTime;
  r.areaLinkVph.forEach((vph, linkId) => {
    const roadId = linkId.replace(/_seg_\d+_(fwd|bwd)$/, '');
    const name = roads.get(roadId)?.name;
    if (!name || isGenericRoadName(name)) return;
    const seg = linkId.replace(/_(fwd|bwd)$/, '');
    const e = out.get(name) ?? out.set(name, { vph: 0, vc: 0, vkm: 0, vh: 0, delay: 0, km: 0, keys: new Set() }).get(name)!;
    e.vph = Math.max(e.vph, vph);
    e.vc = Math.max(e.vc, r.areaVc.get(seg) ?? 0);
    const t = times?.get(linkId);
    if (t) {
      const km = t.lengthM / 1000;
      // Speed weighted by the traffic on each stretch (a stretch nobody drives does not lower the road's speed)
      const w = Math.max(vph, 1e-3);
      e.vkm += w * km; e.vh += w * t.timeS / 3600;
      e.delay += vph * Math.max(0, t.timeS - t.t0S) / 3600;
      if (!e.keys.has(seg)) e.km += km;
    }
    e.keys.add(seg);
  });
  return out;
}

const losRank = (l: string | null) => (l ? 'ABCDEF'.indexOf(l) : -1);

export function comparisonTables(a: RoadAnalysisResult, b: RoadAnalysisResult, roads: { before: ReadonlyMap<string, DrivableObject>; after: ReadonlyMap<string, DrivableObject> },
  demandByClass?: { kind: string; vph: number }[]): ComparisonTables {
  const ra = byRoad(a, roads.before), rb = byRoad(b, roads.after);
  const links: LinkRow[] = [...new Set([...ra.keys(), ...rb.keys()])].map(road => {
    const x = ra.get(road), y = rb.get(road);
    return {
      road, vphBefore: Math.round(x?.vph ?? 0), vphAfter: Math.round(y?.vph ?? 0), vcBefore: x?.vc ?? 0, vcAfter: y?.vc ?? 0,
      speedBefore: x && x.vh > 0 ? x.vkm / x.vh : null, speedAfter: y && y.vh > 0 ? y.vkm / y.vh : null,
      delayVehHBefore: x?.delay ?? 0, delayVehHAfter: y?.delay ?? 0, lengthKm: Math.max(x?.km ?? 0, y?.km ?? 0),
      segmentKeys: [...new Set([...(x?.keys ?? []), ...(y?.keys ?? [])])],
    };
  })
    // Roads that matter for the decision first: the largest change in delay, then in load, then the busiest
    .sort((p, q) => Math.abs(q.delayVehHAfter - q.delayVehHBefore) - Math.abs(p.delayVehHAfter - p.delayVehHBefore)
      || Math.abs(q.vcAfter - q.vcBefore) - Math.abs(p.vcAfter - p.vcBefore) || Math.max(q.vphBefore, q.vphAfter) - Math.max(p.vphBefore, p.vphAfter));

  // Junctions matched by id, else within 30 m (an edit can renumber the simulated node)
  const used = new Set<JunctionUse>();
  // An analysis without a junction list (older runs, tests) has no junction rows, not a crash
  const ja = a.junctions ?? [], jb = b.junctions ?? [];
  const junctions: JunctionRow[] = ja.map(j => {
    const k = jb.find(x => !used.has(x) && x.id === j.id) ?? jb.find(x => !used.has(x) && near(x.coordinates, j.coordinates, 30));
    if (k) used.add(k);
    return {
      label: j.label, coordinates: j.coordinates, signalised: k?.signalised ?? j.signalised,
      delayBefore: j.delayS, delayAfter: k ? k.delayS : null, losBefore: j.los, losAfter: k ? k.los : null,
      queueBefore: j.maxQueueM, queueAfter: k ? k.maxQueueM : null, vehBefore: j.vehicles, vehAfter: k ? k.vehicles : null,
      ...(k ? {} : { only: 'before' as const }),
    };
  });
  for (const k of jb) if (!used.has(k)) junctions.push({ label: k.label, coordinates: k.coordinates, signalised: k.signalised, delayBefore: null, delayAfter: k.delayS, losBefore: null, losAfter: k.los, queueBefore: null, queueAfter: k.maxQueueM, vehBefore: null, vehAfter: k.vehicles, only: 'after' });
  junctions.sort((p, q) => Math.max(losRank(q.losBefore), losRank(q.losAfter)) - Math.max(losRank(p.losBefore), losRank(p.losAfter))
    || Math.abs((q.delayAfter ?? 0) - (q.delayBefore ?? 0)) - Math.abs((p.delayAfter ?? 0) - (p.delayBefore ?? 0)));

  const areaVkm = (r: RoadAnalysisResult) => { let v = 0; r.areaLinkVph.forEach((x, id) => { const t = r.areaLinkTime?.get(id); if (t) v += x * t.lengthM / 1000; }); return r.areaLinkTime ? v : null; };
  const vkmA = areaVkm(a), vkmB = areaVkm(b);
  const perHour = (r: RoadAnalysisResult) => r.throughputVph ?? null;
  const summary: SummaryRow[] = [
    { label: 'Mean speed in the area', before: vkmA !== null && a.assignment.totalVehHours > 0 ? vkmA / a.assignment.totalVehHours : null, after: vkmB !== null && b.assignment.totalVehHours > 0 ? vkmB / b.assignment.totalVehHours : null, unit: 'km/h', source: 'routed', lowerIsBetter: false },
    { label: 'Distance driven in the area', before: vkmA, after: vkmB, unit: 'veh·km/h', source: 'routed', lowerIsBetter: null },
    { label: 'Time spent driving in the area', before: a.assignment.totalVehHours, after: b.assignment.totalVehHours, unit: 'veh·h/h', source: 'routed', lowerIsBetter: true },
    { label: 'Throughput of the neighbourhood (trips completed)', before: perHour(a), after: perHour(b), unit: 'veh/h', source: 'simulated', lowerIsBetter: false },
    { label: 'Mean trip time in the neighbourhood', before: a.network.meanTravelTimeS, after: b.network.meanTravelTimeS, unit: 's', source: 'simulated', lowerIsBetter: true },
    { label: 'Mean delay per trip', before: a.network.meanDelayS, after: b.network.meanDelayS, unit: 's', source: 'simulated', lowerIsBetter: true },
    { label: 'Mean trip speed in the neighbourhood', before: a.network.tripSpeedKmh ?? null, after: b.network.tripSpeedKmh ?? null, unit: 'km/h', source: 'simulated', lowerIsBetter: false },
    { label: 'Stretches over capacity', before: a.assignment.overCapacityLinks, after: b.assignment.overCapacityLinks, unit: 'stretches', source: 'routed', lowerIsBetter: true },
  ];
  const notes = [
    'Links: the area routing (user equilibrium, BPR link times) on the frozen demand; volume and load are each road\'s busiest stretch, speed is weighted by traffic over its stretches, delay is time above free flow.',
    'Junctions: the corridor micro-simulation, mean over the seeds; level of service from control delay (Indo-HCM / HCM thresholds), longest queue in metres.',
    'Per vehicle class: the class mix of the demand is fixed and all classes share the routed paths, so travel times by class are not modelled; only the demand by class is shown.',
    'All figures are modelled from estimated demand and the traffic model fails validation (TAG M3.1): read directions and relative sizes, not absolute values.',
  ];
  if (!a.areaLinkTime || !b.areaLinkTime) notes.push('Speeds and delay by road need results computed by this version; re-run the baseline to fill them.');
  return { links, junctions, summary, classMix: demandByClass ?? [], notes };
}

const csvCell = (v: unknown) => { const t = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const r1 = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : (Math.round(v * 10) / 10).toString());

/** CSV of each table (UTF-8, one header row; empty cell = not measured in that run). */
export function comparisonCsvs(t: ComparisonTables): Record<string, string> {
  const csv = (h: string[], rows: unknown[][]) => [h, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  return {
    'links.csv': csv(['road', 'length_km', 'volume_before_veh_h', 'volume_after_veh_h', 'vc_before', 'vc_after', 'speed_before_kmh', 'speed_after_kmh', 'delay_before_veh_h', 'delay_after_veh_h', 'source'],
      t.links.map(l => [l.road, r1(l.lengthKm), l.vphBefore, l.vphAfter, l.vcBefore.toFixed(2), l.vcAfter.toFixed(2), r1(l.speedBefore), r1(l.speedAfter), r1(l.delayVehHBefore), r1(l.delayVehHAfter), 'modelled (routed)'])),
    'junctions.csv': csv(['junction', 'control', 'delay_before_s', 'delay_after_s', 'los_before', 'los_after', 'max_queue_before_m', 'max_queue_after_m', 'vehicles_before', 'vehicles_after', 'present_in', 'source'],
      t.junctions.map(j => [j.label, j.signalised ? 'signal' : 'priority', r1(j.delayBefore), r1(j.delayAfter), j.losBefore ?? '', j.losAfter ?? '', r1(j.queueBefore), r1(j.queueAfter), j.vehBefore ?? '', j.vehAfter ?? '', j.only ?? 'both', 'modelled (simulated)'])),
    'summary.csv': csv(['measure', 'before', 'after', 'unit', 'source'], t.summary.map(s => [s.label, r1(s.before), r1(s.after), s.unit, `modelled (${s.source})`])),
  };
}
