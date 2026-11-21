"""
Screening reads a densified curved alignment exactly as the polyline it replaces (docs/urbanos/GEOMETRY_EDITOR_DESIGN.md
§3.4, §8): `coordinates` is the derived densified line and `depths[i]` stays one entry per vertex, interpolated by
chainage between the PI controls (`derived: true`). The extra fields (`alignment`, `depthControls`, `derived`) are
ignored by the backend. All geometry and depths here are SYNTHETIC.
"""
import pytest

from coordination import screening as S
from coordination import screening_config as C

LAT, LON = 18.4305, 73.7400
K = 1 / 105000.0
CFG = C.effective()


def _pts(xs):
    return [[LON + x * K, LAT, 0] for x in xs]


def _line(dx0, dy0, dx1, dy1):
    return [[LON + dx0 * K, LAT + dy0 * K / 1.06, 0], [LON + dx1 * K, LAT + dy1 * K / 1.06, 0]]


def _lerp(a, b, t):
    return None if a is None or b is None else a + (b - a) * t


def _densify(xs, values):
    """Every 5 m between the given vertices, values interpolated (None = unknown spreads to its side), marked derived."""
    out_x, out_v = [], []
    for i in range(len(xs) - 1):
        n = max(1, int((xs[i + 1] - xs[i]) // 5))
        for k in range(n):
            t = k / n
            out_x.append(xs[i] + (xs[i + 1] - xs[i]) * t)
            out_v.append((_lerp(values[i], values[i + 1], t), k > 0))
    out_x.append(xs[-1])
    out_v.append((values[-1], False))
    return out_x, out_v


def _tunnel(oid, xs, crowns, extra=None):
    deps = [{"crownDepthM": c, "certainty": "estimated" if c is not None else "unknown", **({"derived": True} if dv else {})}
            for c, dv in crowns]
    return {"id": oid, "type": "underground_alignment", "name": oid, "scenarioId": "alt", "coordinates": _pts(xs),
            "properties": {"alignmentKind": "bored_tunnel", "section": {"shape": "circular", "diameterM": 6.0}, "sectionCertainty": "estimated",
                           "depths": deps, **(extra or {})}}


def _util(oid, xs, deps, extra=None):
    ds = []
    for (dm, isdef), dv in deps:
        e = {"depthM": dm, "topDepthM": dm, "certainty": "hypothetical" if dm is not None else "unknown"}
        if isdef:
            e["isDefault"] = True
        if dv:
            e["derived"] = True
        ds.append(e)
    return {"id": oid, "type": "utility", "name": oid, "scenarioId": "alt", "coordinates": _pts(xs),
            "properties": {"utilityType": "sewage", "diameterMm": 300, "zRef": "top", "depths": ds, "depth": 0, "depthCertainty": "unknown",
                           "status": "proposed", "evidence": "user-drawn", **(extra or {})}}


WATER = {"id": "w", "type": "utility", "name": "w", "scenarioId": "base", "coordinates": _line(73, -20, 73, 20),
         "properties": {"utilityType": "water", "diameterMm": 300, "zRef": "top", "status": "existing", "evidence": "QL-A",
                        "depths": [{"depthM": 2.0, "topDepthM": 2.0, "certainty": "measured"}] * 2, "depth": 2.0}}


def _same(a, b):
    assert a.envelope() == pytest.approx(b.envelope()) if None not in a.envelope() else a.envelope() == b.envelope()
    for c0, c1 in [(0, 10), (20, 40), (60, 80), (95, 100)]:
        ea, eb = a.envelope(c0, c1), b.envelope(c0, c1)
        for x, y in zip(ea, eb):
            assert (x is None and y is None) or x == pytest.approx(y, abs=1e-6)
    assert a.geom.length == pytest.approx(b.geom.length, rel=1e-9)


@pytest.mark.parametrize("crowns", [[10.0, 20.0, 12.0], [10.0, None, 12.0]])
def test_tunnel_densified_twin_screens_like_the_polyline(crowns):
    xs = [0, 50, 100]
    legacy = S.design_asset(_tunnel("t", xs, [(c, False) for c in crowns]), "proposed")
    dx, dv = _densify(xs, crowns)
    twin = S.design_asset(_tunnel("t", dx, dv, {"alignment": {"v": 1, "pis": []}, "depthControls": [{"crownDepthM": c} for c in crowns]}), "proposed")
    _same(legacy, twin)
    other = S.design_asset(WATER, "existing")
    ra, rb = S.evaluate_pair(legacy, other, CFG), S.evaluate_pair(twin, other, CFG)
    assert (ra is None) == (rb is None)
    if ra:
        assert ra.get("status") == rb.get("status")
        assert ra.get("measurements") == rb.get("measurements")


def test_utility_densified_twin_screens_like_the_polyline_and_counts_defaults_once():
    xs = [0, 50, 100]
    vals = [(1.0, True), (3.0, False), (1.0, True)]
    legacy = S.design_asset(_util("s", xs, [(v, False) for v in vals]), "proposed")
    dx, dv = _densify(xs, [v[0] for v in vals])
    # a derived vertex is a default only between two default points (none here: every span has the typed 3.0 m point)
    twin_deps = [((v, False), d) for v, d in dv]
    for i, x in enumerate(dx):
        if x in (0, 100):
            twin_deps[i] = ((1.0, True), False)
    twin = S.design_asset(_util("s", dx, twin_deps), "proposed")
    _same(legacy, twin)
    assert twin.meta["default_vertices"] == legacy.meta["default_vertices"] == 2
    f1, _ = S.cover_check(legacy, CFG)
    f2, _ = S.cover_check(twin, CFG)
    assert (f1 or {}).get("status") == (f2 or {}).get("status")
    # between two default points the derived vertices carry isDefault (so defaults_used still sees them) but are not counted
    dx2, dv2 = _densify([0, 100], [1.0, 1.0])
    all_def = S.design_asset(_util("d", dx2, [((v, True), d) for v, d in dv2]), "proposed")
    assert all_def.meta["default_vertices"] == 2
    assert S.defaults_used(all_def, 40, 60)
