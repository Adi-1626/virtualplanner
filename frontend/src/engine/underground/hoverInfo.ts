/**
 * Hover tooltips and station-label declutter for the Underground map (docs/urbanos/UNDERGROUND_VISUAL_FIXES.md).
 * Pure (no Cesium): what a hovered entity is, its name, its depth or elevation ("depth not mapped" when nothing is
 * known — never a guessed value) and its status / evidence; and which metro station labels to draw so neighbouring
 * stations do not stack on top of each other.
 */
import type { CityObject, MetroLineObject, MetroStationObject, UndergroundAlignmentObject, UtilityObject } from '../objects/types';
import type { SubsurfaceRecord } from '../../lib/coordinationApi';
import { layerOf, type LayerKey } from './recordsSummary';
import { utilityZ } from './utilityModel';
import { ALIGNMENT_KIND_LABEL, depthsOf } from './alignmentGeometry';

export interface HoverTip {
  /** Asset type, e.g. "Sewer · existing record". */
  type: string;
  name: string;
  /** Depth below ground or elevation; "Depth not mapped" when unknown. */
  depth: string;
  /** Status and evidence (how the position / depth is known). */
  status: string;
}

export const DEPTH_NOT_MAPPED = 'Depth not mapped';
/** An underground metro tunnel with no depth in OSM and no reviewed official figure (official sources only). */
export const NO_OFFICIAL_TUNNEL_DEPTH = `${DEPTH_NOT_MAPPED} (no official figure)`;
/** The same for a station: the dataset holds no official depth for it. */
export const NO_OFFICIAL_STATION_DEPTH = `${DEPTH_NOT_MAPPED} (no official figure in the dataset)`;

/** Object id behind a picked entity id: 'ug:<objectId>:<part>' → objectId; 'rec:<id>[:k]' → null (a record). */
export function pickObjectId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.startsWith('rec:')) return null;
  if (raw.startsWith('ug:')) {
    const last = raw.lastIndexOf(':');
    const id = raw.slice(3, last > 2 ? last : undefined);
    return id === 'cutaway' ? null : id;
  }
  return raw;
}
/** Record id behind a picked entity id 'rec:<id>' or 'rec:<id>:<k>'. */
export function pickRecordId(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('rec:')) return null;
  const rest = raw.slice(4);
  const k = rest.lastIndexOf(':');
  return k > 0 && /^\d+$/.test(rest.slice(k + 1)) ? rest.slice(0, k) : rest;
}

const RECORD_TYPE: Record<LayerKey, string> = {
  sewer: 'Sewer', storm_drain: 'Storm-water drain', water: 'Water main', power: 'Power cable', gas: 'Gas main', telecom: 'Telecom duct',
  other_utility: 'Utility', borehole: 'Borehole', foundation: 'Foundation',
};
const UTILITY_TYPE: Record<string, string> = { water: 'Water pipe', sewage: 'Sewer pipe', electricity: 'Power cable', gas: 'Gas pipe', fiber: 'Fibre duct' };
const m1 = (v: number) => `${Math.round(v * 10) / 10}`;
const range = (vs: number[]) => {
  const lo = Math.min(...vs), hi = Math.max(...vs);
  return Math.abs(hi - lo) < 0.05 ? `${m1(lo)} m` : `${m1(lo)}–${m1(hi)} m`;
};

/** Tooltip for an imported subsurface record (PMC sewer / storm-drain network, AGS4 borehole, …). */
export function recordTip(r: SubsurfaceRecord, datasetName?: string): HoverTip {
  const layer = layerOf(r);
  const ql = r.quality_level ?? 'UNKNOWN';
  const src = datasetName ? ` · ${datasetName}` : '';
  if (r.record_type === 'borehole') {
    return {
      type: 'Borehole · existing record', name: r.external_id || 'Unnamed borehole',
      depth: r.final_depth_m !== null ? `Final depth ${m1(r.final_depth_m)} m below ground` : DEPTH_NOT_MAPPED,
      status: `Existing · evidence ${ql}${src}`,
    };
  }
  // Same depth rule as the 3D line (UndergroundRenderer.renderRecords)
  const d = r.depth_m ?? (r.z_max_m !== null && r.z_max_m !== undefined ? -r.z_max_m : null);
  const dia = r.diameter_m ? ` · Ø ${Math.round(r.diameter_m * 1000)} mm` : '';
  return {
    type: `${RECORD_TYPE[layer]} · existing record`, name: r.external_id || 'Unnamed record',
    depth: d !== null ? `~${m1(d)} m below ground as recorded${dia}` : `${DEPTH_NOT_MAPPED} (drawn on the surface)${dia}`,
    status: `Existing · evidence ${ql}${src}`,
  };
}

