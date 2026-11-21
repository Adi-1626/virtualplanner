"""
Underground screening engine (docs/urbanos/UNDERGROUND_CHECKS.md; rules: coordination/screening_config.py, aligned with
UNDERGROUND_RESEARCH.md §3–4).

Checks every PROPOSED underground object of an alternative (Design-drawn underground alignments and utilities) against
what exists: Design-drawn existing objects (status existing / abandoned, or older baseline objects), PMC sewer / storm-drain records and other imported utility
records, OSM metro (tunnels, stations, lines), Design-drawn elevated metro, building footprints (foundation proxy,
depth UNKNOWN), PMC nallas / rivers, NWDP groundwater wells and imported boreholes; and proposed objects against each
other.

Read-only except field verifications a person records (coordination/models.py UndergroundVerificationEntity).

Statuses (only these):
  potential_conflict      the data as recorded breaks a threshold (stricter rule wins)
  requires_investigation  within the data's positional uncertainty of a threshold, inside the Metro 20 m zone, a
                          specialist case (no Indian numeric norm), or a groundwater / cover / watercourse flag
  insufficient_data       a needed input is missing (no Z, no datum, no width, no records for a network) — never a pass
  verified                ONLY when a person has recorded field evidence (QL-A) for that pair and neither asset changed
Checks that flag nothing are listed per object as "nothing found in the available data" — a checklist entry, not a
status. The words safe / clear / passed / feasible / construction-ready are never produced.

Geometry: UTM 43N (EPSG:32643). Depth positive DOWN from local ground (crown = top, invert = bottom). For a pair the depth
envelope is taken over the stretch of each asset that lies within the threshold distance of the other. A pair meets
clearance when EITHER the horizontal OR the vertical requirement is met after widening it by both assets' positional
uncertainty; a record whose Z is not usable (QL-B/C/D, no datum) makes the vertical component "not checkable".
"""
from __future__ import annotations

import datetime
import hashlib
import json
import math
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np
import shapely
import shapely.ops
from shapely.geometry import LineString, Point, mapping
from shapely.geometry.base import BaseGeometry
from shapely.strtree import STRtree

from . import geometry as G
from . import screening_config as C
from datasets.public_text import redact_paths

ENGINE = "underground-screening 1.0 (2026-11-15)"
STATUSES = ("potential_conflict", "requires_investigation", "insufficient_data", "verified")
SEVERITY = {s: i for i, s in enumerate(STATUSES)}
STATUS_LABEL = {
    "potential_conflict": "Potential conflict",
    "requires_investigation": "Requires investigation",
    "insufficient_data": "Insufficient data",
    "verified": "Verified",
}
STATUS_MEANING = {
    "potential_conflict": "With the data as recorded, the two assets are closer than the rule allows (or overlap). Confirm the "
                          "existing asset's position on site before redesigning.",
    "requires_investigation": "Close to a limit within the data's accuracy, inside the Metro 20 m zone, or a case with no Indian "
                              "numeric rule: another authority or a specialist must look at it.",
    "insufficient_data": "Something needed for the check is missing (depth, datum, size, or no records at all), so nothing can "
                         "be concluded. This is not a pass.",
    "verified": "A person recorded field evidence (e.g. a trial pit, QL-A) for this pair and neither asset changed since. "
                "Never set by the software.",
}
BANNER = "Automated screening — not an engineering assessment"
DISCLAIMER = ("Automated screening on incomplete records, using the rules table below (stricter rule wins, widened by data "
              "accuracy). Not an engineering assessment or approval. 'Nothing found' only means nothing was found in the data "
              "listed; utility owners, Maha-Metro and a qualified engineer must confirm.")
CHECK_NOTHING = "nothing found in the available data"
CHECK_FLAGGED = "flagged"
CHECK_NOT = "not checked"

KIND_LABEL = {"water": "Water main", "sewer": "Sewer", "storm": "Storm drain", "power": "Power cable", "gas": "Gas main",
              "telecom": "Telecom duct", "utility": "Utility", "tunnel": "Tunnel", "metro_tunnel": "Metro tunnel",
              "metro_station": "Metro station", "metro_viaduct": "Elevated metro (piers)", "metro": "Metro line (level unknown)",
              "building": "Building", "watercourse": "Nalla / river"}
ALIGNMENT_CLASS = {"bored_tunnel": "tunnel", "underground_metro": "metro_tunnel", "cut_and_cover": "tunnel",
                   "utility_trunk": "utility", "storm_drain": "storm"}
ALIGNMENT_LABEL = {"bored_tunnel": "Bored tunnel", "underground_metro": "Underground metro", "cut_and_cover": "Cut-and-cover box",
                   "utility_trunk": "Utility trunk", "storm_drain": "Storm drain"}
UTILITY_CLASS = {"water": "water", "electricity": "power", "sewage": "sewer", "gas": "gas", "fiber": "telecom"}
METRO_CLASSES = ("metro_tunnel", "metro_station", "metro_viaduct", "metro")
BURIED = ("water", "sewer", "storm", "power", "gas", "telecom", "utility", "tunnel", "metro_tunnel")
NETWORKS = {"water": "water supply", "power": "electricity", "gas": "gas (CGD)", "telecom": "telecom", "sewer": "sewer", "storm": "storm drain"}
CERT_RANK = {"measured": 0, "estimated": 1, "hypothetical": 2, "unknown": 3}


def record_class(utility_type: Optional[str]) -> str:
    t = (utility_type or "").lower()
    for keys, cls in ((("storm", "drain", "swd"), "storm"), (("sewer", "sewage", "foul"), "sewer"), (("water",), "water"),
                      (("power", "electric", "cable", "hv", "lv"), "power"), (("gas", "png", "cgd"), "gas"),
                      (("telecom", "fibre", "fiber", "ofc", "duct"), "telecom")):
        if any(k in t for k in keys):
            return cls
    return "utility"


def record_ref(ext: Optional[str]) -> str:
    """GeoServer-style feature ids ('pmc_storm_water_drains.631') read as '#631'; other ids as published."""
    e = str(ext or "")
    head, _, tail = e.rpartition(".")
    return f"#{tail}" if head and tail.isdigit() else e


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _r(v: Optional[float], nd: int = 2) -> Optional[float]:
    return None if v is None else round(float(v), nd)


# ── assets ───────────────────────────────────────────────────────────────────────────────────────────────────────────

@dataclass
class Asset:
    id: str
    name: str
    layer: str                       # design_proposed | design_existing | utility_record | osm_metro | building | watercourse
    status: str                      # proposed | existing
    cls: str
    geom: BaseGeometry               # UTM centreline / polygon / point
    half_width: Optional[float]      # None = width UNKNOWN (polygons: 0, footprint as drawn)
    profile: list[tuple[float, Optional[float], Optional[float]]]  # (chainage m, crown depth, invert depth); depth +down
    quality: str                     # QL-A..QL-D | UNKNOWN | design
    certainty: str
    dataset: dict
    diameter: Optional[float] = None
    kind_label: str = ""
    method: Optional[str] = None     # bored | cut_and_cover | open_cut (proposed only)
    meta: dict = field(default_factory=dict)

    @property
    def depth_known(self) -> bool:
        return any(c is not None for _, c, _ in self.profile) or any(i is not None for _, _, i in self.profile)

    def envelope(self, c0: Optional[float] = None, c1: Optional[float] = None) -> tuple[Optional[float], Optional[float]]:
        """(shallowest crown, deepest invert) over chainage c0..c1 (whole asset when None). Any UNKNOWN value inside the
        stretch makes that bound UNKNOWN."""
        p = self.profile
        if not p:
            return None, None
        if len(p) == 1 or c0 is None:
            crowns = [c for _, c, _ in p]
            inverts = [i for _, _, i in p]
        else:
            lo, hi = min(c0, c1), max(c0, c1)
            pts = [lo, hi] + [ch for ch, _, _ in p if lo < ch < hi]
            crowns = [self._at(ch, 1) for ch in pts]
            inverts = [self._at(ch, 2) for ch in pts]
        crown = None if any(v is None for v in crowns) else min(crowns)
        invert = None if any(v is None for v in inverts) else max(inverts)
        return crown, invert

    def _at(self, ch: float, k: int) -> Optional[float]:
        p = self.profile
        if ch <= p[0][0]:
            return p[0][k]
        for a, b in zip(p, p[1:]):
            if a[0] <= ch <= b[0]:
                if a[k] is None or b[k] is None:
                    return None
                t = 0.0 if b[0] == a[0] else (ch - a[0]) / (b[0] - a[0])
                return a[k] + t * (b[k] - a[k])
        return p[-1][k]

    def tolerance(self, cfg: dict) -> tuple[float, Optional[float]]:
        """(horizontal, vertical) positional uncertainty; vertical None = this asset's Z cannot be used (QL-B/C/D, no datum)."""
        t = cfg["tolerance"].get(self.quality) or cfg["tolerance"]["UNKNOWN"]
        v = t["vertical_m"]
        if self.meta.get("datum_stated") is False:
            v = None
        return t["horizontal_m"], v

    def label(self) -> str:
        return self.name or self.kind_label or KIND_LABEL.get(self.cls, self.cls)

    def public(self, with_geometry: bool = True) -> dict:
        crown, invert = self.envelope()
        d = {"id": self.id, "name": self.label(), "kind": self.cls, "kind_label": self.kind_label or KIND_LABEL.get(self.cls, self.cls),
             "layer": self.layer, "status": self.status, "quality_level": self.quality, "certainty": self.certainty,
             "dataset": self.dataset, "width_m": None if self.half_width is None else _r(self.half_width * 2),
             "crown_depth_m": _r(crown), "invert_depth_m": _r(invert)}
        if self.meta.get("lifecycle"):
            d["lifecycle"] = self.meta["lifecycle"]
        if self.meta.get("default_vertices"):
            d["default_depth_points"] = self.meta["default_vertices"]
        if with_geometry:
            d["geometry"] = _lonlat(self.geom)
        return d


_OSM_ID_RE = re.compile(r"^osm_m_(way|node|relation)_(\d+)(?:_|$)")


def osm_ref(obj_id: Any, props: Optional[dict] = None) -> Optional[str]:
    """The OpenStreetMap element a Design object was imported from, as the OSM index names it ("osm_way_123"), or None.
    Study-area imports store `osmSourceId` ("way/123") / `osmElementType` + `osmId`; their object ids are
    "osm_m_<type>_<id>[_in_area_<area>_<n>]" (a way clipped by two study areas gives two objects with one OSM id)."""
    p = props or {}
    src = p.get("osmSourceId")
    if isinstance(src, str) and "/" in src:
        t, i = src.split("/", 1)
        if t in ("way", "node", "relation") and i.isdigit():
            return f"osm_{t}_{i}"
    if p.get("osmElementType") in ("way", "node", "relation") and str(p.get("osmId", "")).isdigit():
        return f"osm_{p['osmElementType']}_{p['osmId']}"
    m = _OSM_ID_RE.match(str(obj_id or ""))
    return f"osm_{m.group(1)}_{m.group(2)}" if m else None


