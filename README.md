# AI-Driven Crime Analytics & Visualization Platform

Transforms fragmented crime records into actionable intelligence — interactive
dashboards, geospatial maps, hotspot detection, district drilldowns, anomaly/trend
alerts, and explainable risk scoring. Pilot state: **Karnataka**.

> Challenge 02 — *"Current systems rely on siloed data and manual reporting, limiting
> advanced analytics and proactive policing capabilities."* This platform is the
> unified analytical layer that fixes that.

## Repository layout

```
roadmap.md              full delivery roadmap (Phases 0–5)
docs/
  phase-0/              Discovery & Data Contract — taxonomy, geo, KPIs, schemas, baselines
  phase-1/              Foundation & Unified Data Model — this phase
backend/                Python: data pipeline + FastAPI aggregate API
frontend/               React (Vite): dashboard consuming the API
crime analysis EDA/     prior exploratory analysis (Boston/Chicago/India/SF)
```

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React + Vite (maps via MapLibre/Leaflet in Phase 2) |
| Backend / API | Python · FastAPI |
| Data / ML | pandas, numpy, scikit-learn (geopandas/statsmodels in Phase 2+) |
| Contracts | JSON Schema + JSON contracts in `docs/phase-0/contracts/` (source of truth) |
| Store | JSON files now → PostgreSQL/PostGIS later |

## Quickstart

```bash
# 1. Backend: build the data layer + serve the API
cd backend
pip install -r requirements.txt
python -m pipeline.run                 # seed -> ingest -> KPIs -> data quality
uvicorn app.main:app --reload          # http://127.0.0.1:8000/docs

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

Runs on **real, verified data for all 30 Karnataka districts**: NCRB district-wise
IPC crimes (2001–2012, reconciled exactly to NCRB totals), Census 2011 populations,
and Census 2011 district boundaries. See [backend/data/manifest.json](backend/data/manifest.json).
