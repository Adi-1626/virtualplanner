"""
Polite, cached fetching for the data-freshness service.

Reuses the dataset registry's robots.txt parser (RFC 9309: longest rule wins, * and $ wildcards, 4xx = no rules,
5xx = disallow all) and its public-host SSRF guard (every redirect re-checked). Adds:
  * a per-host minimum delay (watch-list `min_host_delay_s`, floor 2 s; robots Crawl-delay or a source's `delay_s`
    when larger)
  * an on-disk cache keyed by URL: ETag / Last-Modified sent back as conditional headers; 304 → cached body
  * a host that refuses (401 / 403 / 429) or fails at network level is not contacted again in the run
  * a hard body limit and timeout

`TRANSPORT` is the only function that touches the network; tests replace it with recorded fixtures.
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable

from datasets.update_monitor import parse_robots, robots_allows
from datasets.updates import _PublicRedirects, non_public_reason

DEFAULT_UA = "UrbanOS-data-freshness/1.0 (+docs/urbanos/DATA_FRESHNESS_SERVICE.md)"
UA_TOKEN = "urbanos-data-freshness"
MAX_BODY = 8_000_000
REFUSAL = (401, 403, 429)


@dataclass
class Response:
    url: str
    final_url: str
    status: int
    headers: dict
    body: bytes
    from_cache: bool = False
    robots_note: str = ""

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.body).hexdigest()


class Refused(Exception):
    """robots.txt disallows the URL, the host refused earlier in the run, or the URL is not public."""


def _transport(url: str, timeout: float, headers: dict) -> tuple[int, dict, bytes, str]:
    why = non_public_reason(url)
    if why:
        raise Refused(why)
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.build_opener(_PublicRedirects).open(req, timeout=timeout) as r:  # noqa: S310 (public http(s) only)
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read(MAX_BODY), r.geturl()
    except urllib.error.HTTPError as e:
        try:
            body = e.read(20_000)
        except Exception:  # noqa: BLE001
            body = b""
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, body, url


TRANSPORT: Callable[[str, float, dict], tuple[int, dict, bytes, str]] = _transport


def default_cache_dir() -> str:
    from datasets import paths
    root = os.environ.get("UPDATER_CACHE_DIR")
    if root:
        return root
    info = paths.data_dir_info()
    if info["source"] in ("URBANOS_DATA_DIR", "URBANOS_DATA_ROOT", "URBANOS_DATA_HOME", "sandbox_default"):
        return str(info["path"] / "updater" / "cache")
    return os.path.join(tempfile.gettempdir(), "urbanos-updater-cache")


class PoliteFetcher:
    def __init__(self, user_agent: str = DEFAULT_UA, min_delay: float = 2.0, timeout: float = 20.0,
                 cache_dir: str | None = None, host_delays: dict[str, float] | None = None,
                 sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic,
                 use_cache: bool = True):
        self.ua = user_agent
        self.min_delay = max(2.0, float(min_delay))
        self.timeout = timeout
        self.cache_dir = cache_dir or default_cache_dir()
        self.host_delays = dict(host_delays or {})
        self.sleep, self.clock = sleep, clock
        self.use_cache = use_cache
        self.robots: dict[str, tuple[list, float | None, str]] = {}
        self.down: dict[str, str] = {}
        self.last: dict[str, float] = {}
        self.requests: list[str] = []      # every network request made (robots.txt included)
        self.per_host: dict[str, int] = {}

    # ── internals ────────────────────────────────────────────────────────────────────────────────────────────────
    def _delay_for(self, host: str) -> float:
        rd = 0.0
        for origin, (_r, d, _n) in self.robots.items():
            if urllib.parse.urlsplit(origin).hostname == host and d:
                rd = max(rd, float(d))
        return max(self.min_delay, float(self.host_delays.get(host, 0.0)), rd)

    def _net(self, url: str, headers: dict | None = None) -> tuple[int, dict, bytes, str]:
        host = urllib.parse.urlsplit(url).hostname or ""
        if host in self.down:
            raise Refused(self.down[host])
        if host in self.last:
            wait = self._delay_for(host) - (self.clock() - self.last[host])
            if wait > 0:
                self.sleep(wait)
        self.last[host] = self.clock()
        self.requests.append(url)
        self.per_host[host] = self.per_host.get(host, 0) + 1
        try:
            return TRANSPORT(url, self.timeout, {"User-Agent": self.ua, "Accept": "*/*", **(headers or {})})
        except Refused:
            raise
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as e:
            self.down[host] = f"host unreachable earlier in this run ({type(e).__name__}: {e})"[:300]
            raise Refused(self.down[host]) from e

    def robots_for(self, url: str) -> tuple[list, float | None, str]:
        u = urllib.parse.urlsplit(url)
        origin = f"{u.scheme}://{u.netloc}"
        if origin not in self.robots:
            try:
                status, _h, body, _f = self._net(origin + "/robots.txt")
            except Refused as e:
                self.robots[origin] = ([(False, "/")], None, f"robots.txt unreachable ({e}); treated as disallow-all")
                return self.robots[origin]
            if 200 <= status < 300 and b"<html" not in body[:500].lower():
                rules, delay = parse_robots(body.decode("utf-8", "replace"), UA_TOKEN)
                self.robots[origin] = (rules, delay, f"robots.txt: {len(rules)} rule(s), crawl-delay {delay or 'none'}")
            elif 200 <= status < 300:
                self.robots[origin] = ([], None, "robots.txt answered with an HTML page: no rules")
            elif 400 <= status < 500:
                self.robots[origin] = ([], None, f"robots.txt HTTP {status}: no rules (RFC 9309)")
            else:
                self.robots[origin] = ([(False, "/")], None, f"robots.txt HTTP {status}: disallow-all (RFC 9309)")
        return self.robots[origin]

    def _cache_paths(self, url: str) -> tuple[str, str]:
        k = hashlib.sha256(url.encode()).hexdigest()
        return os.path.join(self.cache_dir, k + ".json"), os.path.join(self.cache_dir, k + ".body")

    def cached(self, url: str) -> tuple[dict, bytes] | None:
        meta_p, body_p = self._cache_paths(url)
        try:
            with open(meta_p, encoding="utf-8") as f:
                meta = json.load(f)
            with open(body_p, "rb") as f:
                return meta, f.read()
        except (OSError, ValueError):
            return None

    def _store(self, url: str, r: Response) -> None:
        if not self.use_cache:
            return
        os.makedirs(self.cache_dir, exist_ok=True)
        meta_p, body_p = self._cache_paths(url)
        with open(body_p, "wb") as f:
            f.write(r.body)
        with open(meta_p, "w", encoding="utf-8") as f:
            json.dump({"url": url, "final_url": r.final_url, "status": r.status, "etag": r.headers.get("etag"),
                       "last_modified": r.headers.get("last-modified"), "sha256": r.sha256,
                       "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)

    # ── public ───────────────────────────────────────────────────────────────────────────────────────────────────
    def get(self, url: str) -> Response:
        """Robots-checked, rate-limited, cached GET. Raises Refused."""
        why = non_public_reason(url)
        if why:
            raise Refused(why)
        rules, _d, note = self.robots_for(url)
        if not robots_allows(rules, url):
            raise Refused(f"robots.txt disallows {urllib.parse.urlsplit(url).path} ({note})")
        cond: dict = {}
        prev = self.cached(url) if self.use_cache else None
        if prev:
            if prev[0].get("etag"):
                cond["If-None-Match"] = prev[0]["etag"]
            if prev[0].get("last_modified"):
                cond["If-Modified-Since"] = prev[0]["last_modified"]
        status, h, body, final = self._net(url, cond)
        host = urllib.parse.urlsplit(url).hostname or ""
        if status == 304 and prev:
            return Response(url, prev[0].get("final_url") or url, 200, h, prev[1], from_cache=True, robots_note=note)
        if status in REFUSAL:
            self.down[host] = f"host refused automated access (HTTP {status}); not retried in this run, not bypassed"
        r = Response(url, final or url, status, h, body, robots_note=note)
        if 200 <= status < 300:
            self._store(url, r)
        return r


def purge_cache(cache_dir: str | None = None) -> int:
    d = cache_dir or default_cache_dir()
    n = 0
    if os.path.isdir(d):
        for f in os.listdir(d):
            if f.endswith((".json", ".body")):
                os.remove(os.path.join(d, f))
                n += 1
    return n