def _lonlat(g: BaseGeometry, max_pts: int = 400) -> dict:
    gg = g
    n = shapely.get_num_coordinates(g)
    if n > max_pts:
        gg = g.simplify(2.0, preserve_topology=False) or g
    out = mapping(G.reproject(gg, G._FROM_UTM))
    return json.loads(json.dumps(out, default=lambda o: list(o)), parse_float=lambda s: round(float(s), 7))


def _profile_from_vertices(line: LineString, crowns: list[Optional[float]], height: Optional[float]):
    coords = list(line.coords)
    out, ch = [], 0.0
    for i, c in enumerate(coords):
        if i:
            ch += math.dist(coords[i - 1][:2], c[:2])
        cr = crowns[i] if i < len(crowns) else None
        out.append((ch, cr, (cr + height) if (cr is not None and height is not None) else None))
    return out


def _cert_worst(cs: list[str]) -> str:
    vals = [c if c in CERT_RANK else "unknown" for c in cs] or ["unknown"]
    return max(vals, key=lambda c: CERT_RANK[c])


LIFECYCLES = ("existing", "proposed", "conceptual", "abandoned")
EVIDENCE_QL = ("QL-A", "QL-B", "QL-C", "QL-D")


def _lc_suffix(lc: Optional[str]) -> str:
    return {"conceptual": " (conceptual)", "abandoned": " (abandoned in place)"}.get(lc or "", "")


def defaults_used(a: Asset, c0: Optional[float], c1: Optional[float]) -> bool:
    """True when the depth of `a` over chainage c0..c1 (whole asset when None) rests on a typical-cover default vertex."""
    flags = a.meta.get("default_flags") or []
    if not any(flags):
        return False
    chs = [ch for ch, _, _ in a.profile]
    if c0 is None or len(chs) < 2:
        return True
    lo, hi = min(c0, c1), max(c0, c1)
    used = set()
    for i in range(len(chs) - 1):
        if chs[i + 1] >= lo - 1e-6 and chs[i] <= hi + 1e-6:
            used.update((i, i + 1))
    return any(flags[i] for i in used if i < len(flags))


def _profile_from_extents(line: LineString, tops: list[Optional[float]], bottoms: list[Optional[float]]):
    """Per-vertex (chainage, top depth, bottom depth); the envelope interpolates between known vertices and never across
    an UNKNOWN one."""
    coords = list(line.coords)
    out, ch = [], 0.0
    for i, c in enumerate(coords):
        if i:
            ch += math.dist(coords[i - 1][:2], c[:2])
        out.append((ch, tops[i] if i < len(tops) else None, bottoms[i] if i < len(bottoms) else None))
    return out


def utility_z(p: dict, n: int, status: str, dia: Optional[float]) -> dict:
    """Per-vertex top / bottom-of-pipe depth (m, +down) of a drawn utility (frontend engine/underground/utilityModel.ts).

    Per-point model (`depths` list present): each vertex's `topDepthM` is used; when it is absent it is derived from
    `depthM` and the object's `zRef` (top / centre / invert) and diameter, as the frontend does. A depth that is not a
    finite number >= 0 is UNKNOWN. A typical-cover default (`isDefault`) is used as a hypothetical value and counted.
    Legacy model (no `depths`): one `depth` for the whole line, read as the top of the pipe; `depthCertainty` 'unknown'
    = no depth; no certainty = hypothetical on a proposal, unknown on an existing object.
    """
    zref = p.get("zRef") if p.get("zRef") in ("top", "centre", "invert") else "top"
    ev = p.get("evidence") if p.get("evidence") in EVIDENCE_QL + ("user-drawn", "unknown") else None
    depths = p.get("depths")
    tops: list[Optional[float]] = []
    bottoms: list[Optional[float]] = []
    certs: list[str] = []
    defaults = 0
    flags: list[bool] = []
    if isinstance(depths, list):
        model = "per-point"
        for i in range(n):
            d = depths[i] if i < len(depths) and isinstance(depths[i], dict) else {}
            dm = _num(d.get("depthM"))
            dm = dm if dm is not None and dm >= 0 else None
            top = _num(d.get("topDepthM")) if "topDepthM" in d else None
            if top is not None and top < 0:
                top = None
            if dm is None:
                top = None
            elif top is None:
                top = dm if zref == "top" else (max(0.0, dm - (dia / 2 if zref == "centre" else dia)) if dia else None)
            if dm is None:
                bot = None
            elif zref == "invert":
                bot = dm
            elif top is not None and dia:
                bot = top + dia
            else:
                bot = None
            tops.append(top)
            bottoms.append(bot)
            flags.append(bool(d.get("isDefault")) and (top is not None or bot is not None))
            if top is not None or bot is not None:
                if d.get("isDefault"):
                    defaults += 1
                    certs.append("hypothetical")
                else:
                    c = d.get("certainty")
                    certs.append(c if c in CERT_RANK and c != "unknown" else "hypothetical" if status == "proposed" else "unknown")
    else:
        model = "legacy"
        # depthCertainty 'unknown' = the stored depth is only a drawing placeholder (types.ts UtilityObject); absent = a
        # design value on a proposal (hypothetical) or an unsourced hand entry on an existing object (used, quality UNKNOWN)
        stated = p.get("depthCertainty")
        depth = _num(p.get("depth"))
        if stated == "unknown" or (depth is not None and depth < 0):
            depth = None
        tops = [depth] * n
        flags = [False] * n
        bottoms = [(depth + dia) if (depth is not None and dia is not None) else None] * n
        if depth is not None:
            certs = [stated or ("hypothetical" if status == "proposed" else "unknown")]
    cert = _cert_worst(certs) if certs else "unknown"
    note = None
    if status == "proposed" and ev in EVIDENCE_QL:
        note = f"Evidence {ev} is recorded on a proposal: a proposal is screened as design intent (no positional widening)."
    return {"tops": tops, "bottoms": bottoms, "cert": cert, "zref": zref, "evidence": ev or "user-drawn", "defaults": defaults, "flags": flags,
            "model": model, "evidence_note": note}


def _utility_quality(status: str, evidence: str, cert: str) -> str:
    """Quality level used for positional-uncertainty widening (screening_config.TOLERANCE).
    - Proposed / conceptual: 'design' — the drawn line IS the design intent, so 'user-drawn' adds no position uncertainty
      (deliberate choice; any recorded QL on a proposal is ignored and noted).
    - Existing / abandoned with evidence QL-A..QL-D: that quality level (ASCE 38).
    - Existing / abandoned drawn by hand ('user-drawn', or unknown): no survey behind it — 'user-drawn' (treated as QL-D,
      level not usable) or 'user-drawn (measured)' when every depth used is stated as measured; 'unknown' -> UNKNOWN."""
    if status == "proposed":
        return "design"
    if evidence in EVIDENCE_QL:
        return evidence
    if evidence == "unknown":
        return "UNKNOWN"
    return _drawn_quality(cert)


def object_lifecycle(obj: dict) -> Optional[str]:
    """The lifecycle the user recorded on a drawn object: utilities `status` (existing / proposed / conceptual / abandoned),
    underground alignments `lifecycle` (existing / proposed / conceptual). None when not recorded ('unknown' or absent):
    the caller then falls back to alternative membership."""
    p = obj.get("properties") or {}
    v = p.get("status") if obj.get("type") == "utility" else (p.get("lifecycle") if obj.get("type") == "underground_alignment" else None)
    return v if v in LIFECYCLES else None


def lifecycle_side(lc: Optional[str]) -> Optional[str]:
    """proposed / conceptual are checked as proposals; existing and abandoned-in-place are obstacles (existing)."""
    if lc is None:
        return None
    return "proposed" if lc in ("proposed", "conceptual") else "existing"


def design_asset(obj: dict, status: str) -> Optional[Asset]:
    """An object as stored by Design ({id, type, name, scenarioId, coordinates, properties}) -> Asset, or None when it is
    not an underground / metro object or its geometry is unusable. `status` is the side it is screened on (proposed /
    existing); the recorded lifecycle (conceptual, abandoned) is kept in meta['lifecycle']."""
    t, p = obj.get("type"), obj.get("properties") or {}
    lc = object_lifecycle(obj)
    coords = obj.get("coordinates") or []
    try:
        pts = [(float(c[0]), float(c[1])) for c in coords if isinstance(c, (list, tuple)) and len(c) >= 2]
    except (TypeError, ValueError):
        return None
    layer = "design_proposed" if status == "proposed" else "design_existing"
    ds = {"id": f"design:{obj.get('scenarioId') or 'base'}", "name": "Drawn in Design" + (" (proposal)" if status == "proposed" else " (recorded as existing)"),
          "quality_level": "design" if status == "proposed" else "as drawn"}
    if t == "underground_alignment" and len(pts) >= 2:
        line = G.project_geojson({"type": "LineString", "coordinates": pts})
        sec = p.get("section") or {}
        if sec.get("shape") == "circular":
            w = h = _num(sec.get("diameterM"))
        else:
            w, h = _num(sec.get("widthM")), _num(sec.get("heightM"))
        w = w if w and w > 0 else None
        h = h if h and h > 0 else None
        depths = p.get("depths") or []
        crowns = [(_num(d.get("crownDepthM")) if isinstance(d, dict) else None) for d in depths]
        certs = [(d.get("certainty") if isinstance(d, dict) and _num(d.get("crownDepthM")) is not None else "unknown") for d in depths] or ["unknown"]
        kind = p.get("alignmentKind") or "bored_tunnel"
        cls = ALIGNMENT_CLASS.get(kind, "tunnel")
        cert = _cert_worst(certs + [p.get("sectionCertainty") or "unknown"])
        method = "bored" if kind in ("bored_tunnel", "underground_metro") else ("cut_and_cover" if kind == "cut_and_cover" else "open_cut")
        return Asset(str(obj.get("id")), obj.get("name") or "", layer, status, cls, line, None if w is None else w / 2,
                     _profile_from_vertices(line, crowns, h), "design" if status == "proposed" else _drawn_quality(cert), cert, ds,
                     diameter=w if sec.get("shape") == "circular" else (max(w, h) if (w and h) else None),
                     kind_label=ALIGNMENT_LABEL.get(kind, "Underground alignment") + _lc_suffix(lc), method=method,
                     meta={"section": sec, "section_height_m": h, "design_type": t, "alignment_kind": kind, "lifecycle": lc or status})
    if t == "utility" and len(pts) >= 2:
        line = G.project_geojson({"type": "LineString", "coordinates": pts})
        dia_mm = _num(p.get("diameterMm"))
        dia = dia_mm / 1000.0 if dia_mm and dia_mm > 0 else None
        cls = UTILITY_CLASS.get(p.get("utilityType"), "utility")
        z = utility_z(p, len(pts), status, dia)
        prof = _profile_from_extents(line, z["tops"], z["bottoms"])
        quality = _utility_quality(status, z["evidence"], z["cert"])
        return Asset(str(obj.get("id")), obj.get("name") or "", layer, status, cls, line, None if dia is None else dia / 2, prof,
                     quality, z["cert"], ds, diameter=dia, kind_label=KIND_LABEL.get(cls, "Utility") + _lc_suffix(lc), method="open_cut",
                     meta={"design_type": t, "utility_type": p.get("utilityType"), "lifecycle": lc or status, "evidence": z["evidence"],
                           "z_model": z["model"], "z_ref": z["zref"], "default_vertices": z["defaults"], "default_flags": z["flags"],
                           "evidence_note": z["evidence_note"]})
    if t == "metro_line" and len(pts) >= 2 and status == "existing":
        line = G.project_geojson({"type": "LineString", "coordinates": pts})
        w = _num(p.get("deckWidth"))
        osm = osm_ref(obj.get("id"), p)
        if metro_line_is_tunnel(p):
            # An OSM tunnel imported into Design: plan position only, depth not mapped (it used to be screened as an
            # "Elevated metro (drawn)", with the import's invented -6 m)
            return Asset(str(obj.get("id")), obj.get("name") or "", layer, status, "metro_tunnel", line, None, [(0.0, None, None)],
                         "UNKNOWN", "unknown", ds, kind_label="Metro tunnel (imported from OpenStreetMap; depth not mapped)" if osm else "Metro tunnel (drawn; depth not mapped)",
                         meta={"design_type": t, "osm_ref": osm})
        return Asset(str(obj.get("id")), obj.get("name") or "", layer, status, "metro_viaduct", line, (w / 2) if w else None,
                     [(0.0, None, None)], "UNKNOWN", "unknown", ds,
                     kind_label="Elevated metro (imported from OpenStreetMap; pier foundations UNKNOWN)" if osm else "Elevated metro (drawn; pier foundations UNKNOWN)",
                     meta={"design_type": t, "osm_ref": osm})
    if t == "metro_station" and pts and status == "existing":
        pt = G.project_geojson({"type": "Point", "coordinates": pts[0]})
        ln, wd = _num(p.get("length")) or 0.0, _num(p.get("width")) or 0.0
        geom = pt.buffer(max(ln, wd) / 2) if (ln or wd) else pt
        return Asset(str(obj.get("id")), obj.get("name") or p.get("stationName") or "", layer, status, "metro_station", geom,
                     0.0 if (ln or wd) else None, [(0.0, None, None)], "UNKNOWN", "unknown", ds, kind_label="Metro station (drawn)",
                     meta={"design_type": t, "osm_ref": osm_ref(obj.get("id"), p)})
    return None


