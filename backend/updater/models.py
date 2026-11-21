"""
Data-freshness service tables (additive; prefix `fu_`). Existing tables are never altered.

    fu_runs        one row per `python -m updater run`
    fu_documents   one row per fetched page (URL, publisher, tier, publish date, retrieval time, body sha256)
    fu_claims      one extracted fact from one document, with the exact quoted sentence
    fu_proposals   claims grouped by (project, attribute, normalised value) + corroboration / conflict / staleness verdict
    fu_audit       append-only, hash-chained log of every run, proposal change, decision, apply and rollback

Nothing here changes the dataset: an approved proposal reaches the app only when `updater.review.apply_approved`
registers a new `ds_dataset_versions` row of `pune_infra_project_facts` through the registry's review flow.
"""
from __future__ import annotations

import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, event

from database.connection import Base


def _now():
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


class FuRunEntity(Base):
    __tablename__ = "fu_runs"

    id = Column(String, primary_key=True)
    mode = Column(String, nullable=False, default="run")          # run | dry_run | manual
    started_at = Column(DateTime, default=_now)
    finished_at = Column(DateTime, nullable=True)
    sources_json = Column(Text, nullable=False, default="[]")      # source ids used
    stats_json = Column(Text, nullable=False, default="{}")        # requests, documents, claims, proposals, per-source
    errors_json = Column(Text, nullable=False, default="[]")       # [{source, url, error}]
    watchlist_sha256 = Column(String, nullable=True)
    git_commit = Column(String, nullable=True)


class FuDocumentEntity(Base):
    __tablename__ = "fu_documents"

    id = Column(String, primary_key=True)
    url = Column(Text, nullable=False, index=True)
    final_url = Column(Text, nullable=True)
    domain = Column(String, nullable=False, index=True)            # registrable domain (hindustantimes.com)
    publisher = Column(String, nullable=False, default="UNKNOWN")
    tier = Column(Integer, nullable=False, default=3)              # 1 official · 2 reputable press · 3 other
    source_id = Column(String, nullable=True)                      # watch-list source that led here
    title = Column(Text, nullable=False, default="")
    published_at = Column(String, nullable=True)                   # ISO date(-time); NULL = undated
    published_from = Column(String, nullable=True)                 # meta | jsonld | time | feed | url | none
    retrieved_at = Column(DateTime, default=_now)
    http_status = Column(Integer, nullable=True)
    sha256 = Column(String, nullable=True, index=True)             # of the fetched body
    text_sha256 = Column(String, nullable=True)                    # of the extracted text
    robots_note = Column(Text, nullable=False, default="")
    run_id = Column(String, nullable=True, index=True)
    manual = Column(Boolean, nullable=False, default=False)        # added by a reviewer (add-evidence)


class FuClaimEntity(Base):
    __tablename__ = "fu_claims"

    id = Column(String, primary_key=True)
    document_id = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=False, index=True)
    attribute = Column(String, nullable=False, index=True)
    value_num = Column(Float, nullable=True)
    value_text = Column(String, nullable=True)                     # ISO month for dates, vocabulary word for status
    unit = Column(String, nullable=True)
    qualifier = Column(String, nullable=False, default="exact")    # exact | approx | max | min
    temporal = Column(String, nullable=True)                       # planned | reported | None
    quote = Column(Text, nullable=False)                           # exact sentence from the document (≤ 400 chars)
    quote_sha256 = Column(String, nullable=False)                  # of the normalised quote (syndication detection)
    attribution = Column(String, nullable=False, default="sentence")  # sentence | previous_sentence | page_rule
    extractor = Column(String, nullable=False)                     # pattern:<name>@<version> | page_rule:<id> | llm:<model>
    cites_other = Column(Boolean, nullable=False, default=False)   # "as reported by …" → not independent
    note = Column(Text, nullable=False, default="")                # e.g. year resolved from the publish date
    proposal_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=_now)


class FuProposalEntity(Base):
    __tablename__ = "fu_proposals"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False, index=True)
    attribute = Column(String, nullable=False, index=True)
    value_key = Column(String, nullable=False)                     # normalised value used for grouping
    value_num = Column(Float, nullable=True)
    value_text = Column(String, nullable=True)
    unit = Column(String, nullable=True)
    qualifier = Column(String, nullable=False, default="exact")
    temporal = Column(String, nullable=True)
    # pending | approved | rejected | applied | superseded (another value approved / applied for the same attribute)
    status = Column(String, nullable=False, default="pending", index=True)
    verdict = Column(String, nullable=False, default="needs_corroboration")  # corroborated | needs_corroboration | conflict
    # same vocabulary as docs/urbanos/pune_project_facts.json: official | corroborated | single_source | conflicting |
    # unverified, plus slipped (a planned date that passed and was replaced by a later reported date)
    confidence = Column(String, nullable=False, default="unverified")
    independent_sources = Column(Integer, nullable=False, default=0)
    official_sources = Column(Integer, nullable=False, default=0)
    evidence_count = Column(Integer, nullable=False, default=0)
    flags_json = Column(Text, nullable=False, default="[]")        # [{code, detail}]
    conflicts_json = Column(Text, nullable=False, default="[]")    # [{kind, value, proposal_id?, detail}]
    current_value_json = Column(Text, nullable=True)               # the active dataset's value, if any
    newest_evidence_at = Column(String, nullable=True)
    decided_by = Column(String, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_note = Column(Text, nullable=True)
    applied_version_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)


class FuAuditEntity(Base):
    """Append-only. `hash` = sha256(prev_hash + canonical JSON of this row's content): editing or deleting any row breaks
    the chain, which `updater.audit.verify_chain` detects."""
    __tablename__ = "fu_audit"

    seq = Column(Integer, primary_key=True, autoincrement=True)
    at = Column(String, nullable=False)                            # ISO UTC
    actor = Column(String, nullable=False)
    action = Column(String, nullable=False)                        # run | proposal_created | proposal_updated | approve | reject | apply | rollback | evidence_added
    subject = Column(String, nullable=True)                        # proposal / run / version id
    detail_json = Column(Text, nullable=False, default="{}")
    prev_hash = Column(String, nullable=False)
    hash = Column(String, nullable=False)


class AppendOnlyError(RuntimeError):
    pass


@event.listens_for(FuAuditEntity, "before_update")
def _audit_no_update(mapper, connection, target):  # noqa: ARG001
    raise AppendOnlyError("fu_audit is append-only")


@event.listens_for(FuAuditEntity, "before_delete")
def _audit_no_delete(mapper, connection, target):  # noqa: ARG001
    raise AppendOnlyError("fu_audit is append-only")


def _register_audit() -> None:
    from planning import audit
    audit._SPEC_BY_NAME.update({
        "FuProposalEntity": ("fu_proposal", None, None, "attribute", ("decided_by",)),
        "FuRunEntity": ("fu_run", None, None, "mode", ()),
    })
    for t in ("fu_proposal", "fu_run"):
        if t not in audit.TRACKED_TYPES:
            audit.TRACKED_TYPES.append(t)


_register_audit()
