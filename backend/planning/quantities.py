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
              "junction": "Junction", "building": "Building", "zone": "Demand zone", "gateway": "Traffic gateway"}
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


def object_quantities(o: dict) -> dict:
    """{length_m, lanes, level, piers, detail} of one stored object ({type, coordinates, properties})."""
    from coordination import screening as SCR
    t, p, c = o.get("type"), o.get("properties") or {}, o.get("coordinates")
    out = {"length_m": plan_length_m(c) if t in LINE_TYPES else None, "lanes": None, "level": "", "piers": None, "detail": ""}
    if t in ("road", "flyover", "metro_flyover"):
        out["lanes"] = _num(p.get("laneCount"))
        oneway = p.get("isOneWay")
        sp = _num(p.get("speedLimit"))
        out["detail"] = ("one-way" if oneway else "two-way") + (", divided" if p.get("hasDivider") else "") + (f", {sp:.0f} km/h" if sp else "")
        sec = (p.get("sections") or [{}])[0] if isinstance(p.get("sections"), list) and p.get("sections") else {}
        xs = (sec or {}).get("crossSection") or {}
        if xs.get("code"):
            out["detail"] += f", cross-section USDG {xs['code']} ({_fmt(_num(xs.get('rowM')), ' m')} RoW)"
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
        rows.append({"id": o["id"], "name": o.get("name") or o["id"], "type": o.get("type"), "op": ch["op"], "q": object_quantities(o)})
    return rows


def totals(rows: list[dict]) -> dict[str, float]:
    """Plan length (m) per type of the NEW line objects, and new piers."""
    out: dict[str, float] = {}
    for r in rows:
        if r["op"] != "add":
            continue
        L = (r["q"] or {}).get("length_m")
        if L:
            out[r["type"]] = out.get(r["type"], 0.0) + L
        if (r["q"] or {}).get("piers"):
            out["piers"] = out.get("piers", 0) + r["q"]["piers"]
    return out


def table_rows(rows: list[dict]) -> list[list[str]]:
    return [[r["name"], TYPE_LABEL.get(r["type"], r["type"] or "?"), OP_LABEL.get(r["op"], r["op"]),
             _fmt((r["q"] or {}).get("length_m"), " m") if (r["q"] or {}).get("length_m") is not None else "-",
             _fmt((r["q"] or {}).get("lanes")) if (r["q"] or {}).get("lanes") is not None else "-",
             (r["q"] or {}).get("level") or "-",
             str((r["q"] or {}).get("piers")) if (r["q"] or {}).get("piers") is not None else "-",
             (r["q"] or {}).get("detail") or "-"] for r in rows]
