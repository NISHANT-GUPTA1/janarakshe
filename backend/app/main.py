"""Crime Analytics API + (optionally) the built frontend, on one origin.

Serves the district-level aggregates produced by the pipeline
(backend/data/processed/api/*.json). If a payload is missing the endpoint returns
503 with a hint to run `python -m pipeline.run`. When frontend/dist exists it is
served at / so the whole app runs from one server (no proxy, no stale-route 404s).

Phase 5 hardening: audit logging, security headers, configurable CORS, and
API-key RBAC gating the person-level (intelligence) endpoints.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from pipeline import paths

from . import config, datastore
from .middleware import AuditMiddleware, SecurityHeadersMiddleware
from .security import analyst_required, identify

app = FastAPI(
    title="AI-Driven Crime Analytics API",
    version="0.5.0",
    description="District crime analytics, intelligence, and socio-economic correlation (pilot: Karnataka).",
)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load(name: str):
    path: Path = paths.API_DIR / name
    if not path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"{name} not built. Run `python -m pipeline.run` first.",
        )
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api")
def api_root():
    # API index. "/" is left for the served frontend (StaticFiles mount below).
    return {
        "service": "AI-Driven Crime Analytics API",
        "version": "0.6.0",
        "endpoints": [
            "/health", "/api/meta", "/api/districts", "/api/districts/{geo_unit_id}",
            "/api/hotspots", "/api/trends", "/api/kpi-catalog", "/api/categories",
            "/api/whoami", "/api/intelligence/repeat-offenders", "/api/intelligence/network",
            "/api/intelligence/patterns", "/api/intelligence/ml-insights",
            "/api/socioeconomic", "/api/socioeconomic/correlations",
            "/api/socioeconomic/schema",
            "/api/fir/overview", "/api/fir/stations", "/api/fir/spatiotemporal",
            "/api/fir/network", "/api/fir/offenders", "/api/fir/cases", "/api/fir/schema",
            "/api/datastore/status", "/api/fir/live/cases", "/api/fir/live/stations",
        ],
        "docs": "/docs",
    }


@app.get("/health")
def health():
    built = (paths.API_DIR / "districts.json").exists()
    return {"status": "ok", "data_built": built}


@app.get("/api/meta")
def meta():
    return _load("meta.json")


@app.get("/api/districts")
def districts():
    """District summary list (latest year), sorted by risk score desc."""
    return _load("districts.json")


@app.get("/api/districts/{geo_unit_id}")
def district_detail(geo_unit_id: str):
    """Full drilldown for one district: KPIs, yearly trend, category breakdown,
    hotspot status, and explainable risk-score components."""
    detail = _load("district_detail.json")
    rec = detail.get(geo_unit_id)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"district '{geo_unit_id}' not found")
    return rec


@app.get("/api/hotspots")
def hotspots():
    return _load("hotspots.json")


@app.get("/api/trends")
def trends():
    return _load("trends.json")


@app.get("/api/kpi-catalog")
def kpi_catalog():
    return _load("kpi_catalog.json")


@app.get("/api/categories")
def categories():
    return _load("categories.json")


@app.get("/api/whoami")
def whoami(x_api_key: str | None = Header(default=None, alias="X-API-Key")):
    who = identify(x_api_key)
    return {"role": who["role"], "auth_mode": who["mode"], "auth_enabled": config.AUTH_ENABLED}


# ---- Phase 3: intelligence (synthetic person-level + real-data ML) ----
# Person-level endpoints are gated to analyst+ (governance: synthetic PII). In dev
# (no CRIME_API_KEYS configured) access is open so the demo runs without setup.
@app.get("/api/intelligence/repeat-offenders")
def repeat_offenders(_=Depends(analyst_required)):
    """Top repeat offenders (SYNTHETIC data — see data_note). Requires analyst role when auth enabled."""
    return _load("intel_repeat_offenders.json")


@app.get("/api/intelligence/network")
def network(_=Depends(analyst_required)):
    """Co-offending network (SYNTHETIC). Requires analyst role when auth enabled."""
    return _load("intel_network.json")


@app.get("/api/intelligence/patterns")
def patterns():
    """AI/ML pattern detection on REAL data: district clusters + anomalies (no PII; open)."""
    return _load("intel_patterns.json")


@app.get("/api/intelligence/ml-insights")
def ml_insights():
    """Advanced AI/ML insights (Phase 6, open): PCA + KMeans (socio-crime clusters),
    RandomForest feature importance, SHAP per-district explainability, Isolation Forest
    multi-dimensional anomaly detection, OLS district forecasts, and composite hotspot
    probability scores — all integrating NCRB crime data with Census 2011 socio-economic
    indicators. No PII; open endpoint.
    """
    return _load("ml_insights.json")


# ---- Phase 7: FIR-record intelligence (KSP Police FIR System schema) ----
# Schema-shaped synthetic FIR records → record-level analytics the open NCRB
# aggregates cannot provide. Person-level views are gated to analyst+ when auth is on.
@app.get("/api/fir/overview")
def fir_overview():
    """Case lifecycle, gravity, detection (chargesheet A/B/C) and demographics."""
    return _load("fir_overview.json")


@app.get("/api/fir/stations")
def fir_stations():
    """Police-station drill-down: cases, heinous share and detection rate per station."""
    return _load("fir_stations.json")


@app.get("/api/fir/spatiotemporal")
def fir_spatiotemporal():
    """Spatiotemporal hotspots: GPS points + time-of-day histograms + grid hotspots."""
    return _load("fir_spatiotemporal.json")


@app.get("/api/fir/network")
def fir_network(_=Depends(analyst_required)):
    """REAL co-accused network + person↔case graph. Requires analyst role when auth enabled."""
    return _load("fir_network.json")


@app.get("/api/fir/offenders")
def fir_offenders(_=Depends(analyst_required)):
    """Repeat-offender profiles with Modus Operandi. Requires analyst role when auth enabled."""
    return _load("fir_offenders.json")


@app.get("/api/fir/cases")
def fir_cases():
    """Sample raw FIR rows (CaseMaster + classification) for the case table."""
    return _load("fir_cases.json")


@app.get("/api/fir/schema")
def fir_schema():
    """The KSP Police FIR System ER model (tables, keys, relationships)."""
    return _load("fir_schema.json")


# ---- Catalyst Data Store: live record-level queries (ZCQL) ----
# These read the FIR tables straight from Data Store when the app runs on AppSail
# with CRIME_USE_DATASTORE=1; otherwise they fall back to the precomputed JSON so the
# app works identically in local dev. Proves the platform uses Data Store at runtime.
@app.get("/api/datastore/status")
def datastore_status():
    """Whether the API is serving record-level data live from Catalyst Data Store."""
    return datastore.status()


@app.get("/api/fir/live/cases")
def fir_live_cases(limit: int = 50):
    """Latest FIR cases, joined to their lookups — live from Data Store when available."""
    limit = max(1, min(limit, 500))
    if datastore.available():
        try:
            rows = datastore.query(
                "SELECT CaseMaster.CrimeNo, CaseMaster.CrimeRegisteredDate, "
                "CaseMaster.latitude, CaseMaster.longitude, CaseCategory.LookupValue, "
                "CrimeHead.CrimeGroupName, CrimeSubHead.CrimeHeadName, "
                "GravityOffence.LookupValue, CaseStatusMaster.CaseStatusName "
                "FROM CaseMaster "
                "LEFT JOIN CaseCategory ON CaseMaster.CaseCategoryID = CaseCategory.CaseCategoryID "
                "LEFT JOIN CrimeHead ON CaseMaster.CrimeMajorHeadID = CrimeHead.CrimeHeadID "
                "LEFT JOIN CrimeSubHead ON CaseMaster.CrimeMinorHeadID = CrimeSubHead.CrimeSubHeadID "
                "LEFT JOIN GravityOffence ON CaseMaster.GravityOffenceID = GravityOffence.GravityOffenceID "
                "LEFT JOIN CaseStatusMaster ON CaseMaster.CaseStatusID = CaseStatusMaster.CaseStatusID "
                f"ORDER BY CaseMaster.CrimeRegisteredDate DESC LIMIT {limit}")
            return {"source": "datastore", "count": len(rows), "rows": rows}
        except Exception as exc:  # noqa: BLE001 — degrade to the static payload
            fallback = _load("fir_cases.json")
            fallback["source"] = "fallback"
            fallback["datastore_error"] = str(exc)
            return fallback
    payload = _load("fir_cases.json")
    payload["source"] = "fallback"
    return payload


@app.get("/api/fir/live/stations")
def fir_live_stations(limit: int = 50):
    """Per-station case counts — live from Data Store when available, else JSON."""
    limit = max(1, min(limit, 500))
    if datastore.available():
        try:
            rows = datastore.query(
                "SELECT Unit.UnitName, COUNT(CaseMaster.CaseMasterID) AS cases "
                "FROM CaseMaster LEFT JOIN Unit ON CaseMaster.PoliceStationID = Unit.UnitID "
                f"GROUP BY Unit.UnitName ORDER BY cases DESC LIMIT {limit}")
            return {"source": "datastore", "count": len(rows), "stations": rows}
        except Exception as exc:  # noqa: BLE001
            fallback = _load("fir_stations.json")
            fallback["source"] = "fallback"
            fallback["datastore_error"] = str(exc)
            return fallback
    payload = _load("fir_stations.json")
    payload["source"] = "fallback"
    return payload


# ---- Phase 4: socio-economic correlation (real Census 2011) ----
@app.get("/api/socioeconomic")
def socioeconomic():
    """Per-district socio-economic indicators (Census 2011)."""
    return _load("se_indicators.json")


@app.get("/api/socioeconomic/correlations")
def socioeconomic_correlations():
    """Correlation matrix: each indicator x each crime group (Pearson/Spearman,
    p-values, hypothesis verdicts) + ethical caveats."""
    return _load("se_correlations.json")


@app.get("/api/socioeconomic/schema")
def socioeconomic_schema():
    """The logically-backed indicator definitions + crime hypotheses."""
    return _load("se_schema.json")


# ---- serve the built frontend (single origin; eliminates proxy/stale-route 404s) ----
# Mounted LAST so all /api routes take precedence. Only active after `npm run build`.
if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIST), html=True), name="frontend")
