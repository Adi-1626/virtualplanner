"""
Source plug-ins: each turns a watch-list source into candidate pages to read.

    official_page  an official page itself (optional `page_rules` for tables)
    rss            an OFFICIAL feed (PMRDA, PIB …); an item is kept only when its title or summary names a watched
                   project AND its link is on an official domain (backend/updater/official.py)

A plug-in never extracts facts; it only finds URLs. News discovery (newspaper RSS feeds, GDELT, Google Custom Search,
Google News RSS) was removed on 2026-11-21 under the official-only rule (DATA_FRESHNESS_RESEARCH.md §11).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime

from .extract import projects_in
from .fetch import PoliteFetcher, Refused
from .official import is_official_url
from .text import norm_for_match

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
        if not is_official_url(it["link"]):
            continue                   # an official feed can link to a newspaper story: never followed
        hit = projects_in(norm_for_match(it["title"] + " " + it["summary"]), projects)
        if hit:
            cands.append(Candidate(it["link"], src["id"], it["title"], _feed_date(it["published"]), hit))
    return SourceResult(src["id"], cands, [], f"{len(items)} feed items, {len(cands)} name a watched project")


def official_page(src: dict, projects: list[dict], fetcher: PoliteFetcher) -> SourceResult:  # noqa: ARG001
    return SourceResult(src["id"], [Candidate(src["url"], src["id"], "", None, set(), list(src.get("page_rules", [])), True,
                                              bool(src.get("extract_sentences", False)))], [])


PLUGINS = {"rss": rss, "official_page": official_page}
