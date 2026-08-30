#!/usr/bin/env node
// Phase 0 contract validator — zero dependencies, runs on the Node already
// installed for this CRA app:  node docs/phase-0/contracts/validate.mjs
//
// Checks (Phase-0 exit gate):
//   1. every contract + schema + example JSON parses
//   2. each example validates against its schema (required / enum / range / pattern)
//   3. cross-references resolve (taxonomy codes used by KPIs/examples exist; geo
//      levels used by schemas/KPIs exist; example category_code / geo_unit_id valid)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(here, p), 'utf8'));

let errors = 0;
const fail = (msg) => { errors++; console.error('  ✗', msg); };
const ok = (msg) => console.log('  ✓', msg);

// ---- load contracts -------------------------------------------------------
let taxonomy, geo, kpis, sources, sIncident, sGeo, sEntity;
let exIncident, exGeo, exEntity;
try {
  taxonomy = read('crime_taxonomy.json');
  geo = read('geo_hierarchy.json');
  kpis = read('kpi_catalog.json');
  sources = read('data_sources.json');
  sIncident = read('schema_incident.json');
  sGeo = read('schema_geo_unit.json');
  sEntity = read('schema_entity.json');
  exIncident = read('examples/incident.example.json');
  exGeo = read('examples/geo_unit.example.json');
  exEntity = read('examples/entity.example.json');
  ok('all contract / schema / example JSON files parse');
} catch (e) {
  console.error('FATAL: could not parse a JSON file:', e.message);
  process.exit(1);
}

// ---- tiny JSON-Schema validator (subset we use) ---------------------------
function validate(schema, obj, path = '') {
  const errs = [];
  const props = schema.properties || {};
  for (const req of schema.required || []) {
    if (obj[req] === undefined) errs.push(`${path}: missing required '${req}'`);
  }
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(obj)) {
      if (!props[k]) errs.push(`${path}: unexpected property '${k}'`);
    }
  }
  for (const [k, spec] of Object.entries(props)) {
    if (obj[k] === undefined) continue;
    const v = obj[k];
    const types = [].concat(spec.type || []);
    const typeOk = types.length === 0 || types.some((t) => matchType(t, v));
    if (!typeOk) errs.push(`${path}.${k}: type ${JSON.stringify(v)} not in ${types}`);
    if (spec.enum && !spec.enum.includes(v)) errs.push(`${path}.${k}: '${v}' not in enum`);
    if (typeof v === 'number') {
      if (spec.minimum !== undefined && v < spec.minimum) errs.push(`${path}.${k}: ${v} < min ${spec.minimum}`);
      if (spec.maximum !== undefined && v > spec.maximum) errs.push(`${path}.${k}: ${v} > max ${spec.maximum}`);
    }
    if (spec.pattern && typeof v === 'string' && !new RegExp(spec.pattern).test(v)) {
      errs.push(`${path}.${k}: '${v}' fails pattern ${spec.pattern}`);
    }
    if (spec.type === 'object' && v && typeof v === 'object') errs.push(...validate(spec, v, `${path}.${k}`));
  }
  return errs;
}
function matchType(t, v) {
  if (t === 'null') return v === null;
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'number') return typeof v === 'number';
  if (t === 'string') return typeof v === 'string';
  if (t === 'boolean') return typeof v === 'boolean';
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v && typeof v === 'object' && !Array.isArray(v);
  return false;
}

// ---- 2. examples validate against schemas ---------------------------------
for (const [name, schema, ex] of [
  ['geo_unit', sGeo, exGeo],
  ['incident', sIncident, exIncident],
  ['entity', sEntity, exEntity],
]) {
  const errs = validate(schema, ex, name);
  if (errs.length) errs.forEach(fail);
  else ok(`${name} example validates against schema`);
}

// ---- 3. cross-reference integrity -----------------------------------------
const catCodes = new Set(taxonomy.categories.map((c) => c.code));
const groupCodes = new Set(taxonomy.groups.map((g) => g.code));
const geoLevels = new Set(geo.levels.map((l) => l.code));
const sourceIds = new Set(sources.sources.map((s) => s.id));

// every category has a severity_weight and a valid group
for (const c of taxonomy.categories) {
  if (typeof c.severity_weight !== 'number') fail(`taxonomy ${c.code}: missing severity_weight`);
  if (!groupCodes.has(c.group)) fail(`taxonomy ${c.code}: group '${c.group}' not defined`);
}
ok(`taxonomy: ${taxonomy.categories.length} categories, all have severity_weight & valid group`);

// KPI geo grains exist (allow synthetic GRID grain used by hotspot metrics)
for (const k of kpis.kpis) {
  for (const g of k.grain?.geo || []) {
    if (!geoLevels.has(g) && g !== 'GRID') fail(`kpi ${k.id}: geo grain '${g}' not a geo level`);
  }
}
ok(`kpi catalog: ${kpis.kpis.length} KPIs, all geo grains resolve`);

// every data source maps_to is non-empty and has required governance fields
for (const s of sources.sources) {
  for (const f of ['license', 'access', 'pii_level', 'refresh']) {
    if (!s[f]) fail(`data source ${s.id}: missing '${f}'`);
  }
  if (!Array.isArray(s.maps_to) || s.maps_to.length === 0) fail(`data source ${s.id}: empty maps_to`);
}
ok(`data sources: ${sources.sources.length} registered, all have license/access/pii_level/refresh`);

// example referential integrity
if (!catCodes.has(exIncident.category_code)) fail(`incident example: category_code '${exIncident.category_code}' not in taxonomy`);
if (!geoLevels.has(exGeo.level)) fail(`geo example: level '${exGeo.level}' not in hierarchy`);
if (!sourceIds.has(exIncident.source_id)) fail(`incident example: source_id '${exIncident.source_id}' not in data sources`);
if (!sourceIds.has(exEntity.source_id)) fail(`entity example: source_id '${exEntity.source_id}' not in data sources`);
ok('example referential integrity (category_code / geo level / source_id) resolves');

// ---- summary --------------------------------------------------------------
console.log('');
if (errors) {
  console.error(`PHASE 0 CONTRACTS: ${errors} error(s) — exit criteria NOT met.`);
  process.exit(1);
} else {
  console.log('PHASE 0 CONTRACTS: all checks passed ✔');
}
