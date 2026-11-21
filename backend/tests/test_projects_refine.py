"""
Projects workspace refinement (docs/urbanos/PROJECTS_AUDIT.md, 2026-11-21): one finding per physical OSM metro element
(study-area import + OSM index), drawn objects of attached alternatives, shared findings listed once, project edit / delete,
the project timeline without finding inserts, the one-call project summary, and the official source of the metro NOC rule.
All geometry and names SYNTHETIC.
"""
import uuid

import pytest

from coordination import geometry as G
from coordination import screening as SCR
from coordination import service as S
from tests.test_coordination import _area, _detect, _el, _line, _project  # noqa: F401  (_area is an autouse fixture)

LAT = 18.545           # a corridor of its own inside the shared SYNTHETIC test area
X0 = 73.852


def _scenario(client, name="SYNTHETIC alternative"):
    sid = f"scn_{uuid.uuid4().hex[:8]}"
    assert client.post("/api/scenarios", json={"id": sid, "name": name, "description": "SYNTHETIC", "year": 2030}).status_code == 201
    return sid


def _link(client, pid, sid):
    r = client.post(f"/api/planning/projects/{pid}/links", json={"entity_type": "scenario", "entity_id": sid, "added_by": "Planner T"})
    assert r.status_code == 201, r.text


def _object(client, oid, typ, coords, sid="base", **props):
    r = client.post("/api/objects", json={"id": oid, "type": typ, "name": props.pop("name", oid), "layerId": props.pop("layerId", "utilities"),
                                          "scenarioId": sid, "coordinates": coords, "properties": props})
    assert r.status_code == 201, r.text


def _fake_osm_metro(monkeypatch, way_id, coords):
    """A SYNTHETIC OSM index holding one underground metro way (the real index is optional in tests)."""
    def fake(boxes):
        g = {"type": "LineString", "coordinates": [c[:2] for c in coords]}
        segs = G.segments_for(f"osm_way_{way_id}", "metro_tunnel", g, width_m=None, z_min=None, z_max=None, certainty="estimated",
                              meta={"layer": "osm_metro", "osm_tags": {"name": "SYNTHETIC Purple Line", "tunnel": "yes"}})
        return segs, {"available": True, "bbox": [73.0, 18.0, 74.5, 19.0], "source": "SYNTHETIC", "dataTimestamp": "2026-11-21"}
    monkeypatch.setattr(S, "osm_metro_segments", fake)


def test_osm_ref_reads_study_area_import_ids_and_properties():
    assert SCR.osm_ref("osm_m_way_586112436_in_area_i8g6bedp0_0") == "osm_way_586112436"
    assert SCR.osm_ref("osm_m_node_7944597710") == "osm_node_7944597710"
    assert SCR.osm_ref("x", {"osmSourceId": "way/12"}) == "osm_way_12"
    assert SCR.osm_ref("x", {"osmElementType": "node", "osmId": 5}) == "osm_node_5"
    assert SCR.osm_ref("drawn_line_1", {}) is None


def test_metro_imported_by_study_area_is_one_finding_not_two(client, monkeypatch):
    """A1: the same OSM way as a base `metro_line` (two study-area clips) and in the OSM index gives ONE finding (OSM)."""
    way = 990001
    coords = [[X0, LAT - 0.002, -6], [X0, LAT + 0.002, -6]]
    for k, area in enumerate(("areaA", "areaB")):
        _object(client, f"osm_m_way_{way}_in_area_{area}_0", "metro_line", coords, layerId="metro", name="SYNTHETIC Purple Line",
                osmSourceId=f"way/{way}", osmElementType="way", osmId=way, deckWidth=8, elevation=-6)
    _fake_osm_metro(monkeypatch, way, coords)
    p = _project(client, "SYNTHETIC tunnel across the metro")
    e = _el(client, p, "tunnel", _line(X0 - 0.002, LAT, X0 + 0.002, LAT), width_m=6, z_min_m=-20, z_max_m=-14)
    run = _detect(client, p)
    metro = [c for c in run["conflicts"] if c["element_a_id"] == e["id"] and (c["b_type"] == "osm_metro" or "Purple" in str(c["evidence"].get("b", {}).get("name", "")))]
    assert [c["b_ref"] for c in metro] == [f"osm_way_{way}"], [c["b_ref"] for c in metro]
    assert metro[0]["class"] == "potential_conflict"          # metro depth UNKNOWN in OSM
    assert sorted(run["summary"]["osm_import_duplicates_skipped"]) == [f"osm_m_way_{way}_in_area_areaA_0", f"osm_m_way_{way}_in_area_areaB_0"]


