"""Catalyst Data Store access layer (live queries via ZCQL).

In an AppSail deployment this initialises the Catalyst SDK and runs ZCQL queries
against the FIR tables (loaded from catalyst/datastore/*.csv). Locally - where there
is no Catalyst environment and the SDK is not installed - `available()` returns False
and callers fall back to the precomputed JSON payloads. This keeps `python -m
pipeline.run` and local `uvicorn` working with zero Catalyst setup.

Enable with env var CRIME_USE_DATASTORE=1 (set in the AppSail config).

Query construction
------------------
ZCQL statements are assembled from module-level constants only. The single
caller-influenced value - a row limit - is coerced through `safe_limit()` before it
reaches a statement, so no caller-supplied text is ever interpolated into a query.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

from . import config

log = logging.getLogger("crime.datastore")

USE_DATASTORE: bool = os.getenv("CRIME_USE_DATASTORE", "0") == "1"

# Hard ceiling on rows returned to a caller, independent of any requested limit.
MAX_ROWS = 1000

_app: Any = None
_init_tried = False
_init_error: str | None = None
_init_lock = threading.Lock()


def _sdk():
    """Import whichever Catalyst SDK module name is present; None if unavailable."""
    try:
        import zcatalyst_sdk as sdk  # current package name

        return sdk
    except ImportError:
        try:
            import zcatalyst as sdk  # older name

            return sdk
        except ImportError:
            return None


def _get_app():
    """Initialise (once) and return the Catalyst SDK app handle, or None."""
    global _app, _init_tried, _init_error
    if _init_tried:
        return _app
    with _init_lock:
        if _init_tried:
            return _app
        _init_tried = True
        if not USE_DATASTORE:
            _init_error = "CRIME_USE_DATASTORE not set"
            return None
        sdk = _sdk()
        if sdk is None:
            _init_error = "zcatalyst SDK not installed"
            return None
        try:
            _app = sdk.initialize()  # auto-reads the Catalyst request/environment
        except Exception as exc:  # noqa: BLE001 - any init failure must degrade, not crash
            _init_error = f"initialize() failed: {type(exc).__name__}"
            log.warning("Catalyst Data Store initialise failed: %s", exc)
            _app = None
        return _app


def available() -> bool:
    return _get_app() is not None


def status() -> dict:
    """Connection status. `error` is a short reason code, never an SDK stack trace."""
    connected = available()
    return {
        "use_datastore": USE_DATASTORE,
        "sdk_installed": _sdk() is not None,
        "connected": connected,
        "error": _init_error,
    }


def safe_limit(requested: int | None) -> int:
    """Clamp a caller-supplied row limit into the configured bounds.

    Coerces to int first, so the returned value is always safe to embed in a ZCQL
    statement regardless of what the caller sent.
    """
    try:
        value = int(requested) if requested is not None else config.LIVE_QUERY_DEFAULT_LIMIT
    except (TypeError, ValueError):
        value = config.LIVE_QUERY_DEFAULT_LIMIT
    return max(config.LIVE_QUERY_MIN_LIMIT, min(value, config.LIVE_QUERY_MAX_LIMIT))


def _flatten(rows: list[dict]) -> list[dict]:
    """Flatten ZCQL's table-namespaced rows into plain dicts.

    ZCQL returns each row keyed by table, e.g. {"CaseMaster": {...}, "Unit": {...}};
    the per-table dicts are merged into one. Aggregate columns (COUNT(...) AS cases)
    come back as scalars at the top level and keep their own column name.
    """
    flattened: list[dict] = []
    for row in rows:
        flat: dict = {}
        for key, value in row.items():
            if isinstance(value, dict):
                flat.update(value)
            else:
                flat[key] = value
        flattened.append(flat)
    return flattened


def query(zcql: str) -> list[dict]:
    """Run a ZCQL query and return flattened rows.

    Raises RuntimeError when the Data Store is unavailable; callers degrade to the
    precomputed payloads.
    """
    app = _get_app()
    if app is None:
        raise RuntimeError(f"Data Store unavailable: {_init_error}")
    rows = app.zcql().execute_query(zcql)
    return _flatten(rows or [])[:MAX_ROWS]


# --------------------------------------------------------------------------- #
# Statements
# --------------------------------------------------------------------------- #
# Static apart from the trailing integer limit, which always comes from safe_limit().
_CASES_QUERY = (
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
    "ORDER BY CaseMaster.CrimeRegisteredDate DESC LIMIT {limit}"
)

_STATIONS_QUERY = (
    "SELECT Unit.UnitName, COUNT(CaseMaster.CaseMasterID) AS cases "
    "FROM CaseMaster LEFT JOIN Unit ON CaseMaster.PoliceStationID = Unit.UnitID "
    "GROUP BY Unit.UnitName ORDER BY cases DESC LIMIT {limit}"
)


def latest_cases(limit: int) -> list[dict]:
    """Most recently registered FIR cases, joined to their lookup tables."""
    return query(_CASES_QUERY.format(limit=safe_limit(limit)))


def station_case_counts(limit: int) -> list[dict]:
    """Case count per police station, busiest first."""
    return query(_STATIONS_QUERY.format(limit=safe_limit(limit)))
