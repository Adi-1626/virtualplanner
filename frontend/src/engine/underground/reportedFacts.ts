/**
 * Reviewed published facts (data-freshness service, /api/updater/facts) used by Underground.
 *
 * OpenStreetMap never maps a metro tunnel's depth, so an underground line stays "Depth not mapped". When a reviewer has
 * approved a published tunnel depth for the project (e.g. Swargate–Katraj "around 28 metres below ground level",
 * Hindustan Times + Punekar News), the hover tooltip adds it as a REPORTED figure with its sources. It is never used to
 * draw the tunnel at that depth: a press or authority figure is not a surveyed crown level (UNDERGROUND_WORKSPACE.md).
 *
 * Matching: a fact's project carries `osm_name_patterns` (watch-list); the metro object's name, ref and OSM name tags
 * are tested against them (case-insensitive).
 */
import type { CityObject } from '../objects/types';
import type { Fact } from '../../lib/freshnessApi';

const tagsOf = (o: CityObject) => {
  const x = o as CityObject & { tags?: Record<string, string>; originalOsmTags?: Record<string, string>; stationName?: string };
  return { ...(x.originalOsmTags ?? {}), ...(x.tags ?? {}) } as Record<string, string>;
};

/** The text an OSM metro object is known by: its name, station name and the name / ref / route tags. */
export function metroNames(o: CityObject): string {
  const t = tagsOf(o);
  const x = o as CityObject & { name?: string; stationName?: string };
  return [x.name, x.stationName, t.name, t['name:en'], t.ref, t.route_name, t.line, t.colour ? `${t.colour} line` : undefined]
    .filter(Boolean).join(' | ').toLowerCase();
}

function matches(names: string, patterns: string[]): boolean {
  return patterns.some(p => {
    try { return new RegExp(p, 'i').test(names); } catch { return false; }
  });
}

/** The approved tunnel-depth fact for this metro line / station, or null. */
export function reportedDepthFor(o: CityObject, facts: readonly Fact[]): Fact | null {
  if (o.type !== 'metro_line' && o.type !== 'metro_station') return null;
  const names = metroNames(o);
  if (!names) return null;
  return facts.find(f => f.attribute === 'tunnel_depth_m' && f.osm_name_patterns?.length && matches(names, f.osm_name_patterns)) ?? null;
}

const CONF: Record<string, string> = { official: 'official source', corroborated: '2 independent outlets', single_source: 'single source', conflicting: 'sources disagree' };

/** "reported ~28 m below ground (Hindustan Times 2026-08-21, Punekar News 2026-11-04 · 2 independent outlets · not surveyed)" */
export function reportedDepthText(f: Fact): string {
  const srcs = f.evidence.slice(0, 2).map(e => `${e.publisher}${e.published_at ? ` ${e.published_at.slice(0, 10)}` : ''}`).join(', ');
  const more = f.evidence.length > 2 ? ` +${f.evidence.length - 2}` : '';
  const conf = f.confidence ? CONF[f.confidence] ?? f.confidence : null;
  return `reported ${f.label} below ground (${srcs}${more}${conf ? ` · ${conf}` : ''} · not surveyed)`;
}

// ── session cache (the tooltip resolves synchronously) ────────────────────────────────────────────────────────────────
let cache: Fact[] = [];
let loading: Promise<void> | null = null;

export function reportedFacts(): readonly Fact[] { return cache; }
export function setReportedFacts(f: Fact[]): void { cache = f; }

/** Loads the active facts once per session; failures leave the cache empty (tooltips then say only "Depth not mapped"). */
export function loadReportedFacts(fetchFacts: () => Promise<{ facts: Fact[]; sha256_ok: boolean | null }>): Promise<void> {
  if (!loading) {
    loading = fetchFacts().then(r => { cache = r.sha256_ok === false ? [] : r.facts; }).catch(() => { cache = []; loading = null; });
  }
  return loading;
}
