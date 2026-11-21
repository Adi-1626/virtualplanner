/**
 * Reviewed published facts (data-freshness service, /api/updater/facts) used by Underground.
 *
 * OpenStreetMap never maps a metro tunnel's depth, so an underground line stays "Depth not mapped". When a reviewer has
 * approved a published tunnel depth for the project AND at least one of its sources is an official one (tier 1: the
 * authority's own page or document), the hover tooltip adds it as a REPORTED figure naming the official source(s). Press
 * evidence is never shown in the app (user rule 2026-11-21: no news-based facts, official sources only): a fact backed
 * only by press reports is not shown, and press sources of an official fact are not listed. The figure is never used to
 * draw the tunnel at that depth: an authority figure is not a surveyed crown level (UNDERGROUND_WORKSPACE.md).
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

/** Only official (tier 1) evidence may be shown in the app; press (tier 2) and other (tier 3) sources never are. */
export const officialEvidence = (f: Fact): Fact['evidence'] => f.evidence.filter(e => e.tier === 1);
export const hasOfficialSource = (f: Fact): boolean => officialEvidence(f).length > 0;

/** The approved tunnel-depth fact for this metro line / station backed by an official source, or null. */
export function reportedDepthFor(o: CityObject, facts: readonly Fact[]): Fact | null {
  if (o.type !== 'metro_line' && o.type !== 'metro_station') return null;
  const names = metroNames(o);
  if (!names) return null;
  return facts.find(f => f.attribute === 'tunnel_depth_m' && hasOfficialSource(f) && f.osm_name_patterns?.length && matches(names, f.osm_name_patterns)) ?? null;
}

/** "reported ~28 m below ground (Maha-Metro 2026-08-21 · official source · not surveyed)" — official sources only. */
export function reportedDepthText(f: Fact): string {
  const ev = officialEvidence(f);
  const srcs = ev.slice(0, 2).map(e => `${e.publisher}${e.published_at ? ` ${e.published_at.slice(0, 10)}` : ''}`).join(', ');
  const more = ev.length > 2 ? ` +${ev.length - 2}` : '';
  return `reported ${f.label} below ground (${srcs}${more} · official source${ev.length > 1 ? 's' : ''} · not surveyed)`;
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
