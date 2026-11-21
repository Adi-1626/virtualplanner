"""Footprint of a drawn line for the Environment screening indicators (docs/urbanos/ENVIRONMENT_WORKSPACE.md).

The centreline is buffered by width/2 in metres in EPSG:32643 (UTM 43N, Pune) with flat ends and mitred corners, then
returned in WGS84. Doing this with shapely instead of offsetting vertices in the browser keeps bends and doubled-back
vertices (snapped drawings) correct, so the tree and green-area counts match an independent GIS check. Deterministic.
"""
from __future__ import annotations

import math

MAX_VERTICES = 2000
MAX_LENGTH_M = 50_000.0


def footprint(coordinates: list, width_m: float) -> dict:
    from pyproj import Transformer
    from shapely.geometry import LineString, mapping
    from shapely.ops import transform

    if not isinstance(coordinates, list) or not (2 <= len(coordinates) <= MAX_VERTICES):
        raise ValueError(f"need 2 to {MAX_VERTICES} [lon, lat] points")
    pts = []
    for c in coordinates:
        if not isinstance(c, (list, tuple)) or len(c) < 2:
            raise ValueError("each point must be [lon, lat]")
        lon, lat = float(c[0]), float(c[1])
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError("coordinates must be finite lon/lat")
        if not pts or (lon, lat) != pts[-1]:
            pts.append((lon, lat))
    if len(pts) < 2:
        raise ValueError("the line has fewer than 2 distinct points")
    if not (math.isfinite(width_m) and 0 < width_m <= 500):
        raise ValueError("width_m must be > 0 and ≤ 500")
    fwd = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
    back = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True).transform
    line = transform(fwd, LineString(pts))
    if line.length > MAX_LENGTH_M:
        raise ValueError(f"line longer than {MAX_LENGTH_M / 1000:.0f} km")
    poly = line.buffer(width_m / 2, cap_style="flat", join_style="mitre", mitre_limit=3.0)
    return {"type": "Feature", "geometry": mapping(transform(back, poly)),
            "properties": {"length_m": round(line.length, 1), "width_m": width_m, "area_m2": round(poly.area, 1),
                           "method": "centreline buffered by width/2 in EPSG:32643, flat ends, mitred corners"}}
