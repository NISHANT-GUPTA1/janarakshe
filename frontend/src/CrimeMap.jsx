import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { BAND_COLOR, HOTSPOT_COLOR } from './dash/palette.js';

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
// districts outside the focus stay on the map but recede, so the filter reads as
// a spotlight rather than as data disappearing.
export default function CrimeMap({ districts, boundaries, selectedId, focusIds = null, height = 520, onSelect }) {
  const [layer, setLayer] = useState('risk'); // 'risk' | 'heat'
  const byId = Object.fromEntries(districts.map((d) => [d.geo_unit_id, d]));
  const inFocus = (id) => !focusIds || focusIds.has(id);

  const shown = districts.filter((d) => inFocus(d.geo_unit_id) && d.centroid);
  const maxSev = Math.max(...shown.map((d) => d.severity_weighted_index), 1);
  const heatPoints = shown.map((d) => [d.centroid.lat, d.centroid.lon, d.severity_weighted_index / maxSev]);

  const style = (feature) => {
    const id = feature.properties.geo_unit_id;
    const d = byId[id];
    const isSel = selectedId === id;
    const focused = inFocus(id);
    return {
      color: isSel ? '#ffffff' : '#1b2335',
      weight: isSel ? 2.5 : 1,
      fillColor: d ? BAND_COLOR[d.risk_band] : '#444',
      fillOpacity: !focused ? 0.08 : layer === 'heat' ? 0.12 : isSel ? 0.92 : 0.62,
    };
  };

  const onEach = (feature, lyr) => {
    const d = byId[feature.properties.geo_unit_id];
    lyr.bindTooltip(
      `<b>${feature.properties.name}</b><br/>${d ? `${d.risk_band} risk (${d.risk_score}) · ${d.crime_rate_per_100k}/100k` : ''}`,
      { sticky: true }
    );
    lyr.on('click', () => onSelect(feature.properties.geo_unit_id));
  };

  return (
    <div className="map-wrap">
      <div className="map-controls">
        <button className={layer === 'risk' ? 'on' : ''} onClick={() => setLayer('risk')}>Risk choropleth</button>
        <button className={layer === 'heat' ? 'on' : ''} onClick={() => setLayer('heat')}>Crime heatmap</button>
        <span className="legend">
          {Object.entries(BAND_COLOR).map(([b, c]) => (
            <span key={b}><i style={{ background: c }} />{b}</span>
          ))}
          <span className="sep" />
          <span><i style={{ background: HOTSPOT_COLOR.established }} />Hotspot</span>
          <span><i style={{ background: HOTSPOT_COLOR.emerging }} />Emerging</span>
        </span>
      </div>

      <MapContainer center={[14.8, 76.2]} zoom={6} style={{ height, borderRadius: 12 }} preferCanvas>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
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
              radius={d.hotspot_status === 'established' ? 10 : 7}
              pathOptions={{ color: '#fff', weight: 1, fillColor: HOTSPOT_COLOR[d.hotspot_status], fillOpacity: 0.9 }}
              eventHandlers={{ click: () => onSelect(d.geo_unit_id) }}
            >
              <Tooltip><b>{d.name}</b> — {d.hotspot_status} hotspot</Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>
    </div>
  );
}