def depth_range_text(top: Optional[float], bottom: Optional[float]) -> str:
    """'16.0 m to 22.3 m', 'top 1.0 m, bottom unknown', or 'depth unknown' (never 'unknown to unknown')."""
    if top is None and bottom is None:
        return "depth unknown"
    if top is None or bottom is None:
        return f"top {_fmt(top)}, bottom {_fmt(bottom)}"
    return f"{_fmt(top)} to {_fmt(bottom)}"



def metro_line_is_tunnel(p: dict) -> bool:
    """A metro line stored by Design is a tunnel when its OSM tags say so (tunnel / negative layer) or its level is below
    ground (older imports stored an invented -6 m)."""
    tags = {**(p.get("originalOsmTags") or {}), **(p.get("tags") or {})}
    try:
        layer = int(str(tags.get("layer", "0")).split(";")[0])
    except ValueError:
        layer = 0
    elev = _num(p.get("elevation"))
    return (bool(tags.get("tunnel")) and tags.get("tunnel") != "no") or layer < 0 or (elev is not None and elev < 0)


def _drawn_quality(cert: str) -> str:
    """Existing objects drawn by hand carry no ASCE 38 quality level: 'user-drawn', or 'user-drawn (measured)' when the
    user states the depth was measured."""
    return "user-drawn (measured)" if cert == "measured" else "user-drawn"


# ── existing-data loaders (cached per data fingerprint) ─────────────────────────────────────────────────────────────

_REC_CACHE: dict[str, Any] = {}


def load_records(db) -> dict:
    """All utility records with geometry as UTM geometries + one STRtree, cached per subsurface-data hash. Vectorised parse
    and projection (the PMC sewer + storm networks are ~53,000 records)."""
    from .models import SubsurfaceDatasetEntity as D, SubsurfaceRecordEntity as R
    from .service import subsurface_hash
    key = f"{db.get_bind().url}|{subsurface_hash(db)}"
    if key in _REC_CACHE:
        return _REC_CACHE[key]
    t0 = time.perf_counter()
    rows = db.query(R.id, R.dataset_id, R.external_id, R.geometry_geojson, R.utility_type, R.owner, R.diameter_m, R.quality_level,
                    R.z_min_m, R.z_max_m, R.z_certainty, R.survey_method).filter(R.record_type == "utility", R.geometry_geojson.isnot(None)).all()
    geoms = shapely.from_geojson([r[3] for r in rows], on_invalid="ignore") if rows else np.array([])
    ok = [i for i, g in enumerate(geoms) if g is not None and not g.is_empty]
    rows = [rows[i] for i in ok]
    geoms = np.array([geoms[i] for i in ok], dtype=object)
    if len(geoms):
        geoms = shapely.transform(geoms, lambda c: np.column_stack(G._TO_UTM.transform(c[:, 0], c[:, 1])))
    datasets = {d.id: {"id": d.id, "name": d.name, "publisher": d.publisher, "licence": d.licence, "data_date": d.data_date,
                       "coverage_bbox": json.loads(d.coverage_bbox_json) if d.coverage_bbox_json else None, "record_count": d.record_count}
                for d in db.query(D).filter(D.record_type == "utility")}
    out = {"rows": rows, "geoms": geoms, "tree": STRtree(geoms) if len(geoms) else None, "datasets": datasets,
           "load_ms": round((time.perf_counter() - t0) * 1000)}
    _REC_CACHE.clear()
    _REC_CACHE[key] = out
    return out


def record_asset(rec: dict, i: int) -> Asset:
    rid, did, ext, _, utype, owner, dia, ql, zmin, zmax, zc, method = rec["rows"][i]
    crown = -zmax if zmax is not None else None
    invert = -zmin if zmin is not None else None
    ds = rec["datasets"].get(did, {"id": did, "name": did})
    cls = record_class(utype)
    ref = did.startswith("ssd_ref_")   # PMC reference networks: levels have no stated datum (research §2.3.3)
    return Asset(rid, f"{KIND_LABEL.get(cls, 'Utility')} {record_ref(ext)}", "utility_record", "existing", cls, rec["geoms"][i],
                 (dia / 2) if dia else None, [(0.0, crown, invert)], ql or "UNKNOWN", zc or "unknown",
                 {"id": did, "name": ds.get("name"), "quality_level": ql or "UNKNOWN", "publisher": ds.get("publisher"),
                  "data_date": ds.get("data_date")},
                 diameter=dia, kind_label=KIND_LABEL.get(cls, "Utility"),
                 meta={"external_id": ext, "owner": owner, "survey_method": method, "utility_type": utype,
                       "datum_stated": False if ref else None,
                       "depth_note": "PMC design levels, datum not stated: relative only, vertical not checkable" if ref else None})


def osm_metro_assets(boxes: list[tuple]) -> tuple[list[Asset], dict]:
    try:
        from osm.index import OsmIndex
        idx = OsmIndex()
        st = idx.status()
    except Exception as e:  # noqa: BLE001
        return [], {"available": False, "reason": redact_paths(str(e))[:160]}
    if not st.get("available") or "metro" not in st.get("capabilities", []):
        return [], {"available": False, "reason": "OSM index without metro"}
    out, seen = [], set()
    ds = {"id": "osm_index", "name": f"OpenStreetMap metro ({st.get('source')}, {st.get('dataTimestamp')})", "quality_level": "UNKNOWN"}
    for el in idx.infrastructure("metro", boxes):
        oid = f"osm_{el.get('type')}_{el.get('id')}"
        if oid in seen:
            continue
        seen.add(oid)
        tags = el.get("tags", {}) or {}
        try:
            layer = int(str(tags.get("layer", "0")).split(";")[0])
        except ValueError:
            layer = 0
        if el.get("type") == "node":
            g = G.project_geojson({"type": "Point", "coordinates": [el["lon"], el["lat"]]})
            cls = "metro_station"
        else:
            pts = [[p["lon"], p["lat"]] for p in el.get("geometry", [])]
            if len(pts) < 2:
                continue
            g = G.project_geojson({"type": "LineString", "coordinates": pts})
            if tags.get("railway") == "station" or tags.get("public_transport") == "station":
                cls = "metro_station"
            elif tags.get("tunnel") or layer < 0:
                cls = "metro_tunnel"
            elif tags.get("bridge") or layer > 0:
                cls = "metro_viaduct"
            else:
                cls = "metro"
        name = tags.get("name") or KIND_LABEL[cls]
        out.append(Asset(oid, f"{name} (OSM)", "osm_metro", "existing", cls, g, None, [(0.0, None, None)], "UNKNOWN", "unknown", ds,
                         kind_label=KIND_LABEL[cls], meta={"osm_tags": {k: tags[k] for k in ("name", "railway", "tunnel", "bridge", "layer") if k in tags}}))
    return out, {"available": True, "bbox": st.get("bbox"), "source": st.get("source"), "data_timestamp": st.get("dataTimestamp")}


def infra_assets(layer_id: str, boxes: list[tuple], cls: str, where: Optional[dict] = None, cap: int = 20000) -> tuple[list[Asset], dict]:
    try:
        from datasets import infra_store
        st = infra_store.status()
        meta_l = infra_store.layer(layer_id) if st.get("available") else None
        if meta_l is None:
            return [], {"available": False, "reason": st.get("reason") or f"{layer_id} not in the infrastructure index"}
    except Exception as e:  # noqa: BLE001
        return [], {"available": False, "reason": redact_paths(str(e))[:160]}
    out, seen, capped = [], set(), False
    for b in boxes:
        for fid, ext, p, g in infra_store.features_near(layer_id, b, where=where, max_features=cap + 1):
            if fid in seen:
                continue
            seen.add(fid)
            if len(seen) > cap:
                capped = True
                break
            gu = G.reproject(g, G._TO_UTM)
            name = p.get("name") or p.get("Name") or ""
            if cls == "building":
                ds = {"id": meta_l.get("dataset_id") or "infra:buildings", "name": "Building footprints (OSM + Microsoft + Google)",
                      "quality_level": "n/a (footprint only)"}
                meta = {"source": p.get("source"), "source_id": p.get("source_id"), "data_class": p.get("data_class"), "height_m": p.get("height_m")}
            else:
                ds = {"id": meta_l.get("dataset_id") or f"infra:{layer_id}", "name": f"PMC {layer_id} (OpenCity)", "quality_level": "QL-D"}
                meta = {"layer_id": layer_id}
            out.append(Asset(f"{layer_id}_{fid}", name, cls if cls != "watercourse" else "watercourse", "existing", cls, gu,
                             0.0 if gu.geom_type in ("Polygon", "MultiPolygon") else None, [(0.0, None, None)], "UNKNOWN", "unknown", ds,
                             kind_label=KIND_LABEL.get(cls, cls), meta=meta))
        if capped:
            break
    return out, {"available": True, "bbox": meta_l.get("bbox"), "read": len(out), "capped": capped}



