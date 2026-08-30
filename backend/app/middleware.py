"""Observability and security middleware.

Three layers, applied outermost-first by main.create_app():

  SecurityHeadersMiddleware - CSP, framing, MIME, referrer and permissions policy.
  RateLimitMiddleware       - fixed-window per-client-IP throttle.
  AuditMiddleware           - correlated access log with role, timing and status.
"""
from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from logging.handlers import RotatingFileHandler
from threading import Lock

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from . import config

REQUEST_ID_HEADER = "X-Request-ID"
RESPONSE_TIME_HEADER = "X-Response-Time-ms"

# Paths worth auditing; static asset traffic is pure noise.
_AUDITED_PREFIXES = ("/api",)
_AUDITED_EXACT = frozenset({"/health", "/docs", "/redoc", "/openapi.json"})


def _build_audit_logger() -> logging.Logger:
    logger = logging.getLogger("crime.audit")
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    logger.propagate = False
    formatter = logging.Formatter("%(asctime)s %(message)s")
    try:
        config.LOG_DIR.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            config.LOG_DIR / "audit.log",
            maxBytes=config.LOG_MAX_BYTES,
            backupCount=config.LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except OSError:
        # Read-only or ephemeral filesystem (some managed runtimes): stream only.
        pass
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    return logger


audit_log = _build_audit_logger()


def client_ip(request: Request) -> str:
    """Caller IP, honouring the proxy chain the managed runtime sits behind.

    Only the left-most X-Forwarded-For entry is used, and it is length-capped so a
    forged header cannot inject unbounded text into the audit log.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:45]  # longest possible IPv6 + zone id
    return request.client.host if request.client else "-"


def _is_audited(path: str) -> bool:
    return path in _AUDITED_EXACT or path.startswith(_AUDITED_PREFIXES)


class AuditMiddleware(BaseHTTPMiddleware):
    """Per-request access log with a correlation id, caller role and timing."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex[:12]
        # Sanitise: the value is echoed back in a response header.
        request_id = "".join(c for c in request_id if c.isalnum() or c in "-_")[:64] or "-"
        request.state.request_id = request_id

        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 1)

        response.headers[RESPONSE_TIME_HEADER] = str(duration_ms)
        response.headers[REQUEST_ID_HEADER] = request_id

        if _is_audited(request.url.path):
            audit_log.info(
                "%s id=%s role=%s %s %s -> %s %sms",
                client_ip(request),
                request_id,
                self._role_of(request),
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
        return response

    @staticmethod
    def _role_of(request: Request) -> str:
        if not config.AUTH_ENABLED:
            return "open"
        from .security import identify  # local import: avoids a config import cycle

        return identify(request.headers.get("X-API-Key")).role or "anon"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Fixed-window request throttle, keyed on client IP.

    Deliberately in-process: this service is a single AppSail container serving
    read-only payloads, so a shared store would add a dependency for no benefit. If
    the deployment is ever scaled horizontally, swap the counter for Catalyst Cache.
    """

    def __init__(self, app, limit: int, window: int):
        super().__init__(app)
        self._limit = limit
        self._window = window
        self._hits: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # [count, window]
        self._lock = Lock()

    def _allow(self, key: str) -> tuple[bool, int, int]:
        """Return (allowed, remaining, seconds_until_reset)."""
        now = int(time.time())
        window_start = now - (now % self._window)
        with self._lock:
            bucket = self._hits[key]
            if bucket[1] != window_start:
                bucket[0], bucket[1] = 0, window_start
                # Bound memory: drop counters from windows that have already rolled.
                if len(self._hits) > 10_000:
                    for stale in [k for k, v in self._hits.items() if v[1] != window_start]:
                        del self._hits[stale]
            bucket[0] += 1
            count = bucket[0]
        reset_in = window_start + self._window - now
        return count <= self._limit, max(0, self._limit - count), reset_in

    async def dispatch(self, request: Request, call_next):
        if request.url.path in config.RATE_LIMIT_EXEMPT:
            return await call_next(request)

        allowed, remaining, reset_in = self._allow(client_ip(request))
        headers = {
            "X-RateLimit-Limit": str(self._limit),
            "X-RateLimit-Remaining": str(remaining),
            "X-RateLimit-Reset": str(reset_in),
        }
        if not allowed:
            audit_log.warning(
                "%s RATE-LIMITED %s %s", client_ip(request), request.method, request.url.path
            )
            return JSONResponse(
                {"detail": "rate limit exceeded"},
                status_code=429,
                headers={**headers, "Retry-After": str(reset_in)},
            )

        response = await call_next(request)
        response.headers.update(headers)
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Standard defensive response headers.

    setdefault() throughout, so a route may deliberately override any single header.
    """

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        headers = response.headers

        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Permissions-Policy", config.PERMISSIONS_POLICY)
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        # X-XSS-Protection is deprecated and its filter has itself been a source of
        # vulnerabilities; "0" is the modern guidance. CSP is the real control.
        headers.setdefault("X-XSS-Protection", "0")

        if config.CSP:
            headers.setdefault("Content-Security-Policy", config.CSP)
        if config.HSTS_ENABLED:
            headers.setdefault("Strict-Transport-Security", config.HSTS_VALUE)

        return response
