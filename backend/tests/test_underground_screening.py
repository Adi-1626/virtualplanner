"""
Underground screening engine (coordination/screening.py, docs/urbanos/UNDERGROUND_CHECKS.md).
All geometry, depths and records here are SYNTHETIC (made up for tests; not Pune data).
"""
import json

import pytest

from coordination import screening as S
from coordination import screening_config as C

LAT = 18.4205        # synthetic corridor far from the other test files' corridors
LON = 73.7300
FORBIDDEN = ("safe", "feasible", "construction-ready", "construction ready", "passed", "compliant", "approved")


def _line(dx0, dy0, dx1, dy1):
    """Lon/lat line from metre offsets around (LON, LAT) (1e-5 deg ≈ 1.05 / 1.11 m: good enough for synthetic tests)."""
    k = 1 / 105000.0
    return [[LON + dx0 * k, LAT + dy0 * k / 1.06, 0], [LON + dx1 * k, LAT + dy1 * k / 1.06, 0]]


def util(oid, coords, utype, depth, dia_mm, sid="alt", **p):
    return {"id": oid, "type": "utility", "name": oid, "scenarioId": sid, "coordinates": coords,
            "properties": {"utilityType": utype, "depth": depth, "diameterMm": dia_mm, **p}}


def align(oid, coords, kind, crowns, dia, sid="alt", cert="estimated"):
    return {"id": oid, "type": "underground_alignment", "name": oid, "scenarioId": sid, "coordinates": coords,
            "properties": {"alignmentKind": kind, "section": {"shape": "circular", "diameterM": dia}, "sectionCertainty": cert,
                           "depths": [{"crownDepthM": c, "certainty": cert} for c in crowns]}}


def asset(o, status="proposed"):
    return S.design_asset(o, status)


CFG = C.effective()


# ── clearance math ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_vertical_gap_depth_ranges():
    assert S.vertical_gap(1.0, 1.3, 2.0, 2.5) == pytest.approx(0.7)     # other entirely below
    assert S.vertical_gap(5.0, 6.0, 1.0, 1.5) == pytest.approx(3.5)     # proposed entirely below
    assert S.vertical_gap(1.0, 2.0, 1.5, 2.5) == 0.0                    # overlap
    assert S.vertical_gap(1.0, None, 2.0, 2.5) is None                  # proposed invert unknown, other below: unknown
    assert S.vertical_gap(5.0, None, 1.0, 1.5) == pytest.approx(3.5)    # proposed crown known and below other's invert
    assert S.vertical_gap(None, None, None, None) is None


def test_stricter_rule_wins_and_both_cited():
    r = C.requirement(CFG, "water", "sewer", 0.3, 0.6)
    assert r["horizontal_m"] == 3.0 and r["vertical_m"] == 1.0
    ids = {x["id"] for x in r["rows"]}
    assert {"C1", "C2", "C2b-H", "C2b-V"} <= ids                        # all cited
    assert r["v_ids"] == ["C2b-V"] and r["h_ids"] == ["C1"]
    assert [c["id"] for c in r["compare"]] == ["C20"]                    # international: comparison only
    assert r["order"]["order"] == "a_above_b"
    r2 = C.requirement(CFG, "sewer", "water", None, None)               # flipped pair: sewer must be BELOW
    assert r2["order"]["order"] == "a_below_b"
    p = C.requirement(CFG, "power", "telecom", None, None)
    assert p["horizontal_m"] == 1.0 and p["vertical_m"] == 1.0 and p["order"]["order"] == "a_below_b"


def test_tunnel_rules_are_referral_distances_not_clearances():
    r = C.requirement(CFG, "tunnel", "water", 6.6, 0.3)
    assert r["specialist"] and r["horizontal_m"] == pytest.approx(6.6)
    assert all(x["type"] in ("no_norm", "rule_of_thumb") for x in r["rows"])
    table = C.rules_table()
    assert any(t["pair"].startswith("water × sewer") for t in table)
    for t in table:
        for row in t["rows"]:
            assert row["type"] in ("normative", "draft_guideline", "rule_of_thumb", "international", "no_norm")
            assert row["source"]


