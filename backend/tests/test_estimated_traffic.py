"""City-wide ESTIMATED traffic (observed/estimated_traffic.py, docs/urbanos/TRAFFIC_ESTIMATED_P10.md)."""
import copy

import pytest

from observed import estimated_traffic


def test_shipped_file_is_valid_and_labelled_estimated():
    ids = estimated_traffic.list_files()
    if not ids:
        pytest.skip("no estimated traffic installed")
    doc = estimated_traffic.load(ids[0])
    assert doc["status"] == "estimated"
    assert doc["label"] == "estimated (project-level, not for decisions)"
    assert doc["split"]["holdout"] and doc["split"]["calibration"]
    # hold-out counts never scale their own roads
    anchored = {o["anchor"] for o in doc["wayOverrides"].values()}
    assert not anchored & set(doc["split"]["holdout"])
    # rules in force: Baba Bhide closed, Z-Bridge two-wheelers only
    kinds = {r["kind"] for r in doc["rules"]}
    assert {"closed", "two_wheeler_only"} <= kinds


def test_validate_rejects_a_file_not_labelled_estimated():
    ids = estimated_traffic.list_files()
    if not ids:
        pytest.skip("no estimated traffic installed")
    doc = estimated_traffic.load(ids[0])
    bad = copy.deepcopy(doc); bad["status"] = "measured"
    assert any("estimated" in p for p in estimated_traffic.validate(bad))
    bad = copy.deepcopy(doc); bad["label"] = "calibrated"
    assert any("label" in p for p in estimated_traffic.validate(bad))
    bad = copy.deepcopy(doc); bad["split"] = {"calibration": ["x"], "holdout": []}
    assert any("holdout" in p for p in estimated_traffic.validate(bad))


def test_unknown_file_is_not_found():
    with pytest.raises(KeyError):
        estimated_traffic.load("no_such_file")