# ── pair evaluation ──────────────────────────────────────────────────────────────────────────────────────────────────


def _stretch(a: Asset, zone: BaseGeometry) -> tuple[Optional[float], Optional[float]]:
    """Chainage range of a's centreline inside `zone` (None when a is not a line or does not enter it)."""
    if a.geom.geom_type != "LineString":
        return None, None
    inter = a.geom.intersection(zone)
    if inter.is_empty:
        p = shapely.ops.nearest_points(a.geom, zone)[0]
        c = a.geom.project(p)
        return c, c
    chs = []
    for part in getattr(inter, "geoms", [inter]):
        for xy in getattr(part, "coords", []):
            chs.append(a.geom.project(Point(xy)))
    return (min(chs), max(chs)) if chs else (None, None)


def vertical_gap(pc: Optional[float], pi: Optional[float], oc: Optional[float], oi: Optional[float]) -> Optional[float]:
    """Gap between two depth ranges (crown..invert, depth +down). >0 separated by that much, <=0 overlap (returned as 0),
    None when the known bounds cannot show either."""
    gaps = []
    if oc is not None and pi is not None:
        gaps.append(oc - pi)      # other entirely below proposed
    if pc is not None and oi is not None:
        gaps.append(pc - oi)      # proposed entirely below other
    if any(g > 1e-6 for g in gaps):
        return max(gaps)
    if len(gaps) == 2:
        return 0.0
    return None




def _fmt(v: Optional[float]) -> str:
    return "unknown" if v is None else f"{v:.1f} m"


def ladder(cfg: dict, *keys: str) -> list[str]:
    """Next investigation, in the order of the Indian process (owner as-builts → CBuD → GPR → trial pits → Maha-Metro NOC
    → boreholes → specialist)."""
    return [text for k, text in cfg["ladder"] if k in keys]


def _cite_txt(rows: list[dict], ids: list[str]) -> str:
    out = []
    for r in rows:
        if r["id"] in ids:
            out.append(f"{r['id']} {r['value_m']:.2f} m {r['dim']} ({r['type'].replace('_', ' ')}: {r['source']} {r['clause']})".replace(" —)", ")"))
    return "; ".join(out)


def _steps_for(o: Asset, cfg: dict, zone: bool, specialist: bool) -> list[str]:
    keys = []
    if o.layer in ("utility_record", "design_existing"):
        keys += ["as_builts", "cbud", "gpr", "trial_pits"]
    if o.layer == "design_proposed":
        keys += []
    if zone or o.cls in METRO_CLASSES:
        keys += ["metro_noc"]
    if specialist:
        keys += ["specialist"]
    steps = ladder(cfg, *keys)
    if o.layer == "design_proposed":
        steps = ["Coordinate the two proposals: change one profile or plan route, or agree a crossing detail."] + steps
    return steps or ladder(cfg, "as_builts", "cbud")


def evaluate_pair(p: Asset, o: Asset, cfg: dict) -> Optional[dict]:
    """Classify a proposed asset against another asset. Returns a finding, {'clear': True, ...} when the pair was read and
    meets the requirement with margin, or None when the other asset is beyond every threshold."""
    req = C.requirement(cfg, p.cls, o.cls, p.diameter, o.diameter)
    tph, tpv = p.tolerance(cfg)
    toh, tov = o.tolerance(cfg)
    tol_h = tph + toh
    v_checkable = tpv is not None and tov is not None
    tol_v = (tpv + tov) if v_checkable else None
    zone_rules = [z for z in cfg["protection_zones"] if o.cls in z["applies_to"].split(",")]
    zone_d = max([z["distance_m"] for z in zone_rules], default=0.0)
    centre = float(p.geom.distance(o.geom))
    width_unknown = p.half_width is None or o.half_width is None
    allow = cfg["unknown_width_allowance_m"] * ((p.half_width is None) + (o.half_width is None))
    edge = max(0.0, centre - (p.half_width or 0.0) - (o.half_width or 0.0) - allow)
    h_req, v_req = req["horizontal_m"], req["vertical_m"]
    h_thr = h_req + tol_h
    if edge > max(h_thr, zone_d) + 1e-6:
        return None
    zone_hit = [z for z in zone_rules if edge <= z["distance_m"] + 1e-6]
    h_margin = edge > h_thr + 1e-6 or (h_req > 0 and edge >= h_thr - 1e-6 and edge > 0)
    if h_margin and not zone_hit:
        return {"clear": True, "edge": edge}

    reach = max(h_thr, 0.5) + (p.half_width or 0.0) + (o.half_width or 0.0) + allow
    pc0, pc1 = _stretch(p, o.geom.buffer(reach))
    oc0, oc1 = _stretch(o, p.geom.buffer(reach))
    p_crown, p_inv = p.envelope(pc0, pc1)
    o_crown, o_inv = o.envelope(oc0, oc1)
    raw_gap = vertical_gap(p_crown, p_inv, o_crown, o_inv)
    gap = raw_gap if v_checkable else None
    crossing = bool(p.geom.intersects(o.geom))
    at = shapely.ops.nearest_points(p.geom, o.geom)
    lon, lat = G.from_utm((at[0].x + at[1].x) / 2, (at[0].y + at[1].y) / 2)

    found: list[str] = []
    plan = ("crosses it in plan" if crossing else f"comes within {edge:.1f} m of it in plan (edge to edge)")
    if width_unknown:
        plan += f"; a footprint width is unknown, so {cfg['unknown_width_allowance_m']:.1f} m half-width was assumed per unknown side"
    found.append(f"{p.label()} {plan}.")
    o_depth = depth_range_text(o_crown, o_inv)
    if o.meta.get("depth_note") and (o_crown is not None or o_inv is not None):
        o_depth += f" ({o.meta['depth_note']})"
    found.append(f"Depth where they meet: proposed {depth_range_text(p_crown, p_inv)}; {o.label()} {o_depth}.")
    for a, c0, c1 in ((p, pc0, pc1), (o, oc0, oc1)):
        if defaults_used(a, c0, c1):
            found.append(f"The depth of {a.label()} there is the typical-cover default for its type, not an entered or measured "
                         "value: enter the real depth.")
    if p.meta.get("evidence_note"):
        found.append(p.meta["evidence_note"])
    if o.meta.get("lifecycle") == "abandoned":
        found.append(f"{o.label()} is recorded as abandoned in place: screened as an existing obstacle (it stays in the ground unless removed).")
    if raw_gap is not None:
        found.append(("Vertical ranges overlap" if raw_gap <= 1e-6 else f"Vertical gap {raw_gap:.1f} m") +
                     ("." if v_checkable else " on recorded values — relative only, vertical not checkable."))
    if req["specialist"]:
        found.append(f"No Indian numeric clearance applies to this pair: anything within {h_req:.2f} m (1 x the larger diameter, a "
                     f"referral distance, not a clearance) goes to a specialist assessment; only a physical intersection is a potential "
                     f"conflict [{_cite_txt(req['rows'], req['h_ids'])}].")
    else:
        found.append(f"Requirement (stricter rule wins): {h_req:.2f} m horizontal [{_cite_txt(req['rows'], req['h_ids']) or 'none'}] or "
                     f"{v_req:.2f} m vertical [{_cite_txt(req['rows'], req['v_ids']) or 'none'}].")
    found.append(f"Widened by positional uncertainty: +{tol_h:.2f} m horizontal" +
                 (f", +{tol_v:.2f} m vertical" if v_checkable else ", vertical not checkable") + f" (data quality {p.quality} / {o.quality}).")
    if req["compare"]:
        found.append("International comparison: " + "; ".join(f"{c['source']} {c['clause']}" for c in req["compare"]) + ".")

    status: str
    specialist = False
    order_broken = None
    if v_checkable and req["order"] and p_crown is not None and p_inv is not None and o_crown is not None and o_inv is not None:
        p_above = p_inv <= o_crown + 1e-6
        p_below = p_crown >= o_inv - 1e-6
        want = req["order"]["order"]
        if (want == "a_above_b" and p_below) or (want == "a_below_b" and p_above):
            order_broken = req["order"]["rule"]
    if v_checkable and gap is not None:
        v_thr = v_req + tol_v
        physical = edge <= 1e-6 and gap <= 1e-6
        v_clear = (gap >= v_thr - 1e-6) if v_thr > 1e-6 else (gap > 1e-6)
        within_uncertainty = (v_req > 0 and gap >= v_req - 1e-6) or (h_req > 0 and edge >= h_req - 1e-6) or (h_req == 0 and edge > 1e-6 and not req["specialist"])
        if order_broken and (crossing or edge < h_req):
            status = "potential_conflict"
            found.append(f"Wrong way round: rule {order_broken} requires the {'proposed' if req['order']['order'] == 'a_above_b' else 'other'} asset on top.")
        elif v_clear:
            if not zone_hit:
                return {"clear": True, "edge": edge}
            status = "requires_investigation"
            found.append("Requirement met vertically in the data.")
        elif within_uncertainty:
            status = "requires_investigation"
            found.append("Requirement met on the recorded positions, but by less than the data's positional uncertainty.")
        elif req["specialist"] and not physical:
            status, specialist = "requires_investigation", True
            found.append("Closer than the referral distance and no Indian numeric clearance applies: specialist assessment needed.")
        else:
            status = "potential_conflict"
            found.append("Requirement not met in the data as recorded" + (" — the two assets physically intersect." if physical else "."))
    else:
        if edge >= h_req - 1e-6 and edge > 0:
            status = "requires_investigation"
            found.append(("Outside the referral distance on the recorded position" if req["specialist"] else "Horizontal requirement met on the recorded position")
                         + ", but by less than the data's positional uncertainty; vertical not checkable.")
        else:
            status = "insufficient_data"
            missing = []
            if p_crown is None or p_inv is None:
                missing.append("the proposed depth or section size")
            if o_crown is None and o_inv is None:
                missing.append(f"the depth of {o.label()}")
            elif not v_checkable:
                missing.append(f"a usable level for {o.label()} (quality {o.quality}" + (", datum not stated" if o.meta.get("datum_stated") is False else "") + ")")
            found.append("Vertical separation cannot be established: " + ", ".join(missing or ["data missing"]) + ".")
            specialist = req["specialist"]
    if zone_hit:
        if SEVERITY[status] > SEVERITY["requires_investigation"]:
            status = "requires_investigation"
        for z in zone_hit:
            found.append(f"Within {z['distance_m']:.0f} m of a Metro structure ({o.label()}, {edge:.1f} m): Maha-Metro NOC required "
                         f"({z['source']}). Permission trigger, not an engineering clearance.")
    not_checked = ["Owner's own standard for these assets (PMC, MSEDCL, MNGL, Maha-Metro may be stricter)."]
    if o.meta.get("lifecycle") == "abandoned":
        not_checked.append(f"Whether {o.label()} has been removed or filled since it was abandoned.")
    if not v_checkable:
        not_checked.append(f"Vertical clearance: level of {o.label() if tov is None else p.label()} not usable (quality / datum).")
    if o.layer == "osm_metro" or o.cls in METRO_CLASSES:
        not_checked.append("Metro tunnel crown / invert and pier foundation levels (OpenStreetMap has plan only; Maha-Metro as-builts not available).")
    if o.layer == "utility_record" and o.quality in ("QL-B", "QL-C", "QL-D", "UNKNOWN"):
        not_checked.append(f"Actual position of {o.label()}: {o.quality} record, not located on site.")
    not_checked.append("Ground level differences between the two points (depths are relative to local ground).")
    return {
        "status": status, "category": "metro" if o.cls in METRO_CLASSES else "clearance", "protection_zone": bool(zone_hit),
        "title": f"{p.label()} × {o.label()}",
        "checked": f"Horizontal and vertical clearance between the proposed {p.kind_label or KIND_LABEL.get(p.cls)} and the "
                   f"{'abandoned (existing obstacle)' if o.meta.get('lifecycle') == 'abandoned' else o.meta.get('lifecycle') if o.meta.get('lifecycle') == 'conceptual' else o.status} "
                   f"{o.kind_label or KIND_LABEL.get(o.cls)}" + (" and the Metro 20 m protection zone" if zone_rules else "") + ".",
        "data_used": _data_used(p, o),
        "found": found,
        "measurements": {"horizontal_m": _r(edge), "centreline_m": _r(centre), "vertical_gap_m": _r(gap), "recorded_vertical_gap_m": _r(raw_gap),
                         "separation_3d_m": _r(math.hypot(edge, max(gap, 0.0))) if gap is not None else None,
                         "required_horizontal_m": _r(h_req), "required_vertical_m": _r(v_req),
                         "uncertainty_horizontal_m": _r(tol_h), "uncertainty_vertical_m": _r(tol_v), "vertical_checkable": v_checkable,
                         "proposed_crown_m": _r(p_crown), "proposed_invert_m": _r(p_inv), "other_crown_m": _r(o_crown), "other_invert_m": _r(o_inv),
                         "crossing": crossing, "width_known": not width_unknown,
                         "proposed_chainage_m": None if pc0 is None else [_r(pc0, 1), _r(pc1, 1)]},
        "rules": req["rows"] + [{"id": z["id"], "dim": "H", "value_m": z["distance_m"], "type": z["type"], "source": z["source"], "clause": "", "note": z["note"]} for z in zone_hit],
        "not_checked": not_checked, "next_steps": _steps_for(o, cfg, bool(zone_hit), specialist or req["specialist"]),
        "location": [round(lon, 7), round(lat, 7)], "proposed": p.public(), "other": o.public(), "_sort": edge,
    }


