# Catalyst deployment — Datathon 2026

Full deployment on Zoho Catalyst using the recommended service for every capability:

| Capability in this project | Catalyst service | Artifact |
|---|---|---|
| Relational FIR database | **Data Store** | `catalyst/datastore/schema.sql` + `backend/data/processed/datastore/*.csv` |
| Backend API / full web app | **AppSail** | `catalyst.json`, `catalyst/appsail/app-config.json`, `./Dockerfile` |
| Frontend / SPA (React + Vite) | **Slate** | `frontend/` (built with `npm run build`) |
| Custom domain + SSL (optional) | **Domain Mappings** | console |
| RBAC / login (optional) | **Authentication** | `backend/app/config.py` (API-key RBAC) |

Deployment via Catalyst is **mandatory**; this uses three matching Catalyst services so
the submission also satisfies the "use the Catalyst service where one exists" rule.

The three services connect like this:

```text
[ Slate: React SPA ]  --HTTPS-->  [ AppSail: FastAPI ]  --ZCQL-->  [ Data Store: FIR tables ]
   VITE_API_BASE ─────────────────────►  /api/*                       CaseMaster, Accused, …
```

---

## Prerequisites

```bash
npm install -g zcatalyst-cli
catalyst login          # log in with the Zoho account that has Catalyst
```

Your Catalyst **project id** is already set in `catalyst.json`. Claim free Catalyst
credits: <https://catalyst.zoho.com/promotions.html?cn=KSPH26>.

> Your GitHub and Zoho accounts do **not** need to match. AppSail deploys from local
> files; Slate connects to whichever GitHub account owns the repo (authorised via OAuth).

---

## Step 1 — Data Store (the FIR database)

1. Generate the load files (already committed, but to refresh them):
   ```bash
   cd backend && python -m pipeline.fir_datastore
   # -> backend/data/processed/datastore/*.csv  (28 tables, ~5.4k rows)
   ```
2. In the Catalyst console: **Data Store → Create Table**, and create all 28 tables
   from `catalyst/datastore/schema.sql` (create each table's columns; set the `*ID`
   columns as the unique keys; model each FK as a lookup/relationship column).
3. For each table: **Bulk Import → upload the matching CSV** from
   `backend/data/processed/datastore/`. **Import order matters** (parents before
   children) so lookups resolve. Safe order:
   ```text
   State, District, UnitType, Unit, Rank, Designation, Employee, Court,
   CaseCategory, GravityOffence, CaseStatusMaster, CrimeHead, CrimeSubHead,
   Act, Section, CrimeHeadActSection, CasteMaster, ReligionMaster, OccupationMaster,
   CaseMaster, Inv_OccuranceTime, ActSectionAssociation,
   ComplainantDetails, Victim, Accused, ArrestSurrender,
   inv_arrestsurrenderaccused, ChargesheetDetails
   ```

## Step 2 — AppSail (the backend API)

### Recommended: managed Python runtime (no Docker)

The API only serves the committed JSON payloads and runs ZCQL against Data Store, so no
build step and no Docker are needed. `CRIME_USE_DATASTORE=1` makes the `/api/fir/live/*`
endpoints query Data Store.

```bash
catalyst appsail:add
#  - Runtime : Catalyst-Managed Runtime
#  - Stack   : Python
#  - Source directory : backend
#  - App name: crimeanalytics
# This creates backend/app-config.json. Set its "command" and env to match
# catalyst/appsail/app-config.json in this repo:
#   command: uvicorn app.main:app --host 0.0.0.0 --port ${X_ZOHO_CATALYST_LISTEN_PORT:-9000}
#   env    : CRIME_CORS_ORIGINS=*  ,  CRIME_USE_DATASTORE=1
catalyst deploy appsail
```

`backend/requirements.txt` is the **slim runtime set** (fastapi, uvicorn, pydantic,
zcatalyst-sdk) — that is all the deployed API needs, so the AppSail install is fast.
The full ML stack used only by the offline pipeline lives in
`backend/requirements-pipeline.txt` (also used by the Dockerfile).

### Alternative: Docker image (only if you have Docker)

```bash
docker build -t crime-analytics:latest .
# push to a registry Catalyst can pull, then:
catalyst deploy appsail --name crimeanalytics --source docker://<REGISTRY>/crime-analytics:latest --port 8000
```

After deploy, note the AppSail URL and check:
- `https://<appsail-url>/api/datastore/status` → `"connected": true`
- `https://<appsail-url>/api/fir/live/cases` → `"source": "datastore"`

## Step 3 — Slate (the frontend)

In the console, **Slate → Create Deployment**, connect the Git repo, and configure:

| Setting | Value |
|---|---|
| Framework | **Vite** |
| Root Path | **`frontend`** |
| Install command | `npm install` |
| Build command | **`npm run build`** |
| Output directory | **`dist`** |
| Environment variable | **`VITE_API_BASE`** = your AppSail URL (from Step 2) |

`VITE_API_BASE` points the SPA at the live AppSail API (which reads Data Store). Deploy;
Slate returns your public frontend URL — that is the submission link.

> If you ever want a **backend-free** static deploy instead, build with
> `npm run build:static` and omit `VITE_API_BASE` — the API is then baked into the
> bundle as JSON. Not needed for this full-stack path.

## Step 4 — (optional) Custom domain + SSL

**Domain Mappings** in the console → map a domain to the Slate app.

---

## What runs where

| Layer | Service | Notes |
|---|---|---|
| `CaseMaster` + 27 related tables | Data Store | system of record; queried live via ZCQL |
| `/api/*` (aggregates + `/api/fir/live/*`) | AppSail | FastAPI; batch analytics precomputed at build, record-level served live |
| React dashboards & maps | Slate | calls AppSail via `VITE_API_BASE` |

## Data note

Real record-level FIR data is confidential PII and is not shipped. The CSVs are a
deterministic, **schema-shaped** synthetic dataset (seed 42) that conforms exactly to
`schema.sql`, anchored to real NCRB district volumes. Replace them with real rows in the
same tables to go to production — no code change.
