/**
 * Official-sources-only rule, UI side (mirror of backend/updater/official.py, which is the rule; a backend test checks
 * that this file names the same domains). The backend already refuses and withholds anything else; the UI checks again
 * so a fact or a piece of evidence that is not from a government or agency site is never shown as data.
 *
 * Official = any host under gov.in or nic.in (registered only to government bodies by NIC), or one of the agency sites
 * below. News sites never are.
 */
export const GOVERNMENT_ZONES = ['gov.in', 'nic.in'] as const;
export const AGENCY_DOMAINS = ['punemetrorail.org', 'mahametro.org', 'sansad.in', 'msrdc.in'] as const;

/** Lower-case host of an http(s) URL with no credentials, no IP literal and plain ASCII letters; otherwise null. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.replace(/\.$/, '').toLowerCase();
  if (!host || !/^[a-z0-9.-]+$/.test(host) || host.startsWith('xn--') || host.includes('.xn--')) return null;
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return null;
  return host;
}

export function officialDomain(url: string | null | undefined): string | null {
  const h = hostOf(url);
  if (!h) return null;
  for (const d of AGENCY_DOMAINS) if (h === d || h.endsWith(`.${d}`)) return d;
  for (const z of GOVERNMENT_ZONES) {
    if (h.endsWith(`.${z}`)) {
      const label = h.slice(0, -(z.length + 1)).split('.').pop();
      return label ? `${label}.${z}` : null;
    }
  }
  return null;
}

export const isOfficialUrl = (url: string | null | undefined): boolean => officialDomain(url) !== null;

/** A fact or proposal may be shown as data only when it has evidence and every piece of it is official. */
export const allOfficial = (evidence: readonly { url: string }[] | null | undefined): boolean =>
  !!evidence && evidence.length > 0 && evidence.every(e => isOfficialUrl(e.url));
