/**
 * Reviewed OFFICIAL facts (data-freshness service, /api/updater/facts) used by Underground.
 *
 * OpenStreetMap never maps a metro tunnel's depth, so an underground line stays "Depth not mapped". When a reviewer has
 * approved a tunnel depth stated by the responsible agency on its own site (official sources only, 2026-11-21: never a
 * news report), the hover tooltip adds it as an OFFICIAL figure with its source. Without one the tooltip says
 * "Depth not mapped (no official figure)". The figure is never used to draw the tunnel at that depth: an authority's
 * published figure is not a surveyed crown level (UNDERGROUND_WORKSPACE.md).
 *
 * Matching: a fact's project carries `osm_name_patterns` (watch-list); the metro object's name, ref and OSM name tags
 * are tested against them (case-insensitive). A fact whose evidence is not entirely from official sites is ignored
 * here too (lib/officialSources.ts), even though the backend already withholds it.
 */
import type { CityObject } from '../objects/types';
import type { Fact } from '../../lib/freshnessApi';
import { allOfficial, officialDomain } from '../../lib/officialSources';

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

const OFFICIAL_CONFIDENCE = new Set(['official', 'official_conflicting']);

/** The approved OFFICIAL tunnel-depth fact for this metro line / station, or null. */
export function reportedDepthFor(o: CityObject, facts: readonly Fact[]): Fact | null {
  if (o.type !== 'metro_line' && o.type !== 'metro_station') return null;
  const names = metroNames(o);
  if (!names) return null;
  return facts.find(f => f.attribute === 'tunnel_depth_m' && OFFICIAL_CONFIDENCE.has(f.confidence ?? '') && allOfficial(f.evidence)
    && f.osm_name_patterns?.length && matches(names, f.osm_name_patterns)) ?? null;
}

const CONF: Record<string, string> = { official: 'official', official_conflicting: 'official sources disagree' };

/** "official ~20 m below ground (Maha-Metro (Pune Metro Rail Project) 2026-05-13, punemetrorail.org · official · not surveyed)" */
export function reportedDepthText(f: Fact): string {
  const srcs = f.evidence.slice(0, 2).map(e => `${e.publisher}${e.published_at ? ` ${e.published_at.slice(0, 10)}` : ''}, ${officialDomain(e.url)}`).join('; ');
  const more = f.evidence.length > 2 ? ` +${f.evidence.length - 2}` : '';
  const conf = f.confidence ? CONF[f.confidence] ?? f.confidence : 'official';
  return `official ${f.label} below ground (${srcs}${more} · ${conf} · not surveyed)`;
}

// ── session cache (the tooltip resolves synchronously) ────────────────────────────────────────────────────────────────
let cache: Fact[] = [];
let loading: Promise<void> | null = null;

export function reportedFacts(): readonly Fact[] { return cache; }
export function setReportedFacts(f: Fact[]): void { cache = f; }

/** Loads the active facts once per session; failures leave the cache empty (tooltips then say "Depth not mapped (no
 * official figure)"). Only facts backed entirely by official sites are kept. */
export function loadReportedFacts(fetchFacts: () => Promise<{ facts: Fact[]; sha256_ok: boolean | null }>): Promise<void> {
  if (!loading) {
    loading = fetchFacts().then(r => { cache = r.sha256_ok === false ? [] : r.facts.filter(f => allOfficial(f.evidence)); }).catch(() => { cache = []; loading = null; });
  }
  return loading;
}
