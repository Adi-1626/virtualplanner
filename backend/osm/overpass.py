"""
Cached, polite proxy to the public Overpass API (OpenStreetMap data, ODbL).

Used when the local OSM index (index.py, built by `python -m osm.build_index`)
is missing or does not cover an area, e.g. on a fresh clone: the database
file is not in the repository. The browser asks
`GET /api/osm/overpass?data=<Overpass QL>` and gets the Overpass JSON answer.

Usage policy of the public instances (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances
and https://dev.overpass-api.de/overpass-doc/en/preface/commons.html):
fewer than 10 000 queries and about 1 GB per day, one query at a time,
identify yourself. So this proxy
- caches every complete answer on disk (SQLite, default 7 days), so a study
  area drawn again, or by a teammate on the same backend, is not fetched again;
- sends one upstream request at a time, at least 1 s apart;
- stops after a daily budget (default 2 000 upstream requests, well under 10k);
- sends a User-Agent naming the application;
- tries the mirrors in turn, honouring HTTP 429/503/504 and Retry-After;
- never caches an answer Overpass marks incomplete (`remark` with timeout /
  runtime error / out of memory), so partial data is not served later as complete.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

import requests

from .index import DATA_DIR

DEFAULT_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "UrbanOS-VirtualPlanner/1.0 (local planning tool; study-area import; +https://github.com/Adi-1626)"
INCOMPLETE = ("timeout", "runtime error", "out of memory")


def _env_list(name: str) -> list[str] | None:
    raw = os.environ.get(name, "").strip()
    return [u.strip() for u in raw.split(",") if u.strip()] or None


class UpstreamError(Exception):
    """Every mirror failed, or the daily budget is spent. `attempts` says what each mirror answered."""

    def __init__(self, message: str, attempts: list[str] | None = None, retry_after_s: int | None = None):
        super().__init__(message)
        self.attempts = attempts or []
        self.retry_after_s = retry_after_s


@dataclass
class OverpassProxy:
    cache_path: str = field(default_factory=lambda: os.environ.get("TWINCITY_OVERPASS_CACHE", os.path.join(DATA_DIR, "overpass_cache.db")))
    endpoints: list[str] = field(default_factory=lambda: _env_list("TWINCITY_OVERPASS_ENDPOINTS") or list(DEFAULT_ENDPOINTS))
    ttl_s: float = field(default_factory=lambda: float(os.environ.get("TWINCITY_OVERPASS_CACHE_TTL_H", "168")) * 3600)
    daily_budget: int = field(default_factory=lambda: int(os.environ.get("TWINCITY_OVERPASS_DAILY_BUDGET", "2000")))
    min_interval_s: float = 1.0
    timeout_s: float = 60.0
    get: Callable[..., requests.Response] = field(default=requests.get, repr=False)
    now: Callable[[], float] = field(default=time.time, repr=False)
    sleep: Callable[[float], None] = field(default=time.sleep, repr=False)

    def __post_init__(self):
        self._lock = threading.Lock()
        self._last = 0.0
        self._day = ""
        self._used = 0
        self._cooldown: dict[str, float] = {}

    # --- cache -------------------------------------------------------------------------------------------------
    def _db(self) -> sqlite3.Connection:
        os.makedirs(os.path.dirname(os.path.abspath(self.cache_path)), exist_ok=True)
        db = sqlite3.connect(self.cache_path)
        db.execute("CREATE TABLE IF NOT EXISTS answers (key TEXT PRIMARY KEY, query TEXT NOT NULL, fetched_at REAL NOT NULL, endpoint TEXT, body TEXT NOT NULL)")
        return db

    @staticmethod
    def key(query: str) -> str:
        return hashlib.sha256(" ".join(query.split()).encode("utf-8")).hexdigest()

    def cached(self, query: str) -> tuple[dict, float] | None:
        try:
            with self._db() as db:
                row = db.execute("SELECT body, fetched_at FROM answers WHERE key = ?", (self.key(query),)).fetchone()
        except sqlite3.Error:
            return None
        if not row or self.now() - row[1] > self.ttl_s:
            return None
        return json.loads(row[0]), row[1]

    def _store(self, query: str, endpoint: str, body: dict) -> None:
        try:
            with self._db() as db:
                db.execute("INSERT OR REPLACE INTO answers VALUES (?, ?, ?, ?, ?)", (self.key(query), query, self.now(), endpoint, json.dumps(body)))
        except sqlite3.Error:
            pass  # a cache that cannot be written is not a failed query

    def cache_stats(self) -> dict:
        try:
            with self._db() as db:
                n, oldest = db.execute("SELECT COUNT(*), MIN(fetched_at) FROM answers").fetchone()
        except sqlite3.Error:
            return {"entries": 0}
        return {"entries": n, "oldest": _iso(oldest) if oldest else None}

    # --- upstream ----------------------------------------------------------------------------------------------
    def _budget(self) -> None:
        day = datetime.datetime.fromtimestamp(self.now(), datetime.timezone.utc).strftime("%Y-%m-%d")
        if day != self._day:
            self._day, self._used = day, 0
        if self._used >= self.daily_budget:
            raise UpstreamError(f"Daily Overpass budget of {self.daily_budget} requests used (public servers allow <10 000/day). Cached areas still load; build the local index for more.")

    def fetch(self, query: str) -> tuple[dict, dict]:
        """(answer, info). info = {cache: 'hit'|'miss', endpoint, fetchedAt}. Raises UpstreamError."""
        hit = self.cached(query)
        if hit:
            return hit[0], {"cache": "hit", "endpoint": None, "fetchedAt": _iso(hit[1])}
        with self._lock:  # one upstream query at a time
            hit = self.cached(query)  # another request may have fetched it meanwhile
            if hit:
                return hit[0], {"cache": "hit", "endpoint": None, "fetchedAt": _iso(hit[1])}
            attempts: list[str] = []
            available = [e for e in self.endpoints if self._cooldown.get(e, 0) <= self.now()]
            if not available:
                wait = int(min(self._cooldown.values()) - self.now()) + 1
                raise UpstreamError(f"All Overpass servers asked us to wait. Try again in {wait} s.", retry_after_s=wait)
            for endpoint in available:
                self._budget()
                gap = self.min_interval_s - (self.now() - self._last)
                if gap > 0:
                    self.sleep(gap)
                self._last = self.now()
                self._used += 1
                host = endpoint.split("/")[2] if "//" in endpoint else endpoint
                try:
                    res = self.get(endpoint, params={"data": query}, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, timeout=self.timeout_s)
                except requests.RequestException as exc:
                    attempts.append(f"{host}: {type(exc).__name__}")
                    self._cooldown[endpoint] = self.now() + 30
                    continue
                if res.status_code in (429, 503, 504):
                    retry = res.headers.get("Retry-After", "")
                    self._cooldown[endpoint] = self.now() + (int(retry) if retry.isdigit() else 60)
                    attempts.append(f"{host}: busy (HTTP {res.status_code})")
                    continue
                if res.status_code == 400:
                    raise UpstreamError(f"Overpass rejected the query (HTTP 400): {res.text[:200]}", attempts + [f"{host}: HTTP 400"])
                if res.status_code != 200:
                    attempts.append(f"{host}: HTTP {res.status_code}")
                    continue
                try:
                    body = res.json()
                except ValueError:
                    attempts.append(f"{host}: not JSON")
                    continue
                remark = body.get("remark") if isinstance(body, dict) else None
                if not isinstance(body, dict) or not isinstance(body.get("elements"), list):
                    attempts.append(f"{host}: invalid answer")
                    continue
                if isinstance(remark, str) and any(k in remark.lower() for k in INCOMPLETE):
                    self._cooldown[endpoint] = self.now() + 30
                    attempts.append(f"{host}: incomplete ({remark[:80]})")
                    continue
                self._store(query, endpoint, body)
                return body, {"cache": "miss", "endpoint": host, "fetchedAt": _iso(self.now())}
            raise UpstreamError("No Overpass server answered: " + "; ".join(attempts), attempts)

    def status(self) -> dict:
        return {
            "endpoints": [e.split("/")[2] if "//" in e else e for e in self.endpoints],
            "cacheTtlHours": round(self.ttl_s / 3600, 1),
            "dailyBudget": self.daily_budget,
            "usedToday": self._used if self._day == datetime.datetime.fromtimestamp(self.now(), datetime.timezone.utc).strftime("%Y-%m-%d") else 0,
            "cache": self.cache_stats(),
        }


def _iso(t: float) -> str:
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).isoformat(timespec="seconds")
