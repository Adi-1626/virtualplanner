"""
Claims → proposals, and each proposal's verdict (DATA_FRESHNESS_RESEARCH.md §4.2–4.4).

Grouping: a claim joins an existing proposal of the same (project, attribute) whose value it AGREES with, else it opens
a new pending proposal. Agreement: equal after unit normalisation, compared at the precision of the less precise value
(5.463 km ≈ 5.46 km; 2,954.53 ≠ 2,954.75), or within ±5 % when either side is hedged ("about", "around"); months and
ranges must be identical.

Corroborated = ≥ 1 official (tier 1) source, or ≥ 2 INDEPENDENT reputable-press (tier 2) sources. Independent: different
registrable domains, not the same normalised sentence (syndicated copy counts once), not an article that says it is
repeating another report. Undated, stale (older than max_article_age_days) and tier-3 sources never count.
LLM-extracted evidence always needs the 2-independent-source route.
"""
from __future__ import annotations

import datetime as dt
import json
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .extract import ATTRIBUTES, decimals, label, value_key
from .facts import current_value
from .models import FuClaimEntity, FuDocumentEntity, FuProposalEntity

DECIDED = ("approved", "rejected", "applied", "superseded", "rolled_back")
COMPETING = ("pending", "approved", "applied")
ASSIGN_ORDER = {"applied": 0, "approved": 1, "pending": 2, "rolled_back": 3, "superseded": 4, "rejected": 5}


def _new_id(prefix: str) -> str:
    import uuid
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def agree(attribute: str, a_num, a_text, a_qual: str, b_num, b_text, b_qual: str) -> bool:
    if a_text is not None or b_text is not None:
        return a_text == b_text
    if a_num is None or b_num is None:
        return False
    d = min(decimals(a_num), decimals(b_num))
    if round(a_num, d) == round(b_num, d):
        return True
    if "approx" in (a_qual, b_qual) and ATTRIBUTES[attribute]["kind"] == "number":
        return abs(a_num - b_num) <= 0.05 * max(abs(a_num), abs(b_num))
    return False


def _date(s: str | None) -> dt.date | None:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def assign(db: Session, actor: str = "updater") -> list[str]:
    """Attach every unassigned claim to a proposal. Returns ids of proposals created."""
    created: list[str] = []
    rows = db.execute(select(FuClaimEntity, FuDocumentEntity).join(FuDocumentEntity, FuDocumentEntity.id == FuClaimEntity.document_id)
                      .where(FuClaimEntity.proposal_id.is_(None))).all()
    rows.sort(key=lambda r: (r[1].tier, -(_date(r[1].published_at) or dt.date.min).toordinal(), r[0].id))
    for c, doc in rows:
        props = list(db.scalars(select(FuProposalEntity).where(FuProposalEntity.project_id == c.project_id,
                                                                FuProposalEntity.attribute == c.attribute)))
        props.sort(key=lambda p: (ASSIGN_ORDER.get(p.status, 9), p.created_at or dt.datetime.min, p.id))
        hit = next((p for p in props if agree(c.attribute, c.value_num, c.value_text, c.qualifier, p.value_num, p.value_text, p.qualifier)), None)
        if hit is None:
            hit = FuProposalEntity(id=_new_id("fup"), project_id=c.project_id, attribute=c.attribute,
                                   value_key=value_key(c.attribute, c.value_num, c.value_text), value_num=c.value_num,
                                   value_text=c.value_text, unit=c.unit, qualifier=c.qualifier, temporal=c.temporal,
                                   status="pending")
            db.add(hit)
            db.flush()
            created.append(hit.id)
            audit.log(db, actor, "proposal_created", hit.id, {"project_id": c.project_id, "attribute": c.attribute,
                                                                "value": label(c.attribute, c.value_num, c.value_text, c.qualifier),
                                                                "first_claim": c.id, "url": doc.url})
        c.proposal_id = hit.id
    db.flush()
    return created


def _evidence(db: Session, proposal_id: str) -> list[tuple[FuClaimEntity, FuDocumentEntity]]:
    return list(db.execute(select(FuClaimEntity, FuDocumentEntity).join(FuDocumentEntity, FuDocumentEntity.id == FuClaimEntity.document_id)
                           .where(FuClaimEntity.proposal_id == proposal_id)).all())


def corroboration(evidence: list[tuple[FuClaimEntity, FuDocumentEntity]], today: dt.date, max_age_days: int) -> dict:
    counting = []
    for c, d in evidence:
        pub = _date(d.published_at)
        if pub is None or c.cites_other or d.tier > 2:
            continue
        if (today - pub).days > max_age_days:
            continue
        counting.append((c, d))
    official = sorted({d.domain for c, d in counting if d.tier == 1 and not c.extractor.startswith("llm:")})
    # tier-2 independence: union-find over domains joined by an identical normalised sentence
    press = [(c, d) for c, d in counting if d.tier == 2]
    parent: dict[str, str] = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    by_quote: dict[str, str] = {}
    for c, d in press:
        find(d.domain)
        if c.quote_sha256 in by_quote:
            parent[find(d.domain)] = find(by_quote[c.quote_sha256])
        else:
            by_quote[c.quote_sha256] = d.domain
    groups = {find(d.domain) for c, d in press}
    independent = len(groups)
    llm_only = bool(counting) and all(c.extractor.startswith("llm:") for c, d in counting)
    corroborated = (len(official) >= 1 and not llm_only) or independent >= 2
    return {"official": len(official), "independent_press": independent, "counting": len(counting),
            "corroborated": corroborated, "llm_only": llm_only,
            "independent_sources": len(official) + independent}


