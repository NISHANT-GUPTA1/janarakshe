"""Catalyst Data Store access layer (live queries via ZCQL).

In an AppSail deployment this initialises the Catalyst SDK and runs ZCQL queries
against the FIR tables (loaded from catalyst/datastore/*.csv). Locally — where there
is no Catalyst environment and the SDK is not installed — `available()` returns False
and callers fall back to the precomputed JSON payloads. This keeps `python -m
pipeline.run` and local `uvicorn` working with zero Catalyst setup.

Enable with env var CRIME_USE_DATASTORE=1 (set automatically in the AppSail config).
"""
from __future__ import annotations

import os

_app = None            # cached Catalyst SDK app handle
_init_tried = False
_init_error: str | None = None

USE_DATASTORE = os.getenv("CRIME_USE_DATASTORE", "0") == "1"


def _sdk():
    """Import whichever Catalyst SDK module name is present; None if unavailable."""
    try:
        import zcatalyst_sdk as sdk  # current package name
        return sdk
    except Exception:
        try:
            import zcatalyst as sdk   # older name
            return sdk
        except Exception:
            return None


def _get_app():
    global _app, _init_tried, _init_error
    if _app is not None or _init_tried:
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
    except Exception as exc:      # noqa: BLE001 — any init failure => fall back
        _init_error = f"initialize() failed: {exc}"
        _app = None
    return _app


def available() -> bool:
    return _get_app() is not None


def status() -> dict:
    return {
        "use_datastore": USE_DATASTORE,
        "sdk_installed": _sdk() is not None,
        "connected": available(),
        "error": _init_error,
    }


def _flatten(rows: list[dict]) -> list[dict]:
    """ZCQL returns rows namespaced by table, e.g. {'CaseMaster': {...}}.
    Merge the (possibly several) table dicts in each row into one flat dict."""
    out = []
    for row in rows:
        flat: dict = {}
        for val in row.values():
            if isinstance(val, dict):
                flat.update(val)
            else:
                flat[val] = val
        out.append(flat)
    return out


def query(zcql: str) -> list[dict]:
    """Run a ZCQL query and return flattened rows. Raises if Data Store is unavailable."""
    app = _get_app()
    if app is None:
        raise RuntimeError(f"Data Store unavailable: {_init_error}")
    rows = app.zcql().execute_query(zcql)
    return _flatten(rows)
