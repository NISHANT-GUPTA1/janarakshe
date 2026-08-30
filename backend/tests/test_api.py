"""Contract tests for the analytics API.

These pin the behaviour the frontend depends on (every route, its status code and
payload shape) plus the security controls, so a future refactor cannot quietly
change either. Run with:  cd backend && python -m pytest
"""
from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient

# Routes that answer 200 with no auth in the default (open) configuration.
OPEN_ROUTES = [
    "/api",
    "/health",
    "/api/meta",
    "/api/districts",
    "/api/hotspots",
    "/api/trends",
    "/api/kpi-catalog",
    "/api/categories",
    "/api/whoami",
    "/api/intelligence/patterns",
    "/api/intelligence/ml-insights",
    "/api/socioeconomic",
    "/api/socioeconomic/correlations",
    "/api/socioeconomic/schema",
    "/api/fir/overview",
    "/api/fir/stations",
    "/api/fir/spatiotemporal",
    "/api/fir/cases",
    "/api/fir/schema",
    "/api/datastore/status",
    "/api/fir/live/cases",
    "/api/fir/live/stations",
]

# Person-level routes gated to analyst+ once auth is enforced.
GATED_ROUTES = [
    "/api/intelligence/repeat-offenders",
    "/api/intelligence/network",
    "/api/fir/network",
    "/api/fir/offenders",
]

KEYS = "k-viewer:viewer,k-analyst:analyst,k-admin:admin"


def build_client(monkeypatch, **env) -> TestClient:
    """Reload the app with a specific environment; config is read at import time."""
    for key in (
        "CRIME_API_KEYS", "CRIME_CORS_ORIGINS", "CRIME_DOCS",
        "CRIME_RATE_LIMIT", "CRIME_TRUSTED_HOSTS", "CRIME_HSTS", "CRIME_CSP",
    ):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    from app import config, datastore, middleware, payloads, security
    from app.routers import analytics, fir, intelligence, socioeconomic, system

    for module in (config, security, datastore, middleware, payloads,
                   system, analytics, intelligence, fir, socioeconomic):
        importlib.reload(module)
    import app.routers as routers
    importlib.reload(routers)
    import app.main as main
    importlib.reload(main)
    payloads.clear()
    return TestClient(main.app)


@pytest.fixture
def client(monkeypatch):
    with build_client(monkeypatch) as test_client:
        yield test_client


# --------------------------------------------------------------------------- #
# route contract
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("path", OPEN_ROUTES + GATED_ROUTES)
def test_route_serves_json(client, path):
    response = client.get(path)
    assert response.status_code == 200, path
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() is not None


def test_api_index_lists_every_advertised_route(client):
    from app.routers.system import ENDPOINTS

    advertised = {e for e in ENDPOINTS if "{" not in e}
    for path in advertised:
        assert client.get(path).status_code == 200, f"advertised but broken: {path}"


def test_district_detail_roundtrip(client):
    first = client.get("/api/districts").json()[0]
    detail = client.get(f"/api/districts/{first['geo_unit_id']}").json()
    assert detail["name"] == first["name"]
    assert {"kpis", "trend", "breakdown", "risk"} <= set(detail)


def test_unknown_district_is_404(client):
    assert client.get("/api/districts/DISTRICT:KA-NOWHERE").status_code == 404


def test_malformed_district_id_is_rejected(client):
    """Path traversal / oversized ids never reach the lookup."""
    assert client.get("/api/districts/..%2f..%2fetc%2fpasswd").status_code in (404, 422)
    assert client.get(f"/api/districts/{'x' * 200}").status_code == 422


def test_live_endpoints_fall_back_without_datastore(client):
    for path in ("/api/fir/live/cases", "/api/fir/live/stations"):
        assert client.get(path).json()["source"] == "fallback"


def test_live_limit_is_clamped_not_rejected(client):
    """Out-of-range limits clamp, preserving the endpoint's established contract."""
    for value in ("0", "-5", "100000"):
        assert client.get(f"/api/fir/live/cases?limit={value}").status_code == 200


def test_live_limit_rejects_non_numeric(client):
    assert client.get("/api/fir/live/cases?limit=1;DROP").status_code == 422


# --------------------------------------------------------------------------- #
# authentication / authorisation
# --------------------------------------------------------------------------- #
def test_open_mode_serves_person_level_data(client):
    for path in GATED_ROUTES:
        assert client.get(path).status_code == 200


def test_enforced_mode_requires_a_key(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS) as client:
        for path in GATED_ROUTES:
            assert client.get(path).status_code == 401
            assert client.get(path, headers={"X-API-Key": "nope"}).status_code == 401


def test_enforced_mode_applies_the_role_hierarchy(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS) as client:
        for path in GATED_ROUTES:
            assert client.get(path, headers={"X-API-Key": "k-viewer"}).status_code == 403
            assert client.get(path, headers={"X-API-Key": "k-analyst"}).status_code == 200
            assert client.get(path, headers={"X-API-Key": "k-admin"}).status_code == 200


def test_open_routes_stay_open_under_enforcement(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS) as client:
        for path in OPEN_ROUTES:
            assert client.get(path).status_code == 200, path


def test_api_keys_are_never_stored_in_plaintext(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS):
        from app import config

        assert "k-admin" not in config.API_KEY_HASHES
        assert all(len(h) == 64 for h in config.API_KEY_HASHES)


def test_whoami_reports_the_resolved_role(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS) as client:
        body = client.get("/api/whoami", headers={"X-API-Key": "k-analyst"}).json()
        assert body == {"role": "analyst", "auth_mode": "enforced", "auth_enabled": True}
        assert client.get("/api/whoami").json()["role"] is None