/** Tooltip for a drawn utility (Design / Underground). */
export function utilityTip(u: UtilityObject): HoverTip {
  const z = utilityZ(u);
  const tops = z.depths.map(d => d.topDepthM).filter((v): v is number => v !== null && v !== undefined);
  const els = z.depths.map(d => d.elevationM).filter((v): v is number => v !== null && v !== undefined);
  const unknown = z.depths.length - tops.length;
  let depth = tops.length ? `Top of pipe ${range(tops)} below ground` : DEPTH_NOT_MAPPED;
  if (tops.length && z.depths.some(d => d.isDefault)) depth += ' (default cover — adjust)';
  if (tops.length && unknown) depth += ` · ${unknown} point${unknown > 1 ? 's' : ''} unknown`;
  if (els.length) depth += ` · elev. ${range(els)} (EGM2008)`;
  return {
    type: `${UTILITY_TYPE[u.utilityType] ?? 'Utility'} · drawn`, name: u.name || 'Utility',
    depth, status: `${cap(z.status)} · evidence ${z.evidence}${z.diameterM ? ` · Ø ${Math.round(z.diameterM * 1000)} mm` : ''}`,
  };
}

/** Tooltip for a proposed / existing underground alignment (tunnel, trunk, drain). */
export function alignmentTip(a: UndergroundAlignmentObject): HoverTip {
  const ds = depthsOf(a);
  const crowns = ds.map(d => d.crownDepthM).filter((v): v is number => v !== null);
  const els = ds.map(d => d.elevationM).filter((v): v is number => v !== null && v !== undefined);
  const order = ['unknown', 'hypothetical', 'estimated', 'measured'];
  const worst = ds.reduce((w, d) => (order.indexOf(d.certainty) < order.indexOf(w) ? d.certainty : w), 'measured' as string);
  let depth = crowns.length ? `Crown ${range(crowns)} below ground` : DEPTH_NOT_MAPPED;
  if (crowns.length && crowns.length < ds.length) depth += ` · ${ds.length - crowns.length} point(s) unknown`;
  if (els.length) depth += ` · elev. ${range(els)}`;
  return {
    type: `${ALIGNMENT_KIND_LABEL[a.alignmentKind] ?? 'Underground alignment'} · ${a.lifecycle ?? 'proposed'}`, name: a.name || 'Alignment',
    depth, status: `${cap(a.lifecycle ?? 'proposed')} · depths ${worst}`,
  };
}

