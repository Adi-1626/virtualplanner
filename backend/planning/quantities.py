"""
Quantities of what an alternative builds (docs/urbanos/BUILD_PROPAGATION.md): one row per object the alternative adds,
changes or removes, read from its stored change set (scenario_router.head_change_set) — the same rows the Design
workspace saved. Lengths are plan lengths along the stored centreline (haversine), pier counts follow the 3D view's rule
(coordination/screening.pier_points). Every value is computed from the drawn design, not measured; a value that is not
recorded is UNKNOWN, never 0.
"""
from __future__ import annotations

import json
import math
from typing import Optional

from sqlalchemy.orm import Session

TYPE_LABEL = {"road": "Road", "flyover": "Flyover", "metro_flyover": "Double-deck (road + metro)", "metro_line": "Metro line",
              "metro_station": "Metro station", "utility": "Utility line", "underground_alignment": "Underground alignment",
              "junction": "Junction", "building": "Building", "zone": "Demand zone", "gateway": "Traffic gateway",
              "street_element": "Street element", "path": "Footpath / cycle track / FOB / subway", "bus_lane": "Bus / BRT lane (lane length)"}
# Street elements drawn in Design (docs/urbanos/DESIGN_TOOLS_P7.md), by kind: the label in the table and in the counts
STREET_KIND_LABEL = {"crossing": "Pedestrian crossing", "bus_stop": "Bus stop", "streetlight": "Streetlights", "street_tree": "Street trees",
                     "roundabout": "Roundabout", "path": "Path"}
STREET_COUNT_LABEL = {"crossing": "pedestrian crossing(s)", "bus_stop": "bus stop(s)", "streetlight": "streetlight pole(s)",
                      "street_tree": "street tree(s)", "roundabout": "roundabout(s)"}
_PATH_TYPE = {"footpath": "footpath", "cycle_one_way": "cycle track (one-way)", "cycle_two_way": "cycle track (two-way)", "shared": "shared footpath + cycle track"}
OP_LABEL = {"add": "new", "modify": "changes an existing object", "delete": "removes an existing object"}
LINE_TYPES = ("road", "flyover", "metro_flyover", "metro_line", "utility", "underground_alignment")


def plan_length_m(coords) -> Optional[float]:
    pts = [c for c in (coords or []) if isinstance(c, (list, tuple)) and len(c) >= 2]
    if len(pts) < 2:
        return None
    total = 0.0
    for a, b in zip(pts, pts[1:]):
        p1, p2 = math.radians(a[1]), math.radians(b[1])
        dp, dl = p2 - p1, math.radians(b[0] - a[0])
        h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        total += 2 * 6371000 * math.asin(math.sqrt(h))
    return total


