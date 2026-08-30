"""FIR-record intelligence (KSP Police FIR System schema).

Schema-shaped synthetic FIR records give record-level analytics the open NCRB
aggregates cannot provide. Person-level views are gated to analyst+ when auth is on.

The `/live/*` routes read the FIR tables straight from Catalyst Data Store via ZCQL
when the app runs on AppSail with CRIME_USE_DATASTORE=1, and otherwise degrade to
the precomputed payloads - so the app behaves identically in local dev.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from .. import config, datastore, payloads
from ..security import analyst_required

log = logging.getLogger("crime.fir")

router = APIRouter(prefix="/api/fir", tags=["fir"])

# Canonical FIR record id, e.g. "CASE-000444". Bounded for the same reason as the
# district id in analytics: oversized or control-character input never reaches the
# lookup or the audit log, and anything well-formed but unknown still answers 404.
FIR_ID = Path(
    ...,
    min_length=1,
    max_length=64,
    pattern=r"^[A-Za-z0-9:_-]+$",
    description="Canonical FIR record id, e.g. CASE-000444",
)

# Out-of-range values are clamped rather than rejected (see datastore.safe_limit),
# preserving the endpoint's established contract. The clamp - not the caller - is
# what bounds the query, so the value reaching ZCQL is always in range.
ROW_LIMIT = Query(
    default=config.LIVE_QUERY_DEFAULT_LIMIT,
    description=(
        f"Rows to return; clamped to "
        f"{config.LIVE_QUERY_MIN_LIMIT}-{config.LIVE_QUERY_MAX_LIMIT}."
    ),
)


# --------------------------------------------------------------------------- #
# precomputed payloads
# --------------------------------------------------------------------------- #
@router.get("/overview", summary="Case lifecycle and demographics")
def overview():
    """Case lifecycle, gravity, detection (chargesheet A/B/C) and demographics."""
    return payloads.load("fir_overview.json")


@router.get("/stations", summary="Police-station drill-down")
def stations():
    """Police-station drill-down: cases, heinous share and detection rate per station."""
    return payloads.load("fir_stations.json")


@router.get("/spatiotemporal", summary="Spatiotemporal hotspots")
def spatiotemporal():
    """GPS points + time-of-day histograms + grid hotspots."""
    return payloads.load("fir_spatiotemporal.json")


@router.get(
    "/network",
    summary="Co-accused network",
    dependencies=[Depends(analyst_required)],
)
def network():
    """Co-accused network + person-to-case graph. Analyst role required when auth
    is enabled."""
    return payloads.load("fir_network.json")


@router.get(
    "/offenders",
    summary="Repeat-offender profiles",
    dependencies=[Depends(analyst_required)],
)
def offenders():
    """Repeat-offender profiles with Modus Operandi. Analyst role required when auth
    is enabled."""
    return payloads.load("fir_offenders.json")


@router.get("/cases", summary="Sample FIR records")
def cases():
    """Sample raw FIR rows (CaseMaster + classification) for the case table."""
    return payloads.load("fir_cases.json")


@router.get("/schema", summary="FIR ER model")
def schema():
    """The KSP Police FIR System ER model (tables, keys, relationships)."""
    return payloads.load("fir_schema.json")


# --------------------------------------------------------------------------- #
# investigation workspace
#
# The queue is the officer's work list; a case file is one investigation. Search,
# alerts and the link graph are cross-cutting views over the same records. The
# case file, search index and graph expose person-level detail, so they carry the
# same analyst gate as the co-accused network.
# --------------------------------------------------------------------------- #
@router.get("/queue", summary="Operational FIR work queue")
def queue():
    """Every case with priority, SLA state, investigation progress and last
    activity, plus the summary buckets, emerging patterns and filter facets."""
    return payloads.load("fir_queue.json")


@router.get(
    "/case/{fir_id}",
    summary="One FIR case file",
    dependencies=[Depends(analyst_required)],
)
def case(fir_id: str = FIR_ID):
    """People, entities, related FIRs with the reason each was linked, explainable
    insights and the typed investigation timeline. Analyst role required when auth
    is enabled."""
    payload = payloads.load("fir_case_detail.json")
    record = payload["cases"].get(fir_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FIR '{fir_id}' not found",
        )
    return {
        "stages": payload["stages"],
        "rules": payload["rules"],
        "as_of": payload["as_of"],
        "case": record,
    }


@router.get(
    "/case-details",
    summary="All FIR case files",
    dependencies=[Depends(analyst_required)],
)
def case_details():
    """Every case file in one payload - what a static host serves instead of the
    per-id route, indexed client-side as the district map already is."""
    return payloads.load("fir_case_detail.json")


@router.get(
    "/search-index",
    summary="Global intelligence search index",
    dependencies=[Depends(analyst_required)],
)
def search_index():
    """FIRs, persons, vehicles, phones, locations, stations, crime types and
    districts in one flat list, so a plate or a number resolves without the caller
    knowing which module holds it."""
    return payloads.load("fir_search.json")


@router.get("/alerts", summary="Actionable intelligence alerts")
def alerts():
    """Alerts that each state what happened, why it matters and what can be done."""
    return payloads.load("fir_alerts.json")


@router.get(
    "/graph",
    summary="Multi-entity link graph",
    dependencies=[Depends(analyst_required)],
)
def graph():
    """Person / vehicle / phone / location / FIR / station nodes with typed edges.
    Analyst role required when auth is enabled."""
    return payloads.load("fir_graph.json")


# --------------------------------------------------------------------------- #
# live Data Store queries
# --------------------------------------------------------------------------- #
def _fallback(payload_name: str, failed: bool) -> dict:
    """Precomputed payload, tagged as a fallback.

    On a query failure the caller is told only that the live path was unavailable;
    the underlying SDK/ZCQL error is written to the server log instead, so database
    and schema internals are never returned to an anonymous client.
    """
    fields: dict = {"source": "fallback"}
    if failed:
        fields["datastore_error"] = "live query unavailable"
    return payloads.with_fields(payload_name, **fields)


@router.get("/live/cases", summary="Latest FIR cases (live)")
def live_cases(limit: int = ROW_LIMIT):
    """Latest FIR cases, joined to their lookups - live from Data Store when available."""
    if datastore.available():
        try:
            rows = datastore.latest_cases(limit)
            return {"source": "datastore", "count": len(rows), "rows": rows}
        except Exception:  # noqa: BLE001 - degrade to the static payload
            log.exception("live FIR case query failed; serving precomputed payload")
            return _fallback("fir_cases.json", failed=True)
    return _fallback("fir_cases.json", failed=False)


@router.get("/live/stations", summary="Per-station case counts (live)")
def live_stations(limit: int = ROW_LIMIT):
    """Per-station case counts - live from Data Store when available, else JSON."""
    if datastore.available():
        try:
            rows = datastore.station_case_counts(limit)
            return {"source": "datastore", "count": len(rows), "stations": rows}
        except Exception:  # noqa: BLE001
            log.exception("live station query failed; serving precomputed payload")
            return _fallback("fir_stations.json", failed=True)
    return _fallback("fir_stations.json", failed=False)
