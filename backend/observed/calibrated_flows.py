"""
Calibrated edge flows, backend/data/calibrated_flows/*.json (docs/urbanos/TRAFFIC_CALIBRATION_P9.md).

A file holds, per demand period, the motor-vehicle volume (veh/h at the period's reference hour) on the links of
one large window of the network, from the app's own assignment with demand estimated from CALIBRATION counts only.
Study areas inside the window take their edge (cordon) flows from it instead of the class-per-lane defaults.
Every value is an estimate; files that fail validation are rejected.
"""

from __future__ import annotations

import json
import os
import re

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "calibrated_flows")
SCHEMA = "twincity.calibrated_edge_flows/v1"
LINK_ID = re.compile(r"^[A-Za-z0-9_\-.]+_(fwd|bwd)$")


def validate(doc: dict) -> list[str]:
    problems: list[str] = []
    if doc.get("schema") != SCHEMA:
        problems.append(f"schema must be {SCHEMA}")
    if doc.get("status") != "estimated":
        problems.append("status must be 'estimated' (calibrated flows are model estimates, never observations)")
    if not doc.get("method") or not doc.get("counts"):
        problems.append("method and counts (the evidence used) are required")
    if not isinstance(doc.get("caveats"), list) or not doc["caveats"]:
        problems.append("caveats must be a non-empty list")
    w = doc.get("window") or {}
    b = w.get("bounds") or {}
    if not all(isinstance(b.get(k), (int, float)) for k in ("minLng", "maxLng", "minLat", "maxLat")):
        problems.append("window.bounds needs minLng, maxLng, minLat, maxLat")
    periods = doc.get("periods")
    if not isinstance(periods, dict) or not periods:
        problems.append("periods must be a non-empty object")
        return problems
    for name, p in periods.items():
        if name not in ("AM_Peak", "PM_Peak", "Midday", "Night"):
            problems.append(f"periods.{name}: unknown period")
            continue
        if not isinstance(p.get("refHour"), int) or not 0 <= p["refHour"] <= 23:
            problems.append(f"periods.{name}: refHour must be 0-23")
        if not p.get("calibrationSites"):
            problems.append(f"periods.{name}: calibrationSites must name the counts it was fitted to")
        overlap = set(p.get("calibrationSites") or []) & set(p.get("holdoutSites") or [])
        if overlap:
            problems.append(f"periods.{name}: a site cannot be both calibration and hold-out: {sorted(overlap)}")
        links = p.get("links")
        if not isinstance(links, dict) or not links:
            problems.append(f"periods.{name}: links must be a non-empty object")
            continue
        bad = [k for k, v in links.items() if not LINK_ID.match(k) or isinstance(v, bool) or not isinstance(v, (int, float)) or v < 0]
        if bad:
            problems.append(f"periods.{name}: {len(bad)} invalid link entries (e.g. {bad[0]!r})")
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