def test_underground_screening_lists_imported_metro_once(client, monkeypatch):
    """A1 (Underground screening): '… Purple Line' (import) and '… Purple Line (OSM)' are one asset."""
    way = 990002
    coords = [[X0 + 0.01, LAT - 0.002, -6], [X0 + 0.01, LAT + 0.002, -6]]
    imported = {"id": f"osm_m_way_{way}", "type": "metro_line", "name": "SYNTHETIC Purple Line", "scenarioId": "base", "coordinates": coords,
                "properties": {"osmSourceId": f"way/{way}", "deckWidth": 8}}
    tunnel = {"id": "t_dup", "type": "underground_alignment", "name": "SYNTHETIC tunnel", "scenarioId": "alt",
              "coordinates": [[X0 + 0.008, LAT, 0], [X0 + 0.012, LAT, 0]],
              "properties": {"alignmentKind": "bored_tunnel", "section": {"shape": "circular", "diameterM": 6}, "sectionCertainty": "estimated",
                             "depths": [{"crownDepthM": 15, "certainty": "estimated"}, {"crownDepthM": 15, "certainty": "estimated"}]}}

    def fake_assets(boxes):
        g = G.project_geojson({"type": "LineString", "coordinates": [c[:2] for c in coords]})
        return [SCR.Asset(f"osm_way_{way}", "SYNTHETIC Purple Line (OSM)", "osm_metro", "existing", "metro_tunnel", g, None,
                          [(0.0, None, None)], "UNKNOWN", "unknown", {"id": "osm_index", "name": "OSM"})], {"available": True, "source": "SYNTHETIC"}
    monkeypatch.setattr(SCR, "osm_metro_assets", fake_assets)
    run = client.post("/api/coordination/underground/screen", json={"scenario_id": "alt", "objects": [imported, tunnel]}).json()
    others = {f["other"]["id"] for f in run["findings"] if f.get("other") and "Purple" in (f["other"].get("name") or "")}
    assert others == {f"osm_way_{way}"}, others
    osm_layer = next(x for x in run["layers"] if x["id"] == "osm_metro")
    assert "1 study-area import copy" in osm_layer["coverage"]


def test_utility_drawn_in_attached_alternative_is_checked_and_its_edit_makes_the_run_stale(client):
    """A3: nothing of the alternative registered; the element carries its own geometry."""
    p, sid = _project(client, "SYNTHETIC attached alt"), _scenario(client)
    _link(client, p, sid)
    x = X0 + 0.02
    _object(client, "alt_gas_1", "utility", [[x, LAT - 0.001, 0], [x, LAT + 0.001, 0]], sid=sid,
            utilityType="gas", depth=5.0, depthCertainty="hypothetical", diameterMm=200, status="proposed")
    e = _el(client, p, "tunnel", _line(x - 0.002, LAT, x + 0.002, LAT), width_m=6, z_min_m=-10, z_max_m=-4)
    run = _detect(client, p)
    hits = [c for c in run["conflicts"] if c["element_a_id"] == e["id"] and c["b_ref"] == "design:alt_gas_1"]
    assert hits and hits[0]["class"] == "conflict", [c["b_ref"] for c in run["conflicts"]]
    assert sid in run["inputs"]["design_scenarios"] and sid in run["inputs"]["design_heads"]
    st0 = client.get(f"/api/coordination/stale/coordination_run/{run['id']}").json()
    assert st0["stale"] is False, st0["reasons"]
    # the drawn utility is edited in its alternative → the run is stale
    r = client.post("/api/objects", json={"id": "alt_gas_2", "type": "utility", "name": "SYNTHETIC water", "layerId": "utilities", "scenarioId": sid,
                                          "coordinates": [[x + 0.001, LAT - 0.001, 0], [x + 0.001, LAT + 0.001, 0]], "properties": {"utilityType": "water", "depth": 1}})
    assert r.status_code == 201
    st = client.get(f"/api/coordination/stale/coordination_run/{run['id']}").json()
    assert st["stale"] is True and f"scenario_head_changed:{sid}" in st["reasons"]
    # attaching another alternative also makes it stale (its drawn objects were not checked)
    _link(client, p, _scenario(client, "SYNTHETIC second alternative"))
    assert "alternatives_attached_changed" in client.get(f"/api/coordination/stale/coordination_run/{run['id']}").json()["reasons"]


