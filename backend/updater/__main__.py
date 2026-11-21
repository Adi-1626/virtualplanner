"""
Data-freshness service CLI (docs/urbanos/DATA_FRESHNESS_SERVICE.md). Run from backend/ with the same DATABASE_URL and
URBANOS_DATA_DIR as the app.

    python -m updater run [--dry-run] [--only id,id] [--sources id,id] [--refresh] [--json report.json]
    python -m updater serve [--every 24h] [--dry-run]          loop scheduler (Ctrl+C to stop)
    python -m updater status
    python -m updater proposals [--status pending] [--project id]
    python -m updater approve PROPOSAL_ID --reviewer NAME [--note TEXT]
    python -m updater reject  PROPOSAL_ID --reviewer NAME [--note TEXT]
    python -m updater apply --reviewer NAME [--note TEXT] [--no-activate]
    python -m updater rollback VERSION_ID --reviewer NAME [--note TEXT]
    python -m updater versions
    python -m updater add-evidence URL --reviewer NAME [--project id]
    python -m updater seed-baseline --reviewer NAME [--file pune_project_facts.json]
    python -m updater evaluate [--json out.json]               golden test against the seed quotes (offline)
    python -m updater verify-audit
    python -m updater purge-cache
    python -m updater check-config
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time


def _db():
    from database.connection import Base, DATABASE_URL, SessionLocal, engine
    import datasets.models  # noqa: F401  registry tables
    import planning.models  # noqa: F401  audit_log (planning.audit hooks write it)
    from updater import models  # noqa: F401
    names = [t for t in Base.metadata.tables if t.startswith(("fu_", "ds_")) or t == "audit_log"]
    Base.metadata.create_all(bind=engine, tables=[Base.metadata.tables[n] for n in names])
    return SessionLocal(), DATABASE_URL


def _every(s: str) -> float:
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*([smhd])", s.strip().lower())
    if not m:
        raise SystemExit("--every must look like 30m, 6h or 1d")
    v = float(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]
    if v < 3600:
        raise SystemExit("--every must be at least 1h (be polite to the publishers)")
    return v


def _print_proposals(rows: list[dict]) -> None:
    if not rows:
        print("  (none)")
    for p in rows:
        conf = " ⚠ conflict" if any(c["kind"] == "source_disagreement" for c in p["conflicts"]) else ""
        cur = f" (dataset: {p['current_value']['label']})" if p.get("current_value") else ""
        print(f"  {p['id']}  [{p['status']}] {p['project_id']} · {p['attribute_label']} = {p['label']}{cur} · "
              f"{p['confidence']} · {p['independent_sources']} independent / {p['official_sources']} official{conf}")
        for e in p.get("evidence", [])[:4]:
            print(f"      “{e['quote'][:150]}” — {e['publisher']} (tier {e['tier']}, {e['published_at'] or 'undated'}) {e['url']}")
        for f in p["flags"]:
            print(f"      flag {f['code']}: {f['detail']}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m updater", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--only")
    r.add_argument("--sources")
    r.add_argument("--refresh", action="store_true")
    r.add_argument("--json")
    s = sub.add_parser("serve")
    s.add_argument("--every", default="24h")
    s.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    p = sub.add_parser("proposals")
    p.add_argument("--status", default="pending")
    p.add_argument("--project")
    for name in ("approve", "reject"):
        x = sub.add_parser(name)
        x.add_argument("proposal_id")
        x.add_argument("--reviewer", required=True)
        x.add_argument("--note", default="")
    a = sub.add_parser("apply")
    a.add_argument("--reviewer", required=True)
    a.add_argument("--note", default="")
    a.add_argument("--no-activate", action="store_true")
    rb = sub.add_parser("rollback")
    rb.add_argument("version_id")
    rb.add_argument("--reviewer", required=True)
    rb.add_argument("--note", default="")
    sub.add_parser("versions")
    ae = sub.add_parser("add-evidence")
    ae.add_argument("url")
    ae.add_argument("--reviewer", required=True)
    ae.add_argument("--project")
    sb = sub.add_parser("seed-baseline")
    sb.add_argument("--reviewer", required=True)
    sb.add_argument("--file")
    ev = sub.add_parser("evaluate")
    ev.add_argument("--json")
    sub.add_parser("verify-audit")
    sub.add_parser("purge-cache")
    sub.add_parser("check-config")
    args = ap.parse_args(argv)

    from updater import config as cfgmod
    cfg = cfgmod.load()
    if args.cmd == "check-config":
        print(f"watch-list OK: {len(cfg['projects'])} projects, {len(cfg['sources'])} sources, sha256 {cfg['_sha256'][:12]}")
        return 0
    if args.cmd == "purge-cache":
        from updater.fetch import default_cache_dir, purge_cache
        print(f"removed {purge_cache()} cached file(s) from {default_cache_dir()}")
        return 0
    if args.cmd == "evaluate":
        from updater import seed
        res = seed.run_golden(seed.load_seed(), cfg)
        print(f"golden quotes: {res['cases']} · reproduced {res['reproduced']} · wrong value {res['wrong_value']} · missed {res['missed']}")
        for d in res["details"]:
            if d["result"] == "wrong_value":
                print(f"  WRONG {d['project_id']} {d['attribute']}: expected {d['value_num'] or d['value_text']}, got {d['got']} — {d['quote'][:120]}")
        if args.json:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump(res, f, indent=2, ensure_ascii=False)
        return 0 if res["wrong_value"] == 0 else 1

    db, url = _db()
    from updater import audit, facts as facts_mod, pipeline, review
    from updater.models import FuProposalEntity
    from updater.proposals import evaluate_all, groups_by_status, proposal_dict
    from sqlalchemy import select
    max_age = int(cfgmod.setting(cfg, "max_article_age_days", 400))
    try:
        if args.cmd in ("run", "serve"):
            print(f"database: {url}")

            def once():
                rep = pipeline.run(db, cfg, dry_run=args.dry_run,
                                   only=set(args.only.split(",")) if getattr(args, "only", None) else None,
                                   sources=set(args.sources.split(",")) if getattr(args, "sources", None) else None,
                                   refresh=getattr(args, "refresh", False))
                st = rep["stats"]
                print(f"run {rep['run_id']} ({rep['mode']}): {st['requests']} requests · {st['pages_read']} pages read · "
                      f"{st['claims_new']} new claims · {len(rep['proposals_created'])} new proposals · {len(rep['errors'])} errors")
                print("pending proposals:")
                _print_proposals(rep["pending"])
                if getattr(args, "json", None):
                    with open(args.json, "w", encoding="utf-8") as f:
                        json.dump(rep, f, indent=2, ensure_ascii=False, default=str)
                return rep
            if args.cmd == "run":
                once()
                return 0
            period = _every(args.every)
            while True:
                try:
                    once()
                except Exception as e:  # noqa: BLE001 — keep the loop alive; the error is printed and audited next run
                    db.rollback()
                    print(f"run failed: {type(e).__name__}: {e}", file=sys.stderr)
                print(f"next run in {args.every} (Ctrl+C to stop)")
                time.sleep(period)
        if args.cmd == "status":
            act = facts_mod.read_active(db)
            print(f"database: {url}")
            print(f"proposals: {groups_by_status(db)}")
            print(f"facts: version {act['version_label']} · {len(act['facts'])} facts · sha256 ok: {act['sha256_ok']} {act['error'] or ''}")
            print(f"audit chain: {audit.verify_chain(db)}")
            return 0
        if args.cmd == "proposals":
            q = select(FuProposalEntity)
            if args.status != "all":
                q = q.where(FuProposalEntity.status.in_(args.status.split(",")))
            if args.project:
                q = q.where(FuProposalEntity.project_id == args.project)
            _print_proposals([proposal_dict(db, x, cfg) for x in db.scalars(q.order_by(FuProposalEntity.project_id, FuProposalEntity.attribute))])
            return 0
        if args.cmd in ("approve", "reject"):
            fn = review.approve if args.cmd == "approve" else review.reject
            x = fn(db, args.proposal_id, args.reviewer, args.note)
            db.commit()
            print(f"{x.id} → {x.status}")
            return 0
        if args.cmd == "apply":
            v = review.apply_approved(db, args.reviewer, args.note, not args.no_activate, cfg)
            evaluate_all(db, facts_mod.read_active(db), max_age)
            db.commit()
            print(f"registered facts version {v.version_label} ({v.id}) · {v.review_status} · sha256 {v.sha256[:12]}")
            return 0
        if args.cmd == "rollback":
            v = review.rollback(db, args.version_id, args.reviewer, args.note)
            evaluate_all(db, facts_mod.read_active(db), max_age)
            db.commit()
            print(f"active facts version is now {v.version_label} ({v.id})")
            return 0
        if args.cmd == "versions":
            for v in review.versions(db):
                print(f"  {v['version_label']:>4}  {v['id']}  {v['review_status']:<15} {v['facts']} facts · {v['reviewed_by'] or ''} {v['review_note'] or ''}")
            return 0
        if args.cmd == "add-evidence":
            res = pipeline.add_evidence(db, cfg, args.url, args.reviewer, args.project)
            print(json.dumps(res, indent=2, ensure_ascii=False))
            return 0
        if args.cmd == "seed-baseline":
            from updater import seed
            act = facts_mod.read_active(db)
            if act["facts"]:
                print("refused: the facts dataset already has facts; the seed baseline is only for an empty dataset")
                return 2
            facts, counts = seed.baseline_facts(seed.load_seed(args.file), cfg)
            v = facts_mod.register_version(db, facts, reviewer=args.reviewer,
                                           note=f"baseline from the verified seed list (pune_project_facts.json): {counts['mapped']} mapped records",
                                           proposal_ids=[], evidence=[{"url": e["url"], "sha256": None} for f in facts for e in f["evidence"]],
                                           activate=True)
            audit.log(db, args.reviewer, "seed_baseline", v.id, counts)
            evaluate_all(db, facts_mod.read_active(db), max_age)
            db.commit()
            print(f"baseline version {v.version_label} ({v.id}): {counts}")
            return 0
        if args.cmd == "verify-audit":
            res = audit.verify_chain(db)
            print(res)
            return 0 if res["ok"] else 1
    except (review.ReviewError, KeyError, ValueError) as e:
        db.rollback()
        print(f"error: {e}", file=sys.stderr)
        return 2
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
