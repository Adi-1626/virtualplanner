"""
`python -m updater migrate-official-only --reviewer NAME [--dry-run]`: brings an EXISTING database in line with the
official-only rule (2026-11-21). Safe to run on a fresh database and safe to run twice (the second run changes nothing).

  1. Pages that are not official (newspaper articles read before the rule) are deleted from fu_documents, with their
     claims from fu_claims. Their URLs and quote hashes are written to the audit log first, so the deletion is on record.
  2. Every proposal is re-evaluated. One left with no official evidence is rejected by "system (official-only rule)"
     and can never be approved or applied.
  3. The facts dataset gets a NEW registry version when the active one is not already the official-only re-seed:
     the official seed list (docs/urbanos/pune_project_facts.json, dataset_version 2) plus every fact a reviewer applied
     from an official proposal (those win over the seed, being later reviewed decisions). Older versions stay in the
     registry; a version holding non-official facts can no longer be activated (review._refuse_unofficial_version).
  4. The coordination rule `metro_noc_20m` gets the official Maha-Metro public notice as its citation, if it still has
     the original news citation (a citation edited by a user is left alone).

Nothing is fetched from the web.
"""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, facts as facts_mod, seed
from .official import evidence_urls_official, is_official_url
from .models import FuClaimEntity, FuDocumentEntity, FuProposalEntity
from .proposals import SYSTEM_ACTOR, evaluate_all

NOTE_PREFIX = "official-only re-seed"


def _key(f: dict) -> tuple:
    return (f.get("project_id"), f.get("attribute"), f.get("value_num"), f.get("value_text"), f.get("qualifier"),
            tuple(sorted(e.get("url") or "" for e in f.get("evidence") or [])))


def planned_facts(db: Session, cfg: dict) -> tuple[list[dict], dict]:
    """The fact set the migration wants active, and counts."""
    data = seed.load_seed()
    if int((data.get("meta") or {}).get("dataset_version") or 1) < seed.SEED_VERSION:
        raise ValueError(f"the seed file is older than dataset_version {seed.SEED_VERSION} (official-only); update the repo")
    base, counts = seed.baseline_facts(data, cfg)
    raw = facts_mod.read_version(db, facts_mod.registry.active_version(db, facts_mod.DATASET_ID), include_unofficial=True)
    reviewed = []
    for f in raw.get("facts", []):
        if f.get("origin") == "seed" or not f.get("proposal_id"):
            continue
        p = db.get(FuProposalEntity, f["proposal_id"])
        if p is not None and p.status == "applied" and evidence_urls_official(f.get("evidence") or []):
            reviewed.append(f)
    keys = {(f["project_id"], f["attribute"]) for f in reviewed}
    out = sorted([f for f in base if (f["project_id"], f["attribute"]) not in keys] + reviewed,
                 key=lambda f: (f["project_id"], f["attribute"]))
    return out, {"seed": counts, "seed_facts": len(base), "reviewed_facts_kept": len(reviewed),
                 "active_version": raw.get("version_label"), "active_facts": len(raw.get("facts", [])),
                 "active_unofficial_facts": len(raw.get("withheld") or [])}


