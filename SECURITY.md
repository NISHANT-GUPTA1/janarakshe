# Security posture

How this platform is defended, what each control does, and what an operator must
set before a deployment can be called production.

---

## 1. Configuration is the security boundary

Every control is environment-driven (`backend/app/config.py`). Defaults are chosen
so the demo runs with zero setup; production is a matter of setting variables, not
editing code.

| Variable | Default | What it controls |
|---|---|---|
| `CRIME_API_KEYS` | *(unset)* | `key:role,...` with roles `viewer\|analyst\|admin`. **Unset means the person-level endpoints are public.** |
| `CRIME_CORS_ORIGINS` | *(unset)* | Exact origin allowlist. Unset falls back to the built-in regex allowlist, never a wildcard. |
| `CRIME_CORS_ORIGIN_REGEX` | Catalyst + localhost | Override the default origin pattern. |
| `CRIME_TRUSTED_HOSTS` | `*` | `Host` header allowlist; blocks Host-header poisoning. |
| `CRIME_DOCS` | off when auth is on | Exposes `/docs`, `/redoc`, `/openapi.json`. |
| `CRIME_RATE_LIMIT` / `CRIME_RATE_WINDOW` | `240` / `60` | Requests per window per client IP. `0` disables. |
| `CRIME_HSTS` | off | Emits `Strict-Transport-Security`. Enable behind TLS. |
| `CRIME_CSP` | built-in policy | Override or (with `""`) disable the CSP. |
| `CRIME_LOG_DIR` | `backend/logs` | Audit log location. |

The service **logs a warning at startup for every weak setting** and reports the
live posture at `GET /health`:

```json
{"status":"ok","data_built":true,
 "security":{"auth":"open","cors":"allowlist","docs":true,
             "rate_limit":"240/60s","csp":true,"hsts":false}}
```

`config.startup_warnings()` returning `[]` is the definition of a hardened
deployment, and a test asserts that a fully configured environment reaches it.

---

## 2. Authentication and authorisation

API-key RBAC with a three-level hierarchy (`viewer < analyst < admin`). Person-level
endpoints — `/api/fir/offenders`, `/api/fir/network`,
`/api/intelligence/repeat-offenders`, `/api/intelligence/network` — require
`analyst` or above.

* Keys are **never stored in plaintext.** `config` keeps `sha256(key) -> role`.
* Lookup uses `hmac.compare_digest` against every configured key, so response time
  does not reveal how much of a key matched — closing a timing side-channel that a
  plain dictionary lookup leaves open.
* A rejected key returns `401` with `WWW-Authenticate: ApiKey`; a valid key with
  insufficient privilege returns `403`.

> **Open by default.** With `CRIME_API_KEYS` unset the demo serves person-level data
> without authentication. This is a deliberate, documented choice so the platform
> runs with no setup — and it is why the startup warning and the `/health` posture
> field exist. Set `CRIME_API_KEYS` before handling real FIR records.

---

## 3. Browser-facing controls

**CORS.** The wildcard is gone. Unset, the API accepts `localhost`, Catalyst
`*.catalystserverless.*`, `*.catalystappsail.*` and `*.zohoscw.*` origins. Methods
are limited to `GET`/`HEAD`/`OPTIONS`, headers to `X-API-Key`/`Content-Type`/
`Accept`, and `allow_credentials` is **false** — the API takes no cookies, which is
what makes the allowlist enforceable rather than advisory.

**Response headers** on every response, including rate-limit rejections:

| Header | Value |
|---|---|
| `Content-Security-Policy` | see below |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | camera, geolocation, microphone… all `()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `X-XSS-Protection` | `0` |
| `Strict-Transport-Security` | when `CRIME_HSTS=1` |

`X-XSS-Protection` was `1; mode=block`. The legacy auditor is deprecated and has
itself introduced vulnerabilities; `0` is current guidance, and CSP is the real
control.

**Content-Security-Policy.** Declared twice on purpose — as a response header from
FastAPI, and as a `<meta>` element in `frontend/index.html`, because on the Catalyst
Slate deployment the SPA is served by Slate and never sees FastAPI's headers.

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none';
form-action 'self'; script-src 'self' 'unsafe-eval';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob: https://*.basemaps.cartocdn.com;
connect-src 'self' https://*.catalystappsail.in https://*.catalystserverless.com;
worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests
```

Two relaxations, both deliberate and both verified against the actual bundle:

* **`'unsafe-eval'`** — `react-force-graph-3d`'s physics integrator JIT-compiles its
  step function with `new Function(...)` (confirmed: six occurrences in the built
  `NetworkGraph` chunk). Removing it silently breaks the 3D Network view. A test
  pins this so it can only ever be removed as a conscious decision.
* **`'unsafe-inline'` in `style-src`** — Leaflet writes runtime styles and Google
  Fonts ships a stylesheet. Style injection carries no script-execution risk;
  `script-src` remains free of `'unsafe-inline'`, which is what stops injected
  markup from running.

---

## 4. Cross-site scripting

React escapes interpolated values, but two third-party widgets take an HTML
**string** and inject it. Both were interpolating fetched data unescaped:

| Location | Sink | Data |
|---|---|---|
| `CrimeMap.jsx` | Leaflet `layer.bindTooltip()` | district `name` from the GeoJSON |
| `NetworkGraph.jsx` | `react-force-graph` `nodeLabel` | offender `name`, `district`, `category` from the API |

Both now escape every interpolated value through `frontend/src/safeHtml.js`. This
matters concretely: `catalyst/README.md` states real FIR rows can replace the
synthetic ones **with no code change**, so an offender name is untrusted input on
the day that happens — a stored-XSS payload executing in an analyst's browser.

