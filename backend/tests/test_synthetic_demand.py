"""SYNTHETIC land-use demand served to the app (synthetic/demand.py, docs/urbanos/DEMAND_P14.md)."""
import csv
import gzip
import json

import pytest
from fastapi.testclient import TestClient

from synthetic import demand


def _doc(**over):
    hourly = {p: {"out": [1 / 24] * 24, "ret": [1 / 24] * 24} for p in ("HBW", "HBE", "HBO", "NHB", "FRT")}
    d = {"schema": demand.SCHEMA, "id": "pune_synthetic_demand_t", "label": "synthetic", "status": "synthetic", "zones": [],
         "impedance": {}, "gravity": {}, "hourly": hourly, "skeleton": {}, "modeSplit": {}}
    d.update(over)
    return d


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("URBANOS_SYNTHETIC_DEMAND_DIR", str(tmp_path))
    demand._DOCS.clear(); demand._ENDS.clear()
    (tmp_path / "pune_synthetic_demand_t.json").write_text(json.dumps(_doc()))
    with gzip.open(tmp_path / "trip_ends.csv.gz", "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(demand.COLUMNS)
        w.writerow([73.85, 18.52, 3, 10.5, 2, 1, 0, 0])
        w.writerow([73.95, 18.62, 4, 0, 40, 0, 0, 40])
    yield tmp_path
    demand._DOCS.clear(); demand._ENDS.clear()


def test_file_must_be_labelled_synthetic():
    assert not demand.validate(_doc())
    assert any("synthetic" in p for p in demand.validate(_doc(status="measured")))
    assert any("synthetic" in p for p in demand.validate(_doc(label="estimated")))
    bad = _doc(); bad["hourly"]["HBW"]["out"] = [0.5] * 24
    assert any("hourly.HBW.out" in p for p in demand.validate(bad))


def test_list_load_and_trip_ends_by_box(store):
    assert demand.list_files() == ["pune_synthetic_demand_t"]
    assert demand.load("pune_synthetic_demand_t")["label"] == "synthetic"
    got = demand.trip_ends("pune_synthetic_demand_t", 73.8, 18.5, 73.9, 18.6)
    assert got["label"] == "synthetic" and got["columns"] == demand.COLUMNS
    assert got["rows"] == [[73.85, 18.52, 3, 10.5, 2.0, 1.0, 0.0, 0.0]]
    with pytest.raises(ValueError):
        demand.trip_ends("pune_synthetic_demand_t", 73.0, 18.0, 74.0, 19.0)  # far larger than a study area
    with pytest.raises(KeyError):
        demand.load("nope")


def test_api(store):
    from main import app
    c = TestClient(app)
    assert c.get("/api/synthetic-demand").json()["files"] == ["pune_synthetic_demand_t"]
    assert c.get("/api/synthetic-demand/pune_synthetic_demand_t").json()["status"] == "synthetic"
    r = c.get("/api/synthetic-demand/pune_synthetic_demand_t/trip-ends", params={"min_lng": 73.9, "min_lat": 18.6, "max_lng": 74.0, "max_lat": 18.7})
    assert r.status_code == 200 and len(r.json()["rows"]) == 1
    assert c.get("/api/synthetic-demand/nope").status_code == 404
    assert c.get("/api/synthetic-demand/pune_synthetic_demand_t/trip-ends", params={"min_lng": 73, "min_lat": 18, "max_lng": 74, "max_lat": 19}).status_code == 400