def _data_used(*assets: Asset) -> list[dict]:
    out, seen = [], set()
    for a in assets:
        k = a.dataset.get("id")
        if k in seen:
            continue
        seen.add(k)
        d = {"dataset": a.dataset.get("name") or k, "dataset_id": k, "quality_level": a.dataset.get("quality_level") or a.quality}
        if a.meta.get("datum_stated") is False:
            d["datum"] = "not stated (levels relative only)"
        out.append(d)
    return out


# ── per-asset checks ─────────────────────────────────────────────────────────────────────────────────────────────────

def _start(p: Asset) -> list[float]:
    c = p.geom.interpolate(0.5, normalized=True) if p.geom.geom_type == "LineString" else p.geom.centroid
    lon, lat = G.from_utm(c.x, c.y)
    return [round(lon, 7), round(lat, 7)]


def _lonlat_pt(pt) -> list[float]:
    lon, lat = G.from_utm(pt.x, pt.y)
    return [round(lon, 7), round(lat, 7)]


def _finding(p: Asset, status: str, category: str, title: str, checked: str, data_used: list, found: list, meas: dict,
             not_checked: list, steps: list, rules: list, location=None, other: Optional[Asset] = None, **extra) -> dict:
    return {"status": status, "category": category, "title": f"{p.label()} — {title}", "checked": checked, "data_used": data_used,
            "found": found, "measurements": meas, "rules": rules, "not_checked": not_checked, "next_steps": steps,
            "location": location or _start(p), "proposed": p.public(), "other": other.public() if other else None, "_sort": 0.0, **extra}


def cover_check(p: Asset, cfg: dict) -> tuple[Optional[dict], dict]:
    """(finding or None, checklist entry). Below a normative minimum → Potential conflict; below a guideline / rule of thumb
    or outside the usual depth band → Requires investigation; no depth → Insufficient data."""
    spec = cfg["cover"].get(p.cls) or cfg["cover"]["utility"]
    crown, invert = p.envelope()
    unknown_pts = sum(1 for _, c, _ in p.profile if c is None)
    used = []
    for m in spec["min"]:
        if m.get("bored_only") and p.method != "bored":
            continue
        v = m["value_m"]
        if m.get("diameter_factor"):
            if not p.diameter:
                continue
            v = max(v, m["diameter_factor"] * p.diameter)
        used.append({**m, "value_m": round(v, 2)})
    rules = [{"id": f"cover:{p.cls}", "dim": "V", "value_m": m["value_m"], "type": m["type"], "source": m["source"], "clause": m["clause"],
              "note": cfg["ground_note"]} for m in used]
    data = [{"dataset": "Design profile (proposal)", "dataset_id": p.dataset["id"], "quality_level": "design"}]
    nc = [cfg["ground_note"], "Owner's own cover standard; road-crossing and casing requirements."]
    found, status = [], None
    if crown is None:
        status = "insufficient_data"
        found.append("No crown depth entered" + (f" at {unknown_pts} of {len(p.profile)} points." if len(p.profile) > 2 else "."))
        steps = ["Enter the crown depth at every point (and the section size) in the profile editor."]
    else:
        steps = []
        found.append(f"Shallowest crown (cover) {crown:.2f} m below ground" + (" (top of pipe)." if p.meta.get("design_type") == "utility" else "."))
        if defaults_used(p, None, None):
            found.append(f"{p.meta.get('default_vertices', 0)} point(s) use the typical-cover default for the type, not an entered depth.")
        for m in sorted(used, key=lambda m: -m["value_m"]):
            if crown < m["value_m"] - 1e-6:
                if m.get("voltage_dependent"):
                    s = "requires_investigation"
                    found.append(f"Below {m['value_m']:.2f} m ({m['source']} {m['clause']}): depends on the cable voltage, which is not recorded.")
                else:
                    s = "potential_conflict" if m["type"] == "normative" else "requires_investigation"
                    found.append(f"Below the minimum {m['value_m']:.2f} m ({m['type'].replace('_', ' ')}: {m['source']} {m['clause']}).")
                if status is None or SEVERITY[s] < SEVERITY[status]:
                    status = s
        if not used and p.cls in ("tunnel", "metro_tunnel"):
            nc.append("Cover rule for a tunnel needs its diameter (bored) — not available, or no rule for a cut-and-cover roof.")
        band = spec.get("band")
        deep = invert if invert is not None else crown
        if band and (crown < band[0] - 1e-6 or deep > band[1] + 1e-6):
            found.append(f"Outside the usual depth band {band[0]:.1f}–{band[1]:.1f} m for this type ({cfg['band_source']['source']} "
                         f"{cfg['band_source']['clause']}): unusual depth, verify.")
            if status is None:
                status = "requires_investigation"
        if invert is None:
            nc.append("Deepest point (invert): section size unknown.")
        if unknown_pts:
            found.append(f"{unknown_pts} point(s) have no depth: cover there is not checked.")
            status = status or "insufficient_data"
        if status in ("potential_conflict", "requires_investigation"):
            steps = ["Deepen the profile or design protection (slab / casing) and check the owner's standard."]
            if p.cls in ("tunnel", "metro_tunnel"):
                steps = ladder(cfg, "boreholes", "specialist")
    entry = {"check": "Cover and depth", "result": CHECK_FLAGGED if status else CHECK_NOTHING,
             "detail": " ".join(found) if not status else STATUS_LABEL[status]}
    if status is None:
        return None, entry
    return _finding(p, status, "cover", "cover and depth",
                    f"Cover (ground to crown) of the proposed {p.kind_label or KIND_LABEL.get(p.cls)} against the minimum for its type.",
                    data, found, {"crown_min_m": _r(crown), "invert_max_m": _r(invert)}, nc, steps, rules), entry


def buildings_check(p: Asset, blds: list[Asset], tree: Optional[STRtree], meta: dict, cfg: dict) -> tuple[Optional[dict], dict]:
    if not meta.get("available"):
        return None, {"check": "Building foundations", "result": CHECK_NOT, "detail": "Building footprint index not available."}
    bc = cfg["buildings"]
    crown, invert = p.envelope()
    depth = invert if invert is not None else crown
    zone = max(bc["min_zone_m"], bc["influence_factor"] * depth) if depth is not None else bc["min_zone_m"]
    gas_req = C.requirement(cfg, p.cls, "building", p.diameter, None) if p.cls == "gas" else None
    gas_d = (gas_req["horizontal_m"] if gas_req else 0.0)
    reach = max(zone, gas_d) + (p.half_width or 0.0)
    hits = []
    if tree is not None:
        for i in tree.query(p.geom, predicate="dwithin", distance=reach):
            b = blds[int(i)]
            hits.append((max(0.0, float(p.geom.distance(b.geom)) - (p.half_width or 0.0)), b))
    hits.sort(key=lambda t: t[0])
    if not hits:
        return None, {"check": "Building foundations", "result": CHECK_NOTHING,
                      "detail": f"No footprint within {zone:.1f} m (OSM completeness and ML recall unknown)."}
    above = [b for d, b in hits if d <= 1e-6]
    found = [f"{len(hits)} building footprint(s) within {zone:.1f} m of the asset edge ({bc['influence_factor']:.1f} × "
             f"{'invert' if invert is not None else 'crown'} depth {_fmt(depth)}, min {bc['min_zone_m']:.0f} m; rule of thumb); "
             f"nearest {hits[0][0]:.1f} m" + (f"; {len(above)} directly above / on the line." if above else "."),
             "Foundation, basement and pile depths are unknown: no Indian numeric clearance exists between a buried asset and a foundation."]
    status = "insufficient_data"
    rules = [{"id": "C19", "dim": "3D", "value_m": 0.0, "type": "no_norm", "source": "No Indian numeric norm found", "clause": "—",
              "note": bc["source"]}]
    if gas_req:
        close = [(d, b) for d, b in hits if d < gas_d - 1e-6]
        rules += gas_req["rows"]
        if close:
            status = "potential_conflict"
            found.append(f"{len(close)} building(s) closer than {gas_d:.1f} m to the gas main ({_cite_txt(gas_req['rows'], gas_req['h_ids'])}), "
                         "unless extra cover or a slab / casing is provided.")
    listed = [{**b.public(), "distance_m": _r(d)} for d, b in hits[:bc["max_listed"]]]
    nc = ["Foundation type and depth, basements, piles; building condition and sensitivity to settlement."]
    if meta.get("capped"):
        nc.append("Not every footprint near this asset was read (read cap reached).")
    f = _finding(p, status, "buildings", "nearby building foundations",
                 "Building footprints inside the settlement / excavation influence zone (foundation proxy)" + (" and the gas–building distance." if gas_req else "."),
                 [{"dataset": "Building footprints (OSM + Microsoft + Google ML)", "dataset_id": "infra:buildings", "quality_level": "footprint only, depth UNKNOWN"}],
                 found, {"buildings_in_zone": len(hits), "directly_above": len(above), "zone_m": _r(zone), "nearest_m": _r(hits[0][0])},
                 nc, ["Collect basement / foundation records for the listed buildings (PMC building-permission drawings)."] + ladder(cfg, "specialist"),
                 rules, location=_lonlat_pt(hits[0][1].geom.centroid), buildings=listed)
    return f, {"check": "Building foundations", "result": CHECK_FLAGGED, "detail": STATUS_LABEL[status]}


