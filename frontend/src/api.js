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
};
