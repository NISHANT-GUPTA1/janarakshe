"""Crime Analytics API + (optionally) the built frontend, on one origin.

Serves the district-level aggregates produced by the pipeline
(backend/data/processed/api/*.json). If a payload is missing the endpoint returns
503 with a hint to run `python -m pipeline.run`. When frontend/dist exists it is
served at / so the whole app runs from one server (no proxy, no stale-route 404s).

Hardening applied here: trusted-host validation, an origin allowlist instead of a
CORS wildcard, security response headers including a Content-Security-Policy,
per-IP rate limiting, correlated audit logging, API-key RBAC gating the
person-level endpoints, and error handlers that never return internals to a client.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import config, payloads
from .middleware import (
    AuditMiddleware,
    RateLimitMiddleware,
    SecurityHeadersMiddleware,
    audit_log,
)
from .routers import ALL_ROUTERS
from .routers.system import API_VERSION

log = logging.getLogger("crime.app")

# Payloads parsed at startup so the first user request is not the one that pays for
# it. Everything else is loaded lazily on first use and then cached.
WARM_PAYLOADS = (
    "meta.json",
    "districts.json",
    "district_detail.json",
    "trends.json",
    "hotspots.json",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    for warning in config.startup_warnings():
        audit_log.warning("SECURITY: %s", warning)
    warmed = payloads.warm(WARM_PAYLOADS)
    audit_log.info(
        "startup: %d/%d payloads cached, posture=%s",
        warmed,
        len(WARM_PAYLOADS),
        config.posture(),
    )
    yield


class SPAStaticFiles(StaticFiles):
    """Static files for the built SPA, with correct cache semantics.

    Vite emits content-hashed filenames under /assets, so those are safe to cache
    indefinitely; the HTML entrypoint must always be revalidated or users are
    pinned to a stale build after every deploy.
    """

    # StaticFiles hands get_response an OS-native relative path, so on Windows the
    # separator is a backslash. Normalise before matching.
    ASSET_PREFIX = "assets/"

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        normalised = path.replace(os.sep, "/").replace("\\", "/").lstrip("/")
        if normalised.startswith(self.ASSET_PREFIX):
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        else:
            response.headers.setdefault("Cache-Control", "no-cache")
        return response


def create_app() -> FastAPI:
    """Build the application: docs gating, middleware stack, routers, SPA mount."""
    application = FastAPI(
        title="AI-Driven Crime Analytics API",
        version=API_VERSION,
        description=(
            "District crime analytics, intelligence, and socio-economic correlation "
            "(pilot: Karnataka)."
        ),
        lifespan=lifespan,
        # Interactive docs enumerate every route and schema; off unless enabled.
        docs_url="/docs" if config.DOCS_ENABLED else None,
        redoc_url="/redoc" if config.DOCS_ENABLED else None,
        openapi_url="/openapi.json" if config.DOCS_ENABLED else None,
    )

    _register_middleware(application)
    _register_error_handlers(application)

    for router in ALL_ROUTERS:
        application.include_router(router)

    _mount_frontend(application)
    return application


def _register_middleware(application: FastAPI) -> None:
    """Middleware runs outermost-last-added, so this reads inside-out.

    Effective order per request:
        TrustedHost -> CORS -> SecurityHeaders -> RateLimit -> Audit -> route
    CORS sits outside the throttle so a browser can still read a 429, and the
    security headers wrap the throttle so they are present on rejections too.
    """
    application.add_middleware(AuditMiddleware)

    if config.RATE_LIMIT_ENABLED:
        application.add_middleware(
            RateLimitMiddleware, limit=config.RATE_LIMIT, window=config.RATE_WINDOW
        )

    application.add_middleware(SecurityHeadersMiddleware)

    cors_kwargs: dict = {
        "allow_methods": config.CORS_ALLOW_METHODS,
        "allow_headers": config.CORS_ALLOW_HEADERS,
        "expose_headers": config.CORS_EXPOSE_HEADERS,
        # No cookies or Authorization are used, so credentials stay off. This is
        # also what makes any origin allowlist meaningful rather than advisory.
        "allow_credentials": False,
        "max_age": 600,
    }
    if config.CORS_ORIGINS:
        cors_kwargs["allow_origins"] = config.CORS_ORIGINS
    else:
        cors_kwargs["allow_origins"] = []
        cors_kwargs["allow_origin_regex"] = config.CORS_ORIGIN_REGEX
    application.add_middleware(CORSMiddleware, **cors_kwargs)

    if config.TRUSTED_HOSTS != ["*"]:
        application.add_middleware(
            TrustedHostMiddleware, allowed_hosts=config.TRUSTED_HOSTS
        )


def _register_error_handlers(application: FastAPI) -> None:
    """Return a generic body for unhandled errors; log the detail server-side.

    Without this, an unexpected exception surfaces a stack trace or internal path
    to the caller.
    """

    @application.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", "-")
        log.exception("unhandled error on %s [id=%s]", request.url.path, request_id)
        return JSONResponse(
            status_code=500,
            content={"detail": "internal server error", "request_id": request_id},
        )


def _mount_frontend(application: FastAPI) -> None:
    """Serve the built SPA at / - mounted last so every /api route takes precedence.

    Only active after `npm run build`; on Slate-hosted deployments the frontend is
    served separately and this is a no-op.
    """
    if config.FRONTEND_DIST.is_dir():
        application.mount(
            "/",
            SPAStaticFiles(directory=str(config.FRONTEND_DIST), html=True),
            name="frontend",
        )
    else:
        log.info("frontend/dist not present; serving the API only")


app = create_app()