def test_true_3d_crossing_clear_vertically_is_not_a_finding():
    w = asset(util("w", _line(0, -20, 0, 20), "water", 1.0, 300))           # water 1.0–1.3 m
    s = asset(util("s", _line(-20, 0, 20, 0), "sewage", 3.0, 600))          # sewer 3.0–3.6 m: gap 1.7 ≥ 1.0
    r = S.evaluate_pair(w, s, CFG)
    assert r and r.get("clear")


def test_crossing_with_too_small_vertical_gap_is_potential_conflict():
    w = asset(util("w", _line(0, -20, 0, 20), "water", 1.0, 300))           # 1.0–1.3
    s = asset(util("s", _line(-20, 0, 20, 0), "sewage", 1.9, 600))          # 1.9: gap 0.6 < 1.0 (C2b-V)
    f = S.evaluate_pair(w, s, CFG)
    assert f["status"] == "potential_conflict"
    m = f["measurements"]
    assert m["crossing"] and m["vertical_gap_m"] == pytest.approx(0.6) and m["required_vertical_m"] == 1.0
    assert any("C2b-V" in x and "C2 " not in x for x in f["found"]) or any("C2b-V" in x for x in f["found"])
    for k in ("checked", "data_used", "found", "not_checked", "next_steps"):
        assert f[k], k


def test_water_below_sewer_is_wrong_way_round():
    w = asset(util("w", _line(0, -20, 0, 20), "water", 4.0, 300))
    s = asset(util("s", _line(-20, 0, 20, 0), "sewage", 1.0, 300))
    f = S.evaluate_pair(w, s, CFG)
    assert f["status"] == "potential_conflict" and any("Wrong way round" in x for x in f["found"])


def test_depth_envelope_is_taken_where_they_meet_not_whole_object():
    # tunnel dives from 3 m to 30 m crown; the pipe crosses at the deep end, so the shallow part must not count
    t = asset(align("t", _line(-500, 0, 500, 0) + [], "cut_and_cover", [3.0, 30.0], 6.0))
    p = asset(util("p", _line(450, -20, 450, 20), "water", 1.0, 300))
    f = S.evaluate_pair(p, t, CFG)
    # crown at x=450 ≈ 3 + 27*950/1000 = 28.65 m → gap ≈ 27 m ≥ 1 D referral → clear
    assert f and f.get("clear")


def test_threshold_widened_by_positional_uncertainty():
    w = asset(util("w", _line(0, -20, 0, 20), "water", 1.0, 300))
    s = asset(util("s", _line(-20, 0, 20, 0), "sewage", 2.31, 300, sid="base", depthCertainty="measured"), "existing")
    assert s.quality == "user-drawn (measured)"     # vertical tolerance 0.3
    f = S.evaluate_pair(w, s, CFG)                    # gap 1.01: meets 1.0 but < 1.0 + 0.3
    assert f["status"] == "requires_investigation"
    assert f["measurements"]["uncertainty_vertical_m"] == pytest.approx(0.3)


def test_no_datum_record_makes_vertical_not_checkable():
    w = asset(util("w", _line(0, -20, 0, 20), "water", 1.0, 300))
    s = asset(util("s", _line(-20, 0, 20, 0), "sewage", 5.0, 300, sid="base"), "existing")   # user-drawn, no QL
    f = S.evaluate_pair(w, s, CFG)
    assert f["status"] == "insufficient_data" and f["measurements"]["vertical_checkable"] is False
    assert f["measurements"]["vertical_gap_m"] is None and f["measurements"]["recorded_vertical_gap_m"] == pytest.approx(3.7)
    assert "not checkable" in " ".join(f["found"])


def test_tunnel_near_utility_specialist_and_physical_clash():
    t = asset(align("t", _line(-100, 0, 100, 0), "bored_tunnel", [10.0, 10.0], 6.0))
    near = asset(util("p", _line(0, -30, 0, 30), "water", 6.0, 300))          # 6.0–6.3 m, tunnel 10–16: gap 3.7 < 1 D (6 m)
    f = S.evaluate_pair(t, near, CFG)
    assert f["status"] == "requires_investigation" and any("specialist" in s.lower() for s in f["next_steps"])
    clash = asset(util("q", _line(0, -30, 0, 30), "water", 11.0, 300))        # inside the tunnel
    f2 = S.evaluate_pair(t, clash, CFG)
    assert f2["status"] == "potential_conflict" and "physically intersect" in " ".join(f2["found"])


