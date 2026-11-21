"""
Deterministic fact extraction (docs/urbanos/DATA_FRESHNESS_RESEARCH.md §3.1).

Input: a parsed page (paragraphs) + the watch-list projects. Output: `Claim`s, each carrying the exact sentence it came
from. Every extractor is a named, versioned pattern; a sentence that does not match exactly yields nothing (a missed
fact is safe, an invented one is not).

Attribution (which project a sentence is about):
  sentence           an alias of the project is in the sentence (if several projects are named, a value goes to the
                     nearest alias before it, with no other project's alias in between)
  previous_sentence  the sentence refers back ("the line", "the corridor", "the TBMs", …) and the previous 3 sentences
                     (document order) name exactly one project
  article            the page title names exactly one watched project, the sentence and the previous 3 sentences name
                     no other watched project, and the sentence does not mention another phase / line (weaker: flagged
                     for review)
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from .text import norm_for_match, quote_hash, sentences

EXTRACTOR_VERSION = "1"
MAX_QUOTE = 400

ATTRIBUTES: dict[str, dict] = {
    "tunnel_depth_m": {"label": "Tunnel depth below ground", "unit": "m", "kind": "number"},
    "length_km": {"label": "Length", "unit": "km", "kind": "number"},
    "station_count": {"label": "Stations", "unit": "stations", "kind": "integer"},
    "cost_inr_crore": {"label": "Project cost", "unit": "INR crore", "kind": "number"},
    "tbm_count": {"label": "Tunnel boring machines", "unit": "TBMs", "kind": "integer"},
    "tunnelling_start": {"label": "Tunnelling (boring) start", "unit": "month", "kind": "month"},
    "completion_target": {"label": "Completion target", "unit": "month", "kind": "month"},
    "status": {"label": "Status", "unit": None, "kind": "status"},
}
STATUS_VOCAB = ("approved", "awarded", "under_construction", "operational")

WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen "
    "eighteen nineteen twenty".split())}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])}
MONTH_ABBR = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10,
              "nov": 11, "dec": 12}
_MONTH_RE = r"(?P<month>january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b\.?"
HEDGE = r"(?P<hedge>about|around|approximately|approx\.?|nearly|roughly|almost|some|up to|upto|over|more than|at least|~)"
NUMWORD = r"(?P<num>\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?|" + "|".join(WORDS) + r")"
REFERS_BACK = re.compile(r"^(?:the|these|this|its|it|they|both|all)\b.{0,40}?\b(?:line|corridor|extension|project|route|stretch|"
                         r"tbms?|machines?|tunnels?|alignment|work|flyover|road|bridge)\b|^(?:it|they)\b")
OTHER_PHASE = re.compile(r"\b(?:phase[- ]?(?:1|i|one)\b|first phase|phase one|other line|existing line|purple line|aqua line)")
FUTURE = re.compile(r"\b(?:will|would|shall|expected|set to|scheduled|likely|plans?|planned|proposed|targets?|targeted|"
                    r"to begin|to start|to commence|is to|are to|aims?|anticipated?|slated)\b")
PAST = re.compile(r"\b(?:began|begun|started|commenced|has started|have started|was launched|kicked off|completed|was completed|opened)\b")
CITES = re.compile(r"\b(?:as (?:first |earlier )?reported by|reported earlier by|according to (?:a |media )?reports?|"
                   r"reports? (?:said|suggest)|as per (?:a |media )?reports?)\b")


@dataclass
class Claim:
    project_id: str
    attribute: str
    value_num: float | None
    value_text: str | None
    unit: str | None
    qualifier: str
    temporal: str | None
    quote: str
    attribution: str
    extractor: str
    cites_other: bool = False
    note: str = ""
    quote_sha256: str = field(default="")

    def __post_init__(self):
        if not self.quote_sha256:
            self.quote_sha256 = quote_hash(self.quote)

    @property
    def value_key(self) -> str:
        return value_key(self.attribute, self.value_num, self.value_text)


def value_key(attribute: str, num: float | None, text: str | None) -> str:
    if text is not None:
        return f"{attribute}:{text}"
    return f"{attribute}:{_fmt(num)}"


def _fmt(v: float | None) -> str:
    if v is None:
        return "?"
    return str(int(v)) if float(v).is_integer() else f"{v:.6g}"


def parse_number(s: str) -> float | None:
    s = s.strip().lower()
    if s in WORDS:
        return float(WORDS[s])
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def decimals(v: float | None, raw: str | None = None) -> int:
    if raw is not None and "." in raw:
        return len(raw.split(".", 1)[1])
    if v is None or float(v).is_integer():
        return 0
    return len(_fmt(v).split(".", 1)[1]) if "." in _fmt(v) else 0


def _qualifier(hedge: str | None) -> str:
    if not hedge:
        return "exact"
    h = hedge.strip().lower()
    if h in ("up to", "upto", "almost"):
        return "max"
    if h in ("over", "more than", "at least"):
        return "min"
    return "approx"


def _temporal(ns: str) -> str | None:
    if FUTURE.search(ns):
        return "planned"
    if PAST.search(ns):
        return "reported"
    return None


# ── per-attribute extractors: (normalised sentence) -> list[(value_num, value_text, qualifier, match_start, note)] ─────
def x_tunnel_depth(ns: str, ctx: dict) -> list:
    tunnel_words = r"\b(?:tunnel\w*|tbms?|boring|underground)\b"
    # "The machines will work about 28 metres below ground level." — "machines" refers to the TBMs of the previous sentences
    if not (re.search(tunnel_words, ns) or (re.search(r"\b(?:the|these|both|all four) machines?\b", ns)
                                             and re.search(r"\b(?:tbms?|tunnel boring machines?)\b", ctx.get("prev", "")))):
        return []
    if re.search(r"\b(?:piles?|piling|shafts?|footings?|foundations?|borewells?|wells?|station box|basement)\b", ns):
        return []
    if re.search(r"\bstations?\b", ns) and not re.search(r"\b(?:tunnel\w*|tbms?|boring|machines?)\b", ns):
        return []
    out = []
    pats = [
        r"(?:depth|depths) of\s+(?:" + HEDGE + r"\s*)?" + r"(?P<num>\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(?P<num2>\d+(?:\.\d+)?))?\s*(?:m|metres|meters|mtrs?)\b",
        r"(?:" + HEDGE + r"\s*)?(?P<num>\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(?P<num2>\d+(?:\.\d+)?))?\s*(?:m|metres|meters|mtrs?)\b\s*"
        r"(?:deep\b|below (?:the )?(?:ground|surface|road)|beneath (?:the )?(?:ground|surface|road)|underground\b)",
    ]
    seen = set()
    for p in pats:
        for m in re.finditer(p, ns):
            if m.start("num") in seen:
                continue
            seen.add(m.start("num"))
            v = float(m.group("num"))
            if not (3 <= v <= 80):          # metro tunnels in Pune: plausible crown/axis depth range
                continue
            if m.group("num2"):
                v2 = float(m.group("num2"))
                out.append((None, f"{_fmt(v)}-{_fmt(v2)}", "range", m.start(), ""))
            else:
                out.append((v, None, _qualifier(m.groupdict().get("hedge")), m.start(), ""))
    return out


def x_length(ns: str, ctx: dict) -> list:
    out = []
    for m in re.finditer(r"(?:" + HEDGE + r"\s*)?(?P<num>\d+(?:\.\d+)?)\s*-?\s*(?:km|kms|kilometres|kilometers)\b(?!\s*/|\s*per|ph)", ns):
        before, after = ns[max(0, m.start() - 40):m.start()], ns[m.end():m.end() + 40]
        if re.search(r"\b(?:away|from the|distance|radius|within|per hour|speed|ride|journey|travel)\b", before + " " + after[:20]):
            continue
        if re.match(r"\s*(?:of\s+)?(?:twin|tunnels?|bores?|track|cables?|pipes?|drains?|lines? of)", after):
            continue
        if not re.search(r"\b(?:long|stretch|corridor|route|extension|line|elevated|underground|length|spans?|spanning|"
                         r"road|flyover|riverfront|ring road|metro|alignment)\b", before + " " + after):
            continue
        v = float(m.group("num"))
        if not (0.2 <= v <= 300):
            continue
        out.append((v, None, _qualifier(m.group("hedge")), m.start(), ""))
    for m in re.finditer(r"(?:" + HEDGE + r"\s*)?(?P<num>\d{2,4}(?:\.\d+)?)\s*(?:m|metres|meters)\s+(?:in length|long)\b", ns):
        v = float(m.group("num")) / 1000.0
        if 0.05 <= v <= 20:
            out.append((v, None, _qualifier(m.group("hedge")), m.start(), "stated in metres"))
    return out


def x_station_count(ns: str, ctx: dict) -> list:
    out = []
    for m in re.finditer(NUMWORD + r"\s+(?:(?:new|more|important|major|planned|proposed)\s+)?(?:(?P<kind>underground|elevated|metro)\s+)?stations\b", ns):
        before = ns[max(0, m.start() - 25):m.start()]
        after = ns[m.end():m.end() + 25]
        if re.search(r"\b(?:first|of the|among|other|remaining|another|existing)\s*$", before):
            continue
        if re.match(r"\s*(?:are|were)?\s*(?:open|opened|operational|functional|under construction|awaiting)", after):
            continue
        v = parse_number(m.group("num"))
        if v is None or not (1 <= v <= 40) or not float(v).is_integer():
            continue
        out.append((v, None, "exact", m.start(), f"{m.group('kind')} stations" if m.group("kind") else ""))
    return out


def x_cost(ns: str, ctx: dict) -> list:
    if not re.search(r"\b(?:cost|costing|estimated|outlay|budget|project worth|project of|worth|pegged)\b|crore[- ](?:[\w-]+\s+){0,3}(?:project|flyover|bridge|road|corridor|line|extension)\b", ns):
        return []
    if re.search(r"\b(?:loa|letter of acceptance|awarded|contract|tender|bid|work order|equity|loan|funding|grant|allocat\w*|"
                 r"released|disbursed|contribut\w*|will add|share of|compensation|for land acquisition|fine|penalty|revenue|toll)\b", ns):
        return []
    out = []
    for m in re.finditer(r"(?:" + HEDGE + r"\s*)?(?:₹|rs\.?|inr)\s*(?P<num>\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)[\s-]*"
                         r"(?P<scale>lakh crore|crore|cr\b)", ns):
        v = parse_number(m.group("num"))
        if v is None:
            continue
        if m.group("scale") == "lakh crore":
            v *= 100000
        if not (1 <= v <= 500000):
            continue
        out.append((v, None, _qualifier(m.group("hedge")), m.start(), ""))
    return out


def x_tbm_count(ns: str, ctx: dict) -> list:
    out = []
    for m in re.finditer(r"(?P<pre>\b(?:needs|need|requires?|require|deploy(?:ed|ing)?|total of|of|use|using|uses|procured?|"
                         r"order(?:ed)?|involve|involves|all)\s+)?" + NUMWORD + r"\s+(?:tunnel boring machines|tbms)\b", ns):
        after = ns[m.end():m.end() + 45]
        if re.match(r"\s*(?:\(tbms\)\s*)?(?:will )?(?:operate|operating|work|working)?\s*(?:from|on the|each|side)\b", after):
            continue
        if not (m.group("pre") or re.match(r"\s*(?:\(tbms\)\s*)?(?:will be|are|to be|would be|have been)\s+(?:deployed|used|procured|arriv)", after)
                or re.match(r"\s*(?:\(tbms\)\s*)?(?:expected to arrive|are expected|will arrive|to arrive)", after)):
            continue
        v = parse_number(m.group("num"))
        if v is None or not (1 <= v <= 20):
            continue
        out.append((v, None, "exact", m.start(), ""))
    return out


def _month_value(m: re.Match, published: dt.date | None, allow_no_year: bool = True) -> tuple[str | None, str]:
    mon_s = m.group("month").rstrip(".")
    mon = MONTHS.get(mon_s) or MONTH_ABBR.get(mon_s)
    if mon is None:
        return None, ""
    year = m.groupdict().get("year")
    if year:
        return f"{int(year):04d}-{mon:02d}", ""
    if not allow_no_year or published is None:
        return None, ""
    y = published.year if mon >= published.month else published.year + 1
    return f"{y:04d}-{mon:02d}", (f"year not stated: '{mon_s.title()}' read as {y}-{mon:02d}, the first such month on or after "
                                  f"the article's publish date {published.isoformat()}")


def x_tunnelling_start(ns: str, ctx: dict) -> list:
    if not re.search(r"\b(?:tunnel\w*|boring|tbms?|tunnel boring)\b", ns):
        return []
    if not re.search(r"\b(?:begin|begins|began|begun|start|starts|started|commence\w*|kick off|kicks off|kicked off|get under way)\b", ns):
        return []
    if re.search(r"\bshafts?\b", ns) and not re.search(r"\b(?:tunnel\w*|boring|tbms?)\b.{0,120}\b(?:begin|start|commence)", ns):
        return []
    out = []
    for m in re.finditer(r"\b(?:in|from|by|during)\s+(?:early\s+|mid-?\s*|the end of\s+|end of\s+|late\s+)?" + _MONTH_RE +
                         r"(?:\s*,?\s*(?P<year>20\d{2}))?", ns):
        val, note = _month_value(m, ctx.get("published"))
        if val:
            out.append((None, val, "exact", m.start(), note))
    return out


def x_completion(ns: str, ctx: dict) -> list:
    if not re.search(r"\b(?:complet\w*|ready|operational|open(?:ed)? (?:for|to) (?:the )?(?:public|commuters)|deadline|target)\b", ns):
        return []
    if re.search(r"\b(?:shaft|station box|casting|segment|survey|dpr|tender)\b", ns):
        return []
    out = []
    rev = re.search(r"\b(?:extended|revised|pushed(?: back)?|postponed|deferred|shifted)\s+to\b", ns)
    start = rev.end() - 2 if rev else 0       # keep the "to" so the pattern below sees a preposition
    day = r"(?:\d{1,2}(?:st|nd|rd|th)?\s+)?"
    pat = (r"\b(?:by|in|of|till|before|until|to)\s+(?:the end of\s+|end of\s+|end-)?" + day +
           r"(?:" + _MONTH_RE + r"\s*(?:\d{1,2}(?:st|nd|rd|th)?\s*)?,?\s*)?(?P<year>20\d{2})?\b")
    for m in re.finditer(pat, ns[start:]):
        pos = m.start() + start
        if not m.group("year") and not m.groupdict().get("month"):
            continue
        if not rev and m.group(0).startswith("to"):
            continue
        if re.search(r"\b(?:original|earlier|initial|previous|old)\s+(?:\w+\s+){0,2}$", ns[max(0, pos - 30):pos]):
            continue
        seg = re.split(r"[,;]|\bwhile\b|\bwhereas\b", ns[max(0, pos - 50):pos])[-1]
        if not re.search(r"\b(?:complet\w*|ready|operational|open\w*|deadline|target\w*|finish\w*|commission\w*)\b", seg):
            continue      # the date must follow its completion word (not a date from another clause)
        if m.groupdict().get("month"):
            val, note = _month_value(m, ctx.get("published"), allow_no_year=True)
        else:
            val, note = m.group("year"), ""
        if val:
            out.append((None, val, "exact", pos, note))
    pub = ctx.get("published")
    for m in re.finditer(r"\b(?:by|before|till|until)\s+(?:the )?end of (?P<rel>this|next) year\b", ns):
        seg = re.split(r"[,;]|\bwhile\b", ns[max(0, m.start() - 50):m.start()])[-1]
        if pub and re.search(r"\b(?:complet\w*|ready|operational|open\w*)\b", seg):
            y = pub.year + (1 if m.group("rel") == "next" else 0)
            out.append((None, f"{y}-12", "exact", m.start(), f"'end of {m.group('rel')} year' read as December {y} from the publish date {pub.isoformat()}"))
    return out


_STATUS_PATTERNS = [
    ("operational", r"\b(?:is|are|was|were|became|has been|have been)?\s*(?:now )?(?:operational|thrown open|opened to (?:the )?(?:public|commuters)|inaugurated)\b"),
    ("under_construction", r"\b(?:construction|civil work|work)\s+(?:has |have )?(?:begun|began|started|commenced|is underway|is under way|is in progress)\b|\bis under construction\b|\bare under construction\b"),
    ("awarded", r"\b(?:work order|letter of acceptance|loa)\b.{0,40}\b(?:issued|awarded|given)\b|\bcontract (?:has been |was )?awarded\b"),
    ("approved", r"\b(?:union cabinet|cabinet|state government|central government|government)\b.{0,40}\b(?:approved|sanctioned|gave (?:its )?nod)\b"),
]


def x_status(ns: str, ctx: dict) -> list:
    if FUTURE.search(ns):
        return []          # "will be operational by …" is a target, not a status
    out = []
    money = bool(re.search(r"₹|\brs\.?\s*\d|\bcrore\b|\bfund\w*", ns))
    for word, p in _STATUS_PATTERNS:
        if word == "approved" and money:
            continue       # "government approved ₹180 crore in funding" is a funding decision, not project approval
        m = re.search(p, ns)
        if m:
            out.append((None, word, "exact", m.start(), ""))
            break
    return out


EXTRACTORS = {
    "tunnel_depth_m": x_tunnel_depth,
    "length_km": x_length,
    "station_count": x_station_count,
    "cost_inr_crore": x_cost,
    "tbm_count": x_tbm_count,
    "tunnelling_start": x_tunnelling_start,
    "completion_target": x_completion,
    "status": x_status,
}
# attributes whose claims need sentence-level attribution (status words are too generic for article context)
SENTENCE_ONLY = {"status"}
# how many previous sentences (document order, across paragraphs) count as context for "the line", "the TBMs", …
CONTEXT_SENTENCES = 3


# ── attribution ───────────────────────────────────────────────────────────────────────────────────────────────────────
def alias_spans(ns: str, projects: list[dict]) -> list[tuple[int, int, str]]:
    spans = []
    for p in projects:
        for a in p.get("aliases", []):
            na = norm_for_match(a)
            if not na:
                continue
            for m in re.finditer(r"(?<![a-z0-9])" + re.escape(na) + r"(?![a-z0-9])", ns):
                spans.append((m.start(), m.end(), p["id"]))
    return sorted(spans)


def projects_in(ns: str, projects: list[dict]) -> set[str]:
    return {s[2] for s in alias_spans(ns, projects)}


def _nearest_project(spans: list[tuple[int, int, str]], pos: int) -> str | None:
    before = [s for s in spans if s[1] <= pos]
    if before:
        return before[-1][2]
    after = [s for s in spans if s[0] >= pos]
    ids = {s[2] for s in after}
    return after[0][2] if len(ids) == 1 else None


def extract_page(paragraphs: list[str], title: str, projects: list[dict], published: dt.date | None,
                 only_attributes: dict[str, set[str]] | None = None) -> list[Claim]:
    """All claims on a page. `only_attributes`: project id -> attributes tracked (default: the project's own list)."""
    tracked = only_attributes or {p["id"]: set(p.get("attributes", [])) for p in projects}
    title_projects = projects_in(norm_for_match(title), projects)
    article_project = next(iter(title_projects)) if len(title_projects) == 1 else None
    ctx = {"published": published}
    out: list[Claim] = []
    seen: set[tuple] = set()
    window: list[set[str]] = []          # projects named in the previous sentences (document order, newest last)
    prev_text: list[str] = []
    for para in paragraphs:
        for s in sentences(para):
            ns = norm_for_match(s)
            spans = alias_spans(ns, projects)
            here = {x[2] for x in spans}
            recent = set().union(*window[-CONTEXT_SENTENCES:]) if window else set()
            ctx["prev"] = " ".join(prev_text[-2:])
            cites = bool(CITES.search(ns))
            temporal = _temporal(ns)
            for attr, fn in EXTRACTORS.items():
                for (vnum, vtext, qual, pos, note) in fn(ns, ctx):
                    if here:
                        pid = _nearest_project(spans, pos) if len(here) > 1 else next(iter(here))
                        how = "sentence"
                    elif len(recent) == 1 and REFERS_BACK.search(ns):
                        pid, how = next(iter(recent)), "previous_sentence"
                    elif article_project and recent <= {article_project} and not OTHER_PHASE.search(ns):
                        pid, how = article_project, "article"
                    else:
                        continue
                    if pid is None or attr not in tracked.get(pid, set()):
                        continue
                    if attr in SENTENCE_ONLY and how != "sentence":
                        continue
                    key = (pid, attr, vnum, vtext, s)
                    if key in seen:
                        continue
                    seen.add(key)
                    unit = ATTRIBUTES[attr]["unit"]
                    t = temporal if attr in ("tunnelling_start", "completion_target", "tunnel_depth_m", "status") else None
                    if attr == "completion_target":
                        t = "planned" if t != "reported" else "reported"
                    out.append(Claim(pid, attr, vnum, vtext, unit, qual, t, s[:MAX_QUOTE], how,
                                     f"pattern:{attr}@{EXTRACTOR_VERSION}", cites, note))
            window.append(here)
            prev_text.append(ns)
    return out


def apply_page_rules(text: str, rules: list[dict], projects: list[dict]) -> list[Claim]:
    """Explicit per-source rules (watch-list `page_rules`) for tables on official pages: a regex with named groups =
    attribute names, bound to one project. The whole match is the quote."""
    known = {p["id"]: p for p in projects}
    flat = re.sub(r"\s+", " ", text)
    out: list[Claim] = []
    for r in rules:
        pid = r.get("project")
        if pid not in known:
            continue
        for m in re.finditer(r["pattern"], flat, flags=re.IGNORECASE):
            for attr, raw in m.groupdict().items():
                if raw is None or attr not in ATTRIBUTES or attr not in known[pid].get("attributes", []):
                    continue
                kind = ATTRIBUTES[attr]["kind"]
                if kind in ("number", "integer"):
                    v = parse_number(raw)
                    if v is None:
                        continue
                    out.append(Claim(pid, attr, v, None, ATTRIBUTES[attr]["unit"], "exact", None, m.group(0)[:MAX_QUOTE],
                                     "page_rule", f"page_rule:{r['id']}", False, r.get("note", "")))
                else:
                    out.append(Claim(pid, attr, None, raw, ATTRIBUTES[attr]["unit"], "exact", None, m.group(0)[:MAX_QUOTE],
                                     "page_rule", f"page_rule:{r['id']}", False, r.get("note", "")))
            break   # first match per rule
    return out


def label(attribute: str, value_num: float | None, value_text: str | None, qualifier: str = "exact") -> str:
    """Human text for a value: '~28 m', '5.46 km', '₹2,954.75 crore', 'January 2027', 'Under construction'."""
    a = ATTRIBUTES.get(attribute, {})
    pre = {"approx": "~", "max": "up to ", "min": "over ", "range": ""}.get(qualifier, "")
    kind = a.get("kind")
    if kind == "month" and value_text:
        if re.fullmatch(r"\d{4}-\d{2}", value_text):
            y, m = value_text.split("-")
            return f"{list(MONTHS)[int(m) - 1].title()} {y}"
        return value_text
    if kind == "status" and value_text:
        return value_text.replace("_", " ").capitalize()
    if value_text is not None:
        return f"{value_text} {a.get('unit') or ''}".strip()
    if attribute == "cost_inr_crore" and value_num is not None:
        return f"{pre}₹{value_num:,.2f}".rstrip("0").rstrip(".") + " crore"
    unit = {"m": "m", "km": "km"}.get(a.get("unit") or "", a.get("unit") or "")
    return f"{pre}{_fmt(value_num)} {unit}".strip()
