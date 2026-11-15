"""The cached Overpass proxy used when the local OSM index is missing (fresh clone): cache, mirrors, honesty."""

import pytest

import api.osm_router as osm_router
from osm.index import OsmIndex
from osm.overpass import OverpassProxy, UpstreamError

Q = '[out:json][timeout:50];(way["highway"](18.50,73.82,18.51,73.83););out geom;'
ANSWER = {"version": 0.6, "elements": [{"type": "way", "id": 1, "tags": {"highway": "primary"}, "geometry": [{"lon": 73.82, "lat": 18.50}, {"lon": 73.83, "lat": 18.51}]}]}


class Res:
    def __init__(self, status, body=None, headers=None, text=""):
        self.status_code, self._body, self.headers, self.text = status, body, headers or {}, text

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def proxy(tmp_path, answers, **kw):
    calls = []
    clock = {"t": 1_800_000_000.0}

    def get(url, params=None, headers=None, timeout=None):
        calls.append((url, params["data"], headers["User-Agent"]))
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a

    p = OverpassProxy(cache_path=str(tmp_path / "c.db"), endpoints=["https://a.test/api/interpreter", "https://b.test/api/interpreter"],
                      get=get, now=lambda: clock["t"], sleep=lambda s: clock.__setitem__("t", clock["t"] + s), **kw)
    return p, calls, clock


def test_caches_complete_answers_and_identifies_itself(tmp_path):
    p, calls, _ = proxy(tmp_path, [Res(200, ANSWER)])
    body, info = p.fetch(Q)
    assert body == ANSWER and info["cache"] == "miss" and info["endpoint"] == "a.test"
    assert "UrbanOS" in calls[0][2]
    again, info2 = p.fetch(Q)  # no second upstream call: the answers list is empty
    assert again == ANSWER and info2["cache"] == "hit" and len(calls) == 1
    # Runs of whitespace (line breaks, indentation) hit the same cache entry
    assert p.fetch("  " + Q.replace("out geom", "out\n   geom") + "\n")[1]["cache"] == "hit"


def test_busy_mirror_is_skipped_and_cooled_down(tmp_path):
    p, calls, _ = proxy(tmp_path, [Res(429, headers={"Retry-After": "120"}), Res(200, ANSWER)])
    body, info = p.fetch(Q)
    assert info["endpoint"] == "b.test" and [c[0] for c in calls] == ["https://a.test/api/interpreter", "https://b.test/api/interpreter"]
    assert p._cooldown["https://a.test/api/interpreter"] > p.now() + 100


def test_incomplete_answers_are_not_cached(tmp_path):
    partial = {"elements": [], "remark": "runtime error: Query timed out in \"query\" at line 1 after 51 seconds."}
    p, calls, _ = proxy(tmp_path, [Res(200, partial), Res(200, partial)])
    with pytest.raises(UpstreamError) as err:
        p.fetch(Q)
    assert "incomplete" in str(err.value)
    assert p.cached(Q) is None


def test_all_mirrors_down_reports_each(tmp_path):
    import requests
    p, calls, _ = proxy(tmp_path, [requests.ConnectionError("x"), Res(504)])
    with pytest.raises(UpstreamError) as err:
        p.fetch(Q)
    assert err.value.attempts == ["a.test: ConnectionError", "b.test: busy (HTTP 504)"]
    # Both are cooling down now: the next call does not hit them again
    with pytest.raises(UpstreamError) as again:
        p.fetch(Q)
    assert again.value.retry_after_s and len(calls) == 2


def test_daily_budget_and_spacing(tmp_path):
    p, calls, clock = proxy(tmp_path, [Res(200, ANSWER), Res(200, ANSWER)], daily_budget=1)
    start = clock["t"]
    p.fetch(Q)
    with pytest.raises(UpstreamError) as err:
        p.fetch(Q.replace("18.51", "18.52"))
    assert "budget" in str(err.value) and len(calls) == 1
    # Expired cache entries are fetched again (one request at least 1 s after the last)
    (tmp_path / "ttl").mkdir()
    p2, calls2, clock2 = proxy(tmp_path / "ttl", [Res(200, ANSWER), Res(200, ANSWER)], ttl_s=10)
    p2.fetch(Q)
    clock2["t"] += 11
    assert p2.fetch(Q)[1]["cache"] == "miss" and len(calls2) == 2
    assert clock["t"] >= start


def test_routes_status_and_proxy(client, tmp_path, monkeypatch):
    monkeypatch.setattr(osm_router, "index", OsmIndex(str(tmp_path / "missing.db")))
    p, calls, _ = proxy(tmp_path, [Res(200, ANSWER), Res(503), Res(503)])
    monkeypatch.setattr(osm_router, "overpass", p)
    st = client.get("/api/osm/status").json()
    assert st["available"] is False and "osm.build_index" in st["buildCommand"] and st["reason"]
    assert st["overpass"]["endpoints"] == ["a.test", "b.test"] and st["overpass"]["dailyBudget"] > 0
    # Index endpoints still say how to build it
    r = client.get("/api/osm/ways", params={"bbox": "73.82,18.50,73.83,18.51"})
    assert r.status_code == 404 and "osm.build_index" in r.json()["detail"]
    ok = client.get("/api/osm/overpass", params={"data": Q})
    assert ok.status_code == 200 and ok.json() == ANSWER and ok.headers["X-Overpass-Cache"] == "miss"
    assert client.get("/api/osm/overpass", params={"data": Q}).headers["X-Overpass-Cache"] == "hit"
    bad = client.get("/api/osm/overpass", params={"data": Q.replace("18.51", "18.53")})
    assert bad.status_code == 502 and bad.json()["detail"]["upstream"] is True and len(bad.json()["detail"]["attempts"]) == 2
    assert client.get("/api/osm/overpass", params={"data": "node(1,2,3,4);out;"}).status_code == 400
