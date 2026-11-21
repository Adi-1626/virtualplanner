"""
Claims → proposals, and each proposal's verdict (DATA_FRESHNESS_RESEARCH.md §4 and §11).

Official sources only (user rule 2026-11-21; updater.official). A claim whose page is not on the official allow-list
never creates or joins a proposal, and a proposal with any non-official evidence (only possible in a database written
before the rule) is REJECTED by the system and can never be approved or applied.

Grouping: a claim joins an existing proposal of the same (project, attribute) whose value it AGREES with, else it opens
a new pending proposal. Agreement: equal after unit normalisation, compared at the precision of the less precise value
(5.463 km ≈ 5.46 km; 2,954.53 ≠ 2,954.75), or within ±5 % when either side is hedged ("about", "around"); months and
ranges must be identical.

Confidence (the only three levels):
  official              stated by the responsible agency or Parliament, and no other official value competes
  official_conflicting  two official sources disagree; both values are shown, a reviewer decides with a note
  slipped               an official planned date that has passed and was replaced by a later official date
News, however many outlets repeat it, never counts.
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
from .official import is_official_url, official_domain

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


SYSTEM_ACTOR = "system (official-only rule)"
NOT_OFFICIAL_NOTE = ("rejected by the official-only rule (2026-11-21): its evidence is not from an official source "
                     "(government or agency site); it cannot be approved or applied")


def doc_is_official(d: FuDocumentEntity) -> bool:
    """Decided again from the stored URLs by code; the stored tier is not trusted (older rows were tiered by config)."""
    return is_official_url(d.url) and is_official_url(d.final_url or d.url)


def evidence_is_official(evidence: list[tuple[FuClaimEntity, FuDocumentEntity]]) -> bool:
    return bool(evidence) and all(doc_is_official(d) for c, d in evidence)


def assign(db: Session, actor: str = "updater") -> list[str]:
    """Attach every unassigned claim from an OFFICIAL page to a proposal. Returns ids of proposals created. A claim from
    any other page (only possible in an old database) is left unassigned and never becomes a proposal."""
    created: list[str] = []
    rows = db.execute(select(FuClaimEntity, FuDocumentEntity).join(FuDocumentEntity, FuDocumentEntity.id == FuClaimEntity.document_id)
                      .where(FuClaimEntity.proposal_id.is_(None))).all()
    rows = [r for r in rows if doc_is_official(r[1])]
    rows.sort(key=lambda r: (-(_date(r[1].published_at) or dt.date.min).toordinal(), r[0].id))
    for c, doc in rows:
        props = [p for p in db.scalars(select(FuProposalEntity).where(FuProposalEntity.project_id == c.project_id,
                                                                       FuProposalEntity.attribute == c.attribute))
                 if not any(not doc_is_official(d) for c2, d in _evidence(db, p.id))]   # never join a pre-rule proposal
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


def corroboration(evidence: list[tuple[FuClaimEntity, FuDocumentEntity]], today: dt.date, max_age_days: int) -> dict:  # noqa: ARG001
    """How many OFFICIAL domains state this value. Only official pages count; there is no press route any more.
    (today / max_age_days are kept for the callers: an old official source still counts, and is flagged.)"""
    official_rows = [(c, d) for c, d in evidence if doc_is_official(d)]
    domains = sorted({official_domain(d.final_url or d.url) for c, d in official_rows if not c.extractor.startswith("llm:")})
    llm_only = bool(official_rows) and all(c.extractor.startswith("llm:") for c, d in official_rows)
    all_official = evidence_is_official(evidence)
    return {"official": len(domains), "official_domains": domains, "counting": len(official_rows),
            "all_official": all_official, "llm_only": llm_only,
            "corroborated": all_official and (len(domains) >= 1 or llm_only),
            "independent_sources": len(domains)}


def evaluate_group(db: Session, project_id: str, attribute: str, active: dict, max_age_days: int,
                   today: dt.date | None = None, actor: str = "updater") -> None:
    today = today or dt.date.today()
    # durable figures (length, cost, depth, counts) stay current for 5 years; plans and status go stale sooner
    max_age_days = int(ATTRIBUTES[attribute].get("max_age_days", max_age_days))
    props = list(db.scalars(select(FuProposalEntity).where(FuProposalEntity.project_id == project_id,
                                                            FuProposalEntity.attribute == attribute)))
    ev = {p.id: _evidence(db, p.id) for p in props}
    info = {p.id: corroboration(ev[p.id], today, max_age_days) for p in props}
    # official-only rule: a proposal resting on anything but official pages is rejected by the system, whatever its
    # status, and leaves the competition (it can never be approved or applied)
    for p in props:
        if not info[p.id]["all_official"] and p.status != "rejected":
            before = p.status
            p.status, p.decided_by, p.decided_at, p.decision_note = "rejected", SYSTEM_ACTOR, _now(), NOT_OFFICIAL_NOTE
            audit.log(db, SYSTEM_ACTOR, "reject", p.id, {"value": label(attribute, p.value_num, p.value_text, p.qualifier),
                                                         "from_status": before, "reason": "not_official"})
    newest = {p.id: max([d.published_at for c, d in ev[p.id] if d.published_at] or [None], key=lambda x: x or "") for p in props}
    cur = current_value(active, project_id, attribute)
    kind = ATTRIBUTES[attribute]["kind"]
    live = [p for p in props if info[p.id]["all_official"]]
    slipped_by = slips(live, ev, newest, kind, today)
    for p in props:
        e = ev[p.id]
        i = info[p.id]
        if not i["all_official"]:
            p.verdict, p.confidence = "not_official", "not_official"
            p.official_sources, p.independent_sources, p.evidence_count = i["official"], i["independent_sources"], len(e)
            p.flags_json = json.dumps([{"code": "not_official", "detail": NOT_OFFICIAL_NOTE}], ensure_ascii=False)
            p.conflicts_json = "[]"
            p.current_value_json = json.dumps(cur, ensure_ascii=False) if cur else None
            p.newest_evidence_at = newest[p.id]
            continue
        # representative value while pending: most precise, then newest (every source is official)
        if p.status == "pending" and e:
            best = sorted(e, key=lambda r: (-decimals(r[0].value_num), -(_date(r[1].published_at) or dt.date.min).toordinal()))[0][0]
            if (best.value_num, best.value_text) != (p.value_num, p.value_text):
                audit.log(db, actor, "proposal_updated", p.id, {"value_from": label(attribute, p.value_num, p.value_text, p.qualifier),
                                                                 "value_to": label(attribute, best.value_num, best.value_text, best.qualifier),
                                                                 "reason": "a more precise or newer official source agrees"})
                p.value_num, p.value_text = best.value_num, best.value_text
                p.value_key = value_key(attribute, best.value_num, best.value_text)
            p.qualifier = best.qualifier
            p.temporal = next((c.temporal for c, d in sorted(e, key=lambda r: r[1].published_at or "", reverse=True) if c.temporal), None)
        flags: list[dict] = []
        dated = [(c, d) for c, d in e if d.published_at]
        stale = [d for c, d in dated if (today - _date(d.published_at)).days > max_age_days]
        if stale:
            flags.append({"code": "stale_source", "detail": f"{len(stale)} official source(s) older than {max_age_days} days; "
                                                            "check the agency has not changed it since"})
        if i["llm_only"]:
            flags.append({"code": "llm_only", "detail": "extracted by the optional LLM extractor only (from an official page); "
                                                        "approving it needs a note saying the quote was checked"})
        if e and all(c.attribution in ("article", "previous_sentence") for c, d in e):
            flags.append({"code": "attribution_by_context", "detail": "no quote names the project in the same sentence; check the page is about it"})
        if any("year not stated" in (c.note or "") for c, d in e):
            flags.append({"code": "year_resolved", "detail": next(c.note for c, d in e if "year not stated" in (c.note or ""))})
        if any(d.published_from == "retrieved" for c, d in e):
            flags.append({"code": "official_page_undated", "detail": "an official page with no date: its value is what the page showed when retrieved; official pages can be out of date"})
        if kind == "month" and p.value_text and len(p.value_text) == 7 and p.temporal == "planned" and p.value_text < today.strftime("%Y-%m"):
            flags.append({"code": "planned_date_passed", "detail": f"planned for {label(attribute, None, p.value_text)}, which has passed — verify what happened"})
        conflicts: list[dict] = []
        if p.id in slipped_by:
            o = next(x for x in props if x.id == slipped_by[p.id])
            flags.append({"code": "slipped", "detail": f"planned for {label(attribute, p.value_num, p.value_text)}, which has passed; "
                                                       f"newer official sources ({(newest[o.id] or '')[:10]}) give {label(attribute, o.value_num, o.value_text)}"})
        for o in live:
            if o.id == p.id or o.status not in COMPETING or not ev[o.id]:
                continue
            if slipped_by.get(o.id) == p.id or slipped_by.get(p.id) == o.id:
                continue          # a slipped earlier plan is history, not a disagreement
            conflicts.append({"kind": "source_disagreement", "proposal_id": o.id, "value": label(attribute, o.value_num, o.value_text, o.qualifier),
                              "status": o.status, "newest_evidence_at": newest[o.id],
                              "detail": f"{len(ev[o.id])} official quote(s) say {label(attribute, o.value_num, o.value_text, o.qualifier)}"})
            if newest[o.id] and newest[p.id] and newest[o.id] > newest[p.id]:
                if not any(f["code"] == "newer_competitor" for f in flags):
                    flags.append({"code": "newer_competitor", "detail": f"a competing official value has newer evidence ({newest[o.id][:10]})"})
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
        disagree = any(x["kind"] == "source_disagreement" for x in conflicts)
        p.verdict = "conflict" if disagree else "official"
        if p.id in slipped_by:
            p.confidence = "slipped"
        elif disagree:
            p.confidence = "official_conflicting"
        else:
            p.confidence = "official"
        p.official_sources = i["official"]
        p.independent_sources = i["independent_sources"]
        p.evidence_count = len(e)
        p.flags_json = json.dumps(flags, ensure_ascii=False)
        p.conflicts_json = json.dumps(conflicts, ensure_ascii=False)
        p.current_value_json = json.dumps(cur, ensure_ascii=False) if cur else None
        p.newest_evidence_at = newest[p.id]
    db.flush()


def _now():
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def slips(props, ev, newest, kind: str, today: dt.date) -> dict[str, str]:
    """{earlier proposal id: later proposal id} for planned dates that SLIPPED: the earlier value is a planned month that
    has already passed, every one of its sources is older than the newest source of a later planned value. A planned
    date that has not passed yet and disagrees is a conflict, not a slip (e.g. a completion target of Feb 2029 vs Dec
    2030: both are still in the future, so the sources disagree)."""
    out: dict[str, str] = {}
    if kind != "month":
        return out
    now_m = today.strftime("%Y-%m")
    for a in props:
        if not (a.value_text and len(a.value_text) == 7 and a.value_text < now_m and ev[a.id]):
            continue
        for b in props:
            if b.id == a.id or not (b.value_text and b.value_text > a.value_text and ev[b.id] and newest[b.id] and newest[a.id]):
                continue
            if b.status not in COMPETING:
                continue
            if newest[b.id] > newest[a.id] and b.temporal == "planned":
                out[a.id] = b.id
                break
    return out


def evaluate_all(db: Session, active: dict, max_age_days: int, today: dt.date | None = None) -> int:
    groups = {(p.project_id, p.attribute) for p in db.scalars(select(FuProposalEntity))}
    for pid, attr in sorted(groups):
        evaluate_group(db, pid, attr, active, max_age_days, today)
    return len(groups)


def is_official(p: FuProposalEntity) -> bool:
    return p.verdict in ("official", "conflict") and p.confidence != "not_official"


def proposal_dict(db: Session, p: FuProposalEntity, cfg: dict | None = None, with_evidence: bool = True) -> dict:
    from .config import project as project_of
    proj = project_of(cfg, p.project_id) if cfg else None
    out = {"id": p.id, "project_id": p.project_id, "project_name": proj["name"] if proj else p.project_id,
           "attribute": p.attribute, "attribute_label": ATTRIBUTES.get(p.attribute, {}).get("label", p.attribute),
           "value_num": p.value_num, "value_text": p.value_text, "unit": p.unit, "qualifier": p.qualifier,
           "temporal": p.temporal, "label": label(p.attribute, p.value_num, p.value_text, p.qualifier),
           "status": p.status, "verdict": p.verdict, "confidence": p.confidence, "independent_sources": p.independent_sources,
           "official_sources": p.official_sources, "evidence_count": p.evidence_count,
           "flags": json.loads(p.flags_json or "[]"), "conflicts": json.loads(p.conflicts_json or "[]"),
           "current_value": json.loads(p.current_value_json) if p.current_value_json else None,
           "newest_evidence_at": p.newest_evidence_at, "decided_by": p.decided_by,
           "decided_at": p.decided_at.isoformat() + "Z" if p.decided_at else None, "decision_note": p.decision_note,
           "applied_version_id": p.applied_version_id,
           "created_at": p.created_at.isoformat() + "Z" if p.created_at else None}
    if with_evidence:
        ev = _evidence(db, p.id)
        ev.sort(key=lambda r: -(_date(r[1].published_at) or dt.date.min).toordinal())
        out["evidence"] = [evidence_dict(c, d) for c, d in ev]
    return out


def evidence_dict(c: FuClaimEntity, d: FuDocumentEntity) -> dict:
    return {"claim_id": c.id, "quote": c.quote, "quote_sha256": c.quote_sha256, "attribution": c.attribution,
            "extractor": c.extractor, "cites_other": bool(c.cites_other), "note": c.note,
            "value": label(c.attribute, c.value_num, c.value_text, c.qualifier), "temporal": c.temporal,
            "document_id": d.id, "url": d.final_url or d.url, "domain": d.domain, "publisher": d.publisher,
            "tier": 1 if doc_is_official(d) else 3, "official": doc_is_official(d),
            "title": d.title, "published_at": d.published_at, "published_from": d.published_from,
            "retrieved_at": d.retrieved_at.isoformat() + "Z" if d.retrieved_at else None, "sha256": d.sha256,
            "manual": bool(d.manual)}


def groups_by_status(db: Session) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for p in db.scalars(select(FuProposalEntity)):
        out[p.status] += 1
    return dict(out)
