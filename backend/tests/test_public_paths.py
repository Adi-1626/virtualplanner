"""No server filesystem path reaches a user-facing API field (UNDERGROUND_VISUAL_FIXES.md, 'Charts and legend').

The Underground Profile/Cross-section showed 'terrain service unavailable (No elevation_copdem30 DEM under
C:\\Users\\adity\\...\\derived ...)' because /api/terrain passed DemUnavailable's text through as the error detail.
"""
import json

from datasets.public_text import LOCAL_DEM_NOT_LOADED, public_path, redact_paths

WIN = r"C:\Users\adity\Desktop\VirtualPlanner\backend\data\urbanos\derived"


def test_redact_windows_and_posix_paths():
    s = redact_paths(f"No elevation_copdem30 DEM under {WIN} - run python -m datasets.pipelines.elevation")
    assert "C:\\" not in s and "adity" not in s and "Users" not in s
    assert "a local folder" in s and "python -m datasets.pipelines.elevation" in s
    assert redact_paths("open C:/Users/adity/data/dem.tif failed") == "open dem.tif failed"
    assert redact_paths(r"share \\srv\data\x\y.fgb missing") == "share y.fgb missing"
    assert redact_paths("index /workspace/work/urbanos-data/derived/osm/osm_index.db locked") == "index osm_index.db locked"
    assert redact_paths("/home/adity/") == "a local folder"


def test_redact_keeps_urls_routes_units_and_relative_paths():
    for keep in ("see https://opencity.in/dataset/pmc/sewer.csv", "GET /api/terrain/overlays/slope.png", "speed 40 km/h, 2 m/s",
                 "derived/elevation_copdem30/v2/dem.tif", "ratio 3/4", "", "QL-D"):
        assert redact_paths(keep) == keep
    assert redact_paths(None) is None and redact_paths(5) == 5


def test_public_path():
    assert public_path("/data/u/derived/x/v1/a.fgb", "/data/u") == "derived/x/v1/a.fgb"
    assert public_path(WIN + r"\x\a.tif", r"C:\Users\adity\Desktop\VirtualPlanner\backend\data\urbanos") == "derived/x/a.tif"
    assert public_path("/elsewhere/a.fgb", "/data/u") == "a.fgb"
    assert public_path(r"D:\other\b.tif") == "b.tif"
    assert public_path("relative/c.csv") == "relative/c.csv" and public_path(None) is None


def test_terrain_api_without_dem_sends_no_path(client, tmp_path, monkeypatch):
    for e in ("URBANOS_DATA_ROOT", "URBANOS_DATA_HOME", "URBANOS_RAW_DIR", "URBANOS_DERIVED_DIR"):
        monkeypatch.delenv(e, raising=False)
    monkeypatch.setenv("URBANOS_DATA_DIR", str(tmp_path / "empty"))
    for r in (client.get("/api/terrain/info"),
              client.post("/api/terrain/profile", json={"coordinates": [[73.85, 18.5], [73.86, 18.51]]}),
              client.get("/api/terrain/point?lon=73.85&lat=18.5")):
        assert r.status_code == 503
        assert r.json()["detail"] == LOCAL_DEM_NOT_LOADED
        assert str(tmp_path) not in r.text and "empty" not in r.text


def test_evidence_outputs_and_notes_carry_no_absolute_path(client, tmp_path, monkeypatch):
    for e in ("URBANOS_DATA_ROOT", "URBANOS_DATA_HOME", "URBANOS_RAW_DIR", "URBANOS_DERIVED_DIR"):
        monkeypatch.delenv(e, raising=False)
    monkeypatch.setenv("URBANOS_DATA_DIR", str(tmp_path))
    g = tmp_path / "derived/nwdp_groundwater_pune/2026-11-13"
    g.mkdir(parents=True)
    (g / "processing.json").write_text(json.dumps({"outputs": [{"path": str(g / "gwl_stations_pune.geojson"), "sha256": "a"}],
                                                   "notes": f"built from {WIN}\\raw\\x.csv"}))
    (g / "gwl_stations_pune.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    (g / "gwl_observations_pune.csv").write_text("station_id,agency,date,depth_to_water_m_bgl,source_file\n")
    r = client.post("/api/terrain/subsurface-evidence", json={"coordinates": [[73.85, 18.5], [73.86, 18.51]]})
    assert r.status_code == 200, r.text
    ds = r.json()["groundwater"]["dataset"]
    assert ds["available"]
    assert ds["outputs"][0]["path"] == "gwl_stations_pune.geojson"   # relative to its version folder, like the others
    assert "C:\\" not in ds["notes"] and "x.csv" in ds["notes"]
    assert str(tmp_path) not in r.text and "adity" not in r.text


def test_subsurface_dataset_dict_redacts_stored_provenance():
    from types import SimpleNamespace
    from api.coordination_router import _dataset_dict
    d = SimpleNamespace(id="d", project_id=None, record_type="utility", format="json", name="PMC storm water", file_name=WIN + r"\a.json",
                        file_sha256=None, publisher="PMC", source_url="https://opencity.in/x/y", licence="ODbL", data_date=None,
                        coverage_bbox_json=None, record_count=1, supersedes_id=None, imported_by="t", imported_at=None,
                        provenance="derived from /workspace/work/urbanos-data/derived/pmc/v1, index /workspace/work/x/osm_index.db",
                        warnings_json=json.dumps([f"read {WIN}\\b.csv"]))
    out = _dataset_dict(d)
    text = json.dumps(out)
    assert "adity" not in text and "/workspace/" not in text and "C:\\\\" not in text
    assert out["file_name"] == "a.json" and "osm_index.db" in out["provenance"] and out["source_url"] == "https://opencity.in/x/y"
