"""
One run of the data-freshness service: sources → candidate pages → fetch (robots, cache, delay) → documents →
claims → proposals → verdicts. Writes only fu_* tables and fu_audit; never the facts dataset.

A dry run does everything, returns the report, and rolls the database transaction back (the HTTP cache is kept).
"""
from __future__ import annotations

import datetime as dt
import json
import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, config as cfgmod, facts as facts_mod, llm
from .extract import apply_page_rules, extract_page, label
from .fetch import PoliteFetcher, Refused
from .models import FuClaimEntity, FuDocumentEntity, FuProposalEntity, FuRunEntity
from .proposals import assign, evaluate_all, proposal_dict
from .sources import PLUGINS, Candidate
from .text import parse_html, publisher_for, sha256_bytes

HTML_TYPES = ("text/html", "application/xhtml")


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _pub_date(s: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def select_candidates(db: Session, cands: list[Candidate], cfg: dict, refresh: bool, now: dt.datetime) -> tuple[list[Candidate], list[dict]]:
    """Dedupe by URL, skip articles fetched within refetch_after_days (official pages are always re-read), newest
    first, cap per run and per host."""
    max_run = int(cfgmod.setting(cfg, "max_articles_per_run", 40))
    max_host = int(cfgmod.setting(cfg, "max_articles_per_host", 8))
    refetch = int(cfgmod.setting(cfg, "refetch_after_days", 30))
    merged: dict[str, Candidate] = {}
    for c in cands:
        if c.url in merged:
            merged[c.url].projects |= c.projects
            merged[c.url].feed_published = merged[c.url].feed_published or c.feed_published
        else:
            merged[c.url] = c
    official = [c for c in merged.values() if c.official_page]
    articles = [c for c in merged.values() if not c.official_page]
    skipped = []
    keep = []
    for c in articles:
        prev = db.scalars(select(FuDocumentEntity).where(FuDocumentEntity.url == c.url).order_by(FuDocumentEntity.retrieved_at.desc())).first()
        if prev and not refresh and prev.retrieved_at and (now.replace(tzinfo=None) - prev.retrieved_at).days < refetch:
            skipped.append({"url": c.url, "reason": f"read {prev.retrieved_at.date()} (re-read after {refetch} days)"})
            continue
        keep.append(c)
    keep.sort(key=lambda c: c.feed_published or "", reverse=True)
    per_host: dict[str, int] = defaultdict(int)
    chosen = []
    from .text import host_of
    for c in keep:
        h = host_of(c.url)
        if per_host[h] >= max_host:
            skipped.append({"url": c.url, "reason": f"per-host cap {max_host} reached"})
            continue
        if len(chosen) >= max_run:
            skipped.append({"url": c.url, "reason": f"per-run cap {max_run} reached"})
            continue
        per_host[h] += 1
        chosen.append(c)
    return official + chosen, skipped


def ingest(db: Session, cfg: dict, cand: Candidate, body: bytes, final_url: str, status: int, robots_note: str,
           run_id: str | None, source_tier: int, manual: bool = False, now: dt.datetime | None = None,
           force_projects: set[str] | None = None) -> tuple[FuDocumentEntity, list[FuClaimEntity], bool]:
    """Store one fetched page and its claims. Returns (document, new claims, was_new). The same URL with the same
    body hash is not processed twice."""
    now = now or dt.datetime.now(dt.timezone.utc)
    sha = sha256_bytes(body)
    prev = db.scalars(select(FuDocumentEntity).where(FuDocumentEntity.url == cand.url, FuDocumentEntity.sha256 == sha)).first()
    if prev is not None:
        prev.retrieved_at = now.replace(tzinfo=None)
        return prev, [], False
    page = parse_html(body, final_url)
    domain, tier, name = publisher_for(final_url, cfg.get("publishers", {}))
    if tier == 3 and source_tier < 3 and cand.official_page:
        tier = source_tier
    if cand.official_page:
        name = next((s.get("publisher") for s in cfg.get("sources", []) if s["id"] == cand.source_id), name) or name
    published, how = page.published_at, page.published_from
    stamp = next((s.get("date_stamp_pattern") for s in cfg.get("sources", []) if s["id"] == cand.source_id and s.get("date_stamp_pattern")), None)
    if stamp:
        import re as _re
        m = _re.search(stamp, page.text)
        if m and all(k in m.groupdict() for k in ("y", "m", "d")):
            published, how = f"{m.group('y')}-{m.group('m')}-{m.group('d')}", "page_stamp"
    if not published and cand.feed_published:
        published, how = cand.feed_published, "feed"
    if not published and cand.official_page:
        published, how = now.date().isoformat(), "retrieved"   # live official page: its value as of retrieval
    doc = FuDocumentEntity(id=_id("fud"), url=cand.url, final_url=final_url, domain=domain, publisher=name, tier=tier,
                           source_id=cand.source_id, title=(page.title or cand.title)[:500], published_at=published,
                           published_from=how, retrieved_at=now.replace(tzinfo=None), http_status=status, sha256=sha,
                           text_sha256=sha256_bytes(page.text.encode()), robots_note=robots_note[:500], run_id=run_id,
                           manual=manual)
    db.add(doc)
    db.flush()
    projects = cfg.get("projects", [])
    if force_projects:
        projects = [p for p in projects if p["id"] in force_projects] or projects
    claims = extract_page(page.paragraphs, page.title or cand.title, projects, _pub_date(published)) if cand.extract_sentences else []
    if cand.page_rules:
        claims += apply_page_rules(page.text, cand.page_rules, projects)
    if llm.enabled() and cand.extract_sentences:
        claims += llm.extract(page.text, page.title or cand.title, projects, _pub_date(published))
    rows = []
    for c in claims:
        r = FuClaimEntity(id=_id("fuc"), document_id=doc.id, project_id=c.project_id, attribute=c.attribute,
                          value_num=c.value_num, value_text=c.value_text, unit=c.unit, qualifier=c.qualifier,
                          temporal=c.temporal, quote=c.quote, quote_sha256=c.quote_sha256, attribution=c.attribution,
                          extractor=c.extractor, cites_other=c.cites_other, note=c.note)
        db.add(r)
        rows.append(r)
    db.flush()
    return doc, rows, True


def run(db: Session, cfg: dict | None = None, *, dry_run: bool = False, only: set[str] | None = None,
        sources: set[str] | None = None, refresh: bool = False, fetcher: PoliteFetcher | None = None,
        actor: str = "updater (CLI)", today: dt.date | None = None, log=print) -> dict:
    cfg = cfg or cfgmod.load()
    now = dt.datetime.now(dt.timezone.utc)
    today = today or now.date()
    projects = [p for p in cfg["projects"] if not only or p["id"] in only]
    if not projects:
        raise ValueError("no watched project selected")
    fetcher = fetcher or PoliteFetcher(user_agent=cfgmod.setting(cfg, "user_agent", None) or "UrbanOS-data-freshness/1.0",
                                       min_delay=float(cfgmod.setting(cfg, "min_host_delay_s", 2.0)))
    run_row = FuRunEntity(id=_id("fur"), mode="dry_run" if dry_run else "run", watchlist_sha256=cfg.get("_sha256"),
                          git_commit=facts_mod.git_commit())
    db.add(run_row)
    db.flush()
    errors: list[dict] = []
    per_source: dict[str, dict] = {}
    cands: list[Candidate] = []
    used = []
    for src in cfg.get("sources", []):
        if not src.get("enabled", True) or (sources and src["id"] not in sources):
            continue
        used.append(src["id"])
        res = PLUGINS[src["kind"]](src, projects, fetcher)
        per_source[src["id"]] = {"candidates": len(res.candidates), "errors": res.errors, "note": res.note}
        errors += [{"source": src["id"], "error": e} for e in res.errors]
        for c in res.candidates:
            c.projects = c.projects & {p["id"] for p in projects} if c.projects else c.projects
            if c.official_page or c.projects:
                cands.append(c)
        log(f"  source {src['id']}: {len(res.candidates)} candidate(s){' · ' + '; '.join(res.errors)[:200] if res.errors else ''}")
    chosen, skipped = select_candidates(db, cands, cfg, refresh, now)
    tier_of = {s["id"]: int(s.get("tier", 3)) for s in cfg.get("sources", [])}
    docs_new = claims_new = 0
    fetched = []
    for c in chosen:
        try:
            r = fetcher.get(c.url)
        except Refused as e:
            errors.append({"source": c.source_id, "url": c.url, "error": str(e)})
            continue
        ctype = (r.headers.get("content-type") or "").lower()
        if r.status != 200:
            errors.append({"source": c.source_id, "url": c.url, "error": f"HTTP {r.status}"})
            continue
        if ctype and not any(t in ctype for t in HTML_TYPES):
            errors.append({"source": c.source_id, "url": c.url, "error": f"not an HTML page ({ctype[:60]})"})
            continue
        doc, rows, new = ingest(db, cfg, c, r.body, r.final_url, r.status, r.robots_note, run_row.id, tier_of.get(c.source_id, 3),
                                now=now, force_projects=None)
        docs_new += int(new)
        claims_new += len(rows)
        fetched.append({"url": c.url, "publisher": doc.publisher, "tier": doc.tier, "published_at": doc.published_at,
                        "claims": len(rows), "new": new, "from_cache": r.from_cache})
        log(f"  read {doc.publisher} (tier {doc.tier}) {c.url[:90]} → {len(rows)} claim(s){'' if new else ' (unchanged)'}")
    created = assign(db, actor)
    active = facts_mod.read_active(db)
    max_age = int(cfgmod.setting(cfg, "max_article_age_days", 400))
    evaluate_all(db, active, max_age, today)
    stats = {"requests": len(fetcher.requests), "requests_per_host": fetcher.per_host, "candidates": len(cands),
             "pages_read": len(fetched), "documents_new": docs_new, "claims_new": claims_new,
             "proposals_created": len(created), "skipped": len(skipped), "per_source": per_source,
             "robots": {o: n for o, (_r, _d, n) in fetcher.robots.items()}}
    run_row.finished_at = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    run_row.sources_json = json.dumps(used)
    run_row.stats_json = json.dumps(stats, default=str)
    run_row.errors_json = json.dumps(errors, default=str)
    audit.log(db, actor, "run", run_row.id, {"mode": run_row.mode, "pages_read": len(fetched), "claims_new": claims_new,
                                             "proposals_created": created, "errors": len(errors),
                                             "watchlist_sha256": cfg.get("_sha256")})
    pending = [proposal_dict(db, p, cfg) for p in db.scalars(select(FuProposalEntity).where(FuProposalEntity.status == "pending")
                                                              .order_by(FuProposalEntity.project_id, FuProposalEntity.attribute))]
    report = {"run_id": run_row.id, "mode": run_row.mode, "started_at": now.isoformat(), "stats": stats, "errors": errors,
              "fetched": fetched, "skipped": skipped, "proposals_created": created, "pending": pending}
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def add_evidence(db: Session, cfg: dict, url: str, reviewer: str, project_id: str | None = None,
                 fetcher: PoliteFetcher | None = None) -> dict:
    """A reviewer adds one page by URL (e.g. a MahaMetro press note). It is fetched under the same robots / politeness
    rules and goes through the same extractors; nothing is typed in by hand."""
    if not (reviewer or "").strip():
        raise ValueError("a reviewer name is required")
    fetcher = fetcher or PoliteFetcher(user_agent=cfgmod.setting(cfg, "user_agent", None) or "UrbanOS-data-freshness/1.0")
    r = fetcher.get(url)
    if r.status != 200:
        raise ValueError(f"HTTP {r.status}")
    cand = Candidate(url, "manual", "", None, {project_id} if project_id else set())
    doc, rows, new = ingest(db, cfg, cand, r.body, r.final_url, r.status, r.robots_note, None, 3, manual=True,
                            force_projects={project_id} if project_id else None)
    assign(db, reviewer)
    evaluate_all(db, facts_mod.read_active(db), int(cfgmod.setting(cfg, "max_article_age_days", 400)))
    audit.log(db, reviewer, "evidence_added", doc.id, {"url": url, "claims": len(rows), "new": new})
    db.commit()
    return {"document_id": doc.id, "publisher": doc.publisher, "tier": doc.tier, "published_at": doc.published_at,
            "claims": [{"project_id": c.project_id, "attribute": c.attribute,
                        "value": label(c.attribute, c.value_num, c.value_text, c.qualifier), "quote": c.quote} for c in rows]}
