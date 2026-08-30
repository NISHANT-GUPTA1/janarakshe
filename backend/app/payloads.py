"""Cached access to the pre-built API payloads in data/processed/api/.

Every analytics route is a passthrough of one JSON file. Reading and parsing those
files on every request made the cheapest possible request the most expensive thing
the server does - several hundred KB of JSON parsed per call - which is both slow
and the easiest denial-of-service vector against the service.

This module parses each payload once and caches it, keyed on the file's
modification time and size so a pipeline re-run is picked up without a restart.

Cached payloads are shared across requests and MUST be treated as immutable.
Routes that need to annotate a payload build a new dict instead - see
`with_fields()`.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from pipeline import paths

log = logging.getLogger("crime.payloads")

# Payload name -> (stat signature, parsed JSON)
_cache: dict[str, tuple[tuple[int, int], Any]] = {}
_lock = threading.Lock()

_UNAVAILABLE = "analytics payload is not available on this deployment"


def _resolve(name: str) -> Path:
    """Resolve a payload name to a path inside API_DIR, refusing traversal.

    The name always comes from a literal in this codebase rather than from user
    input, so this is defence in depth: it keeps that guarantee true even if a
    future route ever forwards a caller-supplied value.
    """
    candidate = (paths.API_DIR / name).resolve()
    api_dir = paths.API_DIR.resolve()
    if candidate.parent != api_dir or candidate.suffix != ".json":
        raise ValueError(f"illegal payload name: {name!r}")
    return candidate


def load(name: str) -> Any:
    """Return the parsed payload `name`, cached until the file changes on disk.

    Raises HTTPException(503) when the payload has not been built, and (500) when
    it exists but is unreadable or malformed - never leaking the filesystem path.
    """
    try:
        path = _resolve(name)
    except ValueError:
        log.error("rejected payload name %r", name)
        raise HTTPException(status_code=500, detail="internal configuration error") from None

    try:
        stat = path.stat()
    except OSError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{name} not built. Run `python -m pipeline.run` first.",
        ) from None

    signature = (stat.st_mtime_ns, stat.st_size)
    cached = _cache.get(name)
    if cached is not None and cached[0] == signature:
        return cached[1]

    with _lock:
        # Re-check: another thread may have populated the entry while we waited.
        cached = _cache.get(name)
        if cached is not None and cached[0] == signature:
            return cached[1]
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            log.error("payload %s is unreadable: %s", name, exc)
            raise HTTPException(status_code=500, detail=_UNAVAILABLE) from None
        _cache[name] = (signature, data)
        return data


def with_fields(name: str, **fields: Any) -> dict:
    """Load a payload and return a shallow copy carrying the extra fields.

    Never mutates the cached object. The payload must be a JSON object; anything
    else is a programming error at the call site.
    """
    payload = load(name)
    if not isinstance(payload, dict):
        raise TypeError(f"payload {name!r} is not a JSON object")
    return {**payload, **fields}


def exists(name: str) -> bool:
    """Whether a payload has been built, without parsing it."""
    try:
        return _resolve(name).exists()
    except ValueError:
        return False


def warm(names: tuple[str, ...]) -> int:
    """Parse payloads ahead of first request. Returns the number cached.

    Missing payloads are skipped: the matching route still answers 503, and a
    partially built data directory must not stop the service from starting.
    """
    warmed = 0
    for name in names:
        try:
            load(name)
            warmed += 1
        except HTTPException:
            log.warning("payload %s not built; its route will answer 503", name)
    return warmed


def clear() -> None:
    """Drop the cache. Used by tests."""
    with _lock:
        _cache.clear()
