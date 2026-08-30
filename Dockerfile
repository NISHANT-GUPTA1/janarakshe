# Multi-stage build: build the React frontend, then serve it + the API from FastAPI
# (single origin, no proxy). Bakes the processed data layer into the image.

# ---- stage 1: frontend ----
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
# `npm ci` installs exactly the lockfile; the fallback exists for a missing lock.
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ---- stage 2: backend + serve ----
FROM python:3.12-slim AS app
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# The image runs the full pipeline at build time, so it needs the full (pipeline) deps.
COPY backend/requirements-pipeline.txt ./backend/requirements-pipeline.txt
RUN pip install --no-cache-dir -r backend/requirements-pipeline.txt

COPY backend/ ./backend/
# The Phase 0 contracts the pipeline reads (crime taxonomy, geo hierarchy, KPI
# catalog). NOTE: this directory is absent from the repository, so this COPY - and
# therefore the Docker build - currently fails. The AppSail deployment is
# unaffected: it serves the committed payloads and never runs the pipeline.
COPY docs/ ./docs/
COPY --from=frontend /fe/dist ./frontend/dist

# Generate the canonical layer + API payloads from the committed real data.
WORKDIR /app/backend
RUN python -m pipeline.run || (echo "pipeline failed" && exit 1)

# Drop root. The audit logger degrades to stdout-only when its directory is not
# writable, so an unwritable volume cannot stop the service from starting.
RUN useradd --create-home --uid 10001 appuser \
 && mkdir -p /app/backend/logs \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Security posture is entirely env-driven; see backend/app/config.py for every
# variable. Defaults are dev-open: set CRIME_API_KEYS to enforce RBAC on the
# person-level endpoints and CRIME_CORS_ORIGINS to pin the frontend origin.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=5).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