def evaluate_group(db: Session, project_id: str, attribute: str, active: dict, max_age_days: int,
                   today: dt.date | None = None, actor: str = "updater") -> None:
    today = today or dt.date.today()
    props = list(db.scalars(select(FuProposalEntity).where(FuProposalEntity.project_id == project_id,
                                                            FuProposalEntity.attribute == attribute)))
    ev = {p.id: _evidence(db, p.id) for p in props}
    info = {p.id: corroboration(ev[p.id], today, max_age_days) for p in props}
    newest = {p.id: max([d.published_at for c, d in ev[p.id] if d.published_at] or [None], key=lambda x: x or "") for p in props}
    has_official = {p.id: any(d.tier == 1 for c, d in ev[p.id]) for p in props}
    cur = current_value(active, project_id, attribute)
    kind = ATTRIBUTES[attribute]["kind"]
    for p in props:
        e = ev[p.id]
        i = info[p.id]
        # representative value while pending: best tier, then most precise, then newest
        if p.status == "pending" and e:
            best = sorted(e, key=lambda r: (r[1].tier, -decimals(r[0].value_num), -(_date(r[1].published_at) or dt.date.min).toordinal()))[0][0]
            if (best.value_num, best.value_text) != (p.value_num, p.value_text):
                audit.log(db, actor, "proposal_updated", p.id, {"value_from": label(attribute, p.value_num, p.value_text, p.qualifier),
                                                                 "value_to": label(attribute, best.value_num, best.value_text, best.qualifier),
                                                                 "reason": "a better-ranked or more precise source agrees"})
                p.value_num, p.value_text = best.value_num, best.value_text
                p.value_key = value_key(attribute, best.value_num, best.value_text)
            p.qualifier = best.qualifier
            p.temporal = next((c.temporal for c, d in sorted(e, key=lambda r: r[1].published_at or "", reverse=True) if c.temporal), None)
        flags: list[dict] = []
        dated = [(c, d) for c, d in e if d.published_at]
        if any(not d.published_at for c, d in e):
            flags.append({"code": "undated_source", "detail": "a source has no machine-readable publish date; it does not count towards corroboration"})
        stale = [d for c, d in dated if (today - _date(d.published_at)).days > max_age_days]
        if stale:
            flags.append({"code": "stale_source", "detail": f"{len(stale)} source(s) older than {max_age_days} days; not counted"})
        if e and all(d.tier == 3 for c, d in e):
            flags.append({"code": "tier3_only", "detail": "only aggregator / other sources; never enough on their own"})
        if i["llm_only"]:
            flags.append({"code": "llm_only", "detail": "extracted by the optional LLM extractor only; needs 2 independent sources"})
        if e and all(c.attribution in ("article", "previous_sentence") for c, d in e):
            flags.append({"code": "attribution_by_context", "detail": "no quote names the project in the same sentence; check the article is about it"})
        if any("year not stated" in (c.note or "") for c, d in e):
            flags.append({"code": "year_resolved", "detail": next(c.note for c, d in e if "year not stated" in (c.note or ""))})
        if any(c.cites_other for c, d in e):
            flags.append({"code": "cites_other_report", "detail": "a source repeats another report; it is not counted as independent"})
        if any(d.published_from == "retrieved" for c, d in e):
            flags.append({"code": "official_page_undated", "detail": "an official page with no date: its value is what the page showed when retrieved; official pages can be out of date"})
        if kind == "month" and p.value_text and len(p.value_text) == 7 and p.temporal == "planned" and p.value_text < today.strftime("%Y-%m"):
            flags.append({"code": "planned_date_passed", "detail": f"planned for {label(attribute, None, p.value_text)}, which has passed — verify what happened"})
        conflicts: list[dict] = []
        for o in props:
            if o.id == p.id or o.status not in COMPETING or not ev[o.id]:
                continue
            conflicts.append({"kind": "source_disagreement", "proposal_id": o.id, "value": label(attribute, o.value_num, o.value_text, o.qualifier),
                              "status": o.status, "newest_evidence_at": newest[o.id],
                              "detail": f"{len(ev[o.id])} quote(s) say {label(attribute, o.value_num, o.value_text, o.qualifier)}"})
            if newest[o.id] and newest[p.id] and newest[o.id] > newest[p.id]:
                if not any(f["code"] == "newer_competitor" for f in flags):
                    flags.append({"code": "newer_competitor", "detail": f"a competing value has newer evidence ({newest[o.id][:10]})"})
            if has_official[p.id] and not has_official[o.id] and newest[o.id] and (newest[p.id] or "") < newest[o.id]:
                flags.append({"code": "official_may_be_outdated", "detail": "newer press reports disagree with the official page; the page may not have been updated"})
            if has_official[o.id] and not has_official[p.id]:
                flags.append({"code": "official_disagrees", "detail": f"an official source says {label(attribute, o.value_num, o.value_text, o.qualifier)}"})
        if cur and cur.get("proposal_id") != p.id:
            same = agree(attribute, cur.get("value_num"), cur.get("value_text"), cur.get("qualifier", "exact"), p.value_num, p.value_text, p.qualifier)
            if not same:
                conflicts.append({"kind": "dataset_value", "value": cur.get("label"), "proposal_id": cur.get("proposal_id"),
                                  "detail": f"the dataset currently says {cur.get('label')}"})
        if p.decided_at and any(c.created_at and c.created_at > p.decided_at for c, d in e):
            flags.append({"code": "new_evidence_since_decision", "detail": "new quotes arrived after the decision"})
        uniq: dict[str, dict] = {}
        for f in flags:
            uniq.setdefault(f["code"], f)
        flags = list(uniq.values())
        verdict = "conflict" if any(x["kind"] == "source_disagreement" for x in conflicts) else ("corroborated" if i["corroborated"] else "needs_corroboration")
        p.verdict = verdict
        p.official_sources = i["official"]
        p.independent_sources = i["independent_sources"]
        p.evidence_count = len(e)
        p.flags_json = json.dumps(flags, ensure_ascii=False)
        p.conflicts_json = json.dumps(conflicts, ensure_ascii=False)
        p.current_value_json = json.dumps(cur, ensure_ascii=False) if cur else None
        p.newest_evidence_at = newest[p.id]
    db.flush()


