"""
Human decisions (DATA_FRESHNESS_RESEARCH.md §4.5). The service itself never calls these; only a reviewer does, through
the API (Data catalogue → Fact updates) or the CLI.

  approve   pending → approved. Needs a reviewer name. A proposal that is not corroborated, or conflicts with another
            source, can be approved only with a note saying why. Competing proposals for the same attribute become
            `superseded`. Approving does NOT change the dataset.
  reject    pending / approved → rejected (reviewer name needed).
  apply     every approved proposal → ONE new immutable registry version of `pune_infra_project_facts` (previous facts +
            the approved values), activated through `registry.review_version` (or left pending_review for a second
            reviewer when activate=False).
  rollback  re-activate an earlier version through `registry.review_version`; proposals follow the active facts.
"""
from __future__ import annotations

import datetime as dt
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from datasets import registry
from datasets.models import DsDatasetVersionEntity

from . import audit, facts as facts_mod
from .extract import ATTRIBUTES, label
from .models import FuProposalEntity
from .proposals import _evidence, evaluate_group, evidence_dict


class ReviewError(ValueError):
    pass


def _now():
    return dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)


def _get(db: Session, pid: str) -> FuProposalEntity:
    p = db.get(FuProposalEntity, pid)
    if p is None:
        raise KeyError(pid)
    return p


def _need_reviewer(reviewer: str | None) -> str:
    r = (reviewer or "").strip()
    if not r:
        raise ReviewError("a reviewer name is required")
    return r


def approve(db: Session, pid: str, reviewer: str, note: str = "", max_age_days: int = 400) -> FuProposalEntity:
    reviewer = _need_reviewer(reviewer)
    p = _get(db, pid)
    if p.status not in ("pending", "rejected", "rolled_back", "superseded"):
        raise ReviewError(f"proposal is {p.status}; only pending, rejected, superseded or rolled-back proposals can be approved")
    evaluate_group(db, p.project_id, p.attribute, facts_mod.read_active(db), max_age_days)
    if p.confidence not in ("official", "corroborated") and not (note or "").strip():
        raise ReviewError(f"this proposal is '{p.confidence.replace('_', ' ')}': approving it needs a note saying why "
                          "(e.g. checked with the authority)")
    if not _evidence(db, p.id):
        raise ReviewError("a proposal without evidence cannot be approved")
    others = []
    for o in db.scalars(select(FuProposalEntity).where(FuProposalEntity.project_id == p.project_id,
                                                        FuProposalEntity.attribute == p.attribute, FuProposalEntity.id != p.id)):
        if o.status in ("pending", "approved"):
            o.status, o.decided_by, o.decided_at = "superseded", reviewer, _now()
            o.decision_note = f"another value was approved ({label(p.attribute, p.value_num, p.value_text, p.qualifier)}, {p.id})"
            others.append(o.id)
    # a rolled-back / superseded proposal approved again goes back into the apply queue (apply_approved only takes
    # approved proposals with no version); its earlier version stays in the registry and the audit log
    p.applied_version_id = None
    p.status, p.decided_by, p.decided_at, p.decision_note = "approved", reviewer, _now(), note or None
    audit.log(db, reviewer, "approve", p.id, {"value": label(p.attribute, p.value_num, p.value_text, p.qualifier),
                                              "verdict": p.verdict, "note": note, "superseded": others})
    db.flush()
    return p


def reject(db: Session, pid: str, reviewer: str, note: str = "") -> FuProposalEntity:
    reviewer = _need_reviewer(reviewer)
    p = _get(db, pid)
    if p.status not in ("pending", "approved", "superseded", "rolled_back"):
        raise ReviewError(f"proposal is {p.status}; it cannot be rejected")
    p.status, p.decided_by, p.decided_at, p.decision_note = "rejected", reviewer, _now(), note or None
    audit.log(db, reviewer, "reject", p.id, {"value": label(p.attribute, p.value_num, p.value_text, p.qualifier), "note": note})
    db.flush()
    return p


def fact_entry(db: Session, p: FuProposalEntity, cfg: dict | None) -> dict:
    from .config import project as project_of
    proj = project_of(cfg, p.project_id) if cfg else None
    ev = [evidence_dict(c, d) for c, d in _evidence(db, p.id)]
    ev.sort(key=lambda e: (e["tier"], e["published_at"] or ""))
    return {"project_id": p.project_id, "project_name": proj["name"] if proj else p.project_id,
            "project_kind": proj.get("kind") if proj else None,
            "osm_name_patterns": proj.get("osm_name_patterns", []) if proj else [],
            "attribute": p.attribute, "attribute_label": ATTRIBUTES[p.attribute]["label"],
            "value_num": p.value_num, "value_text": p.value_text, "unit": p.unit, "qualifier": p.qualifier,
            "temporal": p.temporal, "label": label(p.attribute, p.value_num, p.value_text, p.qualifier),
            "verdict_at_approval": p.verdict, "confidence": p.confidence, "independent_sources": p.independent_sources,
            "official_sources": p.official_sources, "flags": json.loads(p.flags_json or "[]"),
            "proposal_id": p.id, "approved_by": p.decided_by,
            "approved_at": p.decided_at.isoformat() + "Z" if p.decided_at else None, "approval_note": p.decision_note,
            "certainty": "reported", "suitability": "screening",
            "evidence": [{k: e[k] for k in ("url", "publisher", "domain", "tier", "title", "published_at", "quote",
                                            "retrieved_at", "sha256", "attribution", "extractor")} for e in ev]}


