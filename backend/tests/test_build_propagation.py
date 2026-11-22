"""
Design builds as built (docs/urbanos/BUILD_PROPAGATION.md): what goes into the ground with a drawn flyover, double-deck or
elevated metro (its pier foundations) is screened by the Underground checks, and the planning report lists the built
works of an attached alternative with their quantities. All geometry here is SYNTHETIC (made up for tests, not Pune data).
"""
import json

from coordination import screening as S
from coordination import screening_config as C

LAT = 18.4405        # synthetic corridor, away from the other test files' corridors
LON = 73.7500
K = 1 / 105000.0


def _pt(dx, dy, z=0.0):
    return [LON + dx * K, LAT + dy * K / 1.06, z]


def flyover(oid, sid="alt", t="flyover", spacing=30.0, deck=6.5, length=400):
    # ramps from grade: 0 m at the ends, deck height in the middle (as applyFlyoverElevationProfile stores it)
    n = 9
    coords = []
    for i in range(n):
        x = -length / 2 + length * i / (n - 1)
        h = deck * min(1.0, min(i, n - 1 - i) / 2)
        coords.append(_pt(x, 0, h))
    return {"id": oid, "type": t, "name": oid, "scenarioId": sid, "coordinates": coords,
            "properties": {"pierSpacing": spacing, "elevation": deck, "laneCount": 4, "width": 16,
                           "groundCoordinates": [[c[0], c[1], 0.0] for c in coords]}}


def util(oid, coords, utype, depth, dia_mm, sid="base", **p):
    return {"id": oid, "type": "utility", "name": oid, "scenarioId": sid, "coordinates": coords,
            "properties": {"utilityType": utype, "depth": depth, "diameterMm": dia_mm, **p}}


def test_pier_points_follow_the_3d_view_rule():
    f = flyover("F")
    pts = S.pier_points(f["coordinates"], f["properties"]["groundCoordinates"], 30.0, S.PIER_MIN_DECK_M)
    # 400 m deck, first pier 15 m in, every 30 m → 13 stations; the ramp ends (deck < 3 m) carry none
    assert 8 <= len(pts) < 13
    xs = sorted((p[0] - LON) / K for p in pts)
    assert xs[0] > -200 + 15 and xs[-1] < 200 - 15
    # an elevated metro: a pier at every station
    assert len(S.pier_points(f["coordinates"], None, 30.0, None)) == 13     # ~401 m line: 15 m + 12 x 30 m


def test_drawn_flyover_and_double_deck_screen_their_pier_foundations():
    for t in ("flyover", "metro_flyover"):
        a = S.design_asset(flyover("F", t=t), "proposed")
        assert a is not None and a.cls == "pier_foundation" and a.geom.geom_type == "MultiPoint"
        assert a.half_width is None                                   # pile cap size UNKNOWN, never assumed
        assert a.envelope() == (0.0, None)                            # from ground down, pile depth UNKNOWN
        assert "UNKNOWN" in a.kind_label and a.meta["pier_count"] == len(a.geom.geoms)


def test_proposed_elevated_metro_is_screened_by_its_piers_and_existing_stays_a_metro_structure():
    m = {"id": "M", "type": "metro_line", "name": "M", "scenarioId": "alt",
         "coordinates": [_pt(-200, 50, 12), _pt(200, 50, 12)], "properties": {"elevation": 12, "pierSpacing": 30}}
    p = S.design_asset(m, "proposed")
    assert p is not None and p.cls == "pier_foundation"
    e = S.design_asset({**m, "scenarioId": "base"}, "existing")
    assert e is not None and e.cls == "metro_viaduct"


def test_pier_rule_is_a_referral_not_a_clearance():
    r = C.requirement(C.effective(), "pier_foundation", "sewer", None, 0.6)
    assert [x["id"] for x in r["rows"]] == ["PF1"] and r["specialist"]
    t = C.requirement(C.effective(), "tunnel", "pier_foundation", 6.0, None)
    assert {"C19", "PF1"} <= {x["id"] for x in t["rows"]} and t["horizontal_m"] == 6.0   # 1 x tunnel diameter referral


