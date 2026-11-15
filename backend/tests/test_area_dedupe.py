"""Coverage boxes (area_osmroads_*) are not stored twice for the same bbox. SYNTHETIC coordinates."""


def _box(i, x0=73.10, y0=17.10, x1=73.11, y1=17.11, name="Roads loaded for a study area"):
    return {"id": f"area_osmroads_t{i}", "name": name, "polygonCoordinates": [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [x0, y0, 0]],
            "minLat": y0, "maxLat": y1, "minLon": x0, "maxLon": x1}


def test_identical_coverage_box_not_duplicated(client):
    assert client.post("/api/areas", json=_box(1)).status_code == 201
    r = client.post("/api/areas", json=_box(2))
    assert r.status_code == 201 and r.json().get("duplicate") is True and r.json()["id"] == "area_osmroads_t1"
    ids = [a["id"] for a in client.get("/api/areas").json()]
    assert "area_osmroads_t1" in ids and "area_osmroads_t2" not in ids
    # a different box is stored
    assert client.post("/api/areas", json=_box(3, x0=73.11, x1=73.12)).json().get("duplicate") is None
    assert "area_osmroads_t3" in [a["id"] for a in client.get("/api/areas").json()]


def test_user_study_areas_with_same_box_are_kept(client):
    b = _box(9, x0=73.20, x1=73.21)
    for i in ("user_sa_1", "user_sa_2"):
        assert client.post("/api/areas", json={**b, "id": i, "name": "My study area"}).status_code == 201
    ids = [a["id"] for a in client.get("/api/areas").json()]
    assert "user_sa_1" in ids and "user_sa_2" in ids
