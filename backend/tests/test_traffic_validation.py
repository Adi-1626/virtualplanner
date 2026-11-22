"""The recorded validation verdict: computed from per-site results, never loosened, and the same as the frontend's."""
import os
import re

from observed import traffic_validation as tv

TS = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "components", "ui", "badges", "trafficValidation.ts")


def test_summary_is_computed_and_still_fails():
    assert (tv.GEH_LIMIT, tv.GEH_SHARE, tv.SCREENLINE_LIMIT) == (5, 0.85, 0.05)
    assert tv.within() == (2, 15) and tv.within("calibration") == (1, 7) and tv.within("holdout") == (1, 8)
    s = tv.summary()
    assert s.startswith("Model FAILS validation") and "2 of 15" in s and "hold-out 1/8" in s and "−26.2%" in s


def test_backend_and_frontend_hold_the_same_results():
    src = open(TS, encoding="utf-8").read()
    rows = {m[0]: (m[1], int(m[2]), int(m[3])) for m in re.findall(r"id: '([a-z0-9_]+)', name: '[^']*', role: '(\w+)', hour: \d+, count: (\d+), model: (\d+)", src)}
    assert rows == {i: (r, c, m) for i, r, c, m in tv.COUNT_RESULTS}
    river = re.search(r"RIVER_SCREENLINE = \{ crossings: (\d+), model: (\d+), count: (\d+) \}", src)
    assert tuple(map(int, river.groups())) == (tv.RIVER_SCREENLINE["crossings"], tv.RIVER_SCREENLINE["model"], tv.RIVER_SCREENLINE["count"])