def test_metro_zone_requires_investigation_with_noc():
    p = asset(util("p", _line(-50, 0, 50, 0), "water", 1.0, 300))
    m = S.Asset("osm_way_1", "Line X (OSM)", "osm_metro", "existing", "metro_viaduct",
                S.G.project_geojson({"type": "LineString", "coordinates": [c[:2] for c in _line(-50, 15, 50, 15)]}),
                None, [(0.0, None, None)], "UNKNOWN", "unknown", {"id": "osm_index", "name": "OSM"})
    f = S.evaluate_pair(p, m, CFG)
    assert f["status"] == "requires_investigation" and f["protection_zone"]
    assert any("Maha-Metro NOC" in x for x in f["found"]) and any("Maha-Metro NOC" in s for s in f["next_steps"])
    far = S.Asset(**{**m.__dict__, "geom": S.G.project_geojson({"type": "LineString", "coordinates": [c[:2] for c in _line(-50, 40, 50, 40)]})})
    assert S.evaluate_pair(p, far, CFG) is None


def test_next_steps_follow_indian_ladder_order():
    steps = S.ladder(CFG, "boreholes", "trial_pits", "as_builts", "metro_noc", "gpr", "cbud")
    keys = ["as-built", "Call Before u Dig", "GPR", "Trial pits", "Maha-Metro NOC", "boreholes"]
    assert all(k.lower() in s.lower() for k, s in zip(keys, steps))


# ── cover ─────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("utype,depth,cert,status", [
    ("gas", 0.8, None, "potential_conflict"),            # below T4S 1.0 m (normative)
    ("water", 0.5, None, "requires_investigation"),      # below IRC draft 0.6 m (guideline)
    ("electricity", 0.9, None, "requires_investigation"),  # 0.75 ok, but 1.05 depends on the unrecorded voltage
    ("electricity", 0.6, None, "potential_conflict"),    # below IS 1255 LV 0.75 m
    ("water", 1.2, None, None),                          # nothing flagged
    ("water", 1.2, "unknown", "insufficient_data"),      # placeholder depth
])
def test_cover(utype, depth, cert, status):
    o = util("u", _line(0, 0, 50, 0), utype, depth, 200, **({"depthCertainty": cert} if cert else {}))
    f, entry = S.cover_check(asset(o), CFG)
    assert (f["status"] if f else None) == status
    if f:
        assert "DSM" in " ".join(f["not_checked"])
    else:
        assert entry["result"] == S.CHECK_NOTHING


def test_bored_tunnel_cover_two_diameters():
    f, _ = S.cover_check(asset(align("t", _line(0, 0, 100, 0), "bored_tunnel", [8.0, 9.0], 6.0)), CFG)
    assert f["status"] == "requires_investigation"                 # 8 m < 2 x 6 m (DPR rule of thumb)
    f2, _ = S.cover_check(asset(align("t", _line(0, 0, 100, 0), "bored_tunnel", [None, 9.0], 6.0)), CFG)
    assert f2["status"] == "insufficient_data"


# ── whole run via the API ──────────────────────────────────────────────────────────────────────────────────────────

