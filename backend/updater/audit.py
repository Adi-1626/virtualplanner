"""Hash-chained, append-only audit log (`fu_audit`). Each row's hash covers the previous row's hash, so editing or
deleting any row is detectable with `verify_chain`."""
from __future__ import annotations

import datetime as dt
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import FuAuditEntity

GENESIS = "0" * 64


def _canon(at: str, actor: str, action: str, subject: str | None, detail: dict) -> str:
    return json.dumps({"at": at, "actor": actor, "action": action, "subject": subject, "detail": detail},
                      sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def log(db: Session, actor: str, action: str, subject: str | None = None, detail: dict | None = None) -> FuAuditEntity:
    detail = detail or {}
    last = db.scalars(select(FuAuditEntity).order_by(FuAuditEntity.seq.desc()).limit(1)).first()
    prev = last.hash if last else GENESIS
    at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    h = hashlib.sha256((prev + _canon(at, actor, action, subject, detail)).encode()).hexdigest()
    row = FuAuditEntity(at=at, actor=actor or "unattributed", action=action, subject=subject,
                        detail_json=json.dumps(detail, sort_keys=True, default=str, ensure_ascii=False), prev_hash=prev, hash=h)
    db.add(row)
    db.flush()
    return row


def verify_chain(db: Session) -> dict:
    prev = GENESIS
    n = 0
    for r in db.scalars(select(FuAuditEntity).order_by(FuAuditEntity.seq)):
        try:
            detail = json.loads(r.detail_json or "{}")
        except ValueError:
            return {"ok": False, "rows": n, "broken_at": r.seq, "reason": "detail is not JSON"}
        if r.prev_hash != prev:
            return {"ok": False, "rows": n, "broken_at": r.seq, "reason": "prev_hash does not match the previous row"}
        h = hashlib.sha256((prev + _canon(r.at, r.actor, r.action, r.subject, detail)).encode()).hexdigest()
        if h != r.hash:
            return {"ok": False, "rows": n, "broken_at": r.seq, "reason": "row content does not match its hash"}
        prev = r.hash
        n += 1
    return {"ok": True, "rows": n, "head": prev}


def entries(db: Session, subject: str | None = None, limit: int = 200) -> list[dict]:
    q = select(FuAuditEntity).order_by(FuAuditEntity.seq.desc()).limit(limit)
    if subject:
        q = select(FuAuditEntity).where(FuAuditEntity.subject == subject).order_by(FuAuditEntity.seq.desc()).limit(limit)
    return [{"seq": r.seq, "at": r.at, "actor": r.actor, "action": r.action, "subject": r.subject,
             "detail": json.loads(r.detail_json or "{}"), "hash": r.hash} for r in db.scalars(q)]