/** Tooltip for an existing metro line or station. `unmapped` = underground with no depth in the source (metroLevel.ts). */
export function metroTip(o: MetroLineObject | MetroStationObject, unmapped: boolean, inferred = false, reported?: string | null): HoverTip {
  const live = (o as MetroLineObject).status === 'under_construction' ? 'Under construction' : 'Existing';
  // a reviewed OFFICIAL depth (data-freshness service) is added as text only; the drawing stays "not mapped"
  const unmappedDepth = (none: string) => (reported ? `${DEPTH_NOT_MAPPED} in OSM · ${reported}` : none);
  if (o.type === 'metro_station') {
    const name = o.stationName || o.name || 'Metro station';
    return unmapped
      ? { type: 'Underground metro station', name, depth: unmappedDepth(NO_OFFICIAL_STATION_DEPTH), status: `${live} · plan position only (OpenStreetMap)${inferred ? ', on a tunnel section' : ''}` }
      : { type: 'Metro station (elevated)', name, depth: `Platform ~${m1(o.elevation)} m above ground (model)`, status: `${live} · OpenStreetMap / drawn` };
  }
  return unmapped
    ? { type: 'Metro tunnel', name: o.name || 'Metro line', depth: unmappedDepth(NO_OFFICIAL_TUNNEL_DEPTH), status: `${live} · plan position only (OpenStreetMap)` }
    : { type: 'Metro viaduct (elevated)', name: o.name || 'Metro line', depth: `Deck ~${m1(o.elevation)} m above ground (model)`, status: `${live} · OpenStreetMap / drawn` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Tooltip for any hoverable underground object, or null for objects that get none (buildings, roads, …). */
export function objectTip(o: CityObject, ctx: { unmappedMetro?: (o: CityObject) => { inferred: boolean } | null; reportedDepth?: (o: CityObject) => string | null } = {}): HoverTip | null {
  switch (o.type) {
    case 'utility': return utilityTip(o);
    case 'underground_alignment': return alignmentTip(o);
    case 'metro_line':
    case 'metro_station': {
      const u = ctx.unmappedMetro?.(o) ?? null;
      return metroTip(o, !!u, u?.inferred, u ? ctx.reportedDepth?.(o) ?? null : null);
    }
    default: return null;
  }
}

// ---- metro station labels ------------------------------------------------------------------------------------------

/**
 * Short label for a station: OSM names carry the line ("District Court (Purple Line)"), "Metro Station" and a second
 * script ("Kasba Peth कसबा पेठ"); the label keeps the station name only. Empty when the station has no name.
 */
export function shortStationName(name: string | undefined | null): string {
  let s = (name ?? '').replace(/\([^)]*\)/g, ' ');
  // keep the Latin part when a name is given in two scripts
  const latin = s.match(/^[\x20-\x7E\u00C0-\u024F]+/);
  if (latin && latin[0].trim()) s = latin[0];
  s = s.replace(/\b(metro\s+station|station|metro)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // an import placeholder for an unnamed OSM node ("Subway Station 7944597694") is no name
  return /^(subway\s*)?\d+$/i.test(s) ? '' : s;
}

export interface StationLabel {
  /** Station ids the label stands for (an interchange's platforms are one label). */
  ids: string[];
  text: string;
  lon: number;
  lat: number;
  /** Vertical pixel offset: neighbours closer than `staggerM` alternate above / below their point. */
  offsetY: number;
}

const KX = 111320 * Math.cos((18.5 * Math.PI) / 180), KY = 110574;
const distM = (a: readonly number[], b: readonly number[]) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);

/**
 * One label per station or interchange: stations within `mergeM` of each other (District Court Aqua / Purple / Pink line
 * platforms, Civil Court) share one label naming each distinct station once; neighbouring labels closer than `staggerM`
 * alternate above and below their point. Stations without a name get no label (the outline and the tooltip remain).
 */
export function declutterStationLabels(
  stations: readonly { id: string; name: string | undefined | null; lon: number; lat: number }[], mergeM = 250, staggerM = 900,
): StationLabel[] {
  const named = stations.map(s => ({ ...s, short: shortStationName(s.name) })).filter(s => s.short);
  const groups: { ids: string[]; names: string[]; pts: number[][] }[] = [];
  for (const s of [...named].sort((a, b) => a.id.localeCompare(b.id))) {
    const g = groups.find(gr => gr.pts.some(p => distM(p, [s.lon, s.lat]) < mergeM));
    if (g) {
      g.ids.push(s.id); g.pts.push([s.lon, s.lat]);
      if (!g.names.some(n => n.toLowerCase() === s.short.toLowerCase())) g.names.push(s.short);
    } else groups.push({ ids: [s.id], names: [s.short], pts: [[s.lon, s.lat]] });
  }
  const labels: StationLabel[] = groups.map(g => ({
    ids: g.ids, text: g.names.join(' / '),
    lon: g.pts.reduce((a, p) => a + p[0], 0) / g.pts.length, lat: g.pts.reduce((a, p) => a + p[1], 0) / g.pts.length, offsetY: -14,
  }));
  // north to south; a label close to the one placed just before it goes below its point instead of above
  labels.sort((a, b) => b.lat - a.lat);
  labels.forEach((l, i) => {
    const prev = labels.slice(0, i).filter(p => distM([p.lon, p.lat], [l.lon, l.lat]) < staggerM);
    if (prev.length && prev[prev.length - 1].offsetY < 0) l.offsetY = 16;
  });
  return labels;
}
