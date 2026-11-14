"""One-off registry repair for the blockers listed in docs/urbanos/DATA_RETENTION_AUDIT.md §2 (run 2026-11-14).

    DATABASE_URL=sqlite:////abs/path/twincity.db python -m datasets.tools.resolve_retention_blockers [--apply]

Without --apply it only prints what it would change. Nothing is deleted: every version row, file row, processing run
and quality check stays in the registry.

  * Bhuvan WMS PNGs (deleted 2026-11-13 under the Bhuvan ToS): their 10 ds_files rows get role "withdrawn" (path,
    sha256, size and URL kept as evidence of what was fetched); the version's review_note records why.
  * Five datasets with an active row and a pending_review re-registration of the same directory: the pending row is
    activated through registry.review_version (the normal review path), so the old active row becomes "superseded"
    and stays readable. Each pending row was checked first: identical data files (path + sha256), and the only
    differences are the corrected classification (derived -> inferred, from classification_overrides.json, commit
    af7064e) or, for the tree index, the processing.json of its re-run.
  * Tree index: the re-registration's processing.json hash is the file on disk; the superseded row keeps the hash of
    the processing.json that the re-run overwrote in place (that file no longer exists anywhere; recorded as such).
"""
from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import select

from database.connection import SessionLocal

from .. import quality, registry
from ..models import DsDatasetVersionEntity, DsFileEntity

REVIEWER = "retention-blocker repair 2026-11-14 (user request 57fa1024)"
BHUVAN_VERSION = "dsv_1b5801795ebe"
PAIRS = {  # dataset: (current active, pending re-registration to activate, reason)
    "esa_worldcover_2021_v200": ("dsv_bb271ca4ea4f", "dsv_61178e8b7f60", "classification corrected derived -> inferred (ML classifier output) per classification_overrides.json"),
    "google_open_buildings_v3": ("dsv_8e5be0b703d2", "dsv_da4ec5273174", "classification corrected derived -> inferred (ML footprint detections) per classification_overrides.json"),
    "ms_global_ml_buildings": ("dsv_b99621137288", "dsv_a3fda9753429", "classification corrected derived -> inferred (ML footprint detections) per classification_overrides.json"),
    "landcover_worldcover2021": ("dsv_f8d5a0c86e12", "dsv_1e4947f7de84", "classification corrected derived -> inferred (classifier labels clipped to Pune) per classification_overrides.json"),
    "pmc_tree_census_2019_index": ("dsv_cd7786f3f943", "dsv_d48ce2056959", "re-run of the same pipeline (output unchanged, trees_index.sqlite sha256 identical); its processing.json is the file on disk"),
}


def _files(db, vid):
    return sorted((f.role, f.path, f.sha256) for f in db.scalars(select(DsFileEntity).where(DsFileEntity.version_id == vid)))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    with SessionLocal() as db:
        # 1. Bhuvan withdrawn files
        rows = [f for f in db.scalars(select(DsFileEntity).where(DsFileEntity.version_id == BHUVAN_VERSION))
                if f.role != "manifest" and f.path.endswith(".png")]
        gone = [f for f in rows if not os.path.exists(quality.resolve_path(f.path))]
        if len(gone) != len(rows):
            print("ABORT: a Bhuvan PNG row points at a file that exists; refusing to mark it withdrawn", file=sys.stderr)
            return 2
        for f in gone:
            print(f"withdraw {f.id} {os.path.basename(f.path)} (role {f.role} -> {quality.WITHDRAWN_ROLE})")
            f.role = quality.WITHDRAWN_ROLE
        bv = db.get(DsDatasetVersionEntity, BHUVAN_VERSION)
        bv.review_note = ((bv.review_note + "\n") if bv.review_note else "") + (
            f"{len(gone)} WMS PNG file rows marked withdrawn 2026-11-14: PNGs deleted 2026-11-13 after reading the Bhuvan "
            "Terms of Service (no copying/derivative works without NRSC authorisation). Rows keep path, sha256, size and "
            "GetMap URL as evidence; manifest.json (deleted_2026_11_13 entries) is unchanged.")
        # 2 + 4. duplicate rows
        for did, (old, new, why) in PAIRS.items():
            vo, vn = db.get(DsDatasetVersionEntity, old), db.get(DsDatasetVersionEntity, new)
            assert vo.dataset_id == vn.dataset_id == did and vo.review_status == "active" and vn.review_status == "pending_review", did
            assert vo.origin_path == vn.origin_path, did
            fo, fn = _files(db, old), _files(db, new)
            data_o = [x for x in fo if x[0] != "manifest"]
            data_n = [x for x in fn if x[0] != "manifest"]
            assert data_o == data_n, f"{did}: data files differ"
            for role, path, sha in fn:   # the version being activated must verify on disk
                p = quality.resolve_path(path)
                assert os.path.exists(p) and quality.sha256_file(p) == sha, f"{did}: {path} does not verify"
            note = f"Duplicate re-registration of the same directory resolved 2026-11-14: {why}. Previous active row {old} kept as superseded."
            if did == "pmc_tree_census_2019_index":
                note += (" The superseded row's processing.json sha256 (fff04376…, 1,253 B) is of the file the 23:40 IST re-run "
                         "overwrote in place; that earlier file no longer exists. Its run is still recorded in ds_processing_runs.")
            print(f"activate {new} for {did} (supersedes {old}): {why}")
            if a.apply:
                registry.review_version(db, new, "activate", REVIEWER, note)
        # fresh quality checks for every touched version
        if a.apply:
            for vid in [BHUVAN_VERSION] + [p for pair in PAIRS.values() for p in pair[:2]]:
                v = db.get(DsDatasetVersionEntity, vid)
                cs = {c["check"]: c["status"] for c in quality.run_checks(db, v)}
                print(f"checks {vid} {v.dataset_id} {v.review_status}: checksum={cs.get('checksum')}")
            db.commit()
            print("committed")
        else:
            db.rollback()
            print("dry run: nothing written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
