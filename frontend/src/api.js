// API client with two interchangeable modes.
//
//   live   (default) — hits the FastAPI backend at /api/*. In dev, Vite proxies
//                      /api -> :8000 (see vite.config.js). Point VITE_API_BASE at
//                      a deployed backend to use it from anywhere.
//
//   static (VITE_STATIC_API=1) — reads the same payloads as flat JSON files under
//                      /api/*.json, shipped with the frontend build. This works
//                      because every backend route is a pure passthrough of one
//                      JSON file (app/main.py just does `return _load("x.json")`),
//                      so Catalyst Web Client Hosting (or any static host) can serve
//                      the whole API with no server process at all. Used only for the
//                      split-hosting option; the default Catalyst deploy is the single
//                      AppSail container that serves this frontend + the live API.
//                      `npm run export:api` copies the files into public/api/.
const BASE = import.meta.env.VITE_API_BASE || '';
const STATIC = import.meta.env.VITE_STATIC_API === '1';

// Each backend route and the JSON file it returns. Keep in sync with app/main.py.
const STATIC_FILES = {
  '/api/meta': 'meta.json',
  '/api/districts': 'districts.json',
  '/api/hotspots': 'hotspots.json',
  '/api/trends': 'trends.json',
  '/api/intelligence/repeat-offenders': 'intel_repeat_offenders.json',
  '/api/intelligence/network': 'intel_network.json',
  '/api/intelligence/patterns': 'intel_patterns.json',
  '/api/socioeconomic': 'se_indicators.json',
  '/api/socioeconomic/correlations': 'se_correlations.json',
  '/api/fir/overview': 'fir_overview.json',
  '/api/fir/stations': 'fir_stations.json',
  '/api/fir/spatiotemporal': 'fir_spatiotemporal.json',
  '/api/fir/network': 'fir_network.json',
  '/api/fir/offenders': 'fir_offenders.json',
  '/api/fir/cases': 'fir_cases.json',
  '/api/fir/schema': 'fir_schema.json',
  // Phase 8 — investigation workspace + crime-intelligence findings
  '/api/fir/queue': 'fir_queue.json',
  '/api/fir/case-details': 'fir_case_detail.json',
  '/api/fir/search-index': 'fir_search.json',
  '/api/fir/alerts': 'fir_alerts.json',
  '/api/fir/graph': 'fir_graph.json',
  '/api/intelligence/overview': 'ci_overview.json',
  '/api/intelligence/districts': 'ci_districts.json',
  '/api/intelligence/offenders': 'ci_offenders.json',
  '/api/socioeconomic/intelligence': 'se_intel.json',
};

async function get(path) {
  const url = STATIC ? `${BASE}/api/${STATIC_FILES[path]}` : `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// The per-district route is the one endpoint that is not a whole file: the backend
// indexes into district_detail.json by id. A static host cannot do that lookup —
// and the ids contain a colon ("DISTRICT:KA-RAMANAGARA"), which is not safe as a
// filename or URL segment. So in static mode we fetch the map once, cache the
// promise, and index it client-side.
let detailMap = null;
async function district(id) {
  if (!STATIC) return get(`/api/districts/${encodeURIComponent(id)}`);
  if (!detailMap) {
    detailMap = fetch(`${BASE}/api/district_detail.json`).then((r) => {
      if (!r.ok) throw new Error(`district_detail -> ${r.status}`);
      return r.json();
    });
  }
  const all = await detailMap;
  const found = all[id];
  if (!found) throw new Error(`district '${id}' not found`);
  return found;
}

// FIR case files follow the same shape as district(): live mode has a per-id
// route, static mode fetches the whole map once and indexes it here. The promise
// is cached, so opening the twentieth case costs one object lookup.
let caseMap = null;
function allCases() {
  if (!caseMap) caseMap = get('/api/fir/case-details');
  return caseMap;
}
async function firCase(id) {
  if (!STATIC) return get(`/api/fir/case/${encodeURIComponent(id)}`);
  const all = await allCases();
  const found = all.cases[id];
  if (!found) throw new Error(`FIR '${id}' not found`);
  return { stages: all.stages, rules: all.rules, as_of: all.as_of, case: found };
}

// The intelligence drill-down is small enough to keep whole; index it the same way.
let ciMap = null;
async function ciDistrict(id) {
  if (!STATIC) return get(`/api/intelligence/districts/${encodeURIComponent(id)}`);
  if (!ciMap) ciMap = get('/api/intelligence/districts');
  const all = await ciMap;
  const found = all.districts[id];
  if (!found) throw new Error(`district '${id}' not found`);
  return found;
}

export const api = {
  meta: () => get('/api/meta'),
  districts: () => get('/api/districts'),
  district,
  hotspots: () => get('/api/hotspots'),
  trends: () => get('/api/trends'),
  intelRepeat: () => get('/api/intelligence/repeat-offenders'),
  intelNetwork: () => get('/api/intelligence/network'),
  intelPatterns: () => get('/api/intelligence/patterns'),
  seIndicators: () => get('/api/socioeconomic'),
  seCorrelations: () => get('/api/socioeconomic/correlations'),
  // Phase 7 — FIR-record intelligence (KSP Police FIR System schema)
  firOverview: () => get('/api/fir/overview'),
  firStations: () => get('/api/fir/stations'),
  firSpatiotemporal: () => get('/api/fir/spatiotemporal'),
  firNetwork: () => get('/api/fir/network'),
  firOffenders: () => get('/api/fir/offenders'),
  firCases: () => get('/api/fir/cases'),
  firSchema: () => get('/api/fir/schema'),
  // Phase 8 — FIR investigation workspace
  firQueue: () => get('/api/fir/queue'),
  firCase,
  firSearchIndex: () => get('/api/fir/search-index'),
  firAlerts: () => get('/api/fir/alerts'),
  firGraph: () => get('/api/fir/graph'),
  // Phase 8 — Crime Intelligence findings
  ciOverview: () => get('/api/intelligence/overview'),
  ciDistricts: () => get('/api/intelligence/districts'),
  ciDistrict,
  ciOffenders: () => get('/api/intelligence/offenders'),
  seIntel: () => get('/api/socioeconomic/intelligence'),
};