---

## 5. Injection and input handling

* **ZCQL.** Statements are module-level constants in `app/datastore.py`. The single
  caller-influenced value is a row limit, forced through `safe_limit()` (int coercion
  then clamp to 1–500) before it reaches a statement, so no caller text is ever
  interpolated into a query. A hard `MAX_ROWS` ceiling caps the result set.
* **Path parameters.** `geo_unit_id` is bounded by length and pattern
  (`^[A-Za-z0-9:_-]+$`), keeping oversized and control-character input out of both
  the lookup and the audit log.
* **Payload names.** `payloads._resolve()` refuses anything that escapes the API
  directory or is not `.json` — defence in depth for the day a route forwards a
  caller-supplied value.

---

## 6. Information disclosure

* Data Store failures previously returned `str(exc)` to the caller, exposing ZCQL
  and SDK internals to an anonymous client. The exception is now logged server-side
  and the response carries only `"datastore_error": "live query unavailable"`.
* A catch-all handler returns `{"detail": "internal server error", "request_id": …}`
  instead of a stack trace; the correlation id ties the response to the log line.
* `/docs`, `/redoc` and `/openapi.json` are disabled automatically once
  `CRIME_API_KEYS` is set.
* Frontend fetch failures collapse to fixed messages rather than surfacing the
  browser's raw DNS/TLS/CORS text into the UI.

---

## 7. Availability

* **Rate limiting** — fixed-window per-IP counter (default 240/60s) returning `429`
  with `Retry-After` and `X-RateLimit-*`. `/health` is exempt so liveness probes are
  never throttled. Counters for elapsed windows are evicted so memory stays bounded.
* **Payload caching** — every analytics route was re-reading and re-parsing a JSON
  file (hundreds of KB) on *every* request, making the cheapest request the most
  expensive operation the server performs. Payloads are now parsed once and cached
  against `(mtime, size)`, so a pipeline re-run is still picked up without a restart.
  Five payloads are warmed at startup.
* **Request timeouts** — the frontend time-boxes every request at 20s via
  `AbortController`; a hung request no longer leaves a panel spinning forever.

---

## 8. Supply chain

| Package | Was | Now | Why |
|---|---|---|---|
| `requests` | 2.28.1 *(vendored)* | pinned 2.32.4 | CVE-2023-32681 (`Proxy-Authorization` leaked on redirect), CVE-2024-35195 (a session that once used `verify=False` keeps skipping TLS verification) |
| `urllib3` | 1.26.20 | pinned 2.2.2 | CVE-2024-37891 (proxy auth header retained across redirects) |
| `nanoid` | vulnerable | patched | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8 (high) |
| `postcss` | vulnerable | patched | GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 (high) — arbitrary `.map` disclosure |
| `pydantic`, `scipy`, `shap` | `>=` floors | exact pins | an unpinned floor means two deploys of one commit can ship different code |

**Vite / esbuild (GHSA-67mh-4wv8-2f99)** is *not* patched: the fix is Vite 8, a
breaking upgrade. It affects only the **dev server** — production builds are
unaffected. The exposure is closed instead in `vite.config.js` by binding the dev
server to loopback (`host: 127.0.0.1`) and setting `cors: false`, so another website
cannot reach it. Upgrade to Vite 8 to remove the advisory itself.

**Known drift.** The vendored `backend/vendor/` bundle has diverged from
`requirements.txt` (it carries fastapi 0.139.2, uvicorn 0.51.0, zcatalyst_sdk 0.0.2)
— so the deployed code is not the code that is pinned. The regeneration command is
in `requirements.txt`; run it so the two agree. Four Windows `.exe` launchers were
also removed from `vendor/bin/` — wrong-platform files in a Linux deploy bundle.

---

## 9. Auditing

Every `/api` request is logged with a correlation id, client IP, resolved role,
method, path, status and duration, to a rotating file and stdout:

```
2026-08-30 20:03:17 10.1.2.3 id=9c9b4ecae275 role=analyst GET /api/fir/offenders -> 200 12.4ms
```

* Client IP honours the left-most `X-Forwarded-For` entry (the managed runtime sits
  behind a proxy, so `request.client.host` was always the proxy) and is length-capped
  so a forged header cannot inject unbounded text into the log.
* `X-Request-ID` is accepted from the caller, stripped to `[A-Za-z0-9_-]{,64}` and
  echoed back — a forged value cannot inject a CRLF and forge a response header.
* Rate-limit rejections are logged at `WARNING`.
* The logger degrades to stdout-only if the log directory is unwritable, so a
  read-only filesystem cannot stop the service from starting.

---

## 10. Container

Non-root (`appuser`, uid 10001), `cap_drop: ALL`, `no-new-privileges`, a
`HEALTHCHECK` on `/health`, and the published port bound to `127.0.0.1` so the
container is reachable only through a reverse proxy.

---

## Production checklist

```bash
CRIME_API_KEYS="<strong-random>:admin,<strong-random>:analyst"
CRIME_CORS_ORIGINS="https://<your-slate-app>.catalystserverless.com"
CRIME_TRUSTED_HOSTS="<your-api-host>"
CRIME_HSTS=1
# CRIME_DOCS stays unset -> docs are disabled automatically
```

Then confirm `GET /health` reports `"auth":"enforced"`, `"cors":"explicit"`,
`"docs":false`, `"hsts":true`, and that the startup log contains no
`SECURITY:` warnings.

## Reporting

Report vulnerabilities privately to the platform owner. Do not open a public issue.