def _screen(client, objects, sid="alt", **kw):
    r = client.post("/api/coordination/underground/screen", json={"scenario_id": sid, "objects": objects, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_run_includes_drawn_utilities_and_reports_honestly(client):
    objs = [align("T", _line(-200, 0, 200, 0), "bored_tunnel", [12, 12], 6.0),
            util("W", _line(0, -40, 0, 40), "water", 13.0, 300),                     # drawn utility clashing with the tunnel
            util("B", _line(100, -40, 100, 40), "sewage", 3.0, 300, sid="base")]     # existing baseline drawn sewer
    run = _screen(client, objs)
    assert run["banner"] == "Automated screening — not an engineering assessment"
    assert "not an engineering assessment" in run["disclaimer"].lower()
    assert {f["status"] for f in run["findings"]} <= {"potential_conflict", "requires_investigation", "insufficient_data"}
    tw = [f for f in run["findings"] if {f["proposed"]["id"], (f.get("other") or {}).get("id")} == {"T", "W"}]
    assert len(tw) == 1 and tw[0]["status"] == "potential_conflict"                  # proposed × proposed, reported once
    tb = [f for f in run["findings"] if f["proposed"]["id"] == "T" and (f.get("other") or {}).get("id") == "B"]
    assert tb and tb[0]["other"]["status"] == "existing" and tb[0]["status"] == "insufficient_data"   # user-drawn: no usable Z
    # no records loaded for water / power / gas / telecom → Insufficient data, never a pass
    gaps = [f for f in run["findings"] if f["category"] == "data_gap"]
    assert len(gaps) == 2 and all(f["status"] == "insufficient_data" for f in gaps)
    assert any("water supply" in x for x in gaps[0]["found"])
    for p in run["summary"]["proposed_checked"]:
        assert p["checklist"] and all(c["result"] in (S.CHECK_NOTHING, S.CHECK_FLAGGED, S.CHECK_NOT) for c in p["checklist"])
    assert run["summary"]["counts"]["verified"] == 0
    txt = json.dumps(run).lower()
    for w in FORBIDDEN:
        assert w not in txt.replace("not an engineering assessment or approval", ""), w
    assert run["rules_table"] and run["layers"]


def test_missing_depth_and_skipped_objects(client):
    run = _screen(client, [align("T", _line(0, 0, 100, 0), "bored_tunnel", [None, None], None),
                           util("X", [[LON, LAT, 0]], "water", 1.0, 100)])
    cov = [f for f in run["findings"] if f["category"] == "cover"]
    assert cov and cov[0]["status"] == "insufficient_data"
    assert run["summary"]["skipped"] and run["summary"]["skipped"][0]["id"] == "X"


def test_empty_alternative(client):
    run = _screen(client, [])
    assert run["findings"] == [] and "Nothing to check" in run["summary"]["headline"]


def _import_qla(client):
    k = 1 / 105000.0
    geom = f"{LON - 40 * k} {LAT};{LON + 40 * k} {LAT}"
    csv = ("utility_id,utility_type,owner,geometry,depth_m,diameter_m,quality_level,survey_method\n"
           f"QA1,water,SYNTHETIC owner,\"{geom}\",2.0,0.3,QL-A,trial pit\n")
    r = client.post("/api/coordination/subsurface/import", json={"record_type": "utility", "format": "csv", "content": csv,
                                                                  "name": "SYNTHETIC QL-A screening record", "imported_by": "Tester"})
    assert r.status_code == 201, r.text


def test_records_and_person_recorded_verification(client):
    _import_qla(client)
    sewer = util("S1", _line(0, -40, 0, 40), "sewage", 2.6, 300)     # QL-A water 2.0–2.3; sewer 2.6: gap 0.3 < 1.0 → conflict
    run = _screen(client, [sewer])
    f = next(x for x in run["findings"] if (x.get("other") or {}).get("quality_level") == "QL-A")
    assert f["status"] == "potential_conflict" and f["measurements"]["vertical_checkable"] is True
    # Verified is never automatic; a person records QL-A field evidence for this finding
    r = client.post("/api/coordination/underground/verifications", json={
        "pair_key": f["pair_key"], "fingerprint": f["fingerprint"], "method": "desk_study", "evidence": "x", "verified_by": "Engineer T"})
    assert r.status_code == 422
    r = client.post("/api/coordination/underground/verifications", json={
        "pair_key": f["pair_key"], "fingerprint": f["fingerprint"], "method": "trial_pit", "measured_vertical_m": 1.2,
        "evidence": "SYNTHETIC trial pit TP-1 exposed both pipes", "verified_by": "Engineer T"})
    assert r.status_code == 201, r.text
    again = next(x for x in _screen(client, [sewer])["findings"] if x["pair_key"] == f["pair_key"])
    assert again["status"] == "verified" and again["computed_status"] == "potential_conflict"
    # the design changes → the verification no longer applies
    moved = util("S1", _line(0, -40, 0, 40), "sewage", 2.7, 300)
    after = next(x for x in _screen(client, [moved])["findings"] if x["pair_key"] == f["pair_key"])
    assert after["status"] != "verified" and after["verification"]["stale"]


def test_screen_reads_objects_from_database(client):
    for o in (util("db_w", _line(0, -40, 0, 40), "water", 1.0, 300, sid="base"),):
        assert client.post("/api/objects", json={**{k: o[k] for k in ("id", "type", "name", "scenarioId", "coordinates")},
                                                 "layerId": "utilities", "properties": o["properties"]}).status_code == 201
    run = _screen(client, None, sid="base")
    assert any(p["id"] == "db_w" for p in run["summary"]["proposed_checked"])


def test_run_detection_includes_design_drawn_objects(client):
    """Known gap closed: project detection now sees utilities drawn in Design."""
    o = util("dd_gas", _line(300, -40, 300, 40), "gas", 4.0, 200, sid="base")
    assert client.post("/api/objects", json={**{k: o[k] for k in ("id", "type", "name", "scenarioId", "coordinates")},
                                             "layerId": "utilities", "properties": o["properties"]}).status_code == 201
    pid = client.post("/api/planning/projects", json={"name": "SYNTHETIC ug", "description": "SYNTHETIC", "created_by": "T"}).json()["id"]
    k = 1 / 105000.0
    el = client.post(f"/api/coordination/projects/{pid}/elements", json={
        "kind": "tunnel", "name": "SYNTHETIC tunnel", "created_by": "T", "width_m": 6, "z_min_m": -10, "z_max_m": -4,
        "geometry": {"type": "LineString", "coordinates": [[LON + 250 * k, LAT], [LON + 350 * k, LAT]]}})
    assert el.status_code == 201, el.text
    run = client.post(f"/api/coordination/projects/{pid}/detect", json={"run_by": "T"}).json()
    hits = [c for c in run["conflicts"] if c["b_type"] == "design_object"]
    assert hits and hits[0]["b_ref"] == "design:dd_gas" and hits[0]["class"] == "conflict"    # gas 4.0–4.2 m inside 4–10 m


def test_record_ref_reads_like_a_number():
    assert S.record_ref("pmc_storm_water_drains.631") == "#631"
    assert S.record_ref("KT-CO-4774") == "KT-CO-4774"


def test_insufficient_data_findings_carry_one_gap_group_per_reason(client):
    """Each Insufficient-data finding names its shared reason (dataset / network / missing input) so the UI and the report
    can list one line per reason instead of hundreds of pairs."""
    objs = [align("T", _line(-200, 0, 200, 0), "bored_tunnel", [12, 12], 6.0),
            util("B1", _line(-100, -40, -100, 40), "sewage", 3.0, 300, sid="base"),
            util("B2", _line(100, -40, 100, 40), "sewage", 3.0, 300, sid="base"),
            util("W", _line(0, -40, 0, 40), "water", None, 300, depthCertainty="unknown")]
    run = _screen(client, objs)
    ins = [f for f in run["findings"] if f["status"] == "insufficient_data"]
    assert ins and all(f.get("gap_group") and f["gap_group"]["key"] and f["gap_group"]["label"] for f in ins)
    assert not any("gap_group" in f for f in run["findings"] if f["status"] != "insufficient_data")
    tb = [f for f in ins if f["proposed"]["id"] == "T" and (f.get("other") or {}).get("id") in ("B1", "B2")]
    assert len(tb) == 2 and tb[0]["gap_group"]["key"] == tb[1]["gap_group"]["key"]              # same reason → one group
    assert "vertical clearance not checkable" in tb[0]["gap_group"]["label"]
    gaps = [f for f in ins if f["category"] == "data_gap"]
    by_nets = {}
    for f in gaps:                                                                                # same missing networks ↔ same group
        by_nets.setdefault(tuple(f["measurements"]["missing_networks"]), set()).add(f["gap_group"]["key"])
    assert all(len(keys) == 1 for keys in by_nets.values()) and len({k for ks in by_nets.values() for k in ks}) == len(by_nets)
    assert gaps[0]["gap_group"]["label"].startswith("No ") and "records in this area" in gaps[0]["gap_group"]["label"]
    assert gaps[0]["measurements"]["missing_networks"]
    for f in ins:
        assert not any(w in f["gap_group"]["label"].lower() for w in FORBIDDEN)


def test_short_dataset_name():
    assert S.short_dataset_name("PMC storm-water drains, labelled rows only (OpenCity mirror) — QL-D records") == "PMC storm-water drains"
    assert S.short_dataset_name("PMC sewer network (OpenCity mirror) — QL-D records") == "PMC sewer network"
    assert S.short_dataset_name(None) == "Unnamed dataset"
