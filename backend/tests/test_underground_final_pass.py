"""Underground final end-user pass: imported OSM metro lines in the screening (SYNTHETIC objects)."""
from coordination import screening as S
from tests.test_underground_screening import _line


def _metro(oid, tags, elevation, **extra):
    return {"id": oid, "type": "metro_line", "name": "Line 1", "scenarioId": "base", "coordinates": _line(-100, 0, 100, 0),
            "properties": {"elevation": elevation, "deckWidth": 8, "tags": tags, **extra}}


def test_imported_osm_tunnel_is_a_metro_tunnel_not_an_elevated_metro():
    for o in (_metro("osm_m_way_11", {"railway": "subway", "tunnel": "yes"}, 0, osmElementType="way", osmId=11),
              _metro("osm_m_way_12", {"railway": "subway", "layer": "-1"}, 0),
              _metro("osm_m_way_13", {"railway": "subway"}, -6)):            # older imports: invented -6 m, no tunnel tag kept
        a = S.design_asset(o, "existing")
        assert a.cls == "metro_tunnel", o["id"]
        assert "depth not mapped" in a.kind_label and "Elevated" not in a.kind_label
        assert a.meta["osm_ref"] == "osm_" + o["id"][len("osm_m_"):]
        assert all(t is None and b is None for _, t, b in a.profile)        # depth UNKNOWN, never -6 m


def test_imported_viaduct_and_drawn_metro_keep_their_labels():
    v = S.design_asset(_metro("osm_m_way_21", {"railway": "subway", "bridge": "yes"}, 12), "existing")
    assert v.cls == "metro_viaduct" and "imported from OpenStreetMap" in v.kind_label
    d = S.design_asset({"id": "m1", "type": "metro_line", "name": "drawn", "scenarioId": "base", "coordinates": _line(-100, 0, 100, 0),
                        "properties": {"elevation": 12, "deckWidth": 8}}, "existing")
    assert d.cls == "metro_viaduct" and d.kind_label.startswith("Elevated metro (drawn") and d.meta["osm_ref"] is None


def test_imported_metro_and_the_osm_index_copy_are_one_asset(client, monkeypatch):
    """A Purple Line way imported into Design is the same way the OSM index returns: one metro finding, not two."""
    from tests.test_underground_screening import align
    idx_copy = S.design_asset(_metro("osm_m_way_11", {"railway": "subway", "tunnel": "yes"}, 0), "existing")
    idx_copy = S.Asset("osm_way_11", "Line 1 (OSM)", "osm_metro", "existing", "metro_tunnel", idx_copy.geom, None, [(0.0, None, None)],
                       "UNKNOWN", "unknown", {"id": "osm_index", "name": "OpenStreetMap metro", "quality_level": "UNKNOWN"}, kind_label="Metro tunnel")
    monkeypatch.setattr(S, "osm_metro_assets", lambda boxes: ([idx_copy], {"available": True}))
    objs = [align("T", _line(-150, 5, 150, 5), "bored_tunnel", [12, 12], 6.0),
            _metro("osm_m_way_11", {"railway": "subway", "tunnel": "yes"}, -6, osmElementType="way", osmId=11)]
    r = client.post("/api/coordination/underground/screen", json={"scenario_id": "alt", "objects": objs})
    assert r.status_code == 200, r.text
    others = [f["other"]["id"] for f in r.json()["findings"] if f.get("other")]
    assert "osm_way_11" in others and "osm_m_way_11" not in others
    assert not any("Elevated" in (f.get("other") or {}).get("kind_label", "") for f in r.json()["findings"])


def test_depth_range_wording_never_unknown_to_unknown():
    assert S.depth_range_text(None, None) == "depth unknown"
    assert S.depth_range_text(16.0, 22.3) == "16.0 m to 22.3 m"
    assert "bottom unknown" in S.depth_range_text(1.0, None)
