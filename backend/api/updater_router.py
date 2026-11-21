"""
Data-freshness review API (`/api/updater`; docs/urbanos/DATA_FRESHNESS_SERVICE.md).

The fetching service runs separately (`python -m updater run`); this API never fetches the web. It lists what the
service proposed and records human decisions:
  GET  /status                    last runs, proposal counts, active facts version, audit-chain check
  GET  /proposals?status=&project= proposals with their quoted evidence, corroboration, conflicts and flags
  POST /proposals/{id}/approve    {reviewer, note?}   approving does not change the dataset
  POST /proposals/{id}/reject     {reviewer, note?}
  POST /apply                     {reviewer, note?, activate?=true}  approved → new registry version
  POST /versions/{id}/activate    {reviewer, note?}   four-eyes: activate a version left pending by apply
  POST /rollback                  {version_id, reviewer, note?}
  GET  /facts                     the ACTIVE facts (file sha256 verified at read time)
  GET  /versions, /runs, /audit
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from database.connection import get_db
from planning.audit import acting_as
from updater import audit, config as cfgmod, facts as facts_mod, official, review
from updater.models import FuProposalEntity, FuRunEntity
from updater.proposals import evaluate_all, groups_by_status, proposal_dict

router = APIRouter(prefix="/updater", tags=["updater"])


def _cfg() -> dict:
    try:
        return cfgmod.load()
    except (OSError, ValueError) as e:
        raise HTTPException(500, f"watch-list could not be read: {e}") from e


class Decision(BaseModel):
    reviewer: str
    note: Optional[str] = ""


class ApplyBody(BaseModel):
    reviewer: str
    note: Optional[str] = ""
    activate: bool = True


class RollbackBody(BaseModel):
    version_id: str
    reviewer: str
    note: Optional[str] = ""


def _run_dict(r: FuRunEntity) -> dict:
    return {"id": r.id, "mode": r.mode, "started_at": r.started_at.isoformat() + "Z" if r.started_at else None,
            "finished_at": r.finished_at.isoformat() + "Z" if r.finished_at else None,
            "sources": json.loads(r.sources_json or "[]"), "stats": json.loads(r.stats_json or "{}"),
            "errors": json.loads(r.errors_json or "[]"), "watchlist_sha256": r.watchlist_sha256, "git_commit": r.git_commit}


@router.get("/status")
def status(db: Session = Depends(get_db)):
    cfg = _cfg()
    runs = list(db.scalars(select(FuRunEntity).order_by(FuRunEntity.started_at.desc()).limit(5)))
    active = facts_mod.read_active(db)
    return {"proposals": groups_by_status(db), "last_runs": [_run_dict(r) for r in runs],
            "facts": {k: active[k] for k in ("version_id", "version_label", "sha256_ok", "error")}
            | {"count": len(active["facts"]), "withheld": active.get("withheld", [])},
            "audit": audit.verify_chain(db), "watched_projects": len(cfg["projects"]), "official_rule": official.describe(),
            "sources": [{"id": s["id"], "kind": s["kind"], "enabled": s.get("enabled", True), "tier": 1,
                         "publisher": s.get("publisher"), "url": s.get("url"), "note": s.get("note", "")} for s in cfg["sources"]]}


@router.get("/proposals")
def proposals(status: Optional[str] = None, project: Optional[str] = None, db: Session = Depends(get_db)):
    cfg = _cfg()
    q = select(FuProposalEntity)
    if status and status != "all":   # "all" = no filter, as in `python -m updater proposals --status all`
        q = q.where(FuProposalEntity.status.in_(status.split(",")))
    if project:
        q = q.where(FuProposalEntity.project_id == project)
    rows = list(db.scalars(q))
    order = {"pending": 0, "approved": 1, "applied": 2, "rolled_back": 3, "superseded": 4, "rejected": 5}
    rows.sort(key=lambda p: (order.get(p.status, 9), p.project_id, p.attribute, p.id))
    return [proposal_dict(db, p, cfg) for p in rows]


def _decide(fn, pid: str, body: Decision, db: Session):
    cfg = _cfg()
    try:
        with acting_as(body.reviewer):
            p = fn(db, pid, body.reviewer, body.note or "")
            db.commit()
    except KeyError:
        db.rollback()
        raise HTTPException(404, "proposal not found") from None
    except review.ReviewError as e:
        db.rollback()
        raise HTTPException(400, str(e)) from None
    return proposal_dict(db, p, cfg)


@router.post("/proposals/{pid}/approve")
def approve(pid: str, body: Decision, db: Session = Depends(get_db)):
    return _decide(review.approve, pid, body, db)


@router.post("/proposals/{pid}/reject")
def reject(pid: str, body: Decision, db: Session = Depends(get_db)):
    return _decide(review.reject, pid, body, db)


@router.post("/apply")
def apply(body: ApplyBody, db: Session = Depends(get_db)):
    cfg = _cfg()
    try:
        with acting_as(body.reviewer):
            v = review.apply_approved(db, body.reviewer, body.note or "", body.activate, cfg)
            evaluate_all(db, facts_mod.read_active(db), int(cfgmod.setting(cfg, "max_article_age_days", 400)))
            db.commit()
    except (review.ReviewError, ValueError) as e:   # ValueError: facts.UnofficialFactError
        db.rollback()
        raise HTTPException(400, str(e)) from None
    return {"version_id": v.id, "version_label": v.version_label, "review_status": v.review_status, "sha256": v.sha256}


@router.post("/versions/{version_id}/activate")
def activate(version_id: str, body: Decision, db: Session = Depends(get_db)):
    try:
        with acting_as(body.reviewer):
            v = review.activate_pending(db, version_id, body.reviewer, body.note or "")
            db.commit()
    except KeyError:
        db.rollback()
        raise HTTPException(404, "facts version not found") from None
    except (review.ReviewError, ValueError) as e:
        db.rollback()
        raise HTTPException(400, str(e)) from None
    return {"version_id": v.id, "version_label": v.version_label, "review_status": v.review_status}


@router.post("/rollback")
def rollback(body: RollbackBody, db: Session = Depends(get_db)):
    cfg = _cfg()
    try:
        with acting_as(body.reviewer):
            v = review.rollback(db, body.version_id, body.reviewer, body.note or "")
            evaluate_all(db, facts_mod.read_active(db), int(cfgmod.setting(cfg, "max_article_age_days", 400)))
            db.commit()
    except KeyError:
        db.rollback()
        raise HTTPException(404, "facts version not found") from None
    except (review.ReviewError, ValueError) as e:
        db.rollback()
        raise HTTPException(400, str(e)) from None
    return {"version_id": v.id, "version_label": v.version_label, "review_status": v.review_status}


@router.get("/facts")
def facts(project: Optional[str] = None, db: Session = Depends(get_db)):
    out = facts_mod.read_active(db)
    if project:
        out = {**out, "facts": [f for f in out["facts"] if f.get("project_id") == project]}
    return out


@router.get("/versions")
def versions(db: Session = Depends(get_db)):
    return review.versions(db)


@router.get("/runs")
def runs(limit: int = 20, db: Session = Depends(get_db)):
    return [_run_dict(r) for r in db.scalars(select(FuRunEntity).order_by(FuRunEntity.started_at.desc()).limit(max(1, min(limit, 100))))]


@router.get("/audit")
def audit_log(subject: Optional[str] = None, limit: int = 200, db: Session = Depends(get_db)):
    return {"chain": audit.verify_chain(db), "entries": audit.entries(db, subject, max(1, min(limit, 1000)))}
