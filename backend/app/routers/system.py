"""Service-level routes: API index, health probe, caller identity, Data Store status."""
from __future__ import annotations

from fastapi import APIRouter, Header

from .. import config, datastore, payloads
from ..security import identify

router = APIRouter(tags=["system"])

API_VERSION = "0.6.0"

# Advertised on the API index. Kept next to the routers so a new endpoint and its
# entry here are added in the same place.
ENDPOINTS = (
    "/health", "/api/meta", "/api/districts", "/api/districts/{geo_unit_id}",
    "/api/hotspots", "/api/trends", "/api/kpi-catalog", "/api/categories",
    "/api/whoami", "/api/intelligence/repeat-offenders", "/api/intelligence/network",
    "/api/intelligence/patterns", "/api/intelligence/ml-insights",
    "/api/socioeconomic", "/api/socioeconomic/correlations",
    "/api/socioeconomic/schema",
    "/api/fir/overview", "/api/fir/stations", "/api/fir/spatiotemporal",
    "/api/fir/network", "/api/fir/offenders", "/api/fir/cases", "/api/fir/schema",
    "/api/datastore/status", "/api/fir/live/cases", "/api/fir/live/stations",
)


@router.get("/api", summary="API index")
def api_root() -> dict:
    """Route index. `/` is left to the served frontend (StaticFiles mount)."""
    return {
        "service": "AI-Driven Crime Analytics API",
        "version": API_VERSION,
        "endpoints": list(ENDPOINTS),
        "docs": "/docs",
    }


@router.get("/health", summary="Liveness probe")
def health() -> dict:
    """Liveness plus a non-sensitive summary of the active security posture."""
    return {
        "status": "ok",
        "data_built": payloads.exists("districts.json"),
        "security": config.posture(),
    }


@router.get("/api/whoami", summary="Resolve the caller's role")
def whoami(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> dict:
    who = identify(x_api_key)
    return {
        "role": who["role"],
        "auth_mode": who["mode"],
        "auth_enabled": config.AUTH_ENABLED,
    }


@router.get("/api/datastore/status", summary="Catalyst Data Store connectivity")
def datastore_status() -> dict:
    """Whether record-level data is being served live from Catalyst Data Store."""
    return datastore.status()
