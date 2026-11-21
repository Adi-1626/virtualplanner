"""
HTML → paragraphs → sentences, publish-date discovery, registrable domains. Standard library only.

The extracted text is what quotes are taken from, so it must keep the publisher's wording: entities are unescaped,
whitespace collapsed, nothing else rewritten (dashes and quotes stay as published; matching code normalises its own copy).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import re
import unicodedata
from html.parser import HTMLParser
from urllib.parse import urlsplit

from datasets.timeutil import parse_ts

BLOCK_TAGS = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "td", "th", "section", "article",
              "header", "footer", "blockquote", "figcaption", "table", "ul", "ol", "dd", "dt"}
SKIP_TAGS = {"script", "style", "noscript", "svg", "nav", "form", "iframe", "button", "select", "template", "aside", "footer"}


class _Extractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0
        self.meta: dict[str, str] = {}
        self.jsonld: list[str] = []
        self.times: list[str] = []
        self.title = ""
        self._in_title = False
        self._in_jsonld = False
        self._buf: list[str] = []
        self.article_parts: list[str] = []
        self._article = 0

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").lower()
            if key and a.get("content"):
                self.meta.setdefault(key, a["content"])
            return
        if tag == "time" and a.get("datetime"):
            self.times.append(a["datetime"])
        if tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in_jsonld, self._buf = True, []
            return
        if tag == "title":
            self._in_title = True
        if tag == "article":
            self._article += 1
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
            if self._article:
                self.article_parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._buf))
            self._in_jsonld = False
            return
        if tag == "title":
            self._in_title = False
        if tag == "article":
            self._article = max(0, self._article - 1)
            self.article_parts.append("\n")
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if tag in BLOCK_TAGS:
            self.parts.append("\n")
            if self._article:
                self.article_parts.append("\n")

    def handle_data(self, data):
        if self._in_jsonld:
            self._buf.append(data)
            return
        if self._in_title:
            self.title += data
            return
        if self.skip:
            return
        self.parts.append(data)
        if self._article:
            self.article_parts.append(data)


class Page:
    """Parsed page: title, paragraphs (list of str), publish date and where it was read from."""

    def __init__(self, title: str, paragraphs: list[str], published_at: str | None, published_from: str,
                 full_paragraphs: list[str] | None = None):
        self.title = title
        self.paragraphs = paragraphs
        self.full_paragraphs = full_paragraphs if full_paragraphs is not None else paragraphs
        self.published_at = published_at
        self.published_from = published_from

    @property
    def text(self) -> str:
        return "\n".join(self.paragraphs)

    @property
    def full_text(self) -> str:
        """Whole page text (sidebars included): what watch-list page_rules are written against."""
        return "\n".join(self.full_paragraphs)


def _clean(s: str) -> str:
    return re.sub(r"[ \t\r\f\v\u00a0]+", " ", s).strip()


def parse_html(body: bytes | str, url: str = "") -> Page:
    raw = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    p = _Extractor()
    try:
        p.feed(raw)
        p.close()
    except Exception:  # noqa: BLE001 — malformed HTML: keep what was parsed
        pass
    def split(t: str, minlen: int = 2) -> list[str]:
        return [x for x in (_clean(y) for y in re.split(r"\n\s*\n|\n", t)) if len(x) >= minlen]
    paras = split("".join(p.parts))
    full = split("".join(p.parts), 1)       # table cells such as "5" kept for page_rules
    art = split("".join(p.article_parts))
    if sum(len(x) for x in art) >= 300:     # an <article> element with real text: read only it (no sidebars / related links)
        paras = art
    title = _clean(html.unescape(p.meta.get("og:title") or p.title or ""))
    pub, how = publish_date(p, url)
    return Page(title, paras, pub, how, full)


def _jsonld_dates(blobs: list[str]) -> list[str]:
    out: list[str] = []

    def walk(o):
        if isinstance(o, dict):
            for k in ("datePublished", "dateCreated"):
                if isinstance(o.get(k), str):
                    out.append(o[k])
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    for b in blobs:
        try:
            walk(json.loads(b))
        except ValueError:
            continue
    return out


_URL_DATE = re.compile(r"/(20\d{2})[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])(?:/|-|$)")


def _norm_date(s: str) -> str | None:
    t = parse_ts(s.strip(), default_tz=dt.timezone(dt.timedelta(hours=5, minutes=30)))
    if t is None:
        m = re.match(r"^\s*(\d{4}-\d{2}-\d{2})", s)
        return m.group(1) if m else None
    return t.isoformat()


def publish_date(p: _Extractor, url: str) -> tuple[str | None, str]:
    """Publish date in priority order: article:published_time meta → JSON-LD datePublished → <time datetime> → date in the
    URL. None ('none') when nothing machine-readable is found: the document is then 'undated' and never corroborates."""
    for key in ("article:published_time", "og:article:published_time", "datepublished", "pubdate", "publish-date",
                "dc.date.issued", "date"):
        if p.meta.get(key):
            d = _norm_date(p.meta[key])
            if d:
                return d, "meta"
    for s in _jsonld_dates(p.jsonld):
        d = _norm_date(s)
        if d:
            return d, "jsonld"
    for s in p.times:
        d = _norm_date(s)
        if d:
            return d, "time"
    m = _URL_DATE.search(url or "")
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", "url"
    return None, "none"


# ── sentences ───────────────────────────────────────────────────────────────────────────────────────────────────────
_ABBR = ("Rs", "No", "Nos", "Dr", "Mr", "Mrs", "Ms", "Prof", "St", "approx", "Approx", "Govt", "Dept", "vs", "Ltd", "Pvt",
         "Co", "Jr", "Sr", "Hon", "Smt", "Shri", "Er", "Adv", "e.g", "i.e", "etc", "Jan", "Feb", "Mar", "Apr", "Aug", "Sept",
         "Sep", "Oct", "Nov", "Dec", "Corp")
_ABBR_RE = re.compile(r"\b(?:" + "|".join(re.escape(a) for a in _ABBR) + r")\.$")


def sentences(paragraph: str) -> list[str]:
    """Split on . ! ? followed by space + capital/quote/digit; never inside a decimal (5.46), an abbreviation (Rs.) or
    an initial (M.G. Road)."""
    out: list[str] = []
    start = 0
    for m in re.finditer(r"[.!?][\"'”’)]?\s+(?=[\"'“‘(]?[A-Z0-9₹])", paragraph):
        cand = paragraph[start:m.end()].strip()
        head = paragraph[start:m.start() + 1]
        if _ABBR_RE.search(head) or re.search(r"\b[A-Z]\.$", head):
            continue
        out.append(cand)
        start = m.end()
    tail = paragraph[start:].strip()
    if tail:
        out.append(tail)
    return out


def norm_for_match(s: str) -> str:
    """Lower-case, NFKC, every dash/hyphen → '-', curly quotes → straight, runs of space collapsed. Used for alias and
    pattern matching only; quotes keep the original text."""
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[\u2010-\u2015\u2212]", "-", s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"\s*-\s*", "-", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def quote_hash(quote: str) -> str:
    n = re.sub(r"[^a-z0-9₹]+", " ", norm_for_match(quote)).strip()
    return hashlib.sha256(n.encode()).hexdigest()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ── domains ─────────────────────────────────────────────────────────────────────────────────────────────────────────
_SECOND_LEVEL = {"co.in", "gov.in", "org.in", "ac.in", "net.in", "nic.in", "res.in", "edu.in", "co.uk", "org.uk",
                 "gov.uk", "ac.uk", "com.au", "co.jp"}


def host_of(url: str) -> str:
    h = (urlsplit(url).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def registrable_domain(url_or_host: str) -> str:
    h = host_of(url_or_host) if "://" in url_or_host else url_or_host.lower().removeprefix("www.")
    labels = h.split(".")
    if len(labels) >= 3 and ".".join(labels[-2:]) in _SECOND_LEVEL:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:]) if len(labels) >= 2 else h


def publisher_for(url: str, publishers: dict) -> tuple[str, int, str]:
    """(registrable domain, tier, name): the most specific host suffix listed in the watch-list publishers wins;
    unlisted = tier 3, named after the domain."""
    h = host_of(url)
    labels = h.split(".")
    for i in range(len(labels) - 1):
        suffix = ".".join(labels[i:])
        if suffix in publishers and isinstance(publishers[suffix], dict):
            p = publishers[suffix]
            return registrable_domain(h), int(p.get("tier", 3)), str(p.get("name", suffix))
    return registrable_domain(h), 3, registrable_domain(h)