def watercourse_check(p: Asset, wcs: list[Asset], tree: Optional[STRtree], meta: dict, cfg: dict) -> tuple[Optional[dict], dict]:
    if not meta.get("available") or tree is None:
        return None, {"check": "Nallas and rivers", "result": CHECK_NOT if not meta.get("available") else CHECK_NOTHING,
                      "detail": "PMC nallas / rivers layer not available." if not meta.get("available") else "No nalla or river within 5 m."}
    hits = [wcs[int(i)] for i in tree.query(p.geom, predicate="dwithin", distance=5.0 + (p.half_width or 0.0))]
    if not hits:
        return None, {"check": "Nallas and rivers", "result": CHECK_NOTHING, "detail": "No nalla or river within 5 m (PMC layer)."}
    crown, _ = p.envelope()
    names = sorted({h.label() for h in hits})[:5]
    f = _finding(p, "requires_investigation", "watercourse", "passes under / beside a nalla or river",
                 "Plan crossing of PMC nallas and rivers (within 5 m).",
                 [{"dataset": "PMC nallas / rivers (OpenCity)", "dataset_id": "infra:nallas,rivers", "quality_level": "QL-D (plan only)"}],
                 [f"Crosses or runs within 5 m of {len(hits)} watercourse feature(s): {', '.join(names)}.",
                  f"Shallowest proposed crown {_fmt(crown)}; bed level, scour depth and flood level are unknown (Pune Metro tunnels run ~19 m below the Mutha bed — research C18, context only)."],
                 {"features": len(hits)}, ["River / nalla bed level, scour depth, flood levels, retaining walls and culverts."],
                 ["Survey bed levels and design flood / scour depth; PMC drainage / Irrigation Department permission for the crossing."] + ladder(cfg, "specialist"),
                 [{"id": "C18", "dim": "V", "value_m": 0.0, "type": "rule_of_thumb", "source": "Maha-Metro Pune tunnels below Mutha", "clause": "context only", "note": ""}],
                 location=_lonlat_pt(shapely.ops.nearest_points(p.geom, hits[0].geom)[1]), other=hits[0])
    return f, {"check": "Nallas and rivers", "result": CHECK_FLAGGED, "detail": STATUS_LABEL["requires_investigation"]}


def groundwater_check(p: Asset, cfg: dict) -> tuple[Optional[dict], dict]:
    name = "Groundwater"
    try:
        from terrain.evidence import Alignment, groundwater
        if p.geom.geom_type != "LineString":
            return None, {"check": name, "result": CHECK_NOT, "detail": "Only linear assets are compared with wells."}
        gw = groundwater(Alignment(_lonlat(p.geom)["coordinates"]), cfg["groundwater"]["radius_m"] / 1000.0, 4)
    except Exception as e:  # noqa: BLE001
        return None, {"check": name, "result": CHECK_NOT, "detail": f"Groundwater data could not be read ({type(e).__name__})."}
    wells = gw.get("wells") or []
    if not wells:
        return None, {"check": name, "result": CHECK_NOT, "detail": gw.get("status") or "No monitoring well nearby.", "gap": True}
    cutoff = (datetime.date.today() - datetime.timedelta(days=365 * cfg["groundwater"]["recent_years"])).isoformat()
    shallowest, src, lines = None, None, []
    for w in wells:
        recent = [s for s in w.get("series", []) if s.get("date", "") >= cutoff]
        lo = min(recent, key=lambda s: s["depth_m_bgl"]) if recent else None
        lines.append(f"{w['station_id']} ({w.get('agency')}) {w['distance_m'] / 1000:.1f} km away: " +
                     (f"shallowest {lo['depth_m_bgl']:.1f} m below ground on {lo['date']} ({len(recent)} readings since {cutoff[:4]})"
                      if lo else "no reading in the recent years"))
        if lo and (shallowest is None or lo["depth_m_bgl"] < shallowest):
            shallowest, src = lo["depth_m_bgl"], w
    crown, invert = p.envelope()
    deepest = invert if invert is not None else crown
    meas = {"shallowest_water_m": _r(shallowest), "deepest_asset_m": _r(deepest), "wells": len(wells)}
    rules = [{"id": "C21", "dim": "V", "value_m": 0.0, "type": "rule_of_thumb", "source": cfg["groundwater"]["source"], "clause": "", "note": ""}]
    data = [{"dataset": "NWDP groundwater levels (CGWB / GSDA manual readings)", "dataset_id": "nwdp_groundwater_pune", "quality_level": "point observations"}]
    nc = ["Water level at the alignment itself (wells are point observations, not interpolated).",
          "Seasonal peaks between quarterly readings, perched water, aquifer type, inflow and dewatering effects."]
    if shallowest is None or deepest is None:
        f = _finding(p, "insufficient_data", "groundwater", "groundwater", "Deepest point of the asset against the shallowest recent depth-to-water nearby.",
                     data, lines + ["No recent reading nearby." if shallowest is None else "Depth of the proposed asset unknown."], meas, nc,
                     ladder(cfg, "boreholes"), rules, location=[src["lon"], src["lat"]] if src else None)
        return f, {"check": name, "result": CHECK_FLAGGED, "detail": STATUS_LABEL["insufficient_data"]}
    if deepest > shallowest:
        f = _finding(p, "requires_investigation", "groundwater", "groundwater",
                     "Deepest point of the asset against the shallowest recent depth-to-water at monitoring wells nearby.", data,
                     lines + [f"The asset reaches {deepest:.1f} m, below the shallowest recent water level {shallowest:.1f} m at a nearby well: "
                              "it may sit below the water table for part of the year (post-monsoon levels are shallowest)."],
                     meas, nc, ladder(cfg, "boreholes") + ["Dewatering / waterproofing assessment."], rules, location=[src["lon"], src["lat"]])
        return f, {"check": name, "result": CHECK_FLAGGED, "detail": STATUS_LABEL["requires_investigation"]}
    return None, {"check": name, "result": CHECK_NOTHING,
                  "detail": f"Deepest point {deepest:.1f} m is above the shallowest recent water level {shallowest:.1f} m at {len(wells)} well(s) within "
                            f"{cfg['groundwater']['radius_m'] / 1000:.0f} km (point observations, not the level at the alignment)."}


def geology_check(p: Asset, cfg: dict, db) -> tuple[Optional[dict], dict]:
    name = "Ground conditions (boreholes)"
    recs = []
    try:
        from terrain.evidence import Alignment, boreholes
        if p.geom.geom_type == "LineString":
            recs = boreholes(Alignment(_lonlat(p.geom)["coordinates"]), cfg["boreholes"]["radius_m"] / 1000.0, db).get("records", [])
    except Exception:  # noqa: BLE001
        recs = []
    _, invert = p.envelope()
    r_m = cfg["boreholes"]["radius_m"]
    if not recs:
        return None, {"check": name, "result": CHECK_NOT, "detail": f"No borehole log within {r_m:.0f} m — site investigation required.", "gap": True}
    deep = [r for r in recs if r.get("final_depth_m") is not None and invert is not None and r["final_depth_m"] >= invert]
    if invert is not None and deep:
        return None, {"check": name, "result": CHECK_NOTHING,
                      "detail": f"{len(deep)} of {len(recs)} borehole(s) within {r_m:.0f} m reach the invert ({invert:.1f} m)."}
    status = "requires_investigation" if invert is not None else "insufficient_data"
    f = _finding(p, status, "geology", "ground conditions", "Whether imported borehole logs near the alignment reach the invert depth.",
                 [{"dataset": "Imported borehole records", "dataset_id": "subsurface:boreholes", "quality_level": "as imported"}],
                 [f"{len(recs)} borehole(s) within {r_m:.0f} m; nearest {recs[0]['external_id']} at {recs[0]['distance_m']:.0f} m.",
                  "None reaches the invert depth." if invert is not None else "Invert depth unknown: cannot say whether logs reach it."],
                 {"boreholes": len(recs), "reaching_invert": len(deep)}, ["Ground between boreholes (no interpolation)."],
                 ladder(cfg, "boreholes", "specialist"), [])
    return f, {"check": name, "result": CHECK_FLAGGED, "detail": STATUS_LABEL[status]}


def data_gap_finding(p: Asset, gaps: list[str], rec_layers: dict, cfg: dict) -> dict:
    """Absence of a layer is itself a finding (research §4): networks with no records here → Insufficient data."""
    present = {cls for cls, n in rec_layers.items() if n}
    missing_nets = [NETWORKS[c] for c in ("water", "power", "gas", "telecom", "sewer", "storm") if c not in present]
    found = []
    if missing_nets:
        found.append("No records loaded for: " + ", ".join(missing_nets) + " — clearances to these networks are not checked.")
    if "sewer" in present or "storm" in present:
        found.append("PMC sewer / storm-drain records have no stated coverage: absence of a record here is not absence of a pipe.")
    found += gaps
    return _finding(p, "insufficient_data", "data_gap", "data not available",
                    "Which networks and evidence layers have any data for this object.",
                    [{"dataset": "Layer inventory (see the layers list)", "dataset_id": "layers", "quality_level": "—"}],
                    found, {"networks_missing": len(missing_nets), "missing_networks": missing_nets}, [f"Clearance to {n} assets." for n in missing_nets],
                    ladder(cfg, "as_builts", "cbud", "gpr", "boreholes"), [])


def short_dataset_name(name: Optional[str]) -> str:
    """'PMC storm-water drains, labelled rows only (OpenCity mirror) — QL-D records' → 'PMC storm-water drains'."""
    n = (name or "").split(" — ")[0].split(" (")[0].split(",")[0].strip()
    return n or "Unnamed dataset"


