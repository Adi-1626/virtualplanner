"""
The verified ground-truth list (docs/urbanos/pune_project_facts.json, branch pune-facts b2eb8e8) as
  1. the BASELINE the service compares against: `python -m updater seed-baseline --reviewer NAME` registers the mapped
     records as a facts version (through the same registry flow as any applied change), so every new proposal is
     checked against it ("the dataset currently says …");
  2. GOLDEN evaluation data: `golden_cases()` turns each sentence quote into (project, attribute, expected value) so the
     extractor is tested on real published wording (tests/test_updater_golden.py; `python -m updater evaluate`).

Seed attributes map onto the service's attributes; records that do not map (agency, type, stations list, free-text
progress, …) or whose value is null (unverified) are left out and counted.
"""
from __future__ import annotations

import json
import os
import re

from .extract import ATTRIBUTES, label

SEED_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "docs", "urbanos", "pune_project_facts.json")
ATTR_MAP = {"length": "length_km", "station_count": "station_count", "tunnel_depth": "tunnel_depth_m",
            "tbm_count": "tbm_count", "tbm_boring_start": "tunnelling_start", "completion_target": "completion_target",
            "cost": "cost_inr_crore", "cost_sanctioned": "cost_inr_crore", "status": "status"}


def load_seed(path: str | None = None) -> dict:
    with open(path or os.environ.get("UPDATER_SEED") or SEED_PATH, encoding="utf-8") as f:
        return json.load(f)


def project_id(seed_id: str) -> str:
    return seed_id.replace("-", "_")


def _lead_number(v) -> float | None:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    if isinstance(v, str):
        m = re.match(r"\s*~?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)", v)
        if m:
            return float(m.group(1).replace(",", ""))
    return None


def status_word(text: str) -> str | None:
    t = (text or "").lower()
    if t.startswith(("operational", "completed")):
        return "operational"
    if t.startswith("under construction"):
        return "under_construction"
    if t.startswith("sanctioned"):
        return "approved"
    return None


def map_value(rec: dict) -> tuple[str, float | None, str | None, str] | None:
    """(attribute, value_num, value_text, qualifier) or None when the record does not map."""
    attr = ATTR_MAP.get(rec.get("attribute"))
    v, unit = rec.get("value"), (rec.get("unit") or "")
    if attr is None or v is None or isinstance(v, (dict, list)):
        return None
    kind = ATTRIBUTES[attr]["kind"]
    qual = "approx" if isinstance(v, str) and ("approx" in v or v.strip().startswith("~")) else "exact"
    if kind == "status":
        w = status_word(str(v))
        return (attr, None, w, "exact") if w else None
    if kind == "month":
        m = re.match(r"\s*(20\d{2})-(\d{2})", str(v))
        if m:
            return attr, None, f"{m.group(1)}-{m.group(2)}", "exact"
        m = re.match(r"\s*(20\d{2})\b", str(v))
        return (attr, None, m.group(1), "exact") if m else None
    n = _lead_number(v)
    if n is None:
        return None
    if attr == "length_km" and unit.strip() == "m":
        n = n / 1000.0
    elif attr == "length_km" and unit.strip() not in ("km", ""):
        return None
    return attr, n, None, qual


def baseline_facts(seed: dict, cfg: dict) -> tuple[list[dict], dict]:
    """Seed records → facts (one per project × attribute; the record's primary value). Returns (facts, counts)."""
    projects = {p["id"]: p for p in cfg.get("projects", [])}
    facts, counts = [], {"records": 0, "mapped": 0, "unmapped_attribute": 0, "null_value": 0, "unknown_project": 0, "duplicate": 0}
    seen = set()
    for r in seed.get("records", []):
        counts["records"] += 1
        pid = project_id(r["project_id"])
        if pid not in projects:
            counts["unknown_project"] += 1
            continue
        if r.get("value") is None:
            counts["null_value"] += 1
            continue
        mv = map_value(r)
        if mv is None:
            counts["unmapped_attribute"] += 1
            continue
        attr, num, text, qual = mv
        if (pid, attr) in seen:
            counts["duplicate"] += 1
            continue
        seen.add((pid, attr))
        counts["mapped"] += 1
        p = projects[pid]
        facts.append({
            "project_id": pid, "project_name": p["name"], "project_kind": p.get("kind"),
            "osm_name_patterns": p.get("osm_name_patterns", []), "attribute": attr,
            "attribute_label": ATTRIBUTES[attr]["label"], "value_num": num, "value_text": text,
            "unit": ATTRIBUTES[attr]["unit"], "qualifier": qual, "temporal": "planned" if attr in ("tunnelling_start", "completion_target") else None,
            "label": label(attr, num, text, qual), "seed_value": r.get("value"), "seed_record_id": r.get("id"),
            "seed_confidence": r.get("confidence"), "confidence": r.get("confidence"), "slipped": bool(r.get("slipped")),
            "as_of": r.get("as_of"), "alt_values": r.get("alt_values"), "note": r.get("note"),
            "proposal_id": None, "origin": "seed", "certainty": "reported", "suitability": "screening",
            "evidence": [{"url": s.get("url"), "publisher": s.get("publisher"), "published_at": s.get("published"),
                          "quote": s.get("quote"), "quote_type": s.get("quote_type"), "quote_verified": s.get("quote_verified"),
                          "tier": 1 if r.get("confidence") == "official" and "press" not in (s.get("publisher") or "").lower() else None}
                         for s in r.get("sources", [])],
        })
    facts.sort(key=lambda f: (f["project_id"], f["attribute"]))
    return facts, counts


def golden_cases(seed: dict, cfg: dict) -> list[dict]:
    """One case per sentence quote of a mapped record: feed the quote (with the project's name as page title) to the
    extractor and expect the record's value. Table-row quotes are skipped (not prose)."""
    projects = {p["id"]: p for p in cfg.get("projects", [])}
    cases = []
    for r in seed.get("records", []):
        pid = project_id(r["project_id"])
        if pid not in projects:
            continue
        mv = map_value(r)
        if mv is None or mv[0] not in projects[pid].get("attributes", []):
            continue
        for s in r.get("sources", []):
            if s.get("quote_type") != "sentence" or not s.get("quote") or "..." in s["quote"]:
                continue
            cases.append({"record_id": r["id"], "project_id": pid, "attribute": mv[0], "value_num": mv[1],
                          "value_text": mv[2], "quote": s["quote"], "published": s.get("published"),
                          "publisher": s.get("publisher"), "title": projects[pid]["aliases"][0]})
    return cases


def run_golden(seed: dict, cfg: dict) -> dict:
    import datetime as dt
    from .extract import extract_page
    from .proposals import agree
    out = {"cases": 0, "reproduced": 0, "wrong_value": 0, "missed": 0, "details": []}
    for c in golden_cases(seed, cfg):
        out["cases"] += 1
        pub = dt.date.fromisoformat(c["published"][:10]) if c.get("published") else None
        claims = [x for x in extract_page([c["quote"]], c["title"], cfg["projects"], pub)
                  if x.project_id == c["project_id"] and x.attribute == c["attribute"]]
        ok = [x for x in claims if agree(c["attribute"], x.value_num, x.value_text, x.qualifier, c["value_num"], c["value_text"], "exact")]
        res = "reproduced" if ok else ("wrong_value" if claims else "missed")
        out[res] += 1
        out["details"].append({**c, "result": res, "got": [label(x.attribute, x.value_num, x.value_text, x.qualifier) for x in claims]})
    return out
