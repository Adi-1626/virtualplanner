"""Calibrated window edge flows (docs/urbanos/TRAFFIC_CALIBRATION_P9.md): the validator and the loader."""
import copy

import pytest

from observed import calibrated_flows

GOOD = {
    "schema": calibrated_flows.SCHEMA, "id": "t", "status": "estimated", "method": "window ODME", "counts": "cmp2008",
    "caveats": ["fitted to 2008 counts"],
    "window": {"bounds": {"minLng": 73.7, "maxLng": 73.9, "minLat": 18.4, "maxLat": 18.6}},
    "periods": {"AM_Peak": {"refHour": 9, "calibrationSites": ["cmp08_rajaram"], "holdoutSites": ["cmp08_tilak"], "links": {"osm_1_seg_1_fwd": 640}}},
}


def test_valid_file_passes():
    assert calibrated_flows.validate(GOOD) == []


def test_rejects_observed_status_shared_sites_and_bad_links():
    bad = copy.deepcopy(GOOD)
    bad["status"] = "observed"
    bad["periods"]["AM_Peak"]["holdoutSites"] = ["cmp08_rajaram"]
    bad["periods"]["AM_Peak"]["links"] = {"not a link": 5, "osm_2_seg_1_bwd": -3}
    p = calibrated_flows.validate(bad)
    assert any("estimated" in x for x in p)
    assert any("both calibration and hold-out" in x for x in p)
    assert any("invalid link entries" in x for x in p)


def test_rejects_missing_fit_evidence():
    bad = copy.deepcopy(GOOD)
    bad["periods"]["AM_Peak"]["calibrationSites"] = []
    bad["caveats"] = []
    p = calibrated_flows.validate(bad)
    assert any("calibrationSites" in x for x in p) and any("caveats" in x for x in p)


def test_unknown_file_is_a_key_error():
    with pytest.raises(KeyError):
        calibrated_flows.load("no_such_window")
