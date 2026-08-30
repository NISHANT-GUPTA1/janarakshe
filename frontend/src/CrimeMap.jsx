import React, { useMemo, useRef, useState } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Tooltip } from 'react-leaflet';
import Basemap from './Basemap.jsx';
import 'leaflet/dist/leaflet.css';
import { BAND_COLOR, HOTSPOT_COLOR } from './dash/palette.js';
import { BAND_LABEL } from './labels.js';
import { escapeHtml } from './safeHtml.js';

// ---- red→green heat ramp (RdYlGn reversed: high crime = dark red, low = green) ----
const HEAT_STOPS = [
  [0.0, [26, 152, 80]],    // green (low)
  [0.18, [120, 198, 90]],  // light green
  [0.32, [210, 230, 120]], // yellow-green
  [0.44, [253, 220, 120]], // yellow
  [0.56, [253, 174, 97]],  // orange
  [0.7, [244, 109, 67]],   // red-orange
  [0.84, [214, 47, 39]],   // red
  [1.0, [150, 0, 30]],     // dark red
];
function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (t <= HEAT_STOPS[i][0]) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const [t1, c1] = HEAT_STOPS[i];
      const f = (t - t0) / (t1 - t0 || 1);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(165,0,38)';
}

// ray-casting point-in-polygon (ring is [[lon,lat],...])
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// deterministic per-cell variation (emulates ward-level granularity we don't have
// in the 31-district source — the data is synthetic/demo, so this is presentation).
function cellNoise(ix, iy) {
  const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  const m = Math.sin(ix * 269.5 + iy * 183.3) * 24634.6345;
  return ((n - Math.floor(n)) * 0.6 + (m - Math.floor(m)) * 0.4);
}

// Build a fine grid clipped to the state. Each cell's tone is a smooth IDW
// interpolation of district crime-rate (regional trend) + local FIR-incident
// density (hotspots) + a little per-cell variation — the granular choropleth look.
function buildHeatGrid(boundaries, districts, points) {
  if (!boundaries?.features?.length) return null;

  // district centroids for interpolation
  const cents = districts
    .filter((d) => d.centroid)
    .map((d) => ({ lat: d.centroid.lat, lon: d.centroid.lon, rate: d.crime_rate_per_100k }));
  if (!cents.length) return null;
  let minRate = Infinity, maxRate = -Infinity;
  cents.forEach((c) => { if (c.rate < minRate) minRate = c.rate; if (c.rate > maxRate) maxRate = c.rate; });
  const rateSpan = maxRate - minRate || 1;

  // per-feature outer rings + bbox
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const feats = boundaries.features.map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((p) => p[0]);
    let a = 90, b = -90, c = 180, d = -180;
    rings.forEach((r) => r.forEach(([lon, lat]) => {
      if (lat < a) a = lat; if (lat > b) b = lat; if (lon < c) c = lon; if (lon > d) d = lon;
    }));
    if (a < minLat) minLat = a; if (b > maxLat) maxLat = b;
    if (c < minLon) minLon = c; if (d > maxLon) maxLon = d;
    return { rings, bbox: [a, b, c, d] };
  });

  const step = 0.045;              // ~5 km cells → granular
  const R = 0.13;                  // FIR influence radius (degrees)
  const sigma2 = 2 * (R / 2.4) * (R / 2.4);
  const cells = [];
  let maxFir = 0;
  let ix = 0;

  for (let lon = minLon; lon <= maxLon; lon += step, ix++) {
    let iy = 0;
    for (let lat = minLat; lat <= maxLat; lat += step, iy++) {
      const clat = lat + step / 2;
      const clon = lon + step / 2;

      // inside the state outline?
      let inside = false;
      for (const fe of feats) {
        const [a, b, c, d] = fe.bbox;
        if (clat < a || clat > b || clon < c || clon > d) continue;
        if (fe.rings.some((r) => pointInRing(clon, clat, r))) { inside = true; break; }
      }
      if (!inside) continue;

      // IDW interpolation of district crime-rate (smooth regional trend)
      let num = 0, den = 0;
      for (const c of cents) {
        const dl = clat - c.lat, dg = clon - c.lon;
        const w = 1 / (dl * dl + dg * dg + 1e-4) ** 1.6;
        num += w * c.rate; den += w;
      }
      const idwNorm = (num / den - minRate) / rateSpan;

      // local FIR incident density (heinous weighted)
      let fir = 0;
      for (const p of points) {
        const dl = clat - p.lat, dg = clon - p.lon;
        const dd = dl * dl + dg * dg;
        if (dd < R * R) fir += Math.exp(-dd / sigma2) * (p.gravity === 'Heinous' ? 2 : 1);
      }
      if (fir > maxFir) maxFir = fir;

      cells.push({ lat, lon, idwNorm, fir, noise: cellNoise(ix, iy) });
    }
  }

  const features = cells.map((c) => {
    const firNorm = maxFir ? c.fir / maxFir : 0;
    // +0.22 red bias so the state reads predominantly hot, like the reference map
    const t = Math.max(0, Math.min(1,
      c.idwNorm * 0.6 + Math.pow(firNorm, 0.5) * 0.45 + (c.noise - 0.5) * 0.22 + 0.22));
    return {
      type: 'Feature',
      properties: { color: heatColor(t) },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [c.lon, c.lat], [c.lon + step, c.lat],
          [c.lon + step, c.lat + step], [c.lon, c.lat + step], [c.lon, c.lat],
        ]],
      },
    };
  });

  return { type: 'FeatureCollection', features };
}

