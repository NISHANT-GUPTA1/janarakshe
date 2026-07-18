# Multi-stage build: build the React frontend, then serve it + the API from FastAPI
# (single origin, no proxy). Bakes the processed data layer into the image.

# ---- stage 1: frontend ----
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ---- stage 2: backend + serve ----
FROM python:3.12-slim AS app
WORKDIR /app
# The image runs the full pipeline at build time, so it needs the full (pipeline) deps.
COPY backend/requirements-pipeline.txt ./backend/requirements-pipeline.txt
RUN pip install --no-cache-dir -r backend/requirements-pipeline.txt
COPY backend/ ./backend/
COPY docs/ ./docs/
COPY --from=frontend /fe/dist ./frontend/dist
# generate the canonical layer + API payloads from the committed real data
WORKDIR /app/backend
RUN python -m pipeline.run || (echo "pipeline failed" && exit 1)
EXPOSE 8000
# Configure auth/CORS via env (see app/config.py). Defaults are dev-open.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