def test_shared_finding_is_listed_once_when_both_projects_ran_and_a_response_is_kept(client):
    """A2: A runs, B runs → each project sees the A↔B pair once; a response on the older copy is still shown."""
    a, b = _project(client, "SYNTHETIC agency A"), _project(client, "SYNTHETIC agency B")
    x = X0 + 0.03
    ea = _el(client, a, "metro_tunnel", _line(x - 0.002, LAT, x + 0.002, LAT), width_m=6, z_min_m=-18, z_max_m=-12)
    eb = _el(client, b, "pipeline", _line(x, LAT - 0.001, x, LAT + 0.001), width_m=1)       # depth UNKNOWN
    run_a = _detect(client, a)
    fa = next(c for c in run_a["conflicts"] if c["b_ref"] == eb["id"])
    _detect(client, b)                                                                          # B's copy, newer, still open
    # A acknowledges on its (older) copy after B's run
    assert client.patch(f"/api/coordination/conflicts/{fa['id']}/status", json={"status": "acknowledged", "actor": "Engineer A", "note": "SYNTHETIC survey asked"}).status_code == 200
    for pid in (a, b):
        r = client.get(f"/api/coordination/projects/{pid}/conflicts").json()
        pair = [i for i in r["issues"] if {i["element_a_id"], i["b_ref"]} == {ea["id"], eb["id"]}]
        assert len(pair) == 1, (pid, len(pair))
        assert pair[0]["status"] == "acknowledged" and pair[0]["status_by"] == "Engineer A"
        assert r["duplicates_merged"] >= 1
    # the summary counts the pair once and not as open
    summ = {p["id"]: p for p in client.get("/api/coordination/projects-summary").json()["projects"]}
    rows = client.get(f"/api/coordination/projects/{a}/conflicts").json()["issues"]
    open_a = sum(1 for i in rows if i["class"] in ("conflict", "potential_conflict") and i["status"] == "open")
    assert summ[a]["open_conflicts"] == open_a and summ[a]["checked"] and summ[b]["checked"]


def test_summary_says_not_checked_as_null_not_zero(client):
    p = _project(client, "SYNTHETIC never checked")
    s = {x["id"]: x for x in client.get("/api/coordination/projects-summary").json()["projects"]}[p]
    assert s["checked"] is False and s["open_conflicts"] is None and s["last_check"] is None
    assert s["elements"] == 0 and s["alternatives"] == 0