export default function CrimeMap({ districts, boundaries, selectedId, focusIds = null, height = 452, onSelect, onView, firPoints = [] }) {
  const [layer, setLayer] = useState('risk'); // 'risk' | 'heat'
  const wrapRef = useRef(null);
  const byId = Object.fromEntries(districts.map((d) => [d.geo_unit_id, d]));
  const inFocus = (id) => !focusIds || focusIds.has(id);
  const selected = selectedId ? byId[selectedId] : null;

  const shown = districts.filter((d) => inFocus(d.geo_unit_id) && d.centroid);

  const heatGeo = useMemo(
    () => buildHeatGrid(boundaries, districts, firPoints),
    [boundaries, districts, firPoints]
  );

  const style = (feature) => {
    const id = feature.properties.geo_unit_id;
    const d = byId[id];
    const isSel = selectedId === id;
    const focused = inFocus(id);
    return {
      color: isSel ? '#0f2d6e' : '#ffffff',
      weight: isSel ? 2.5 : 1,
      fillColor: d ? BAND_COLOR[d.risk_band] : '#c4cede',
      fillOpacity: !focused ? 0.12 : isSel ? 0.95 : 0.72,
    };
  };

  const onEach = (feature, lyr) => {
    const d = byId[feature.properties.geo_unit_id];
    // bindTooltip parses its argument as HTML and `name` comes from the fetched
    // GeoJSON, so every interpolated value is escaped (see safeHtml.js).
    const summary = d
      ? `${escapeHtml(BAND_LABEL[d.risk_band])} risk (${escapeHtml(d.risk_score)})`
        + ` · ${escapeHtml(d.crime_rate_per_100k)}/100k`
      : '';
    lyr.bindTooltip(
      `<b>${escapeHtml(feature.properties.name)}</b><br/>${summary}`,
      { sticky: true }
    );
    lyr.on('click', () => onSelect(feature.properties.geo_unit_id));
  };

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  return (
    <div className={`map-wrap ${layer === 'heat' ? 'is-heat' : ''}`} ref={wrapRef}>
      <div className="map-toolbar">
        <div className="seg">
          <button className={layer === 'risk' ? 'on' : ''} onClick={() => setLayer('risk')}>Risk Layer</button>
          <button className={layer === 'heat' ? 'on' : ''} onClick={() => setLayer('heat')}>Heat Layer</button>
        </div>
        <button className="map-fs" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
        </button>
      </div>

      <MapContainer center={[14.8, 76.2]} zoom={6} style={{ height, borderRadius: 12 }} zoomControl={false} preferCanvas>
        {/* basemap always shown so the surrounding states give context in both layers */}
        <Basemap />

        {/* Risk choropleth (district level) */}
        {layer === 'risk' && boundaries && (
          <GeoJSON
            key={`risk-${selectedId}-${focusIds ? focusIds.size : 'all'}`}
            data={boundaries}
            style={style}
            onEachFeature={onEach}
          />
        )}

        {/* Heat choropleth (fine grid) */}
        {layer === 'heat' && heatGeo && (
          <GeoJSON
            key={`heat-${heatGeo.features.length}`}
            data={heatGeo}
            interactive={false}
            style={(f) => ({ fillColor: f.properties.color, fillOpacity: 0.92, color: '#ffffff', weight: 0.25, opacity: 0.35 })}
          />
        )}

        {/* District boundaries drawn over the heat grid (transparent fill, still clickable) */}
        {layer === 'heat' && boundaries && (
          <GeoJSON
            key={`heat-bounds-${selectedId}`}
            data={boundaries}
            style={(feature) => ({
              color: selectedId === feature.properties.geo_unit_id ? '#0f2d6e' : '#243654',
              weight: selectedId === feature.properties.geo_unit_id ? 2.6 : 1.1,
              fill: true, fillColor: '#000', fillOpacity: 0,
            })}
            onEachFeature={onEach}
          />
        )}

        {/* hotspot markers stay on the risk view; the heat view is kept clean */}
        {layer === 'risk' && shown
          .filter((d) => d.hotspot_status !== 'none')
          .map((d) => (
            <CircleMarker
              key={d.geo_unit_id}
              center={[d.centroid.lat, d.centroid.lon]}
              radius={d.hotspot_status === 'established' ? 9 : 6}
              pathOptions={{ color: '#fff', weight: 1.5, fillColor: HOTSPOT_COLOR[d.hotspot_status], fillOpacity: 0.95 }}
              eventHandlers={{ click: () => onSelect(d.geo_unit_id) }}
            >
              <Tooltip><b>{d.name}</b> — {d.hotspot_status} hotspot</Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>

      {/* legend */}
      <div className="map-legend">
        {layer === 'risk' ? (
          <>
            <span className="ml-h">Risk Band</span>
            {Object.entries(BAND_COLOR).map(([b, c]) => (
              <span key={b} className="ml-row"><i style={{ background: c }} />{BAND_LABEL[b]}</span>
            ))}
            <span className="ml-h">Hotspots</span>
            <span className="ml-row"><i className="dot" style={{ background: HOTSPOT_COLOR.established }} />Established</span>
            <span className="ml-row"><i className="dot" style={{ background: HOTSPOT_COLOR.emerging }} />Emerging</span>
          </>
        ) : (
          <>
            <span className="ml-h">Crime intensity</span>
            <span className="ml-gradient" />
            <span className="ml-scale"><span>Low</span><span>High</span></span>
          </>
        )}
      </div>

      {/* selected district card */}
      {selected && (
        <div className="map-card-pop">
          <button className="mcp-x" onClick={() => onSelect(null)} aria-label="Close">×</button>
          <b className="mcp-name">{selected.name}</b>
          <span className={`band-pill b-${selected.risk_band.toLowerCase()}`}>{BAND_LABEL[selected.risk_band]} Risk</span>
          <div className="mcp-row"><span>Rate/100k</span><b>{selected.crime_rate_per_100k}</b></div>
          <div className="mcp-row"><span>Risk Score</span><b>{selected.risk_score}</b></div>
          <button className="btn-primary w-full" onClick={() => (onView ? onView(selected.geo_unit_id) : onSelect(selected.geo_unit_id))}>View District</button>
        </div>
      )}
    </div>
  );
}
