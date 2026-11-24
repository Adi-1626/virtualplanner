"""
City-wide ESTIMATED traffic, backend/data/estimated_traffic/*.json (docs/urbanos/TRAFFIC_ESTIMATED_P10.md).

A file is the compact model built by urbanos-data/estimated/traffic-v1/scripts/build_estimated_traffic.py: fitted
parameters, the activity grid, hourly and directional shares, class mix, per-way anchors and rules. The app estimates
any road's weekday volume from it (frontend/src/engine/simulation/EstimatedTraffic.ts). Every value is an estimate:
the label must say so, and files that are not labelled estimated are rejected. Kept apart from the official
(measured) datasets: nothing here is ever written into observed counts or screen lines.
"""

from __future__ import annotations

import json
import os

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "estimated_traffic")
SCHEMA = "twincity.estimated_traffic/v1"
LABEL = "estimated (project-level, not for decisions)"


def validate(doc: dict) -> list[str]:
    problems: list[str] = []
    if doc.get("schema") != SCHEMA:
        problems.append(f"schema must be {SCHEMA}")
    if doc.get("status") != "estimated":
        problems.append("status must be 'estimated' (never measured)")
    if doc.get("label") != LABEL:
        problems.append(f"label must be {LABEL!r}")
    p = doc.get("params") or {}
    for k in ("b_lanes", "b_act", "b_dist", "b_river"):
        if not isinstance(p.get(k), (int, float)):
            problems.append(f"params.{k} missing")
    hs = doc.get("hourShare")
    if not isinstance(hs, list) or len(hs) != 24 or abs(sum(hs) - 1) > 1e-3:
        problems.append("hourShare must be 24 shares summing to 1")
    g = doc.get("grid") or {}
    if not isinstance(g.get("values"), list) or len(g["values"]) != g.get("nx", 0) * g.get("ny", 0):
        problems.append("grid.values must have nx * ny cells")
    if not (doc.get("split") or {}).get("holdout"):
        problems.append("split.holdout must name the held-out counts")
    return problems


def list_files() -> list[str]:
    if not os.path.isdir(DATA_DIR):
        return []
    return sorted(f[:-5] for f in os.listdir(DATA_DIR) if f.endswith(".json"))


def load(file_id: str) -> dict:
    if file_id not in list_files():
        raise KeyError(file_id)
    with open(os.path.join(DATA_DIR, f"{file_id}.json"), encoding="utf-8") as f:
        doc = json.load(f)
    problems = validate(doc)
    if problems:
        raise ValueError("; ".join(problems))
    return doc