def test_edit_name_purpose_and_study_area(client):
    p = _project(client, "SYNTHETIC to rename")
    r = client.patch(f"/api/planning/projects/{p}", json={"edited_by": "Planner T", "name": "  SYNTHETIC renamed  ", "description": "New purpose",
                                                          "area_id": "coord_test_area"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["name"] == "SYNTHETIC renamed" and j["description"] == "New purpose" and j["area"]["id"] == "coord_test_area" and j["bbox"]
    assert client.patch(f"/api/planning/projects/{p}", json={"edited_by": "Planner T", "area_id": "nope"}).status_code == 422
    j = client.patch(f"/api/planning/projects/{p}", json={"edited_by": "Planner T", "area_id": ""}).json()
    assert j["area_id"] is None and j["bbox"] is None
    ev = client.get(f"/api/planning/projects/{p}/audit").json()["events"]
    assert any(e["action"] == "update" and "name" in (e["changed_fields"] or []) and e["actor"] == "Planner T" for e in ev)


def test_delete_project_removes_its_rows_keeps_linked_records_and_refuses_with_a_decision(client):
    a, b = _project(client, "SYNTHETIC delete me"), _project(client, "SYNTHETIC neighbour")
    sid = _scenario(client)
    _link(client, a, sid)
    x = X0 + 0.04
    _el(client, a, "metro_tunnel", _line(x - 0.002, LAT, x + 0.002, LAT), width_m=6, z_min_m=-18, z_max_m=-12)
    eb = _el(client, b, "pipeline", _line(x, LAT - 0.001, x, LAT + 0.001), width_m=1)
    _detect(client, a)
    run_b = _detect(client, b)
    assert client.delete(f"/api/planning/projects/{a}?removed_by=Planner%20T&confirm_name=wrong").status_code == 422
    r = client.delete(f"/api/planning/projects/{a}", params={"removed_by": "Planner T", "confirm_name": "SYNTHETIC delete me"})
    assert r.status_code == 200, r.text
    assert r.json()["elements"] == 1 and r.json()["runs"] == 1
    assert client.get(f"/api/planning/projects/{a}").status_code == 404
    assert any(s["id"] == sid for s in client.get("/api/planning/linkable").json()["scenario"])  # the alternative itself is kept
    assert all(p["id"] != a for p in client.get("/api/coordination/projects-summary").json()["projects"])
    # B keeps its own finding against the deleted project's element, and its run is now stale
    issues = client.get(f"/api/coordination/projects/{b}/conflicts").json()["issues"]
    assert any(i["element_a_id"] == eb["id"] and i["other_project"] == a for i in issues)
    st = client.get(f"/api/coordination/stale/coordination_run/{run_b['id']}").json()
    assert st["stale"] is True
    # a project with a recorded decision is kept
    c = _project(client, "SYNTHETIC decided")
    assert client.post(f"/api/planning/projects/{c}/decisions", json={"decision_text": "SYNTHETIC", "decided_by": "Officer T"}).status_code == 201
    assert client.delete(f"/api/planning/projects/{c}", params={"removed_by": "Planner T", "confirm_name": "SYNTHETIC decided"}).status_code == 409
    assert client.get(f"/api/planning/projects/{c}").status_code == 200
    # the audit log keeps the history of the deleted project
    ev = client.get("/api/planning/audit", params={"entity_type": "project", "entity_id": a}).json()
    assert any(e["action"] == "delete" for e in ev)


def test_project_timeline_hides_finding_inserts_but_counts_them(client):
    """A7: a check writes one audit row per finding; the timeline lists the run, not every finding."""
    p = _project(client, "SYNTHETIC timeline")
    x = X0 + 0.05
    _el(client, p, "excavation", _line(x - 0.002, LAT, x + 0.002, LAT), width_m=4, z_min_m=-3, z_max_m=0)
    run = _detect(client, p)
    n = len(run["conflicts"])
    j = client.get(f"/api/planning/projects/{p}/audit").json()
    assert not any(e["entity_type"] == "coordination_conflict" and e["action"] == "create" for e in j["events"])
    assert any(e["entity_type"] == "coordination_run" for e in j["events"]) and j["finding_inserts_hidden"] == n
    full = client.get(f"/api/planning/projects/{p}/audit?include_finding_inserts=true").json()
    assert sum(1 for e in full["events"] if e["entity_type"] == "coordination_conflict") == n
    # a person's response is still listed
    f = run["conflicts"][0]
    client.patch(f"/api/coordination/conflicts/{f['id']}/status", json={"status": "acknowledged", "actor": "Engineer T", "note": "SYNTHETIC"})
    ev = client.get(f"/api/planning/projects/{p}/audit").json()["events"]
    assert any(e["entity_type"] == "coordination_conflict" and e["action"] == "update" and e["actor"] == "Engineer T" for e in ev)


def test_metro_noc_rule_cites_the_official_regulation_not_news(client):
    """A8 (user rule 2026-11-21): no news-based facts. An old seeded citation is replaced on start-up."""
    from coordination.models import ClearanceRuleEntity
    from coordination.seed import _seed
    from database.connection import SessionLocal
    rules = {r["id"]: r for r in client.get("/api/coordination/clearance-rules").json()["rules"]}
    assert "UDCPR 2020 cl. 14.2.1.7" in rules["metro_noc_20m"]["citation"]
    for r in rules.values():
        assert "indianexpress" not in (r["citation"] or "").lower() and "Indian Express" not in (r["citation"] or "")
    with SessionLocal() as db:
        row = db.get(ClearanceRuleEntity, "metro_noc_20m")
        row.citation = "Indian Express, 17 Apr 2026 — https://indianexpress.com/x"
        db.commit()
        _seed(db)
        db.commit()
        assert db.get(ClearanceRuleEntity, "metro_noc_20m").citation.startswith("UDCPR 2020")
        assert db.get(ClearanceRuleEntity, "metro_noc_20m").horizontal_m == 20.0
        # the earlier UDCPR citation (read through a third-party mirror, official PDF not opened) is replaced as well
        row = db.get(ClearanceRuleEntity, "metro_noc_20m")
        row.citation = ("UDCPR 2020 cl. 14.2.1.7 (Govt of Maharashtra, Urban Development Dept; consolidated text, Directorate of Town "
                        "Planning, as amended to 30.01.2025, p. 269) … (clause text read via https://citiwise.in/udcpr/14-2-1-7)")
        db.commit()
        _seed(db)
        db.commit()
        cit = db.get(ClearanceRuleEntity, "metro_noc_20m").citation
        assert "citiwise" not in cit and "printed p. 268" in cit
        assert "punemetrorail.org/download/PUBLIC-NOTICE-ENGLISH.pdf" in cit and "READ 2026-11-21" in cit


@pytest.mark.parametrize("n", [12])
def test_summary_is_one_call_for_many_projects(client, n):
    """A9: the list reads one summary instead of 4 calls per card."""
    ids = [_project(client, f"SYNTHETIC many {k}") for k in range(n)]
    for k, p in enumerate(ids[:3]):
        _el(client, p, "pipeline", _line(X0 + 0.06 + 0.003 * k, LAT, X0 + 0.061 + 0.003 * k, LAT), width_m=1, z_min_m=-3, z_max_m=-2)
        _detect(client, p)
    s = {x["id"]: x for x in client.get("/api/coordination/projects-summary").json()["projects"]}
    assert all(p in s for p in ids)
    assert all(s[p]["last_check"] and s[p]["last_check"]["stale"] in (True, False) for p in ids[:3])


def test_twin_osm_ways_of_one_named_line_give_one_finding_per_element(client, monkeypatch):
    """OSM maps the two bores / tracks of the Purple Line as two ways with the same name: one finding, '2 pieces'."""
    x = X0 + 0.07
    ways = {990011: [[x, LAT - 0.002], [x, LAT + 0.002]], 990012: [[x + 0.00013, LAT - 0.002], [x + 0.00013, LAT + 0.002]]}

    def fake(boxes):
        segs = []
        for wid, c in ways.items():
            segs += G.segments_for(f"osm_way_{wid}", "metro_tunnel", {"type": "LineString", "coordinates": c}, width_m=None, z_min=None, z_max=None,
                                   certainty="estimated", meta={"layer": "osm_metro", "osm_tags": {"name": "SYNTHETIC Twin Line", "tunnel": "yes"}})
        return segs, {"available": True, "bbox": [73.0, 18.0, 74.5, 19.0], "source": "SYNTHETIC", "dataTimestamp": "2026-11-21"}
    monkeypatch.setattr(S, "osm_metro_segments", fake)
    p = _project(client, "SYNTHETIC crossing twin bores")
    e = _el(client, p, "pipeline", _line(x - 0.002, LAT, x + 0.002, LAT), width_m=1, z_min_m=-3, z_max_m=-2)
    rows = [c for c in _detect(client, p)["conflicts"] if c["element_a_id"] == e["id"] and c["b_type"] == "osm_metro"]
    assert len(rows) == 1 and rows[0]["evidence"]["osm_pieces"] == 2
    assert any("2 OpenStreetMap pieces" in r for r in rows[0]["reasons"])
    assert rows[0]["permission_triggers"] and rows[0]["permission_triggers"][0]["rule_id"] == "metro_noc_20m"


def test_a_check_is_not_stale_at_birth_when_another_project_pins_an_older_version(client):
    """Found while testing: another project's element pinned to v1 of an alternative that already had v2 made every new
    check of any project 'stale' immediately (scenario_version_superseded). Stale now means a newer version appeared
    after the check."""
    sid = _scenario(client, "SYNTHETIC pinned")
    x = X0 + 0.08
    _object(client, f"o_{sid}", "road", [[x, LAT, 0], [x + 0.004, LAT, 0]], sid=sid, layerId="roads", width=10)
    v1 = client.post(f"/api/scenarios/{sid}/versions", json={"label": "v1"}).json()
    client.post(f"/api/scenarios/{sid}/versions", json={"label": "v2"})
    other = _project(client, "SYNTHETIC pins v1")
    _el(client, other, "road", None, element_ref=f"o_{sid}", scenario_id=sid, scenario_version_id=v1["id"], z_min_m=-1, z_max_m=0)
    p = _project(client, "SYNTHETIC fresh check")
    _el(client, p, "pipeline", _line(x + 0.002, LAT - 0.001, x + 0.002, LAT + 0.001), width_m=1, z_min_m=-3, z_max_m=-2)
    run = _detect(client, p)
    assert run["stale"]["stale"] is False, run["stale"]["reasons"]
    client.post(f"/api/scenarios/{sid}/versions", json={"label": "v3"})
    assert f"scenario_version_superseded:{sid}" in client.get(f"/api/coordination/stale/coordination_run/{run['id']}").json()["reasons"]


def test_project_report_lists_elements_and_conflict_findings(client):
    """A19: the project report (PDF/DOCX) carries the proposal elements and the conflict check, with UNKNOWN never shown as 0."""
    a = client.post("/api/planning/projects", json={"name": "SYNTHETIC report A", "description": "", "created_by": "A"}).json()
    b = client.post("/api/planning/projects", json={"name": "SYNTHETIC report B", "description": "", "created_by": "B"}).json()
    line = {"type": "LineString", "coordinates": [[73.85, 18.50], [73.852, 18.50]]}
    cross = {"type": "LineString", "coordinates": [[73.851, 18.499], [73.851, 18.501]]}
    client.post(f"/api/coordination/projects/{a['id']}/elements", json={"kind": "tunnel", "name": "SYNTHETIC tunnel", "geometry": line, "width_m": 4,
                                                                      "z_min_m": -14, "z_max_m": -10, "certainty": "hypothetical", "created_by": "A"})
    client.post(f"/api/coordination/projects/{b['id']}/elements", json={"kind": "pipeline", "name": "SYNTHETIC gas main", "geometry": cross, "width_m": 0.3,
                                                                      "z_min_m": None, "z_max_m": None, "certainty": "unknown", "created_by": "B"})
    r = client.post(f"/api/coordination/projects/{a['id']}/detect", json={"run_by": "A"})
    assert r.status_code == 201
    pdf = client.get(f"/api/planning/projects/{a['id']}/report?format=pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    from tests.test_planning import _pdf_text
    import re
    pt = _pdf_text(pdf.content)
    assert "7. Proposal elements and conflict check" in pt
    assert "UNKNOWN" in pt and not re.search(r"UNKNO\s+WN|SYNTHE\s+TIC|unknow\s+n\b", pt), "a word is broken mid-word in a table column"
    docx = client.get(f"/api/planning/projects/{a['id']}/report?format=docx")
    assert docx.status_code == 200
    import io, zipfile
    xml = zipfile.ZipFile(io.BytesIO(docx.content)).read("word/document.xml").decode("utf8")
    assert "Proposal elements and conflict check" in xml
    assert "SYNTHETIC tunnel" in xml
    assert ("Project &apos;SYNTHETIC report B&apos;: SYNTHETIC gas main" in xml) or ("Project 'SYNTHETIC report B': SYNTHETIC gas main" in xml)
    assert "Potential conflict" in xml and "UNKNOWN" in xml
    # the other project sees the shared finding in its own report, raised by A's check
    xb = zipfile.ZipFile(io.BytesIO(client.get(f"/api/planning/projects/{b['id']}/report?format=docx").content)).read("word/document.xml").decode("utf8")
    assert "raised by other projects" in xb and "SYNTHETIC gas main" in xb


def test_report_audit_table_names_the_actor_in_plain_words(client):
    """A18: the report's audit table says where a name came from in words, not '[request_field]' / '[none]'."""
    p = client.post("/api/planning/projects", json={"name": "SYNTHETIC actor words", "description": "", "created_by": "Planner Q"}).json()
    assert client.patch(f"/api/planning/projects/{p['id']}", json={"status": "under_study", "edited_by": "Planner Q"}).status_code == 200
    import io, zipfile
    xml = zipfile.ZipFile(io.BytesIO(client.get(f"/api/planning/projects/{p['id']}/report?format=docx").content)).read("word/document.xml").decode("utf8")
    assert "Planner Q (name typed in the tool)" in xml          # the status change (request field)
    for code in ("[request_field]", "[record_field]", "[header]", "[none]", "[td_audit]"):
        assert code not in xml, code
