"""Saved underground screening runs: reopening shows the last result, stale when objects / records / engine changed."""
from coordination import screening as S
from coordination import screening_runs as RUNS
from tests.test_underground_screening import FORBIDDEN, _line, _screen, align, util  # noqa: F401


def _objs(sid, depth=13.0):
    return [align("RT", _line(-200, 500, 200, 500), "bored_tunnel", [12, 12], 6.0, sid=sid),
            util("RW", _line(0, 460, 0, 540), "water", depth, 300, sid=sid)]


def _latest(client, sid, objects):
    r = client.post("/api/coordination/underground/runs/latest", json={"scenario_id": sid, "objects": objects})
    assert r.status_code == 200, r.text
    return r.json()


def test_never_checked_alternative_has_no_run(client):
    assert _latest(client, "runs_none", [])["run"] is None


def test_run_is_saved_and_reopened_fresh(client):
    sid = "runs_a"
    run = _screen(client, _objs(sid), sid=sid)
    assert run["run_id"].startswith("ugs_") and run["saved_at"] and len(run["inputs_hash"]) == 24
    got = _latest(client, sid, _objs(sid))
    assert got["stale"] is False and got["stale_reasons"] == []
    assert got["run"]["run_id"] == run["run_id"] and got["run"]["findings"] == run["findings"]
    assert got["run"]["summary"]["counts"] == run["summary"]["counts"] and got["run"]["banner"] == run["banner"]
    lst = client.get("/api/coordination/underground/runs", params={"scenario_id": sid}).json()
    assert lst[0]["run_id"] == run["run_id"] and lst[0]["findings_count"] == len(run["findings"]) and lst[0]["summary"]["counts"]


def test_reopened_run_is_stale_when_objects_changed(client):
    sid = "runs_b"
    _screen(client, _objs(sid), sid=sid)
    got = _latest(client, sid, _objs(sid, depth=2.0))                       # the water main was lowered / raised
    assert got["stale"] is True and any("Objects" in r for r in got["stale_reasons"])
    # timestamps and display state do not make a result stale
    touched = _objs(sid)
    for o in touched:
        o["properties"]["updatedAt"] = "2030-01-01T00:00:00Z"
    assert _latest(client, sid, touched)["stale"] is False
    # an object added
    assert _latest(client, sid, _objs(sid) + [util("RX", _line(50, 460, 50, 540), "gas", 1.2, 100, sid=sid)])["stale"] is True


def test_stale_when_engine_or_records_changed(client):
    sid = "runs_c"
    _screen(client, _objs(sid), sid=sid)
    from database.connection import SessionLocal
    with SessionLocal() as db:
        e = RUNS.latest(db, sid)
        e.engine_version = "underground-screening 0.9"
        e.data_hash = "0" * 16
        db.commit()
        st = RUNS.staleness(db, e, _objs(sid))
    assert st["stale"] and len(st["stale_reasons"]) == 2


def test_focus_runs_are_not_saved_and_old_runs_pruned(client):
    sid = "runs_d"
    r = client.post("/api/coordination/underground/screen", json={"scenario_id": sid, "objects": _objs(sid), "focus_ids": ["RT"]}).json()
    assert "run_id" not in r and _latest(client, sid, _objs(sid))["run"] is None
    for _ in range(RUNS.RUNS_KEPT + 2):
        _screen(client, _objs(sid), sid=sid)
    assert len(client.get("/api/coordination/underground/runs", params={"scenario_id": sid}).json()) == RUNS.RUNS_KEPT


def test_inputs_hash_same_for_ui_and_database_shapes():
    a = _objs("alt")
    b = [dict(o, properties={**o["properties"], "createdAt": "x", "layerId": "underground"}) for o in reversed(a)]
    assert S.inputs_hash(a, "alt") == S.inputs_hash(b, "alt")
    assert S.inputs_hash(a, "alt") != S.inputs_hash(a, "alt2")
    assert S.inputs_hash(a, "alt") != S.inputs_hash(a, "alt", {"rules": {"C1": 4.0}})
