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


def test_street_design_quantities_unit():
    """Street elements and bus lanes drawn in Design (docs/urbanos/DESIGN_TOOLS_P7.md): kind, item counts, path length,
    bus-lane lane length. SYNTHETIC objects."""
    from planning import quantities as Q
    path = {"type": "street_element", "coordinates": [_pt(0, 0), _pt(100, 0)],
            "properties": {"kind": "path", "path": {"pathType": "cycle_two_way", "level": "ground", "widthM": 3.0}}}
    q = Q.object_quantities(path)
    assert 99 < q["length_m"] < 101 and "cycle track (two-way)" in q["detail"] and q["level"] == "at ground level"
    lights = {"type": "street_element", "coordinates": [_pt(0, 0)],
              "properties": {"kind": "streetlight", "roadside": {"count": 5, "spacingM": 30, "poleHeightM": 10, "zone": "furniture",
                                                                 "points": [_pt(30 * i, 5) for i in range(4)]}}}
    q = Q.object_quantities(lights)
    assert q["count"] == 4 and q["length_m"] is None and "4 pole(s)" in q["detail"]   # the placed points, not the asked count
    trees = {"type": "street_element", "coordinates": [_pt(0, 0)], "properties": {"kind": "street_tree", "roadside": {"count": 3, "points": []}}}
    q = Q.object_quantities(trees)
    assert q["count"] == 3 and "pit UNKNOWN" in q["detail"]
    rb = {"type": "street_element", "coordinates": [_pt(0, 0)],
          "properties": {"kind": "roundabout", "roundabout": {"category": "urban_single", "icdM": 32, "islandM": 12, "circulatoryM": 10, "armCount": 4}}}
    assert "ICD 32.0 m" in Q.object_quantities(rb)["detail"]
    road = {"type": "road", "coordinates": [_pt(0, 0), _pt(500, 0)],
            "properties": {"laneCount": 4, "busPriority": {"kind": "brt", "directions": "both", "laneWidthM": 3.5, "dividerM": 0.5}}}
    q = Q.object_quantities(road)
    assert "BRT (both directions, 3.5 m lane, divider 0.5 m)" in q["detail"]
    assert 990 < q["bus_lane_m"] < 1010                                  # 500 m x 2 directions
    one = {**road, "properties": {**road["properties"], "busPriority": {"kind": "bus_lane", "directions": "forward", "laneWidthM": 3.5, "dividerM": None}}}
    assert 495 < Q.object_quantities(one)["bus_lane_m"] < 505
    assert Q.object_quantities({**road, "properties": {"laneCount": 4}}).get("bus_lane_m") is None
    rows = [{"type": "street_element", "op": "add", "q": Q.object_quantities(x)} for x in (path, lights, trees, rb)] + \
           [{"type": "road", "op": "modify", "q": Q.object_quantities(road)}]
    tot = Q.totals(rows)
    assert 99 < tot["path"] < 101 and 990 < tot["bus_lane"] < 1010 and "street_element" not in tot
    assert Q.street_counts(rows) == {"streetlight": 4, "street_tree": 3, "roundabout": 1}