def apply_approved(db: Session, reviewer: str, note: str = "", activate: bool = True, cfg: dict | None = None) -> DsDatasetVersionEntity:
    reviewer = _need_reviewer(reviewer)
    approved = list(db.scalars(select(FuProposalEntity).where(FuProposalEntity.status == "approved",
                                                              FuProposalEntity.applied_version_id.is_(None))
                               .order_by(FuProposalEntity.project_id, FuProposalEntity.attribute)))
    if not approved:
        raise ReviewError("nothing to apply: no approved proposal")
    keys = {(p.project_id, p.attribute) for p in approved}
    if len(keys) != len(approved):
        raise ReviewError("two approved proposals for the same project and attribute; reject one first")
    active = facts_mod.read_active(db)
    if active["sha256_ok"] is False:
        raise ReviewError(f"the active facts version cannot be read safely ({active['error']}); fix that before applying")
    kept = [f for f in active["facts"] if (f["project_id"], f["attribute"]) not in keys]
    new = [fact_entry(db, p, cfg) for p in approved]
    allf = sorted(kept + new, key=lambda f: (f["project_id"], f["attribute"]))
    evidence = [{"url": e["url"], "sha256": e["sha256"], "proposal_id": f["proposal_id"]} for f in new for e in f["evidence"]]
    v = facts_mod.register_version(db, allf, reviewer=reviewer, note=note or f"{len(new)} fact(s) applied by {reviewer}",
                                   proposal_ids=[p.id for p in approved], evidence=evidence, activate=activate)
    replaced = []
    for f in active["facts"]:
        if (f["project_id"], f["attribute"]) in keys:
            old = db.get(FuProposalEntity, f["proposal_id"]) if f.get("proposal_id") else None   # seed facts have none
            if old is not None and old.status == "applied":
                old.status, old.decision_note = "superseded", f"replaced in {v.version_label} by a newer approved value"
                replaced.append(old.id)
    for p in approved:
        p.status, p.applied_version_id = ("applied" if activate else "approved"), v.id
    audit.log(db, reviewer, "apply", v.id, {"version_label": v.version_label, "activated": activate,
                                            "proposal_ids": [p.id for p in approved], "replaced": replaced,
                                            "facts": len(allf), "sha256": v.sha256})
    db.flush()
    return v


def activate_pending(db: Session, version_id: str, reviewer: str, note: str = "") -> DsDatasetVersionEntity:
    """Four-eyes mode: a second reviewer activates a version left pending by apply(activate=False)."""
    reviewer = _need_reviewer(reviewer)
    v = db.get(DsDatasetVersionEntity, version_id)
    if v is None or v.dataset_id != facts_mod.DATASET_ID:
        raise KeyError(version_id)
    registry.review_version(db, version_id, "activate", reviewer, note)
    sync_statuses(db, reviewer)
    audit.log(db, reviewer, "activate", version_id, {"version_label": v.version_label, "note": note})
    db.flush()
    return v


def rollback(db: Session, version_id: str, reviewer: str, note: str = "") -> DsDatasetVersionEntity:
    reviewer = _need_reviewer(reviewer)
    v = db.get(DsDatasetVersionEntity, version_id)
    if v is None or v.dataset_id != facts_mod.DATASET_ID:
        raise KeyError(version_id)
    if v.review_status != "superseded":
        raise ReviewError(f"version {v.version_label} is {v.review_status}; only a superseded version can be rolled back to")
    if not facts_mod.read_version(db, v)["sha256_ok"]:
        raise ReviewError("that version's facts file does not match its registered sha256; refusing to activate it")
    before = registry.active_version(db, facts_mod.DATASET_ID)
    registry.review_version(db, version_id, "activate", reviewer, note or f"rollback by {reviewer}")
    changed = sync_statuses(db, reviewer)
    audit.log(db, reviewer, "rollback", version_id, {"to": v.version_label, "from": before.version_label if before else None,
                                                     "note": note, "proposals_changed": changed})
    db.flush()
    return v


def sync_statuses(db: Session, reviewer: str) -> list[str]:
    """Proposal statuses follow the active facts: in the active file → applied; previously applied but not in it →
    rolled_back (can be approved again)."""
    active = facts_mod.read_active(db)
    in_active = {f.get("proposal_id") for f in active["facts"]}
    changed = []
    for p in db.scalars(select(FuProposalEntity).where(FuProposalEntity.status.in_(("applied", "approved", "superseded", "rolled_back")))):
        if p.status == "approved" and not p.applied_version_id:
            continue          # approved, never applied: stays in the queue
        if p.id in in_active and p.status != "applied":
            p.status = "applied"
            changed.append(p.id)
        elif p.id not in in_active and p.status == "applied":
            p.status, p.decision_note = "rolled_back", f"not in the active facts after a rollback by {reviewer}"
            changed.append(p.id)
    db.flush()
    return changed


def versions(db: Session) -> list[dict]:
    out = []
    for v in reversed(registry.versions_of(db, facts_mod.DATASET_ID)):
        out.append({"id": v.id, "version_label": v.version_label, "review_status": v.review_status,
                    "facts": json.loads(v.stats_json or "{}").get("facts"), "sha256": v.sha256,
                    "reviewed_by": v.reviewed_by, "reviewed_at": v.reviewed_at.isoformat() + "Z" if v.reviewed_at else None,
                    "review_note": v.review_note, "notes": v.notes,
                    "created_at": v.created_at.isoformat() + "Z" if v.created_at else None})
    return out
