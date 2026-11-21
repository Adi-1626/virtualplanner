"""
Official-sources-only rule (user rule 2026-11-21: "dont get the dataset from news, unless it is from certified. We cannot
get fake information into our data set and into the app. So please make sure it takes data from reliable sources only.").

This module is the ONE place that decides whether a URL is an official source. It is code, not configuration: the
watch-list (`watchlist.json`) cannot add a domain, raise a tier or switch the check off. Every gate in the service asks
`is_official_url`:

    pipeline.select_candidates / pipeline.ingest   a page that is not official is never fetched or stored
    proposals.assign                                a claim whose page is not official never creates or joins a proposal
    review.approve / review.apply_approved          a proposal with any non-official evidence cannot be approved / applied
    facts.register_version                          a facts version with a non-official fact cannot be registered
    facts.read_version                              a non-official fact in an older version is withheld from the app

Which domains count (verified 2026-11-21, DATA_FRESHNESS_RESEARCH.md §11):
  * any host under ``gov.in`` or ``nic.in``. NIC is the exclusive registrar for GOV.IN and registers it only for
    government bodies (registry.gov.in eligibility; MeitY guidelines F.No. L-13/14/2014-IGD); the Guidelines for Indian
    Government Websites require government sites to use gov.in or nic.in "exclusively allotted and restricted to
    Government websites". This covers PIB, MoHUA, MoRTH, NHAI, PMO, PMRDA, PMC, PCMC, the Maharashtra government, the
    Gazette (egazette.gov.in), CAG, the NGT, the Supreme Court and High Courts, and the old Lok Sabha / Rajya Sabha sites.
  * the agencies below whose own site is NOT under gov.in / nic.in, each checked against an official statement of its
    address (listed in AGENCY_DOMAINS).

News sites, blogs, aggregators and contractors' press releases are never official, whatever they quote.
"""
from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

# Government-only second-level zones (registry rule, see the module docstring).
GOVERNMENT_ZONES: tuple[str, ...] = ("gov.in", "nic.in")

# Agency sites outside gov.in / nic.in. domain -> (agency, how the domain was verified as the agency's own).
AGENCY_DOMAINS: dict[str, tuple[str, str]] = {
    "punemetrorail.org": ("Maha-Metro (Pune Metro Rail Project)",
                          "linked as 'Pune Metro' from mahametro.org; Maha-Metro recruitment notices name www.punemetrorail.org; "
                          "the site footer and its PDFs carry Maha-Metro letterhead (checked 2026-11-21)"),
    "mahametro.org": ("Maharashtra Metro Rail Corporation Ltd (Maha-Metro)",
                      "Maha-Metro annual reports 2020-21 to 2024-25 (audited, with CAG comments): 'The company's website is "
                      "mahametro.org' (checked 2026-11-21)"),
    "sansad.in": ("Parliament of India (Lok Sabha / Rajya Sabha secretariats)",
                  "Rajya Sabha Handbook for Members (2024) and Lok Sabha LARRDIS chapter: Digital Sansad at 'sansad.in', "
                  "designed and hosted by NIC (checked 2026-11-21)"),
    "msrdc.in": ("Maharashtra State Road Development Corporation (MSRDC)",
                 "listed as MSRDC's website on pwd.maharashtra.gov.in (Attached Offices) (checked 2026-11-21)"),
}


class NotOfficialSource(ValueError):
    """A URL that is not on the official allow-list was offered as evidence."""


def host_of(url: str) -> str | None:
    """Lower-case host of an http(s) URL; None for anything else (other schemes, credentials in the URL, IP literals,
    empty hosts). A URL with user info (https://pib.gov.in@evil.com/) is refused outright."""
    try:
        parts = urlsplit((url or "").strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https"):
        return None
    if "@" in (parts.netloc or ""):
        return None
    host = (parts.hostname or "").rstrip(".").lower()
    if not host or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-." for c in host):
        return None          # IDN / odd characters: never official (lookalike domains)
    try:
        ipaddress.ip_address(host)
        return None
    except ValueError:
        pass
    return host


def _under(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def official_domain(url: str) -> str | None:
    """The allow-listed domain a URL belongs to ('pib.gov.in', 'punemetrorail.org', …), or None when it is not official.
    For gov.in / nic.in the returned domain is the registrable name under the zone (www.pib.gov.in -> pib.gov.in)."""
    host = host_of(url)
    if host is None:
        return None
    for d in AGENCY_DOMAINS:
        if _under(host, d):
            return d
    for z in GOVERNMENT_ZONES:
        if host.endswith("." + z):
            label = host[: -len(z) - 1].rsplit(".", 1)[-1]
            return f"{label}.{z}" if label else None
    return None


def is_official_url(url: str | None) -> bool:
    return bool(url) and official_domain(url) is not None


def require_official(url: str, what: str = "source") -> str:
    d = official_domain(url)
    if d is None:
        raise NotOfficialSource(f"{what} {url!r} is not an official source (only government and agency sites are "
                                "allowed: gov.in, nic.in, Maha-Metro, Parliament, MSRDC; see backend/updater/official.py)")
    return d


def evidence_urls_official(evidence: list[dict]) -> bool:
    """True when the list is non-empty and every item's url is official."""
    return bool(evidence) and all(is_official_url(e.get("url")) for e in evidence)


def describe() -> dict:
    """The rule as data, for `check-config`, the status API and the docs."""
    return {"government_zones": list(GOVERNMENT_ZONES),
            "agency_domains": {d: {"agency": a, "verified": v} for d, (a, v) in AGENCY_DOMAINS.items()},
            "news": "never (no news feeds, no news leads; DATA_FRESHNESS_RESEARCH.md §11)"}
