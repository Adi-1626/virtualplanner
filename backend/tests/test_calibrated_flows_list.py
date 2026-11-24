"""p11: the app asks which calibrated-flow files are installed before loading one (none is shipped), so its absence is
not a failed request in the browser console."""


def test_list_installed_calibrated_flows(client):
    r = client.get("/api/calibrated-flows")
    assert r.status_code == 200
    files = r.json()["files"]
    assert isinstance(files, list)
    for f in files:
        assert client.get(f"/api/calibrated-flows/{f}").status_code == 200
    assert client.get("/api/calibrated-flows/not_installed_file").status_code == 404
