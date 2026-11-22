"""A drawn curved road (PI + radius `alignment`) saved through the objects API and loaded again keeps its alignment
exactly. The row is tests/fixtures/objects/drawn_curved_road.json: what the app POSTs for a road drawn with the Road
tool (3 clicks, auto curve), checked against the app by frontend/src/engine/testing/AlignmentRoundTrip.test.ts, which
also checks that this row, as GET returns it, loads back into the same alignment in the shape editor. Synthetic."""
import copy
import json
import uuid
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "objects" / "drawn_curved_road.json"


def _row(client, oid):
    rows = [o for o in client.get("/api/objects", params={"scenario_id": "base"}).json() if o["id"] == oid]
    assert len(rows) == 1
    return rows[0]


def _fixture(oid):
    row = json.loads(FIXTURE.read_text())
    row["id"] = oid
    return row


def test_fixture_is_a_curved_road():
    a = json.loads(FIXTURE.read_text())["properties"]["alignment"]
    assert len(a["pis"]) == 3 and a["pis"][1]["radiusM"] > 0 and a["pis"][0]["radiusM"] == 0


def test_save_and_reload_keeps_alignment(client):
    row = _fixture(f"syn_{uuid.uuid4().hex[:8]}")
    assert client.post("/api/objects", json=row).status_code == 201
    back = _row(client, row["id"])
    assert back == row                                              # the whole row, unchanged
    assert back["properties"]["alignment"] == row["properties"]["alignment"]
    assert back["coordinates"] == row["coordinates"]


def test_batch_save_and_reshape_keep_alignment(client):
    row = _fixture(f"syn_{uuid.uuid4().hex[:8]}")
    assert client.post("/api/objects/batch", json=[row]).status_code == 201
    assert _row(client, row["id"]) == row
    # A reshape saved over it (radius typed at the middle PI) replaces the alignment; nothing of the old one remains
    reshaped = copy.deepcopy(row)
    reshaped["properties"]["alignment"]["pis"][1].update(radiusM=55.5, radiusSource="user")
    assert client.post("/api/objects", json=reshaped).status_code == 201
    back = _row(client, row["id"])
    assert back["properties"]["alignment"]["pis"][1] == {**row["properties"]["alignment"]["pis"][1], "radiusM": 55.5, "radiusSource": "user"}
    assert back == reshaped
