"""SYNTHETIC land-use demand (label `synthetic`; demo only, not measured): docs/urbanos/DEMAND_P14.md."""
from fastapi import APIRouter, HTTPException, Query

from synthetic import demand

synthetic_demand_router = APIRouter(prefix="/synthetic-demand", tags=["synthetic demand"])


@synthetic_demand_router.get("")
def list_synthetic_demand():
    """Synthetic demand files installed (the data live outside the repo; the app asks first)."""
    return {"files": demand.list_files(), "label": demand.LABEL}


@synthetic_demand_router.get("/{file_id}")
def get_synthetic_demand(file_id: str):
    try:
        return demand.load(file_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No synthetic demand file {file_id!r}")
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid synthetic demand file {file_id!r}: {exc}")


@synthetic_demand_router.get("/{file_id}/trip-ends")
def get_trip_ends(file_id: str, min_lng: float = Query(...), min_lat: float = Query(...), max_lng: float = Query(...), max_lat: float = Query(...)):
    try:
        return demand.trip_ends(file_id, min_lng, min_lat, max_lng, max_lat)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No synthetic trip ends for {file_id!r}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
