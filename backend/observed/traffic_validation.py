"""
Recorded traffic-model validation results (TAG M3.1) and the summary computed from them.

Mirror of frontend/src/components/ui/badges/trafficValidation.ts (tests/test_traffic_validation.py checks that both
hold the same per-site numbers). Source: the app's own per-site runs, shipped configuration (class-typical edge flows),
docs/urbanos/TRAFFIC_CALIBRATION_P9.md, re-run on p10-estimated (docs/urbanos/TRAFFIC_ESTIMATED_P10.md) and on p11-sim with the p11 engine (docs/urbanos/SIM_USER_TEST_P11.md §2, where
edge flows calibrated to the ESTIMATED city-wide traffic were tried and not shipped: worse on the hold-out). Recorded results, not live values; the
criteria are TAG's and are never loosened to change the verdict.
"""

from __future__ import annotations

import math

GEH_LIMIT = 5
GEH_SHARE = 0.85
SCREENLINE_LIMIT = 0.05

# (id, role, count, model): motor vehicles per hour, both directions, at the counted hour
COUNT_RESULTS = [
    ("cmp08_shivaji", "calibration", 7245, 2444),
    ("cmp08_shinde", "calibration", 4636, 1631),
    ("cmp08_smjoshi", "calibration", 4036, 2080),
    ("cmp08_rajaram", "calibration", 7050, 7304),
    ("cmp08_sangam", "calibration", 15640, 10907),
    ("cmp08_wadia_rob", "calibration", 4454, 3078),
    ("cmp08_sancheti_rob", "calibration", 6255, 5720),
    ("cmp08_mhatre", "holdout", 9753, 5013),
    ("cmp08_tilak", "holdout", 2070, 1799),
    ("cmp08_sambhaji", "holdout", 4251, 2006),
    ("cmp08_yerwada_ambedkar", "holdout", 19143, 18890),
    ("cmp08_rangehill_rub", "holdout", 1611, 2752),
    ("gunjan17_09", "holdout", 10034, 5804),
    ("gunjan17_14", "holdout", 6581, 4084),
    ("gunjan17_19", "holdout", 9460, 5804),
]
RIVER_SCREENLINE = {"crossings": 9, "model": 54247, "count": 73824}
# Speed tests (docs/ENGINEERING_VALIDATION.md §5.0, code c916854): 4/21, 27/120, 2/9 within 15%, all below 85%
SPEEDS_FAIL = True
EDGE_FLOW_BASIS = "class-typical edge flows; edge flows calibrated to estimated data (pune_estimated_traffic_v1) tried, not used: worse on hold-out; area demand from estimated zone land use matched to estimated volumes (p11) tried, not used: worse on the hold-out river screen line"


def geh(m: float, c: float) -> float:
    return math.sqrt(2 * (m - c) ** 2 / max(1.0, m + c))


def within(role: str | None = None) -> tuple[int, int]:
    rows = [r for r in COUNT_RESULTS if role is None or r[1] == role]
    return sum(geh(r[3], r[2]) < GEH_LIMIT for r in rows), len(rows)


def river_error() -> float:
    return RIVER_SCREENLINE["model"] / RIVER_SCREENLINE["count"] - 1


def fails() -> bool:
    w, n = within()
    return w / n <= GEH_SHARE or abs(river_error()) > SCREENLINE_LIMIT or SPEEDS_FAIL


def summary() -> str:
    w, n = within()
    wc, nc = within("calibration")
    wh, nh = within("holdout")
    e = river_error()
    verdict = "FAILS validation" if fails() else "meets the recorded criteria"
    return (f"Model {verdict} (TAG M3.1: {w} of {n} counts within GEH 5, calibration {wc}/{nc}, hold-out {wh}/{nh}; "
            f"river screen line {'−' if e < 0 else '+'}{abs(e) * 100:.1f}%; {EDGE_FLOW_BASIS}). Compare options, not forecasts.")