# --------------------------------------------------------------------------- #
# security controls
# --------------------------------------------------------------------------- #
def test_security_headers_are_present(client):
    headers = client.get("/api/meta").headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "no-referrer"
    # Deprecated filter must be disabled, not enabled.
    assert headers["x-xss-protection"] == "0"
    csp = headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    assert "base-uri 'self'" in csp
    assert "permissions-policy" in headers


def test_csp_allows_the_3d_graph_jit(client):
    """react-force-graph's physics integrator uses new Function(); without
    'unsafe-eval' the 3D network view breaks. Pinned so it is a conscious change."""
    assert "'unsafe-eval'" in client.get("/api/meta").headers["content-security-policy"]


def test_cors_rejects_an_unknown_origin(client):
    response = client.get("/api/meta", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_cors_allows_a_catalyst_origin(client):
    origin = "https://myapp.catalystserverless.com"
    response = client.get("/api/meta", headers={"Origin": origin})
    assert response.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize(
    "origin",
    [
        "https://janarakshe.onslate.in",   # the live deployed frontend
        "https://myapp.onslate.in",
        "https://crimeapi-50044117510.development.catalystappsail.in",
        "http://localhost:5173",
    ],
)
def test_cors_allows_every_origin_the_app_is_actually_served_from(client, origin):
    """Slate serves the SPA from *.onslate.in. If the allowlist misses that origin
    the deployed dashboard breaks entirely, so each real origin is pinned here."""
    response = client.get("/api/meta", headers={"Origin": origin})
    assert response.headers.get("access-control-allow-origin") == origin


def test_cors_does_not_allow_credentials(client):
    response = client.get(
        "/api/meta", headers={"Origin": "http://localhost:5173"}
    )
    assert response.headers.get("access-control-allow-credentials") != "true"


def test_docs_are_hidden_once_auth_is_enforced(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_docs_can_be_re_enabled_explicitly(monkeypatch):
    with build_client(monkeypatch, CRIME_API_KEYS=KEYS, CRIME_DOCS="1") as client:
        assert client.get("/docs").status_code == 200


def test_rate_limit_returns_429_and_retry_after(monkeypatch):
    with build_client(monkeypatch, CRIME_RATE_LIMIT="5") as client:
        codes = [client.get("/api/meta").status_code for _ in range(12)]
        assert codes.count(200) == 5
        throttled = client.get("/api/meta")
        assert throttled.status_code == 429
        assert throttled.headers["retry-after"]
        assert throttled.headers["x-ratelimit-limit"] == "5"


def test_health_is_never_rate_limited(monkeypatch):
    with build_client(monkeypatch, CRIME_RATE_LIMIT="2") as client:
        for _ in range(10):
            assert client.get("/health").status_code == 200


def test_trusted_host_rejects_a_forged_host(monkeypatch):
    with build_client(monkeypatch, CRIME_TRUSTED_HOSTS="analytics.example") as client:
        assert client.get("/api/meta", headers={"Host": "evil.example"}).status_code == 400
        assert client.get(
            "/api/meta", headers={"Host": "analytics.example"}
        ).status_code == 200


def test_health_reports_the_security_posture(client):
    posture = client.get("/health").json()["security"]
    assert posture["auth"] == "open"
    assert posture["cors"] == "allowlist"
    assert posture["rate_limit"] == "240/60s"


def test_open_auth_raises_a_startup_warning(monkeypatch):
    with build_client(monkeypatch):
        from app import config

        assert any("CRIME_API_KEYS is not set" in w for w in config.startup_warnings())


def test_wildcard_cors_raises_a_startup_warning(monkeypatch):
    with build_client(monkeypatch, CRIME_CORS_ORIGINS="*"):
        from app import config

        assert any("allows any website" in w for w in config.startup_warnings())


def test_hardened_config_has_no_warnings(monkeypatch):
    with build_client(
        monkeypatch, CRIME_API_KEYS=KEYS, CRIME_CORS_ORIGINS="https://app.example"
    ):
        from app import config

        assert config.startup_warnings() == []


def test_every_response_carries_a_request_id(client):
    assert client.get("/api/meta").headers["x-request-id"]


def test_forged_request_id_is_sanitised(client):
    response = client.get("/api/meta", headers={"X-Request-ID": "a\r\nInjected: 1"})
    assert "\n" not in response.headers["x-request-id"]
    assert "injected" not in {k.lower() for k in response.headers}


# --------------------------------------------------------------------------- #
# payload cache
# --------------------------------------------------------------------------- #
def test_cache_is_not_mutated_by_the_fallback_annotation(client):
    """The live routes add a "source" field; the shared cached payload must not
    inherit it, or /api/fir/cases would start reporting itself as a fallback."""
    client.get("/api/fir/live/cases")
    assert "source" not in client.get("/api/fir/cases").json()


def test_cache_refreshes_when_a_payload_changes(client, tmp_path):
    from app import payloads
    from pipeline import paths

    target = paths.API_DIR / "meta.json"
    original = target.read_bytes()
    try:
        first = client.get("/api/meta").json()
        edited = dict(first, district_count=first["district_count"] + 1)
        target.write_text(__import__("json").dumps(edited), encoding="utf-8")
        payloads.clear()
        assert client.get("/api/meta").json()["district_count"] == edited["district_count"]
    finally:
        target.write_bytes(original)
        payloads.clear()


def test_payload_names_outside_the_api_dir_are_refused():
    from fastapi import HTTPException

    from app import payloads

    for bad in ("../config.py", "/etc/passwd", "meta.json/../../x.json", "notjson.txt"):
        with pytest.raises(HTTPException) as excinfo:
            payloads.load(bad)
        assert excinfo.value.status_code in (500, 503)