def _screen(client, objs, sid="alt"):
    r = client.post("/api/coordination/underground/screen", json={"scenario_id": sid, "objects": objs})
    assert r.status_code == 200, r.text
    return r.json()


def test_screening_run_flags_a_sewer_under_a_proposed_flyover_pier(client):
    f = flyover("FLY")
    a = S.design_asset(f, "proposed")
    px, py = a.geom.geoms[len(a.geom.geoms) // 2].coords[0]
    lon, lat = S.G.from_utm(px, py)
    sew = util("SEW", [[lon, lat - 40 * K, 0], [lon, lat + 40 * K, 0]], "sewage", 3.0, 600)   # crosses right at a pier
    far = util("FAR", [_pt(-170, -300), _pt(-170, -260)], "water", 1.0, 150)                   # far away
    run = _screen(client, [f, sew, far])
    checked = {p["id"]: p for p in run["summary"]["proposed_checked"]}
    assert "FLY" in checked
    assert any(c["check"] == "Cover and depth" and c["result"] == S.CHECK_NOT for c in checked["FLY"]["checklist"])
    hit = [x for x in run["findings"] if x["proposed"]["id"] == "FLY" and (x.get("other") or {}).get("id") == "SEW"]
    assert hit and hit[0]["status"] in ("requires_investigation", "insufficient_data")       # never a pass, never a made-up conflict
    assert any("PF1" == r["id"] for r in hit[0]["rules"])
    assert not [x for x in run["findings"] if (x.get("other") or {}).get("id") == "FAR"]
    # the run's input hash changes when the flyover moves (stale detection reads it)
    g = json.loads(json.dumps(f))
    g["coordinates"] = [[c[0] + 50 * K, c[1], c[2]] for c in g["coordinates"]]
    assert S.inputs_hash([f, sew], "alt") != S.inputs_hash([g, sew], "alt")


def test_proposed_tunnel_under_an_existing_drawn_flyover_meets_its_piers(client):
    f = flyover("BASEFLY", sid="base")
    a = S.design_asset(f, "existing")
    px, py = a.geom.geoms[3].coords[0]
    lon, lat = S.G.from_utm(px, py)
    t = {"id": "TUN", "type": "underground_alignment", "name": "TUN", "scenarioId": "alt",
         "coordinates": [[lon, lat - 100 * K, 0], [lon, lat + 100 * K, 0]],
         "properties": {"alignmentKind": "bored_tunnel", "section": {"shape": "circular", "diameterM": 6.0}, "sectionCertainty": "estimated",
                        "depths": [{"crownDepthM": 15, "certainty": "estimated"}, {"crownDepthM": 15, "certainty": "estimated"}]}}
    run = _screen(client, [f, t])
    hit = [x for x in run["findings"] if x["proposed"]["id"] == "TUN" and (x.get("other") or {}).get("id") == "BASEFLY"]
    assert hit and hit[0]["other"]["kind"] == "pier_foundation"
    # a 15 m deep bore under piers of unknown pile depth: the vertical gap cannot be established → not a pass
    assert hit[0]["status"] == "insufficient_data" and any("Vertical separation cannot be established" in x for x in hit[0]["found"])


def _post(client, o, layer):
    r = client.post("/api/objects", json={**{k: o[k] for k in ("id", "type", "name", "scenarioId", "coordinates")},
                                          "layerId": layer, "properties": o["properties"]})
    assert r.status_code == 201, r.text


def test_project_detection_sees_the_piers_of_a_flyover_drawn_in_an_attached_alternative(client):
    sid = "syn_alt_piers"
    assert client.post("/api/scenarios", json={"id": sid, "name": "SYNTHETIC alt piers", "description": "SYNTHETIC", "year": 2026}).status_code == 201
    f = flyover("pd_fly", sid=sid)
    _post(client, f, "flyovers")
    a = S.design_asset(f, "proposed")
    px, py = a.geom.geoms[4].coords[0]
    lon, lat = S.G.from_utm(px, py)
    pid = client.post("/api/planning/projects", json={"name": "SYNTHETIC pier project", "description": "SYNTHETIC", "created_by": "T"}).json()["id"]
    el = client.post(f"/api/coordination/projects/{pid}/elements", json={
        "kind": "pipeline", "name": "SYNTHETIC trunk main", "created_by": "T", "width_m": 1.0, "z_min_m": -4, "z_max_m": -3,
        "geometry": {"type": "LineString", "coordinates": [[lon, lat - 50 * K], [lon, lat + 50 * K]]}})
    assert el.status_code == 201, el.text
    assert client.post(f"/api/planning/projects/{pid}/links", json={"entity_type": "scenario", "entity_id": sid, "added_by": "T"}).status_code == 201
    run = client.post(f"/api/coordination/projects/{pid}/detect", json={"run_by": "T"}).json()
    hits = [c for c in run["conflicts"] if c["b_type"] == "design_object" and c["b_ref"] == "design:pd_fly"]
    assert hits and hits[0]["class"] != "no_conflict_within_available_data"


def test_planning_report_lists_the_built_works_of_an_attached_alternative_with_quantities(client):
    from database.connection import SessionLocal
    from planning.models import PlanningProjectEntity
    from planning.report import build_model
    sid = "syn_alt_report"
    assert client.post("/api/scenarios", json={"id": sid, "name": "SYNTHETIC report alt", "description": "SYNTHETIC", "year": 2026}).status_code == 201
    base_road = {"id": "rq_base_road", "type": "road", "name": "SYNTHETIC base road", "scenarioId": "base",
                 "coordinates": [_pt(0, -500), _pt(0, -100)], "properties": {"laneCount": 2, "isOneWay": False, "speedLimit": 40}}
    _post(client, base_road, "roads")
    new_road = {"id": "rq_new_road", "type": "road", "name": "SYNTHETIC new road", "scenarioId": sid,
                "coordinates": [_pt(0, 0), _pt(1000, 0)], "properties": {"laneCount": 4, "isOneWay": False, "hasDivider": True, "speedLimit": 60}}
    _post(client, new_road, "roads")
    _post(client, flyover("rq_fly", sid=sid), "flyovers")
    assert client.post(f"/api/scenarios/{sid}/changes", json=[{"objectId": "rq_base_road", "op": "delete"}]).status_code in (200, 201)
    pid = client.post("/api/planning/projects", json={"name": "SYNTHETIC report project", "description": "SYNTHETIC", "created_by": "T"}).json()["id"]
    assert client.post(f"/api/planning/projects/{pid}/links", json={"entity_type": "scenario", "entity_id": sid, "added_by": "T"}).status_code == 201
    db = SessionLocal()
    try:
        m = build_model(db, db.get(PlanningProjectEntity, pid))
    finally:
        db.close()
    sec = m.sections[3]
    tables = [b for b in sec.blocks if b.kind == "table" and "Plan length" in (b.header or [])]
    assert tables, [b.kind for b in sec.blocks]
    rows = {r[0]: r for r in tables[0].rows}
    assert rows["SYNTHETIC new road"][2] == "new" and rows["SYNTHETIC new road"][4] == "4"
    L = float(rows["SYNTHETIC new road"][3].replace(" m", "").replace(",", ""))
    assert 990 < L < 1010
    assert rows["SYNTHETIC base road"][2] == "removes an existing object"
    assert int(rows["rq_fly"][6]) > 0 and "deck" in rows["rq_fly"][5]
    notes = " ".join(b.text or "" for b in sec.blocks if b.kind == "note")
    assert "new piers" in notes and "not measured" in notes