def test_planning_report_lists_street_elements_and_a_bus_lane_on_a_changed_base_road(client):
    from database.connection import SessionLocal
    from planning.models import PlanningProjectEntity
    from planning.report import build_model
    sid = "syn_alt_street"
    assert client.post("/api/scenarios", json={"id": sid, "name": "SYNTHETIC street alt", "description": "SYNTHETIC", "year": 2026}).status_code == 201
    base = {"id": "sq_base_road", "type": "road", "name": "SYNTHETIC base arterial", "scenarioId": "base",
            "coordinates": [_pt(0, 2000), _pt(800, 2000)], "properties": {"laneCount": 4, "isOneWay": False, "speedLimit": 50}}
    _post(client, base, "roads")
    mod = {**base, "scenarioId": sid, "layerId": "roads",
           "properties": {**base["properties"], "busPriority": {"kind": "bus_lane", "directions": "both", "laneWidthM": 3.5, "dividerM": None, "appliedAt": "2026-11-22"}}}
    assert client.post(f"/api/scenarios/{sid}/changes", json=[{"objectId": base["id"], "op": "modify", "object": mod}]).status_code == 200
    _post(client, {"id": "se_sq_x", "type": "street_element", "name": "SYNTHETIC crossing", "scenarioId": sid, "coordinates": [_pt(400, 2000)],
                   "properties": {"kind": "crossing", "anchor": {"roadId": base["id"], "chainageM": 400, "offsetM": 0, "side": "left"},
                                  "crossing": {"crossingType": "signalised", "widthM": 3, "refuge": True, "refugeWidthM": 1.5}}}, "street_elements")
    _post(client, {"id": "se_sq_s", "type": "street_element", "name": "SYNTHETIC stop", "scenarioId": sid, "coordinates": [_pt(200, 2005)],
                   "properties": {"kind": "bus_stop", "busStop": {"placement": "kerb", "shelterLengthM": 10, "shelterDepthM": 1.5}}}, "street_elements")
    pid = client.post("/api/planning/projects", json={"name": "SYNTHETIC street project", "description": "SYNTHETIC", "created_by": "T"}).json()["id"]
    assert client.post(f"/api/planning/projects/{pid}/links", json={"entity_type": "scenario", "entity_id": sid, "added_by": "T"}).status_code == 201
    db = SessionLocal()
    try:
        m = build_model(db, db.get(PlanningProjectEntity, pid))
    finally:
        db.close()
    sec = m.sections[3]
    rows = {r[0]: r for r in next(b for b in sec.blocks if b.kind == "table" and "Plan length" in (b.header or [])).rows}
    assert rows["SYNTHETIC crossing"][1] == "Street element" and "signalised" in rows["SYNTHETIC crossing"][7] and "refuge 1.5 m" in rows["SYNTHETIC crossing"][7]
    assert "kerb-side" in rows["SYNTHETIC stop"][7]
    assert rows["SYNTHETIC base arterial"][2] == "changes an existing object" and "bus lane (both directions" in rows["SYNTHETIC base arterial"][7]
    notes = " ".join(b.text or "" for b in sec.blocks if b.kind == "note")
    assert "Bus / BRT lane (lane length) 1.6" in notes          # 800 m x 2 directions
    assert "1 pedestrian crossing(s)" in notes and "1 bus stop(s)" in notes


def test_a_subway_drawn_in_design_is_screened_as_a_dug_box_and_other_street_elements_are_not():
    """DESIGN_TOOLS_P7.md §8: a pedestrian / cycle subway goes into the ground; crossings, stops, lights, trees, roundabouts,
    ground paths and FOBs do not change the Underground inputs. SYNTHETIC objects."""
    def path(oid, level, sid="alt"):
        return {"id": oid, "type": "street_element", "name": oid, "scenarioId": sid, "coordinates": [_pt(-20, 300), _pt(20, 300)],
                "properties": {"kind": "path", "path": {"pathType": "footpath", "level": level, "widthM": 3.0, "clearHeightM": 2.75}}}
    sub = path("sub", "subway")
    a = S.design_asset(sub, "proposed")
    assert a is not None and a.cls == "tunnel" and a.method == "cut_and_cover"
    assert a.half_width == 1.5 and a.envelope() == (0.0, None)               # dug from the surface; invert UNKNOWN
    assert "UNKNOWN" in a.kind_label
    assert S.design_asset(path("fob", "fob"), "proposed") is None
    assert S.design_asset(path("gp", "ground"), "proposed") is None
    crossing = {"id": "x", "type": "street_element", "name": "x", "scenarioId": "alt", "coordinates": [_pt(0, 300)], "properties": {"kind": "crossing"}}
    assert S.is_screened(sub) and not S.is_screened(crossing) and not S.is_screened(path("fob", "fob"))
    f = flyover("F")
    h0 = S.inputs_hash([f], "alt")
    assert S.inputs_hash([f, crossing, path("fob", "fob")], "alt") == h0      # nothing screened changed
    assert S.inputs_hash([f, sub], "alt") != h0
    prop, _, skipped = S.classify_objects([sub, crossing], "alt")
    assert [x.id for x in prop] == ["sub"] and skipped == []