def evaluate_all(db: Session, active: dict, max_age_days: int, today: dt.date | None = None) -> int:
    groups = {(p.project_id, p.attribute) for p in db.scalars(select(FuProposalEntity))}
    for pid, attr in sorted(groups):
        evaluate_group(db, pid, attr, active, max_age_days, today)
    return len(groups)


def is_corroborated(p: FuProposalEntity) -> bool:
    return p.verdict == "corroborated"


def proposal_dict(db: Session, p: FuProposalEntity, cfg: dict | None = None, with_evidence: bool = True) -> dict:
    from .config import project as project_of
    proj = project_of(cfg, p.project_id) if cfg else None
    out = {"id": p.id, "project_id": p.project_id, "project_name": proj["name"] if proj else p.project_id,
           "attribute": p.attribute, "attribute_label": ATTRIBUTES.get(p.attribute, {}).get("label", p.attribute),
           "value_num": p.value_num, "value_text": p.value_text, "unit": p.unit, "qualifier": p.qualifier,
           "temporal": p.temporal, "label": label(p.attribute, p.value_num, p.value_text, p.qualifier),
           "status": p.status, "verdict": p.verdict, "independent_sources": p.independent_sources,
           "official_sources": p.official_sources, "evidence_count": p.evidence_count,
           "flags": json.loads(p.flags_json or "[]"), "conflicts": json.loads(p.conflicts_json or "[]"),
           "current_value": json.loads(p.current_value_json) if p.current_value_json else None,
           "newest_evidence_at": p.newest_evidence_at, "decided_by": p.decided_by,
           "decided_at": p.decided_at.isoformat() + "Z" if p.decided_at else None, "decision_note": p.decision_note,
           "applied_version_id": p.applied_version_id,
           "created_at": p.created_at.isoformat() + "Z" if p.created_at else None}
    if with_evidence:
        ev = _evidence(db, p.id)
        ev.sort(key=lambda r: (r[1].tier, -(_date(r[1].published_at) or dt.date.min).toordinal()))
        out["evidence"] = [evidence_dict(c, d) for c, d in ev]
    return out


def evidence_dict(c: FuClaimEntity, d: FuDocumentEntity) -> dict:
    return {"claim_id": c.id, "quote": c.quote, "quote_sha256": c.quote_sha256, "attribution": c.attribution,
            "extractor": c.extractor, "cites_other": bool(c.cites_other), "note": c.note,
            "value": label(c.attribute, c.value_num, c.value_text, c.qualifier), "temporal": c.temporal,
            "document_id": d.id, "url": d.final_url or d.url, "domain": d.domain, "publisher": d.publisher, "tier": d.tier,
            "title": d.title, "published_at": d.published_at, "published_from": d.published_from,
            "retrieved_at": d.retrieved_at.isoformat() + "Z" if d.retrieved_at else None, "sha256": d.sha256,
            "manual": bool(d.manual)}


def groups_by_status(db: Session) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for p in db.scalars(select(FuProposalEntity)):
        out[p.status] += 1
    return dict(out)
