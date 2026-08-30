"""District-level aggregate analytics (open data, no PII)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, status

from .. import payloads

router = APIRouter(prefix="/api", tags=["analytics"])

# Canonical geo_unit_id form, e.g. "DISTRICT:KA-RAMANAGARA". Bounding the path
# parameter keeps oversized or control-character input out of the lookup and the
# audit log; anything well-formed but unknown still answers 404.
GEO_UNIT_ID = Path(
    ...,
    min_length=1,
    max_length=64,
    pattern=r"^[A-Za-z0-9:_-]+$",
    description="Canonical district id, e.g. DISTRICT:KA-RAMANAGARA",
)


@router.get("/meta", summary="Dataset metadata")
def meta():
    return payloads.load("meta.json")


@router.get("/districts", summary="District summary list")
def districts():
    """District summary list (latest year), sorted by risk score desc."""
    return payloads.load("districts.json")


@router.get("/districts/{geo_unit_id}", summary="District drilldown")
def district_detail(geo_unit_id: str = GEO_UNIT_ID):
    """Full drilldown for one district: KPIs, yearly trend, category breakdown,
    hotspot status, and explainable risk-score components."""
    detail = payloads.load("district_detail.json")
    record = detail.get(geo_unit_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"district '{geo_unit_id}' not found",
        )
    return record


@router.get("/hotspots", summary="Hotspot districts")
def hotspots():
    return payloads.load("hotspots.json")


@router.get("/trends", summary="Statewide yearly trend")
def trends():
    return payloads.load("trends.json")


@router.get("/kpi-catalog", summary="KPI definitions")
def kpi_catalog():
    return payloads.load("kpi_catalog.json")


@router.get("/categories", summary="Crime category taxonomy")
def categories():
    return payloads.load("categories.json")
