"""
Saved underground screening runs (docs/urbanos/UNDERGROUND_CHECKS.md §2.9): every check from the result panel is stored
(alternative id, inputs hash, timestamp, summary, the whole result compressed) so reopening the alternative shows the last
result, marked stale when the screened objects or the utility records changed since.
"""

from __future__ import annotations

import datetime
import json
import uuid
import zlib
from typing import Optional

from . import screening as S
from .models import UndergroundScreeningRunEntity as RunE
from .service import subsurface_hash

RUNS_KEPT = 20          # newest runs kept per alternative


def _iso(d: Optional[datetime.datetime]) -> Optional[str]:
    return d.replace(microsecond=0).isoformat() + "Z" if d else None


def save(db, run: dict) -> dict:
    """Store a run; returns {run_id, saved_at}. Older runs of the alternative beyond RUNS_KEPT are removed."""
    sm = run["summary"]
    summary = {"counts": sm["counts"], "worst_status": sm["worst_status"], "headline": sm["headline"],
               "proposed_checked": [{k: p.get(k) for k in ("id", "name", "kind_label")} for p in sm["proposed_checked"]],
               "existing_assets_read": sm.get("existing_assets_read")}
    e = RunE(id=f"ugs_{uuid.uuid4().hex[:12]}", scenario_id=run["scenario_id"], inputs_hash=run["inputs_hash"],
             data_hash=subsurface_hash(db), engine_version=run["engine_version"], config_version=run["config_version"],
             objects_count=run.get("objects_count") or 0, findings_count=len(run["findings"]),
             summary_json=json.dumps(summary), result_json_gz=zlib.compress(json.dumps(run, separators=(",", ":")).encode(), 6))
    db.add(e)
    db.flush()
    old = (db.query(RunE.id).filter(RunE.scenario_id == run["scenario_id"]).order_by(RunE.created_at.desc(), RunE.id.desc())
           .offset(RUNS_KEPT).all())
    if old:
        db.query(RunE).filter(RunE.id.in_([o[0] for o in old])).delete(synchronize_session=False)
    db.commit()
    return {"run_id": e.id, "saved_at": _iso(e.created_at)}


def latest(db, scenario_id: str) -> Optional[RunE]:
    return (db.query(RunE).filter(RunE.scenario_id == scenario_id).order_by(RunE.created_at.desc(), RunE.id.desc()).first())


def staleness(db, e: RunE, objects: Optional[list[dict]], config_overrides: Optional[dict] = None) -> dict:
    """Whether a saved run still describes the alternative: objects (sent now, or read from the database when omitted),
    the utility records, and the engine version."""
    objs = objects if objects is not None else S.objects_from_db(db, e.scenario_id)
    reasons = []
    if S.inputs_hash(objs, e.scenario_id, config_overrides) != e.inputs_hash:
        reasons.append("Objects in this alternative changed since this check.")
    if e.data_hash and subsurface_hash(db) != e.data_hash:
        reasons.append("Utility records were imported or changed since this check.")
    if e.engine_version != S.ENGINE:
        reasons.append(f"The screening engine changed since this check ({e.engine_version} → {S.ENGINE}).")
    return {"stale": bool(reasons), "stale_reasons": reasons}


def load(e: RunE) -> dict:
    run = json.loads(zlib.decompress(e.result_json_gz))
    run["run_id"], run["saved_at"] = e.id, _iso(e.created_at)
    return run


def listing(db, scenario_id: str) -> list[dict]:
    return [{"run_id": e.id, "scenario_id": e.scenario_id, "saved_at": _iso(e.created_at), "inputs_hash": e.inputs_hash,
             "engine_version": e.engine_version, "objects_count": e.objects_count, "findings_count": e.findings_count,
             "summary": json.loads(e.summary_json)}
            for e in db.query(RunE).filter(RunE.scenario_id == scenario_id).order_by(RunE.created_at.desc(), RunE.id.desc())]
