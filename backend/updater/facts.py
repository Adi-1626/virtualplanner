"""
The facts dataset `pune_infra_project_facts` in the dataset registry.

Every applied change is a NEW immutable registry version:
  <data dir>/derived/pune_infra_project_facts/<label>/facts.json       the complete fact set (sorted, UTF-8)
  <data dir>/derived/pune_infra_project_facts/<label>/provenance.json  lineage (previous version, proposals, evidence)
(provenance.json, not processing.json, so `datasets.importer` does not register the directory a second time; the
registry row and its ds_processing_runs row are written here.)

The app reads facts ONLY from the active version and checks the file's sha256 against the registry at read time.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess

from sqlalchemy.orm import Session

from datasets import paths, quality, registry
from datasets.models import DsDatasetVersionEntity, DsFileEntity, DsProcessingRunEntity
from datasets.vocab import data_root

DATASET_ID = "pune_infra_project_facts"
SOURCE_ID = "updater_published_facts"
LICENCE = ("Internal use. Each fact links to and attributes its publishers; quoted sentences are short excerpts kept "
           "for verification, not republication (DATA_FRESHNESS_RESEARCH.md §2.2).")
LIMITATIONS = ("Published figures (authority statements and press reports) reviewed by a named person before use. "
               "Not surveyed, not engineering levels: screening context only. Sources can be wrong or out of date.")


def git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=os.path.dirname(os.path.abspath(__file__)),
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def ensure_registered(db: Session) -> None:
    registry.ensure_source(db, SOURCE_ID, name="Published infrastructure facts (data-freshness service)",
                           publisher="Various — see each fact's evidence", url="", access_method="api",
                           licence_text=LICENCE, official=False, origin="api",
                           notes="Facts proposed by `python -m updater` from official pages, publisher feeds and GDELT; "
                                 "each one approved by a reviewer.",
                           robots_notes="robots.txt honoured for every host (RFC 9309); see DATA_FRESHNESS_SERVICE.md")
    registry.ensure_dataset(db, DATASET_ID, title="Pune infrastructure project facts (published, reviewed)",
                            description="Tunnel depths, lengths, station counts, costs, TBM counts, tunnelling start and "
                                        "completion targets and status of watched Pune projects, each with its quoted "
                                        "source sentences. Written only by the data-freshness review flow.",
                            theme="project_facts", source_id=SOURCE_ID, limitations=LIMITATIONS, max_age_days=30,
                            origin="api")


def _rel(path: str) -> str:
    root = os.path.realpath(data_root())
    rp = os.path.realpath(path)
    return os.path.relpath(rp, root).replace(os.sep, "/") if rp.startswith(root.rstrip(os.sep) + os.sep) else rp


def _write_version_files(label: str, facts: list[dict], provenance: dict) -> tuple[str, str, int]:
    d = paths.derived_dir() / DATASET_ID / label
    if d.exists() and any(d.iterdir()):
        raise FileExistsError(f"{d} already exists: versions are immutable")
    d.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"dataset": DATASET_ID, "version_label": label, "facts": facts}, indent=2, sort_keys=True,
                      ensure_ascii=False).encode("utf-8")
    fp = d / "facts.json"
    fp.write_bytes(body)
    (d / "provenance.json").write_text(json.dumps(provenance, indent=2, sort_keys=True, ensure_ascii=False, default=str), encoding="utf-8")
    return str(fp), quality.sha256_file(str(fp)), len(body)


def facts_file(db: Session, v: DsDatasetVersionEntity) -> DsFileEntity | None:
    from sqlalchemy import select
    return db.scalars(select(DsFileEntity).where(DsFileEntity.version_id == v.id, DsFileEntity.role == "derived")).first()


def register_version(db: Session, facts: list[dict], *, reviewer: str, note: str, proposal_ids: list[str],
                     evidence: list[dict], activate: bool) -> DsDatasetVersionEntity:
    """Writes the files and registers them as a new version (pending_review), then activates it through
    registry.review_version when `activate`. The first ever version is an empty baseline (activated by the registry as
    the dataset's first version), so every real fact arrives in a reviewed version."""
    ensure_registered(db)
    now = dt.datetime.now(dt.timezone.utc)
    if not registry.versions_of(db, DATASET_ID):
        _add(db, "v1", [], note="Empty baseline: the dataset before any fact was applied.", proposal_ids=[], evidence=[],
             prev=None, now=now, reviewer="system")
    prev = registry.active_version(db, DATASET_ID)
    label = f"v{len(registry.versions_of(db, DATASET_ID)) + 1}"
    v = _add(db, label, facts, note=note, proposal_ids=proposal_ids, evidence=evidence, prev=prev, now=now, reviewer=reviewer)
    if activate:
        registry.review_version(db, v.id, "activate", reviewer, note or f"applied {len(proposal_ids)} approved proposal(s)")
    return v


def _add(db: Session, label: str, facts: list[dict], *, note: str, proposal_ids: list[str], evidence: list[dict],
         prev: DsDatasetVersionEntity | None, now: dt.datetime, reviewer: str) -> DsDatasetVersionEntity:
    commit = git_commit()
    prov = {"pipeline": "updater.review.apply_approved", "git_commit": commit, "created_at": now.isoformat(),
            "reviewer": reviewer, "note": note, "previous_version_id": prev.id if prev else None,
            "proposal_ids": proposal_ids, "evidence": evidence, "fact_count": len(facts)}
    path, sha, size = _write_version_files(label, facts, prov)
    v = registry.add_version(
        db, DATASET_ID, version_label=label, retrieved_at=now.isoformat(), published_date=now.date().isoformat(),
        sha256=sha, size_bytes=size, format="JSON", crs="n/a (tabular facts; no geometry)", resolution="n/a",
        data_class="inferred", suitability="screening",
        accuracy_statement="As published by the cited sources; each value carries its quote. Not surveyed.",
        licence_text=LICENCE, origin="api", origin_path=_rel(os.path.dirname(path)),
        stats_json={"facts": len(facts), "projects": len({f['project_id'] for f in facts})},
        fingerprint=registry.fingerprint(DATASET_ID, label, sha), notes=note,
        files=[{"role": "derived", "path": _rel(path), "sha256": sha, "size_bytes": size, "format": "json"}])
    db.add(DsProcessingRunEntity(
        id=registry.new_id("dsp"), version_id=v.id, pipeline="updater.review.apply_approved", git_commit=commit,
        params_json=json.dumps({"reviewer": reviewer, "proposal_ids": proposal_ids}),
        inputs_json=json.dumps(([{"version_id": prev.id, "sha256": prev.sha256}] if prev else []) +
                               [{"url": e.get("url"), "sha256": e.get("sha256")} for e in evidence]),
        outputs_json=json.dumps([{"path": _rel(path), "sha256": sha}]),
        validation_json=json.dumps({"facts": len(facts), "every_fact_has_evidence": all(f.get("evidence") for f in facts)}),
        started_at=now.isoformat(), finished_at=now.isoformat(), origin_path=_rel(os.path.dirname(path))))
    db.flush()
    try:
        quality.run_checks(db, v)
    except Exception:  # noqa: BLE001 — quality checks are informative; registration stands
        pass
    return v


def read_version(db: Session, v: DsDatasetVersionEntity | None) -> dict:
    """{version_id, version_label, review_status, facts, sha256_ok, error}. A file whose sha256 differs from the
    registry is refused (facts = [])."""
    if v is None:
        return {"version_id": None, "version_label": None, "review_status": None, "facts": [], "sha256_ok": None,
                "error": None}
    f = facts_file(db, v)
    base = {"version_id": v.id, "version_label": v.version_label, "review_status": v.review_status,
            "reviewed_by": v.reviewed_by, "reviewed_at": v.reviewed_at.isoformat() + "Z" if v.reviewed_at else None}
    if f is None:
        return {**base, "facts": [], "sha256_ok": False, "error": "version has no facts file"}
    p = quality.resolve_path(f.path)
    try:
        sha = quality.sha256_file(p)
    except OSError as e:
        return {**base, "facts": [], "sha256_ok": False, "error": f"facts file unreadable ({type(e).__name__})"}
    if sha != f.sha256:
        return {**base, "facts": [], "sha256_ok": False,
                "error": "facts file does not match its registered sha256 (edited outside the review flow); refused"}
    with open(p, encoding="utf-8") as fh:
        data = json.load(fh)
    return {**base, "facts": data.get("facts", []), "sha256_ok": True, "error": None}


def read_active(db: Session) -> dict:
    return read_version(db, registry.active_version(db, DATASET_ID))


def current_value(active: dict, project_id: str, attribute: str) -> dict | None:
    for f in active.get("facts", []):
        if f.get("project_id") == project_id and f.get("attribute") == attribute:
            return f
    return None
