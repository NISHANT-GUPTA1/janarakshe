"""Crime-intelligence routes.

Governance split (Phase 0): person-level views are gated to analyst+ whenever auth
is enforced; model output over aggregate data carries no PII and stays open.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, status

from .. import payloads
from ..security import analyst_required

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])

GEO_UNIT_ID = Path(
    ...,
    min_length=1,
    max_length=64,
    pattern=r"^[A-Za-z0-9:_-]+$",
    description="Canonical district id, e.g. DISTRICT:KA-RAMANAGARA",
)


@router.get(
    "/repeat-offenders",
    summary="Top repeat offenders (synthetic)",
    dependencies=[Depends(analyst_required)],
)
def repeat_offenders():
    """Top repeat offenders (SYNTHETIC data - see data_note). Analyst role required
    when auth is enabled."""
    return payloads.load("intel_repeat_offenders.json")


@router.get(
    "/network",
    summary="Co-offending network (synthetic)",
    dependencies=[Depends(analyst_required)],
)
def network():
    """Co-offending network (SYNTHETIC). Analyst role required when auth is enabled."""
    return payloads.load("intel_network.json")


@router.get("/overview", summary="Ranked intelligence findings")
def overview():
    """Detections republished as ranked findings, each with a priority, a claim
    type (observed / statistical / ML / projection), the signals behind it, the
    method that found it and the actions available next - plus crime profiles,
    period comparisons and the state trend. Aggregate only; open endpoint."""
    return payloads.load("ci_overview.json")


@router.get("/districts", summary="District intelligence drill-down")
def districts():
    """Per-district intelligence for every district: period change, top movers,
    hotspot areas, stations and the findings that landed there."""
    return payloads.load("ci_districts.json")


@router.get("/districts/{geo_unit_id}", summary="One district's intelligence")
def district(geo_unit_id: str = GEO_UNIT_ID):
    """One district's intelligence view."""
    record = payloads.load("ci_districts.json")["districts"].get(geo_unit_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"district '{geo_unit_id}' not found",
        )
    return record


@router.get(
    "/offenders",
    summary="Repeat-offender intelligence (synthetic)",
    dependencies=[Depends(analyst_required)],
)
def offenders():
    """Linked cases, crime types, locations, associates and recent activity per
    offender. SYNTHETIC person-level data; analyst role required when auth is
    enabled."""
    return payloads.load("ci_offenders.json")


@router.get("/patterns", summary="District clusters and anomalies")
def patterns():
    """AI/ML pattern detection on REAL data: district clusters + anomalies (no PII)."""
    return payloads.load("intel_patterns.json")


@router.get("/ml-insights", summary="Advanced ML insights")
def ml_insights():
    """Advanced AI/ML insights: PCA + KMeans (socio-crime clusters), RandomForest
    feature importance, SHAP per-district explainability, Isolation Forest
    multi-dimensional anomaly detection, OLS district forecasts, and composite
    hotspot probability scores - integrating NCRB crime data with Census 2011
    socio-economic indicators. No PII; open endpoint.
    """
    return payloads.load("ml_insights.json")