def _join_or(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def gap_group(f: dict) -> dict:
    """Why an Insufficient-data finding cannot be judged, as one group shared by all findings with the same reason (one
    dataset / network / missing input). key = grouping key; label = plain sentence for a non-engineer; unit = what the
    count counts. The UI and the screening report list one line per group with the findings behind an expand."""
    cat = f["category"]
    o = f.get("other") or {}
    m = f.get("measurements") or {}
    if cat in ("clearance", "metro"):
        if m.get("proposed_crown_m") is None or m.get("proposed_invert_m") is None:
            pid = f["proposed"]["id"]
            return {"key": f"proposed_depth:{pid}", "label": f"{f['proposed']['name']}: depth or section size not entered — vertical "
                    "clearance not checkable", "unit": "nearby asset"}
        ds = o.get("dataset") or {}
        name = short_dataset_name(ds.get("name") or o.get("kind_label"))
        no_depth = m.get("other_crown_m") is None and m.get("other_invert_m") is None
        reason = "no depth recorded" if no_depth else "levels have no stated datum"
        return {"key": f"vertical:{ds.get('id') or o.get('layer')}:{'nodepth' if no_depth else 'nodatum'}",
                "label": f"{name}: {reason} — vertical clearance not checkable", "unit": "crossing or near pass"}
    if cat == "data_gap":
        nets = list(m.get("missing_networks") or [])
        if nets:
            return {"key": "networks:" + ",".join(nets), "label": f"No {_join_or(nets)} records in this area", "unit": "object"}
        return {"key": "data_gap", "label": "Evidence layers missing in this area", "unit": "object"}
    if cat == "buildings":
        return {"key": "buildings", "label": "Building foundations, basements and piles: depths unknown", "unit": "object"}
    if cat == "cover":
        return {"key": "cover", "label": "Cover not checkable: no crown depth entered", "unit": "object"}
    if cat == "groundwater":
        return {"key": "groundwater", "label": "Groundwater: no recent reading nearby or asset depth unknown", "unit": "object"}
    if cat == "geology":
        return {"key": "geology", "label": "Ground conditions: invert depth unknown, borehole reach not checkable", "unit": "object"}
    return {"key": f"cat:{cat}", "label": f.get("title") or cat, "unit": "finding"}


# ── field verification (recorded by a person) ───────────────────────────────────────────────────────────────────────

def pair_key(proposed_id: str, other_id: Optional[str], category: str) -> str:
    return f"{proposed_id}|{other_id or '-'}|{category}"


def fingerprint(f: dict) -> str:
    """What the verification was recorded against: both assets' geometry, size and depths."""
    def part(a):
        return None if not a else [a.get("geometry"), a.get("width_m"), a.get("crown_depth_m"), a.get("invert_depth_m")]
    return hashlib.sha256(json.dumps([part(f["proposed"]), part(f.get("other"))], sort_keys=True, default=str).encode()).hexdigest()[:16]


def apply_verifications(db, findings: list[dict]) -> None:
    try:
        from .models import UndergroundVerificationEntity as V
        rows = db.query(V).filter(V.pair_key.in_([f["pair_key"] for f in findings])).order_by(V.created_at).all() if findings else []
    except Exception:  # noqa: BLE001 - table missing in an old database: nothing verified
        return
    latest = {}
    for v in rows:
        latest[v.pair_key] = v
    for f in findings:
        v = latest.get(f["pair_key"])
        if v is None:
            continue
        rec = {"id": v.id, "verified_by": v.verified_by, "method": v.method, "evidence": v.evidence, "note": v.note,
               "measured_horizontal_m": v.measured_horizontal_m, "measured_vertical_m": v.measured_vertical_m,
               "recorded_at": v.created_at.isoformat() + "Z" if v.created_at else None, "fingerprint": v.fingerprint}
        f["verification"] = rec
        if v.fingerprint == f["fingerprint"]:
            f["computed_status"] = f["status"]
            f["status"] = "verified"
            f["found"] = [f"Field verification recorded by {v.verified_by} ({v.method}): {v.evidence}"] + f["found"]
        else:
            rec["stale"] = True
            f["found"].append(f"A field verification by {v.verified_by} was recorded, but one of the assets changed since: re-verify.")


# ── run ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def classify_objects(objects: list[dict], scenario_id: str) -> tuple[list[Asset], list[Asset], list[dict]]:
    """Which side each drawn object is screened on.
    1. The lifecycle recorded on the object wins (utility `status`, alignment `lifecycle`): proposed / conceptual are
       checked as proposals wherever they are drawn; existing and abandoned-in-place are existing obstacles (an abandoned
       pipe is still in the ground). A proposal drawn on the base city is therefore checked in every alternative.
    2. Not recorded (older objects, 'unknown'): alternative membership — proposed = objects of the checked alternative,
       existing = baseline objects; in the baseline itself every drawn underground alignment / utility is proposed."""
    proposed, existing, skipped = [], [], []
    for o in objects:
        sid = o.get("scenarioId") or "base"
        is_prop = (sid == scenario_id and scenario_id != "base") or (scenario_id == "base" and o.get("type") in ("underground_alignment", "utility"))
        side = lifecycle_side(object_lifecycle(o))
        if side is not None:
            is_prop = side == "proposed"
        try:
            a = design_asset(o, "proposed" if is_prop else "existing")
        except Exception as e:  # noqa: BLE001
            skipped.append({"id": o.get("id"), "name": o.get("name"), "reason": f"geometry could not be read ({type(e).__name__})"})
            continue
        if a is None:
            if o.get("type") in ("underground_alignment", "utility"):
                skipped.append({"id": o.get("id"), "name": o.get("name"), "reason": "fewer than 2 plan points"})
            continue
        (proposed if is_prop else existing).append(a)
    return proposed, existing, skipped


def objects_from_db(db, scenario_id: str) -> list[dict]:
    """Underground / metro objects visible in the alternative: baseline objects (minus the alternative's deletes, with its
    modifications) + the alternative's own objects."""
    from models.models import CityObjectEntity, ScenarioObjectChangeEntity
    types = ("underground_alignment", "utility", "metro_line", "metro_station")
    out: dict[str, dict] = {}
    for e in db.query(CityObjectEntity).filter(CityObjectEntity.type.in_(types), CityObjectEntity.scenario_id.in_(["base", scenario_id])):
        out[e.id] = {"id": e.id, "type": e.type, "name": e.name, "scenarioId": e.scenario_id,
                     "coordinates": json.loads(e.geometry_geojson or "[]"), "properties": json.loads(e.properties_json or "{}")}
    if scenario_id != "base":
        for c in db.query(ScenarioObjectChangeEntity).filter(ScenarioObjectChangeEntity.scenario_id == scenario_id):
            if c.op == "delete":
                out.pop(c.object_id, None)
            elif c.op == "modify" and c.type in types:
                out[c.object_id] = {"id": c.object_id, "type": c.type, "name": c.name, "scenarioId": scenario_id,
                                    "coordinates": json.loads(c.geometry_geojson or "[]"), "properties": json.loads(c.properties_json or "{}")}
    return list(out.values())


_VOLATILE_KEYS = {"createdAt", "updatedAt", "layerId", "visible", "selected", "highlighted", "locked", "hidden"}


def inputs_hash(objects: list[dict], scenario_id: str, config_overrides: Optional[dict] = None) -> str:
    """What a run screened: the alternative, its underground / metro objects (geometry, properties; timestamps and display
    state ignored) and any rule overrides. Same objects → same hash, whether sent by the UI or read from the database."""
    types = ("underground_alignment", "utility", "metro_line", "metro_station")
    canon = sorted(
        ({"id": o.get("id"), "type": o.get("type"), "name": o.get("name"), "scenarioId": o.get("scenarioId") or "base",
          "coordinates": o.get("coordinates"),
          "properties": {k: v for k, v in (o.get("properties") or {}).items() if k not in _VOLATILE_KEYS}}
         for o in objects if o.get("type") in types), key=lambda d: str(d["id"]))
    raw = json.dumps([scenario_id, canon, config_overrides or {}], sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _boxes(assets: list[Asset], pad_of) -> list[tuple]:
    out = []
    for a in assets:
        pad = pad_of(a)
        x0, y0, x1, y1 = a.geom.bounds
        lo0, la0 = G.from_utm(x0 - pad, y0 - pad)
        lo1, la1 = G.from_utm(x1 + pad, y1 + pad)
        out.append((lo0, la0, lo1, la1))
    return out


def screen(db, scenario_id: str, objects: Optional[list[dict]] = None, focus_ids: Optional[list[str]] = None,
           config_overrides: Optional[dict] = None) -> dict:
    t0 = time.perf_counter()
    timings: dict[str, int] = {}
    mark = [t0]

    def lap(k):
        now = time.perf_counter()
        timings[k] = round((now - mark[0]) * 1000)
        mark[0] = now

    cfg = C.effective(config_overrides)
    objs = objects if objects is not None else objects_from_db(db, scenario_id)
    proposed, existing_design, skipped = classify_objects(objs, scenario_id)
    targets = [a for a in proposed if not focus_ids or a.id in focus_ids]
    lap("inputs")
    max_rule = max([r["value_m"] for r in cfg["rules"]] + [0.0]) + 2 * max(t["horizontal_m"] for t in cfg["tolerance"].values()) + 10.0
    radius = max(cfg["screening_radius_m"], max([z["distance_m"] for z in cfg["protection_zones"]], default=0.0), max_rule)
    boxes = _boxes(targets, lambda a: radius)

    rec = load_records(db)
    lap("records_load")
    metro, metro_meta = osm_metro_assets(boxes) if boxes else ([], {"available": False, "reason": "nothing to check"})
    lap("osm_metro")
    from .service import BUILDING_STATUSES
    bc = cfg["buildings"]
    bld_boxes = _boxes(targets, lambda a: max(bc["min_zone_m"], bc["influence_factor"] * (a.envelope()[1] or a.envelope()[0] or 0.0), 3.0) + (a.half_width or 0.0) + 5.0)
    blds, bld_meta = infra_assets("buildings", bld_boxes, "building", where={"status": BUILDING_STATUSES}) if bld_boxes else ([], {"available": False})
    bld_tree = STRtree([b.geom for b in blds]) if blds else None
    lap("buildings")
    wcs, wc_meta = [], {"available": False}
    if boxes:
        n1, m1 = infra_assets("nallas", boxes, "watercourse", cap=5000)
        n2, m2 = infra_assets("rivers", boxes, "watercourse", cap=500)
        wcs, wc_meta = n1 + n2, {"available": bool(m1.get("available") or m2.get("available"))}
    wc_tree = STRtree([w.geom for w in wcs]) if wcs else None
    lap("watercourses")

    # A study-area import copies OSM metro ways / stations into the base city; the same element is also read from the OSM
    # index. Keep the OSM copy (one finding per physical metro element), drop the imported duplicate(s).
    metro_ids = {m.id for m in metro}
    dup_ids = {a.id for a in existing_design if a.meta.get("osm_ref") and a.meta["osm_ref"] in metro_ids}
    if dup_ids:
        existing_design = [a for a in existing_design if a.id not in dup_ids]
        metro_meta = {**metro_meta, "import_duplicates": len(dup_ids)}
    others: list[Asset] = existing_design + metro + proposed
    other_tree = STRtree([o.geom for o in others]) if others else None
    findings: list[dict] = []
    checklists: dict[str, list[dict]] = {a.id: [] for a in targets}
    pairs_done: set[tuple] = set()
    read = {a.id: 0 for a in targets}
    clear = {a.id: 0 for a in targets}
    rec_classes: dict[str, dict[str, int]] = {a.id: {} for a in targets}
    for p in targets:
        cands: list[Asset] = []
        if other_tree is not None:
            for i in other_tree.query(p.geom, predicate="dwithin", distance=radius):
                o = others[int(i)]
                if o.id == p.id:
                    continue
                key = tuple(sorted((p.id, o.id)))
                if o.status == "proposed" and key in pairs_done:
                    continue
                pairs_done.add(key)
                cands.append(o)
        if rec["tree"] is not None:
            cands += [record_asset(rec, int(i)) for i in rec["tree"].query(p.geom, predicate="dwithin", distance=radius)]
        for o in cands:
            read[p.id] += 1
            if o.layer in ("utility_record", "design_existing"):
                rec_classes[p.id][o.cls] = rec_classes[p.id].get(o.cls, 0) + 1
            r = evaluate_pair(p, o, cfg)
            if r is None:
                continue
            if r.get("clear"):
                clear[p.id] += 1
                continue
            findings.append(r)
        n_pairs = sum(1 for f in findings if f["proposed"]["id"] == p.id and f["category"] in ("clearance", "metro"))
        checklists[p.id].append({"check": "Clearance to existing and proposed assets",
                                 "result": CHECK_FLAGGED if n_pairs else CHECK_NOTHING,
                                 "detail": f"{read[p.id]} asset(s) in the data within {radius:.0f} m: {n_pairs} flagged; the others are further "
                                           "than the requirement plus data uncertainty."})
        checklists[p.id].append({"check": "Metro 20 m protection zone", "result": CHECK_FLAGGED if any(
            f["proposed"]["id"] == p.id and f.get("protection_zone") for f in findings) else (CHECK_NOTHING if metro_meta.get("available") else CHECK_NOT),
            "detail": "OpenStreetMap metro + Design-drawn metro" if metro_meta.get("available") else "OSM metro index not available; only Design-drawn metro checked."})
    findings = _merge_same_line(findings)
    lap("pairs")
    for p in targets:
        gaps: list[str] = []
        cf, entry = cover_check(p, cfg)
        checklists[p.id].append(entry)
        if cf:
            findings.append(cf)
        for fn in ((lambda: buildings_check(p, blds, bld_tree, bld_meta, cfg)), (lambda: watercourse_check(p, wcs, wc_tree, wc_meta, cfg))):
            f, entry = fn()
            checklists[p.id].append(entry)
            if f:
                findings.append(f)
        if p.cls in BURIED:
            f, entry = groundwater_check(p, cfg)
            checklists[p.id].append(entry)
            if f:
                findings.append(f)
            if entry.get("gap"):
                gaps.append(f"Groundwater: {entry['detail']}")
            if p.cls in ("tunnel", "metro_tunnel") or p.method in ("bored", "cut_and_cover"):
                f, entry = geology_check(p, cfg, db)
                checklists[p.id].append(entry)
                if f:
                    findings.append(f)
                if entry.get("gap"):
                    gaps.append(f"Geology: {entry['detail']}")
        findings.append(data_gap_finding(p, gaps, rec_classes[p.id] | {c: 1 for c in _dataset_classes(rec)}, cfg))
    lap("asset_checks")
    for f in findings:
        f["pair_key"] = pair_key(f["proposed"]["id"], (f.get("other") or {}).get("id"), f["category"])
        f["id"] = "f_" + hashlib.sha1(f["pair_key"].encode()).hexdigest()[:12]
        f["fingerprint"] = fingerprint(f)
    apply_verifications(db, findings)
    for f in findings:
        f["status_label"] = STATUS_LABEL[f["status"]]
        if f["status"] == "insufficient_data":
            f["gap_group"] = gap_group(f)
    findings.sort(key=lambda f: (SEVERITY[f["status"]], f["proposed"]["name"], f.pop("_sort", 0.0)))
    for f in findings:
        f.pop("_sort", None)
    geometries = _hoist_geometries(findings)
    counts = {s: sum(1 for f in findings if f["status"] == s) for s in STATUSES}
    layers = _layers_report(rec, metro_meta, bld_meta, wc_meta, existing_design, cfg)
    worst = next((s for s in STATUSES if counts[s]), None)
    lap("report")
    return {
        "engine_version": ENGINE, "config_version": cfg["version"], "scenario_id": scenario_id,
        "inputs_hash": inputs_hash(objs, scenario_id, config_overrides), "objects_count": len(objs),
        "generated_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z", "banner": BANNER, "disclaimer": DISCLAIMER,
        "summary": {"counts": counts, "worst_status": worst, "headline": _headline(counts, len(targets)),
                    "proposed_checked": [a.public(with_geometry=False) | {"checklist": checklists[a.id]} for a in targets], "skipped": skipped,
                    "existing_assets_read": sum(read.values()), "not_checked": _run_not_checked(layers),
                    "status_meaning": {s: {"label": STATUS_LABEL[s], "meaning": STATUS_MEANING[s]} for s in STATUSES}},
        "layers": layers, "findings": findings, "geometries": geometries, "rules_table": C.rules_table(cfg),
        "config": {k: cfg[k] for k in ("version", "tolerance", "buildings", "groundwater", "boreholes", "screening_radius_m",
                                       "unknown_width_allowance_m", "ground_note", "ladder")},
        "timings_ms": {**timings, "total": round((time.perf_counter() - t0) * 1000), "records_cached_load_ms": rec.get("load_ms")},
    }


def _hoist_geometries(findings: list[dict]) -> dict:
    """Asset geometries (lon/lat GeoJSON) once per asset id, out of the findings (a long alignment would otherwise be
    repeated in every one of its findings)."""
    out: dict[str, dict] = {}
    for f in findings:
        for a in [f.get("proposed"), f.get("other")] + list(f.get("buildings") or []):
            if a and "geometry" in a:
                g = a.pop("geometry")
                out.setdefault(a["id"], g)
    return out


def _merge_same_line(findings: list[dict]) -> list[dict]:
    """OpenStreetMap splits one metro line into many ways: keep one finding per (proposed object, named metro line), the
    most severe and nearest, and say how many pieces were merged."""
    keep: dict[tuple, dict] = {}
    out = []
    for f in findings:
        o = f.get("other") or {}
        if f["category"] != "metro" or o.get("layer") != "osm_metro":
            out.append(f)
            continue
        k = (f["proposed"]["id"], o.get("name"), o.get("kind"))
        cur = keep.get(k)
        if cur is None:
            f["merged_pieces"] = 1
            keep[k] = f
            out.append(f)
        else:
            n = cur["merged_pieces"] + 1
            if (SEVERITY[f["status"]], f["_sort"]) < (SEVERITY[cur["status"]], cur["_sort"]):
                out[out.index(cur)] = f
                keep[k] = f
                cur = f
            cur["merged_pieces"] = n
    for f in keep.values():
        if f["merged_pieces"] > 1:
            f["found"].append(f"{f['merged_pieces']} OpenStreetMap pieces of this line are within reach; the nearest is shown.")
    return out


def _dataset_classes(rec: dict) -> set:
    """Network classes for which a utility dataset is loaded at all (PMC sewer / storm)."""
    out = set()
    for d in rec["datasets"].values():
        n = (d.get("name") or "").lower()
        if "storm" in n:
            out.add("storm")
        elif "sewer" in n:
            out.add("sewer")
    return out


def _headline(counts: dict, n: int) -> str:
    if n == 0:
        return "Nothing to check: draw an underground alignment or a utility in this alternative first."
    parts = [f"{counts[s]} {STATUS_LABEL[s].lower()}" for s in STATUSES if counts[s]]
    return f"{n} proposed object{'s' if n != 1 else ''} screened: " + (", ".join(parts) if parts else "no finding") + "."


def _layers_report(rec, metro_meta, bld_meta, wc_meta, existing_design, cfg) -> list[dict]:
    out = []
    for d in rec["datasets"].values():
        ref = d["id"].startswith("ssd_ref_")
        out.append({"id": d["id"], "name": d["name"], "used": True, "quality_level": "QL-D" if ref else "as imported",
                    "records": d.get("record_count"), "datum": "not stated (levels relative only, vertical not checkable)" if ref else "as imported",
                    "coverage": "stated" if d.get("coverage_bbox") else "completeness unknown — absence of a record is not absence of a pipe"})
    for net in ("water supply", "electricity", "gas (CGD)", "telecom"):
        out.append({"id": f"missing:{net}", "name": f"{net[0].upper() + net[1:]} network", "used": False, "coverage": "no dataset loaded"})
    out.append({"id": "osm_metro", "name": "OpenStreetMap metro (tunnels, stations, lines)", "used": bool(metro_meta.get("available")),
                "quality_level": "plan only, no levels", "coverage": metro_meta.get("reason") or f"index {metro_meta.get('source')} ({metro_meta.get('data_timestamp')})"
                + (f"; {metro_meta['import_duplicates']} study-area import cop{'y' if metro_meta['import_duplicates'] == 1 else 'ies'} of the same OSM elements listed once"
                   if metro_meta.get("import_duplicates") else "")})
    out.append({"id": "buildings", "name": "Building footprints (foundation proxy)", "used": bool(bld_meta.get("available")),
                "quality_level": "footprint only, depth unknown", "coverage": bld_meta.get("reason") or ("capped read" if bld_meta.get("capped") else "index extent")})
    out.append({"id": "watercourses", "name": "PMC nallas and rivers", "used": bool(wc_meta.get("available")), "quality_level": "QL-D (plan only)"})
    out.append({"id": "design_existing", "name": "Existing objects drawn in Design (status existing / abandoned, or older baseline objects)", "used": True, "records": len(existing_design),
                "quality_level": "user-drawn"})
    gw_ok = _exists("nwdp_groundwater_pune")
    out.append({"id": "nwdp_groundwater_pune", "name": "NWDP groundwater wells", "used": gw_ok, "quality_level": "point observations",
                "coverage": "wells within %.0f km" % (cfg["groundwater"]["radius_m"] / 1000) if gw_ok else "dataset not on disk"})
    out.append({"id": "boreholes", "name": "Imported borehole logs", "used": True, "quality_level": "as imported"})
    return out


def _exists(dataset_id: str) -> bool:
    try:
        from datasets import paths
        return paths.derived_version_dir(dataset_id) is not None
    except Exception:  # noqa: BLE001
        return False


def _run_not_checked(layers: list[dict]) -> list[str]:
    nc = ["Water supply, electricity, gas and telecom networks: no dataset is loaded (only PMC sewer / storm-drain records "
          "and objects drawn in Design).",
          "Vertical clearance to PMC sewers: their levels have no stated datum (relative only).",
          "Metro tunnel and pier foundation levels (Maha-Metro as-builts not available; OpenStreetMap has plan only).",
          "Foundations, basements and piles of buildings.",
          "Real ground levels: the 3D ground is a surface model (DSM), not bare earth; depths are relative to local ground as entered.",
          "Owners' own standards (PMC, MSEDCL, MNGL, Maha-Metro), protected monuments, trees, road pavement structure.",
          "Settlement, structural adequacy, construction method, temporary works and traffic diversion."]
    for l in layers:
        if not l.get("used") and not l["id"].startswith("missing:"):
            nc.append(f"{l['name']}: not available ({l.get('coverage') or 'not loaded'}).")
    return nc
