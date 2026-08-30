# Backend — Data Pipeline + Aggregate API

Python (FastAPI + pandas) backend for the AI-Driven Crime Analytics platform.
Implements **Phase 1**: ingestion → canonical model → data-quality gate →
district-level aggregate APIs. Pilot state: **Karnataka**.

## Setup

```bash
cd backend
python -m venv .venv && .\venv\Scripts\activate or .\venv\Scripts\Activate.ps1      # Windows
# source .venv/bin/activate                          # macOS/Linux
pip install -r requirements.txt
```

## Run the pipeline

```bash
python -m pipeline.run            # seed -> ingest -> KPIs -> data quality
python -m pipeline.run --no-seed  # reuse existing seed/raw CSV
```

Outputs land in `data/processed/` (canonical layer) and `data/processed/api/`
(the static payloads the API serves).

## Run the API

```bash
uvicorn app.main:app --reload     # http://127.0.0.1:8000  (docs at /docs)
```

Runs open (no API key) by default so the demo needs no setup; the service logs a
`SECURITY:` warning at startup saying so, and `GET /health` reports the live
posture. See [../SECURITY.md](../SECURITY.md) for every environment variable and
the production checklist.

## Tests

```bash
python -m pytest                  # 58 contract + security tests
```

`tests/test_api.py` pins every route's status and shape, the RBAC hierarchy, and
each security control (CORS allowlist, CSP, rate limiting, trusted hosts, docs
gating, header sanitisation, payload-cache isolation).

| Endpoint                             | Returns                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `GET /health`                      | liveness + whether data is built + security posture                        |
| `GET /api/meta`                    | platform metadata, years, district count                                   |
| `GET /api/districts`               | district summary list (latest year), sorted by risk                        |
| `GET /api/districts/{geo_unit_id}` | full drilldown: KPIs, trend, breakdown, hotspot,**explainable risk** |
| `GET /api/hotspots`                | districts flagged emerging/established                                     |
| `GET /api/trends`                  | state-level yearly totals                                                  |
| `GET /api/kpi-catalog`             | Phase 0 KPI definitions (passthrough)                                      |
| `GET /api/categories`              | crime taxonomy (passthrough)                                               |

## Layout

```
backend/
  app/
    main.py              app factory: middleware stack, routers, SPA mount
    config.py            env-driven settings + startup security warnings
    security.py          API-key RBAC (hashed keys, constant-time compare)
    middleware.py        audit log, rate limit, security headers
    payloads.py          cached, path-validated access to data/processed/api/
    datastore.py         Catalyst Data Store (ZCQL) with static-payload fallback
    routers/             system | analytics | intelligence | fir | socioeconomic
  tests/test_api.py      contract + security test suite
  pipeline/
    contracts.py         loads docs/phase-0 contracts; taxonomy mapping + schema validation
    paths.py             filesystem locations
    seed.py              deterministic Karnataka sample generator (stands in for NCRB)
    ingest.py            raw -> canonical geo_units + incidents (dual-path, case_count)
    build_kpis.py        kpi_facts + hotspot z-score + baseline risk score + API payloads
    data_quality.py      schema/mapping/referential/coverage checks -> report
    run.py               orchestrator
  data/
    manifest.json        what to download to replace the seed with real data
    seed/                committed sample inputs (geo + crime)
    raw/                 downloaded source files (gitignored)
    processed/           generated canonical layer + api/ (gitignored)
  requirements.txt
```

## Going from sample → real data

The pipeline runs on a **deterministic sample** (`data/seed/`) so it works offline.
To use real data, follow `data/manifest.json`: download NCRB/Census/boundary files
into `data/raw/`, repoint the loader, and run with `--no-seed`. The data-quality
report (`data/processed/data_quality_report.md`) tells you what still needs attention
(e.g. the missing LGD/Census codes the sample intentionally leaves blank).

## Contracts are the source of truth

Nothing here hard-codes crime types, geography, or KPI formulas — it all reads
`docs/phase-0/contracts/*.json`. Change a contract, re-run the pipeline, and the
canonical layer + API follow. Validate the contracts themselves with:

```bash
node ../docs/phase-0/contracts/validate.mjs
```
