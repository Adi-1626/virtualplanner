"""
Source plug-ins: each turns a watch-list source into candidate pages to read.

    official_page  the page itself (tier 1; optional `page_rules` for tables)
    rss            a publisher / authority feed; an item is kept only when its title or summary names a watched project
    gdelt          GDELT DOC 2.0 API (free, open licence; ≥ 5 s between calls); discovery only — the article's tier
                   comes from its own domain
    google_cse     Google Custom Search JSON API (optional; GOOGLE_CSE_KEY + GOOGLE_CSE_CX; ends 2027-01-01)

A plug-in never extracts facts; it only finds URLs. Google News RSS is deliberately absent: its robots.txt disallows
/rss for every agent and its feed licence is personal feed-reader use only (DATA_FRESHNESS_RESEARCH.md §2).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime

from .extract import projects_in
from .fetch import PoliteFetcher, Refused
from .text import norm_for_match

GOOGLE_CSE_END = dt.date(2027, 1, 1)


@dataclass
class Candidate:
    url: str
    source_id: str
    title: str = ""
    feed_published: str | None = None
    projects: set[str] = field(default_factory=set)
    page_rules: list[dict] = field(default_factory=list)
    official_page: bool = False
    extract_sentences: bool = True     # official pages: only their page_rules unless the source says otherwise


@dataclass
class SourceResult:
    source_id: str
    candidates: list[Candidate]
    errors: list[str]
    note: str = ""


def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def parse_feed(body: bytes) -> list[dict]:
    """RSS 2.0 or Atom → [{title, link, summary, published}]. Bounded by the fetcher's body limit."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    out = []
    ns_atom = "{http://www.w3.org/2005/Atom}"
    for it in root.iter("item"):
        out.append({"title": (it.findtext("title") or "").strip(), "link": (it.findtext("link") or "").strip(),
                    "summary": _strip_tags(it.findtext("description") or ""), "published": (it.findtext("pubDate") or "").strip()})
    for it in root.iter(ns_atom + "entry"):
        link = ""
        for ln in it.findall(ns_atom + "link"):
            if ln.get("rel", "alternate") == "alternate":
                link = ln.get("href", "")
        out.append({"title": (it.findtext(ns_atom + "title") or "").strip(), "link": link,
                    "summary": _strip_tags(it.findtext(ns_atom + "summary") or ""),
                    "published": (it.findtext(ns_atom + "published") or it.findtext(ns_atom + "updated") or "").strip()})
    return out


def _feed_date(s: str) -> str | None:
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).isoformat()
    except (TypeError, ValueError, IndexError):
        m = re.match(r"\d{4}-\d{2}-\d{2}", s)
        return m.group(0) if m else None


def rss(src: dict, projects: list[dict], fetcher: PoliteFetcher) -> SourceResult:
    try:
        r = fetcher.get(src["url"])
    except Refused as e:
        return SourceResult(src["id"], [], [str(e)])
    if r.status != 200:
        return SourceResult(src["id"], [], [f"HTTP {r.status}"])
    items = parse_feed(r.body)
    cands = []
    for it in items:
        if not it["link"].startswith(("http://", "https://")):
            continue
        hit = projects_in(norm_for_match(it["title"] + " " + it["summary"]), projects)
        if hit:
            cands.append(Candidate(it["link"], src["id"], it["title"], _feed_date(it["published"]), hit))
    return SourceResult(src["id"], cands, [], f"{len(items)} feed items, {len(cands)} name a watched project")


def official_page(src: dict, projects: list[dict], fetcher: PoliteFetcher) -> SourceResult:  # noqa: ARG001
    return SourceResult(src["id"], [Candidate(src["url"], src["id"], "", None, set(), list(src.get("page_rules", [])), True,
                                              bool(src.get("extract_sentences", False)))], [])


def gdelt(src: dict, projects: list[dict], fetcher: PoliteFetcher) -> SourceResult:
    base = src.get("url") or "https://api.gdeltproject.org/api/v2/doc/doc"
    host = urllib.parse.urlsplit(base).hostname or ""
    fetcher.host_delays[host] = max(fetcher.host_delays.get(host, 0.0), float(src.get("delay_s", 6.0)))
    cands, errors = [], []
    for p in projects:
        q = p.get("gdelt_query")
        if not q:
            continue
        url = base + "?" + urllib.parse.urlencode({"query": f"{q} sourcelang:english", "mode": "artlist", "format": "json",
                                                   "maxrecords": "25", "timespan": src.get("timespan", "6months"), "sort": "datedesc"})
        try:
            r = fetcher.get(url)
        except Refused as e:
            errors.append(f"{p['id']}: {e}")
            if host in fetcher.down:
                break
            continue
        if r.status != 200:
            errors.append(f"{p['id']}: HTTP {r.status} {r.body[:120].decode('utf-8', 'replace')}")
            continue
        try:
            arts = json.loads(r.body.decode("utf-8", "replace") or "{}").get("articles", [])
        except ValueError:
            errors.append(f"{p['id']}: GDELT answered with non-JSON")
            continue
        for a in arts:
            u = a.get("url") or ""
            title = a.get("title") or ""
            hit = projects_in(norm_for_match(title), projects)
            if not u.startswith(("http://", "https://")) or not hit:
                continue                       # title must name a watched project; GDELT matches body text loosely
            sd = a.get("seendate") or ""
            seen = f"{sd[0:4]}-{sd[4:6]}-{sd[6:8]}" if re.fullmatch(r"\d{8}T\d{6}Z", sd) else None
            cands.append(Candidate(u, src["id"], title, seen, hit))
    return SourceResult(src["id"], cands, errors, "GDELT DOC 2.0 (cite https://www.gdeltproject.org/)")


def google_cse(src: dict, projects: list[dict], fetcher: PoliteFetcher, today: dt.date | None = None) -> SourceResult:
    key, cx = os.environ.get("GOOGLE_CSE_KEY"), os.environ.get("GOOGLE_CSE_CX")
    today = today or dt.date.today()
    if today >= GOOGLE_CSE_END:
        return SourceResult(src["id"], [], ["Google discontinued the Custom Search JSON API on 2027-01-01"])
    if not key or not cx:
        return SourceResult(src["id"], [], ["GOOGLE_CSE_KEY / GOOGLE_CSE_CX not set (optional plug-in)"])
    cands, errors = [], []
    for p in projects:
        q = (p.get("gdelt_query") or p["name"]).replace("\"", "")
        url = (src.get("url") or "https://www.googleapis.com/customsearch/v1") + "?" + urllib.parse.urlencode(
            {"key": key, "cx": cx, "q": q, "dateRestrict": "m6", "num": "10"})
        try:
            r = fetcher.get(url)
        except Refused as e:
            errors.append(f"{p['id']}: {e}")
            continue
        if r.status != 200:
            errors.append(f"{p['id']}: HTTP {r.status}")
            continue
        for it in json.loads(r.body or b"{}").get("items", []):
            hit = projects_in(norm_for_match((it.get("title") or "") + " " + (it.get("snippet") or "")), projects)
            if hit and str(it.get("link", "")).startswith("http"):
                cands.append(Candidate(it["link"], src["id"], it.get("title") or "", None, hit))
    days = (GOOGLE_CSE_END - today).days
    return SourceResult(src["id"], cands, errors, f"Google CSE (discontinued in {days} days)")


PLUGINS = {"rss": rss, "official_page": official_page, "gdelt": gdelt, "google_cse": google_cse}
