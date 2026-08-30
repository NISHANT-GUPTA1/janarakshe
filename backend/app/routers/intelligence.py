"""Crime-intelligence routes.

Governance split (Phase 0): person-level views are gated to analyst+ whenever auth
is enforced; model output over aggregate data carries no PII and stays open.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import payloads
from ..security import analyst_required

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


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
