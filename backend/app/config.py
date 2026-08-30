"""Runtime configuration for the Crime Analytics API.

Every setting is environment-driven with a safe default, so the service runs with
zero setup locally and is hardened by setting env vars in the deployed environment.

Environment variables
---------------------
CRIME_API_KEYS       "key1:admin,key2:analyst,key3:viewer". Enables API-key RBAC.
                     When UNSET auth is OPEN (dev mode) so the demo runs with no
                     setup; a startup warning is emitted because the person-level
                     endpoints are then served unauthenticated.
CRIME_CORS_ORIGINS   Comma-separated exact origins. Overrides the default regex
                     allowlist entirely. Use this to pin production to one origin.
CRIME_CORS_ORIGIN_REGEX
                     Override the default origin regex (localhost + Catalyst hosts).
CRIME_TRUSTED_HOSTS  Comma-separated Host header allowlist ("*" disables the check).
CRIME_DOCS           "1" to expose /docs, /redoc and /openapi.json. Default: off
                     whenever auth is enforced, on otherwise (dev convenience).
CRIME_RATE_LIMIT     Requests per window per client IP. "0" disables. Default 240.
CRIME_RATE_WINDOW    Rate-limit window in seconds. Default 60.
CRIME_HSTS           "1" to emit Strict-Transport-Security. Default off (so plain
                     HTTP local dev is not pinned to HTTPS by the browser).
CRIME_CSP            Override the Content-Security-Policy header. "" disables it.
CRIME_LOG_DIR        Directory for audit logs. Default backend/logs.
CRIME_USE_DATASTORE  "1" to serve /api/fir/live/* from Catalyst Data Store (ZCQL).
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"

# Role hierarchy: higher index = more privilege.
ROLES = ("viewer", "analyst", "admin")


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_flag(name: str, default: bool = False) -> bool:
    raw = _env(name).lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


def _env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in _env(name, default).split(",") if item.strip()]


def _hash_key(key: str) -> str:
    """Hash an API key so the plaintext is never held in memory or logged."""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _parse_keys(raw: str) -> dict[str, str]:
    """Parse "key:role,key:role" into {sha256(key): role}, ignoring bad entries."""
    keys: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        key, role = pair.split(":", 1)
        key, role = key.strip(), role.strip().lower()
        if key and role in ROLES:
            keys[_hash_key(key)] = role
    return keys


# --------------------------------------------------------------------------- #
# authentication / authorisation
# --------------------------------------------------------------------------- #
# Keys are stored hashed; see security.identify for the constant-time comparison.
API_KEY_HASHES: dict[str, str] = _parse_keys(os.getenv("CRIME_API_KEYS", ""))
AUTH_ENABLED: bool = bool(API_KEY_HASHES)


def role_rank(role: str | None) -> int:
    """Privilege ordering; unknown/None roles rank below every real role."""
    return ROLES.index(role) if role in ROLES else -1


# --------------------------------------------------------------------------- #
# CORS
# --------------------------------------------------------------------------- #
# The SPA is hosted on Catalyst Slate and calls this API cross-origin, so the exact
# frontend subdomain is assigned at deploy time. Rather than a wildcard (which lets
# ANY site read the API), the default is a regex allowlist covering local dev and
# the Catalyst hosting domains. Set CRIME_CORS_ORIGINS to pin production further.
DEFAULT_CORS_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    # Slate serves the deployed SPA from *.onslate.in (e.g. janarakshe.onslate.in).
    # This is the origin the live frontend actually calls from — omitting it blocks
    # the entire dashboard, so it stays first among the hosted patterns.
    # Subdomains carry dots of their own - the AppSail host is
    # "crimeapi-<id>.development.catalystappsail.in" - so the label pattern must
    # allow them, or the real hosts fail to match.
    r"|^https://[A-Za-z0-9.-]+\.onslate\.in$"
    r"|^https://[A-Za-z0-9.-]+\.catalystserverless\.(com|eu|in)$"
    r"|^https://[A-Za-z0-9.-]+\.catalystappsail\.(in|com)$"
    r"|^https://[A-Za-z0-9.-]+\.zohoscw\.(com|eu|in)$"
)

CORS_ORIGINS: list[str] = _env_list("CRIME_CORS_ORIGINS")
# An explicit "*" is honoured but is never the default; it is reported at startup.
CORS_ALLOW_ALL: bool = CORS_ORIGINS == ["*"]
CORS_ORIGIN_REGEX: str | None = (
    None if CORS_ORIGINS else _env("CRIME_CORS_ORIGIN_REGEX") or DEFAULT_CORS_ORIGIN_REGEX
)
# The API is read-only and takes no cookies, so credentials stay off and the
# method/header surface is limited to what the SPA actually sends.
CORS_ALLOW_METHODS = ["GET", "HEAD", "OPTIONS"]
CORS_ALLOW_HEADERS = ["X-API-Key", "Content-Type", "Accept"]
CORS_EXPOSE_HEADERS = ["X-Request-ID", "X-Response-Time-ms"]

# --------------------------------------------------------------------------- #
# transport / headers
# --------------------------------------------------------------------------- #
TRUSTED_HOSTS: list[str] = _env_list("CRIME_TRUSTED_HOSTS", "*")

# Interactive docs enumerate every route and schema. Keep them on in open dev mode
# for convenience, off once real API keys are configured.
DOCS_ENABLED: bool = _env_flag("CRIME_DOCS", default=not AUTH_ENABLED)

HSTS_ENABLED: bool = _env_flag("CRIME_HSTS", default=False)
HSTS_VALUE = "max-age=31536000; includeSubDomains"

# Content-Security-Policy.
#
# 'unsafe-eval' is required and deliberate: the 3D offender-network view uses
# react-force-graph-3d, whose physics integrator (ngraph) JIT-compiles its step
# function with `new Function(...)`. Dropping it silently breaks that view. Every
# other directive is locked down - notably object-src 'none', base-uri 'self' and
# frame-ancestors 'none', which are what actually blunt injection and clickjacking.
# 'unsafe-inline' in style-src covers Leaflet's runtime styles and the Google Fonts
# stylesheet; it carries no script-execution risk.
DEFAULT_CSP = "; ".join(
    (
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://services.arcgisonline.com",
        "connect-src 'self' https://*.catalystappsail.in https://*.catalystserverless.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "upgrade-insecure-requests",
    )
)
CSP: str = os.getenv("CRIME_CSP", DEFAULT_CSP)

PERMISSIONS_POLICY = (
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), payment=(), usb=()"
)

# --------------------------------------------------------------------------- #
# rate limiting
# --------------------------------------------------------------------------- #
# Each payload route parses a JSON file, so unbounded request rates are the cheapest
# denial-of-service vector against this service. Fixed-window counter per client IP.
RATE_LIMIT: int = _env_int("CRIME_RATE_LIMIT", 240)
RATE_WINDOW: int = _env_int("CRIME_RATE_WINDOW", 60)
RATE_LIMIT_ENABLED: bool = RATE_LIMIT > 0

# Liveness probes must never be throttled.
RATE_LIMIT_EXEMPT = frozenset({"/health"})

# --------------------------------------------------------------------------- #
# query bounds
# --------------------------------------------------------------------------- #
LIVE_QUERY_MIN_LIMIT = 1
LIVE_QUERY_MAX_LIMIT = 500
LIVE_QUERY_DEFAULT_LIMIT = 50

# --------------------------------------------------------------------------- #
# logging
# --------------------------------------------------------------------------- #
LOG_DIR = Path(_env("CRIME_LOG_DIR") or str(BACKEND_DIR / "logs"))
LOG_MAX_BYTES = 2_000_000
LOG_BACKUP_COUNT = 3


def startup_warnings() -> list[str]:
    """Security posture issues worth shouting about at boot. Empty == hardened."""
    warnings: list[str] = []
    if not AUTH_ENABLED:
        warnings.append(
            "CRIME_API_KEYS is not set - person-level endpoints "
            "(/api/fir/offenders, /api/fir/network, /api/intelligence/*) are served "
            "WITHOUT authentication. Set CRIME_API_KEYS to enforce RBAC."
        )
    if CORS_ALLOW_ALL:
        warnings.append(
            "CRIME_CORS_ORIGINS='*' allows any website to read this API from a "
            "browser. Set it to your frontend origin."
        )
    if DOCS_ENABLED and AUTH_ENABLED:
        warnings.append("CRIME_DOCS=1 exposes /docs and /openapi.json publicly.")
    if not RATE_LIMIT_ENABLED:
        warnings.append("Rate limiting is disabled (CRIME_RATE_LIMIT=0).")
    if not CSP:
        warnings.append("Content-Security-Policy is disabled (CRIME_CSP='').")
    return warnings


def posture() -> dict:
    """Non-sensitive summary of the active security posture (surfaced on /health)."""
    return {
        "auth": "enforced" if AUTH_ENABLED else "open",
        "cors": "wildcard" if CORS_ALLOW_ALL else ("explicit" if CORS_ORIGINS else "allowlist"),
        "docs": DOCS_ENABLED,
        "rate_limit": f"{RATE_LIMIT}/{RATE_WINDOW}s" if RATE_LIMIT_ENABLED else "off",
        "csp": bool(CSP),
        "hsts": HSTS_ENABLED,
    }
