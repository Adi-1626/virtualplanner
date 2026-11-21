"""Watch-list loading and validation (backend/updater/watchlist.json, or UPDATER_WATCHLIST)."""
from __future__ import annotations

import hashlib
import json
import os
import re

from .extract import ATTRIBUTES

WATCHLIST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watchlist.json")
SOURCE_KINDS = ("official_page", "rss", "gdelt", "google_cse")


class ConfigError(ValueError):
    pass


def load(path: str | None = None) -> dict:
    p = path or os.environ.get("UPDATER_WATCHLIST") or WATCHLIST_PATH
    with open(p, "rb") as f:
        raw = f.read()
    cfg = json.loads(raw.decode("utf-8"))
    cfg["_sha256"] = hashlib.sha256(raw).hexdigest()
    cfg["_path"] = p
    validate(cfg)
    return cfg


def validate(cfg: dict) -> None:
    ids = set()
    for p in cfg.get("projects", []):
        if not re.fullmatch(r"[a-z0-9_]+", p.get("id", "")):
            raise ConfigError(f"project id {p.get('id')!r}: lower-case letters, digits and _ only")
        if p["id"] in ids:
            raise ConfigError(f"duplicate project id {p['id']}")
        ids.add(p["id"])
        if not p.get("aliases"):
            raise ConfigError(f"project {p['id']}: at least one alias is needed")
        bad = [a for a in p.get("attributes", []) if a not in ATTRIBUTES]
        if bad:
            raise ConfigError(f"project {p['id']}: unknown attribute(s) {bad}; known: {sorted(ATTRIBUTES)}")
        for pat in p.get("osm_name_patterns", []):
            re.compile(pat)
    sids = set()
    for s in cfg.get("sources", []):
        if s.get("kind") not in SOURCE_KINDS:
            raise ConfigError(f"source {s.get('id')}: kind must be one of {SOURCE_KINDS}")
        if s["id"] in sids:
            raise ConfigError(f"duplicate source id {s['id']}")
        sids.add(s["id"])
        if int(s.get("tier", 3)) not in (1, 2, 3):
            raise ConfigError(f"source {s['id']}: tier must be 1, 2 or 3")
        for r in s.get("page_rules", []):
            if r.get("project") not in ids:
                raise ConfigError(f"source {s['id']} rule {r.get('id')}: unknown project {r.get('project')}")
            re.compile(r["pattern"])


def project(cfg: dict, pid: str) -> dict | None:
    return next((p for p in cfg.get("projects", []) if p["id"] == pid), None)


def setting(cfg: dict, key: str, default):
    return (cfg.get("settings") or {}).get(key, default)
