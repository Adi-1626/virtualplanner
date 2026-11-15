"""
Roads and traffic signals from the local OpenStreetMap index (see osm/index.py).

Answers are shaped like the Overpass API's (`{"elements": [...]}`), so the
frontend imports them with the same code it uses for Overpass.
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from osm.index import OsmIndex, parse_boxes
from osm.overpass import OverpassProxy, UpstreamError

router = APIRouter()
index = OsmIndex()
overpass = OverpassProxy()

BUILD_COMMAND = "cd backend && python -m osm.build_index"

BBOX_HELP = "One or more boxes as minLng,minLat,maxLng,maxLat, separated by ';'"


def _boxes(bbox: str):
    try:
        boxes = parse_boxes(bbox)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not index.available():
        raise HTTPException(status_code=404, detail="The local OpenStreetMap index has not been built. Run: python -m osm.build_index")
    if not index.covers(boxes):
        raise HTTPException(status_code=416, detail="The local OpenStreetMap index does not cover this area.")
    return boxes


@router.get("/osm/status")
def osm_status():
    """Local index status, plus how to build it and what the Overpass fallback is (so the UI can say where data comes from)."""
    st = index.status()
    st["buildCommand"] = BUILD_COMMAND
    if not st.get("available"):
        st["reason"] = "No local OpenStreetMap index on this machine (backend/data/osm/osm_index.db is not in the repository)."
    st["overpass"] = overpass.status()
    return st


@router.get("/osm/overpass")
def osm_overpass(data: str = Query(..., max_length=20000, description="Overpass QL query ([out:json])")):
    """Cached, rate-limited proxy to the public Overpass API, for areas the local index does not cover."""
    if "[out:json]" not in data.replace(" ", ""):
        raise HTTPException(status_code=400, detail="Only [out:json] Overpass queries are proxied.")
    try:
        body, info = overpass.fetch(data)
    except UpstreamError as exc:
        headers = {"Retry-After": str(exc.retry_after_s)} if exc.retry_after_s else None
        return JSONResponse(status_code=502, content={"detail": {"upstream": True, "message": str(exc), "attempts": exc.attempts}}, headers=headers)
    return JSONResponse(content=body, headers={"X-Overpass-Cache": info["cache"], "X-Overpass-Fetched-At": info["fetchedAt"] or "", "Access-Control-Expose-Headers": "X-Overpass-Cache, X-Overpass-Fetched-At"})


@router.get("/osm/ways")
def osm_ways(bbox: str = Query(..., description=BBOX_HELP)):
    return {"elements": index.ways(_boxes(bbox))}


@router.get("/osm/signals")
def osm_signals(bbox: str = Query(..., description=BBOX_HELP)):
    return {"elements": index.signals(_boxes(bbox))}


@router.get("/osm/buildings")
def osm_buildings(bbox: str = Query(..., description=BBOX_HELP)):
    return _infrastructure("buildings", bbox)


@router.get("/osm/metro")
def osm_metro(bbox: str = Query(..., description=BBOX_HELP)):
    return _infrastructure("metro", bbox)


def _infrastructure(category: str, bbox: str):
    boxes = _boxes(bbox)
    try:
        return {"elements": index.infrastructure(category, boxes)}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