def _num(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _fmt(v: Optional[float], unit: str = "", nd: int = 0) -> str:
    return "UNKNOWN" if v is None else f"{v:,.{nd}f}{unit}"


def bus_lane_directions(bp) -> int:
    """General-traffic lanes a road's bus lane / BRT upgrade takes (one per listed direction; frontend streetDesign/busLane.ts)."""
    if not isinstance(bp, dict) or bp.get("kind") not in ("bus_lane", "brt"):
        return 0
    return 2 if bp.get("directions", "both") == "both" else 1


def _street_element(p: dict, c, out: dict) -> None:
    kind = p.get("kind")
    out["kind"] = kind
    label = STREET_KIND_LABEL.get(kind, "Street element (kind UNKNOWN)")
    if kind == "path":
        sp = p.get("path") or {}
        out["length_m"] = plan_length_m(c)
        lvl = sp.get("level")
        h = _num(sp.get("clearHeightM"))
        out["level"] = {"ground": "at ground level", "fob": f"foot-over-bridge, clear height {_fmt(h, ' m', 2)}",
                        "subway": f"subway, clear height {_fmt(h, ' m', 2)}"}.get(lvl, "level UNKNOWN")
        out["detail"] = f"{_PATH_TYPE.get(sp.get('pathType'), 'type UNKNOWN')}, width {_fmt(_num(sp.get('widthM')), ' m', 1)}"
        return
    out["count"] = 1
    if kind == "crossing":
        x = p.get("crossing") or {}
        ref = f"refuge {_fmt(_num(x.get('refugeWidthM')), ' m', 1)}" if x.get("refuge") else "no refuge"
        out["detail"] = f"{label}: {x.get('crossingType') or 'type UNKNOWN'}, {_fmt(_num(x.get('widthM')), ' m', 1)} wide, {ref}"
    elif kind == "bus_stop":
        b = p.get("busStop") or {}
        where = {"kerb": "kerb-side", "bay": "in the parking / furniture strip", "median_brt": "BRT median station"}.get(b.get("placement"), "placement UNKNOWN")
        out["detail"] = f"{label}: {where}, shelter {_fmt(_num(b.get('shelterLengthM')), ' m', 1)} x {_fmt(_num(b.get('shelterDepthM')), ' m', 1)}"
    elif kind in ("streetlight", "street_tree"):
        r = p.get("roadside") or {}
        pts = r.get("points") if isinstance(r.get("points"), list) else []
        n = len(pts) or int(_num(r.get("count")) or 0) or None
        out["count"] = n
        sp = _num(r.get("spacingM"))
        if kind == "streetlight":
            out["detail"] = f"{label}: {_fmt(n)} pole(s), {_fmt(_num(r.get('poleHeightM')), ' m', 1)} high, every {_fmt(sp, ' m', 1)} ({r.get('zone') or 'zone UNKNOWN'})"
        else:
            out["detail"] = f"{label}: {_fmt(n)} tree(s), pit {_fmt(_num(r.get('pitM')), ' m', 1)} square, every {_fmt(sp, ' m', 1)}" + \
                            (" (spacing assumed)" if (p.get("valueCertainty") or {}).get("spacingM") == "unknown" else "")
    elif kind == "roundabout":
        rb = p.get("roundabout") or {}
        cat = {"urban_single": "urban single-lane (IRC:65)", "double": "double-lane (IRC:65)", "mini": "mini (MoUD CoP Part 2)"}.get(rb.get("category"), "category UNKNOWN")
        out["detail"] = (f"{label}: {cat}, ICD {_fmt(_num(rb.get('icdM')), ' m', 1)}, island {_fmt(_num(rb.get('islandM')), ' m', 1)}, "
                         f"circulatory {_fmt(_num(rb.get('circulatoryM')), ' m', 1)}, {_fmt(_num(rb.get('armCount')))} arm(s)")
    else:
        out["detail"] = label


def object_quantities(o: dict) -> dict:
    """{length_m, lanes, level, piers, detail} of one stored object ({type, coordinates, properties}); street elements also
    carry kind and count (items), roads with a bus lane / BRT upgrade bus_lane_m (lane length taken from general traffic)."""
    from coordination import screening as SCR
    t, p, c = o.get("type"), o.get("properties") or {}, o.get("coordinates")
    out = {"length_m": plan_length_m(c) if t in LINE_TYPES else None, "lanes": None, "level": "", "piers": None, "detail": ""}
    if t == "street_element":
        _street_element(p, c, out)
        return out
    if t in ("road", "flyover", "metro_flyover"):
        out["lanes"] = _num(p.get("laneCount"))
        oneway = p.get("isOneWay")
        sp = _num(p.get("speedLimit"))
        out["detail"] = ("one-way" if oneway else "two-way") + (", divided" if p.get("hasDivider") else "") + (f", {sp:.0f} km/h" if sp else "")
        sec = (p.get("sections") or [{}])[0] if isinstance(p.get("sections"), list) and p.get("sections") else {}
        xs = (sec or {}).get("crossSection") or {}
        if xs.get("code"):
            out["detail"] += f", cross-section USDG {xs['code']} ({_fmt(_num(xs.get('rowM')), ' m')} RoW)"
        bp = p.get("busPriority")
        dirs = bus_lane_directions(bp)
        if t == "road" and dirs:
            out["detail"] += (f", {'BRT' if bp.get('kind') == 'brt' else 'bus lane'} "
                              f"({'both directions' if dirs == 2 else bp.get('directions')}, {_fmt(_num(bp.get('laneWidthM')), ' m', 1)} lane"
                              f"{', divider ' + _fmt(_num(bp.get('dividerM')), ' m', 1) if bp.get('dividerM') is not None else ''})")
            out["bus_lane_m"] = out["length_m"] * dirs if out["length_m"] is not None else None
    if t in ("flyover", "metro_flyover"):
        out["level"] = f"deck {_fmt(_num(p.get('elevation')), ' m', 1)} above ground" + (f", metro deck {_fmt(_num(p.get('metroElevation')), ' m', 1)}" if t == "metro_flyover" else "")
        out["piers"] = len(SCR.pier_points(c or [], p.get("groundCoordinates"), _num(p.get("pierSpacing")) or 30.0, SCR.PIER_MIN_DECK_M))
    elif t == "metro_line":
        if SCR.metro_line_is_tunnel(p):
            out["level"] = "underground (depth not recorded)"
        else:
            out["level"] = f"track deck {_fmt(_num(p.get('elevation')), ' m', 1)} above ground"
            out["piers"] = len(SCR.pier_points(c or [], None, _num(p.get("pierSpacing")) or 30.0, None))
        out["detail"] = f"{_fmt(_num(p.get('trackCount')))} track(s)"
    elif t == "utility":
        d = _num(p.get("depth"))
        out["level"] = f"top of pipe {_fmt(d, ' m', 2)} below ground" + (" (depth UNKNOWN: placeholder)" if p.get("depthCertainty") == "unknown" else "")
        out["detail"] = f"{p.get('utilityType') or 'type UNKNOWN'}, diameter {_fmt(_num(p.get('diameterMm')), ' mm')}"
    elif t == "underground_alignment":
        crowns = [_num(x.get("crownDepthM")) for x in (p.get("depths") or []) if isinstance(x, dict)]
        known = [x for x in crowns if x is not None]
        out["level"] = (f"crown {min(known):.1f}–{max(known):.1f} m below ground" if known else "crown depth UNKNOWN") + \
                       (f" ({len(crowns) - len(known)} point(s) UNKNOWN)" if known and len(known) < len(crowns) else "")
        sec = p.get("section") or {}
        size = f"Ø {_fmt(_num(sec.get('diameterM')), ' m', 1)}" if sec.get("shape") == "circular" else f"{_fmt(_num(sec.get('widthM')), ' m', 1)} x {_fmt(_num(sec.get('heightM')), ' m', 1)}"
        out["detail"] = f"{(p.get('alignmentKind') or 'kind UNKNOWN').replace('_', ' ')}, {size}"
    elif t == "metro_station":
        out["detail"] = f"{_fmt(_num(p.get('length')), ' m')} x {_fmt(_num(p.get('width')), ' m')}"
        out["level"] = f"platform {_fmt(_num(p.get('elevation')), ' m', 1)} above ground"
    elif t == "junction":
        out["detail"] = "signalised" if p.get("hasSignals") or p.get("importedJunction") else "priority / unsignalised"
    return out


def built_works(db: Session, sid: str) -> list[dict]:
    """One row per object the alternative adds, changes or removes, with its quantities."""
    from api.scenario_router import head_change_set
    from models.models import CityObjectEntity
    rows = []
    for ch in head_change_set(db, sid):
        o = ch.get("object")
        if o is None:   # a delete: describe the removed base object
            e = db.get(CityObjectEntity, ch["objectId"])
            if e is None:
                rows.append({"id": ch["objectId"], "name": "(base object no longer stored)", "type": "?", "op": ch["op"], "q": {}})
                continue
            o = {"id": e.id, "type": e.type, "name": e.name, "coordinates": json.loads(e.geometry_geojson or "[]"),
                 "properties": json.loads(e.properties_json or "{}")}
        q = object_quantities(o)
        if ch["op"] == "modify" and q.get("bus_lane_m"):
            # a changed base road: the bus lane is a built work only when the base road did not already have the same one
            e = db.get(CityObjectEntity, o["id"])
            base_bp = (json.loads(e.properties_json or "{}") if e is not None else {}).get("busPriority")
            new_bp = (o.get("properties") or {}).get("busPriority")
            strip = lambda b: {k: v for k, v in (b or {}).items() if k != "appliedAt"}  # noqa: E731
            if base_bp and strip(base_bp) == strip(new_bp):
                q["bus_lane_m"] = None
        rows.append({"id": o["id"], "name": o.get("name") or o["id"], "type": o.get("type"), "op": ch["op"], "q": q})
    return rows


def totals(rows: list[dict]) -> dict[str, float]:
    """Plan length (m) per type of the NEW line objects (a drawn path under "path"), new piers, and the lane length of
    bus / BRT lanes added on new or changed roads ("bus_lane")."""
    out: dict[str, float] = {}
    for r in rows:
        bl = (r["q"] or {}).get("bus_lane_m")
        if bl and r["op"] in ("add", "modify"):
            out["bus_lane"] = out.get("bus_lane", 0.0) + bl
        if r["op"] != "add":
            continue
        L = (r["q"] or {}).get("length_m")
        if L:
            key = "path" if r["type"] == "street_element" else r["type"]
            out[key] = out.get(key, 0.0) + L
        if (r["q"] or {}).get("piers"):
            out["piers"] = out.get("piers", 0) + r["q"]["piers"]
    return out


def street_counts(rows: list[dict]) -> dict[str, int]:
    """Items of the NEW street elements by kind (crossings, bus stops, streetlight poles, street trees, roundabouts).
    A run whose item count is not recorded adds nothing (its row says UNKNOWN)."""
    out: dict[str, int] = {}
    for r in rows:
        q = r["q"] or {}
        if r["op"] != "add" or r["type"] != "street_element" or q.get("kind") not in STREET_COUNT_LABEL or not q.get("count"):
            continue
        out[q["kind"]] = out.get(q["kind"], 0) + int(q["count"])
    return out


def table_rows(rows: list[dict]) -> list[list[str]]:
    return [[r["name"], TYPE_LABEL.get(r["type"], r["type"] or "?"), OP_LABEL.get(r["op"], r["op"]),
             _fmt((r["q"] or {}).get("length_m"), " m") if (r["q"] or {}).get("length_m") is not None else "-",
             _fmt((r["q"] or {}).get("lanes")) if (r["q"] or {}).get("lanes") is not None else "-",
             (r["q"] or {}).get("level") or "-",
             str((r["q"] or {}).get("piers")) if (r["q"] or {}).get("piers") is not None else "-",
             (r["q"] or {}).get("detail") or "-"] for r in rows]
