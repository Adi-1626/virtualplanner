"""
SYNTHETIC land-use 4-step demand (docs/urbanos/DEMAND_P14.md), served to the app.

Files live outside the repo, in ``<URBANOS_DATA_DIR>/synthetic/demand-v1/out/`` (built by
``urbanos-data/synthetic/demand-v1/scripts/build_demand.py``):
  - ``pune_synthetic_demand_v1.json``: the city model (zones, impedance, factored gravity OD, mode / hourly parameters,
    main-road skeleton). Rejected unless labelled ``synthetic``.
  - ``trip_ends.csv.gz``: building-level trip-end weights (lon, lat, zone index, residents, jobs, service jobs, seats,
    industrial jobs), served by bounding box for a study area.

Everything here is labelled synthetic and kept apart from the official (measured) and estimated datasets: nothing is ever
written into observed counts, screen lines or the estimated traffic.
"""
from __future__ import annotations

import csv
import gzip
import json
import os
from array import array
from pathlib import Path

from datasets.paths import data_dir

SCHEMA = "twincity.synthetic_demand/v1"
LABEL = "synthetic"
# A study area is a few km across; a box larger than this is refused (the app never asks for one)
MAX_BOX_DEG = 0.4


def root() -> Path:
    override = os.environ.get("URBANOS_SYNTHETIC_DEMAND_DIR")
    return Path(override) if override else data_dir() / "synthetic" / "demand-v1" / "out"


def list_files() -> list[str]:
    r = root()
    if not r.is_dir():
        return []
    return sorted(p.stem for p in r.glob("pune_synthetic_demand_*.json"))


def validate(doc: dict) -> list[str]:
    problems: list[str] = []
    if doc.get("schema") != SCHEMA:
        problems.append(f"schema must be {SCHEMA}")
    if doc.get("label") != LABEL or doc.get("status") != LABEL:
        problems.append("label and status must be 'synthetic' (never measured or estimated)")
    for k in ("zones", "impedance", "gravity", "hourly", "skeleton", "modeSplit"):
        if k not in doc:
            problems.append(f"{k} missing")
    for p, h in (doc.get("hourly") or {}).items():
        for side in ("out", "ret"):
            v = h.get(side)
            if not isinstance(v, list) or len(v) != 24 or abs(sum(v) - 1) > 1e-3:
                problems.append(f"hourly.{p}.{side} must be 24 shares summing to 1")
    return problems


_DOCS: dict[str, dict] = {}


def load(file_id: str) -> dict:
    if file_id not in list_files():
        raise KeyError(file_id)
    if file_id not in _DOCS:
        with open(root() / f"{file_id}.json", encoding="utf-8") as f:
            doc = json.load(f)
        problems = validate(doc)
        if problems:
            raise ValueError("; ".join(problems))
        _DOCS[file_id] = doc
    return _DOCS[file_id]


COLUMNS = ["lon", "lat", "zone", "res", "jobs", "svc", "seats", "ind"]
_ENDS: dict[str, list[array]] = {}


def _ends(path: Path) -> list[array]:
    key = str(path)
    if key not in _ENDS:
        cols = [array("d") for _ in COLUMNS]
        with gzip.open(path, "rt", newline="") as f:
            r = csv.reader(f)
            head = next(r)
            if head != COLUMNS:
                raise ValueError(f"trip_ends columns must be {COLUMNS}")
            for row in r:
                for c, v in zip(cols, row):
                    c.append(float(v))
        _ENDS[key] = cols
    return _ENDS[key]


def trip_ends(file_id: str, min_lng: float, min_lat: float, max_lng: float, max_lat: float) -> dict:
    """Building trip ends inside a box (synthetic). The zone column indexes the asset's zones."""
    if file_id not in list_files():
        raise KeyError(file_id)
    if not (max_lng > min_lng and max_lat > min_lat) or max_lng - min_lng > MAX_BOX_DEG or max_lat - min_lat > MAX_BOX_DEG:
        raise ValueError(f"box must be non-empty and at most {MAX_BOX_DEG} degrees a side")
    path = root() / "trip_ends.csv.gz"
    if not path.exists():
        raise KeyError("trip_ends.csv.gz")
    cols = _ends(path)
    lon, lat = cols[0], cols[1]
    rows = []
    for i in range(len(lon)):
        x, y = lon[i], lat[i]
        if min_lng <= x <= max_lng and min_lat <= y <= max_lat:
            rows.append([round(c[i], 6) if k < 2 else (int(c[i]) if k == 2 else c[i]) for k, c in enumerate(cols)])
    return {"id": file_id, "label": LABEL, "columns": COLUMNS, "rows": rows}