def migrate(db: Session, cfg: dict, reviewer: str, dry_run: bool = False, max_age_days: int = 400) -> dict:
    reviewer = (reviewer or "").strip()
    if not reviewer:
        raise ValueError("a reviewer name is required")
    report: dict = {"dry_run": dry_run}
    # 1. non-official pages and their claims
    docs = [d for d in db.scalars(select(FuDocumentEntity)) if not (is_official_url(d.url) and is_official_url(d.final_url or d.url))]
    doc_ids = [d.id for d in docs]
    claims = list(db.scalars(select(FuClaimEntity).where(FuClaimEntity.document_id.in_(doc_ids)))) if doc_ids else []
    touched = sorted({c.proposal_id for c in claims if c.proposal_id})
    report["unofficial_pages_deleted"] = len(docs)
    report["unofficial_claims_deleted"] = len(claims)
    report["proposals_touched"] = len(touched)
    if docs:
        audit.log(db, SYSTEM_ACTOR, "purge_unofficial", None, {
            "reviewer": reviewer, "documents": [{"url": d.url, "publisher": d.publisher, "sha256": d.sha256} for d in docs],
            "claims": [{"id": c.id, "proposal_id": c.proposal_id, "quote_sha256": c.quote_sha256} for c in claims]})
        for c in claims:
            db.delete(c)
        for d in docs:
            db.delete(d)
        db.flush()
    # 2. re-evaluate: proposals with no official evidence left are rejected by the system
    before = {p.id: p.status for p in db.scalars(select(FuProposalEntity))}
    evaluate_all(db, facts_mod.read_active(db), max_age_days)
    report["proposals_rejected"] = sorted(p.id for p in db.scalars(select(FuProposalEntity))
                                          if p.status == "rejected" and before.get(p.id) != "rejected")
    # 3. facts: re-seed when the active version is not already the official-only one
    want, counts = planned_facts(db, cfg)
    report["facts"] = counts
    active = facts_mod.registry.active_version(db, facts_mod.DATASET_ID)
    raw = facts_mod.read_version(db, active, include_unofficial=True)
    same = active is not None and raw.get("sha256_ok") and sorted(map(_key, raw["facts"])) == sorted(map(_key, want))
    if same:
        report["facts_version"] = {"action": "none", "version_label": raw["version_label"], "facts": len(want)}
    elif dry_run:
        report["facts_version"] = {"action": "would register a new version", "facts": len(want)}
    else:
        note = (f"{NOTE_PREFIX} (dataset_version {seed.SEED_VERSION}): official seed list + {counts['reviewed_facts_kept']} "
                f"reviewed official fact(s); {counts['active_unofficial_facts']} non-official fact(s) of "
                f"{counts['active_version'] or 'no version'} removed")
        v = facts_mod.register_version(db, want, reviewer=reviewer, note=note, proposal_ids=[f["proposal_id"] for f in want if f.get("proposal_id")],
                                       evidence=[{"url": e["url"], "sha256": e.get("sha256")} for f in want for e in f["evidence"]],
                                       activate=True)
        from .review import sync_statuses
        sync_statuses(db, reviewer)
        evaluate_all(db, facts_mod.read_active(db), max_age_days)
        report["facts_version"] = {"action": "registered", "version_label": v.version_label, "version_id": v.id, "facts": len(want)}
    # 4. coordination rule citation (news -> official notice), only when untouched by a user
    report["noc_rule_citation"] = _fix_noc_citation(db, reviewer)
    audit.log(db, reviewer, "migrate_official_only", None, {k: v for k, v in report.items() if k != "proposals_rejected"}
              | {"proposals_rejected": len(report["proposals_rejected"])})
    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def _fix_noc_citation(db: Session, reviewer: str) -> str:
    try:
        from coordination.models import ClearanceRuleEntity
        from coordination.seed import _S9, _S9_LEGACY
        from planning.audit import acting_as
    except ImportError:
        return "coordination module not available"
    r = db.get(ClearanceRuleEntity, "metro_noc_20m")
    if r is None:
        return "rule not in this database"
    if (r.citation or "") == _S9:
        return "already official"
    if (r.citation or "") != _S9_LEGACY:
        return "left alone (edited by a user)"
    with acting_as(reviewer):
        r.citation = _S9
        db.flush()
    return "replaced with the official Maha-Metro notice"


def summary(report: dict) -> str:
    fv = report["facts_version"]
    return (f"{'DRY RUN — nothing saved. ' if report['dry_run'] else ''}"
            f"deleted {report['unofficial_pages_deleted']} non-official page(s) and {report['unofficial_claims_deleted']} claim(s); "
            f"rejected {len(report['proposals_rejected'])} proposal(s); facts: {fv['action']}"
            f"{' ' + fv.get('version_label', '') if fv.get('version_label') else ''} ({fv['facts']} official facts); "
            f"NOC rule citation: {report['noc_rule_citation']}\n{json.dumps(report['facts'], ensure_ascii=False)}")
