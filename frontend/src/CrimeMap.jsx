import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { BAND_COLOR, HOTSPOT_COLOR } from './dash/palette.js';

const BAND_LABEL = { Critical: 'Critical', High: 'High', Medium: 'Moderate', Low: 'Low' };

// leaflet.heat isn't part of react-leaflet — wrap it as a child layer.
function HeatLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.heatLayer(points, { radius: 38, blur: 28, maxZoom: 9, max: 1.0 }).addTo(map);
    return () => map.removeLayer(layer);
  }, [map, points]);
  return null;
}

// `focusIds` (a Set, or null for "everything") comes from the console filters:
// districts outside the focus stay on the map but recede.
export default function CrimeMap({ districts, boundaries, selectedId, focusIds = null, height = 452, onSelect }) {
  const [layer, setLayer] = useState('risk'); // 'risk' | 'heat'
  const wrapRef = useRef(null);
  const byId = Object.fromEntries(districts.map((d) => [d.geo_unit_id, d]));
  const inFocus = (id) => !focusIds || focusIds.has(id);
  const selected = selectedId ? byId[selectedId] : null;

  const shown = districts.filter((d) => inFocus(d.geo_unit_id) && d.centroid);
  const maxSev = Math.max(...shown.map((d) => d.severity_weighted_index), 1);
  const heatPoints = shown.map((d) => [d.centroid.lat, d.centroid.lon, d.severity_weighted_index / maxSev]);

  const style = (feature) => {
    const id = feature.properties.geo_unit_id;
    const d = byId[id];
    const isSel = selectedId === id;
    const focused = inFocus(id);
    return {
      color: isSel ? '#0f2d6e' : '#ffffff',
      weight: isSel ? 2.5 : 1,
      fillColor: d ? BAND_COLOR[d.risk_band] : '#c4cede',
      fillOpacity: !focused ? 0.12 : layer === 'heat' ? 0.14 : isSel ? 0.95 : 0.72,
    };
  };

  const onEach = (feature, lyr) => {
    const d = byId[feature.properties.geo_unit_id];
    lyr.bindTooltip(
      `<b>${feature.properties.name}</b><br/>${d ? `${BAND_LABEL[d.risk_band]} risk (${d.risk_score}) · ${d.crime_rate_per_100k}/100k` : ''}`,
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
    <div className="map-wrap" ref={wrapRef}>
      {/* segmented layer toggle + fullscreen */}
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
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
        />
        {boundaries && (
          <GeoJSON
            key={`${selectedId}-${layer}-${focusIds ? focusIds.size : 'all'}`}
            data={boundaries}
            style={style}
            onEachFeature={onEach}
          />
        )}
        {layer === 'heat' && <HeatLayer points={heatPoints} />}
        {shown
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
        <span className="ml-h">Risk Band</span>
        {Object.entries(BAND_COLOR).map(([b, c]) => (
          <span key={b} className="ml-row"><i style={{ background: c }} />{BAND_LABEL[b]}</span>
        ))}
        <span className="ml-h">Hotspots</span>
        <span className="ml-row"><i className="dot" style={{ background: HOTSPOT_COLOR.established }} />Established</span>
        <span className="ml-row"><i className="dot" style={{ background: HOTSPOT_COLOR.emerging }} />Emerging</span>
      </div>

      {/* selected district card */}
      {selected && (
        <div className="map-card-pop">
          <button className="mcp-x" onClick={() => onSelect(null)} aria-label="Close">×</button>
          <b className="mcp-name">{selected.name}</b>
          <span className={`band-pill b-${selected.risk_band.toLowerCase()}`}>{BAND_LABEL[selected.risk_band]} Risk</span>
          <div className="mcp-row"><span>Rate/100k</span><b>{selected.crime_rate_per_100k}</b></div>
          <div className="mcp-row"><span>Risk Score</span><b>{selected.risk_score}</b></div>
          <button className="btn-primary w-full" onClick={() => onSelect(selected.geo_unit_id)}>View District</button>
        </div>
      )}
    </div>
  );
}
