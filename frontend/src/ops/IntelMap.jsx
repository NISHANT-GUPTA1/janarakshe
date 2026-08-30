import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Delta, Tag, fmt, pClass } from './ui.jsx';

// ===========================================================
// Crime intelligence map.
//
// The layer that matters most is "Change", not "Volume": a district
// with a lot of crime is not news to the officer who polices it, but
// a district where burglary moved 38% this month is. Volume is
// available, and it is not the default.
//
// Layers, in the order an officer reasons about them:
//   emerging clusters -> what is happening right now
//   crime change      -> what moved, against the previous period
//   hotspots          -> where it has been concentrated
//   density           -> raw FIR locations
//   stations / beats  -> who covers it
// ===========================================================

const KA_CENTER = [14.8, 76.2];
const PRIORITY_COLOR = {
  CRITICAL: '#b3261e', HIGH: '#a4530b', WATCH: '#7d5900',
  INFO: '#1f56d6', INFORMATION: '#1f56d6', RESOLVED: '#16653f',
};
const BAND_COLOR = { Critical: '#b3261e', High: '#a4530b', Medium: '#c99a12', Low: '#16653f' };

const LAYERS = [
  { id: 'clusters', label: 'Emerging clusters', on: true },
  { id: 'change', label: 'Crime change', on: true },
  { id: 'hotspots', label: 'Crime hotspots', on: false },
  { id: 'firs', label: 'FIR locations', on: false },
  { id: 'stations', label: 'Police stations', on: false },
  { id: 'beats', label: 'District boundaries', on: true },
];

export default function IntelMap({
  clusters = [],       // emerging clusters (lat/lon/case_count/change_pct/...)
  firs = [],           // queue rows with lat/lon
  districts = [],      // district summaries with centroid + change
  stations = [],       // { name, district, lat, lon, cases }
  boundaries = null,   // geojson
  height = 520,
  onInvestigate,       // (cluster) => void
  onOpenDistrict,      // (geo_unit_id) => void
  onOpenFir,           // (fir_id) => void
  focus,               // [lat, lon] to fly to
}) {
  // Layers with no data behind them are not offered at all: an empty checkbox
  // that silently does nothing is worse than one that is absent.
  const hasDistricts = districts.length > 0;
  const layers = LAYERS.filter((l) => (l.id === 'change' || l.id === 'hotspots' ? hasDistricts : true));
  const [on, setOn] = useState(() => new Set(LAYERS.filter((l) => l.on).map((l) => l.id)));
  const toggle = (id) => setOn((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const shown = (id) => on.has(id) && layers.some((l) => l.id === id);

  const maxCluster = Math.max(1, ...clusters.map((c) => c.case_count || 0));
  const changeById = useMemo(() => {
    const m = new Map();
    districts.forEach((d) => m.set(d.geo_unit_id, d));
    return m;
  }, [districts]);

  const styleBoundary = (feature) => {
    const id = feature?.properties?.geo_unit_id;
    const d = changeById.get(id);
    if (!shown('change') || !d || d.change_pct == null) {
      return { color: '#9db0c8', weight: 1, fillColor: '#ffffff', fillOpacity: 0.06 };
    }
    const c = d.change_pct;
    const mag = Math.min(Math.abs(c) / 60, 1);
    return {
      color: '#7f8ea6', weight: 1,
      fillColor: c > 0 ? '#b3261e' : '#16653f',
      fillOpacity: 0.08 + mag * 0.42,
    };
  };

  return (
    <div className="map-wrap" style={{ height }}>
      <MapContainer center={KA_CENTER} zoom={7} scrollWheelZoom style={{ height: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OpenStreetMap &copy; CARTO'
        />
        <FlyTo focus={focus} />

        {shown('beats') && boundaries && (
          <GeoJSON
            key={`b-${shown('change')}-${districts.length}`}
            data={boundaries}
            style={styleBoundary}
            onEachFeature={(feature, layer) => {
              const id = feature?.properties?.geo_unit_id;
              const d = changeById.get(id);
              const name = feature?.properties?.name || d?.name || 'District';
              layer.bindTooltip(
                d?.change_pct != null
                  ? `${name} — ${d.change_pct > 0 ? '+' : ''}${d.change_pct}% vs previous 30 days`
                  : name,
                { sticky: true },
              );
              layer.on('click', () => id && onOpenDistrict?.(id));
            }}
          />
        )}

        {shown('firs') && firs.map((f) => (
          f.lat != null && (
            <CircleMarker
              key={f.fir_id}
              center={[f.lat, f.lon]}
              radius={3}
              pathOptions={{
                color: PRIORITY_COLOR[f.priority] || '#64748b',
                fillColor: PRIORITY_COLOR[f.priority] || '#64748b',
                fillOpacity: 0.6, weight: 0.7,
              }}
            >
              <Popup>
                <div className="hot-popup">
                  <h4>{f.fir_no}</h4>
                  <div className="hp-row"><span>Offence</span><b>{f.crime_type}</b></div>
                  <div className="hp-row"><span>Station</span><b>{f.station}</b></div>
                  <div className="hp-row"><span>Status</span><b>{f.status}</b></div>
                  <div style={{ marginTop: 7 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => onOpenFir?.(f.fir_id)}>
                      Open case file
                    </button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          )
        ))}

        {shown('hotspots') && districts.filter((d) => d.hotspot_status && d.hotspot_status !== 'none')
          .map((d) => d.centroid && (
            <CircleMarker
              key={`h-${d.geo_unit_id}`}
              center={[d.centroid.lat, d.centroid.lon]}
              radius={9 + (d.risk_score || 0) / 12}
              pathOptions={{
                color: BAND_COLOR[d.risk_band] || '#64748b',
                fillColor: BAND_COLOR[d.risk_band] || '#64748b',
                fillOpacity: 0.12, weight: 1.6, dashArray: d.hotspot_status === 'emerging' ? '4 3' : null,
              }}
            >
              <Popup>
                <div className="hot-popup">
                  <h4>{d.name}</h4>
                  <div className="hp-row"><span>Hotspot</span><b>{d.hotspot_status}</b></div>
                  <div className="hp-row"><span>Risk</span><b>{d.risk_band} {d.risk_score}</b></div>
                  <div className="hp-row"><span>Rate</span><b>{d.crime_rate_per_100k}/100k</b></div>
                  <div style={{ marginTop: 7 }}>
                    <button className="btn btn-sm btn-primary" onClick={() => onOpenDistrict?.(d.geo_unit_id)}>
                      District intelligence
                    </button>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          ))}

        {shown('stations') && stations.map((s) => s.lat != null && (
          <CircleMarker
            key={`s-${s.unit_id || s.name}`}
            center={[s.lat, s.lon]}
            radius={4}
            pathOptions={{ color: '#0f2f60', fillColor: '#fff', fillOpacity: 1, weight: 1.6 }}
          >
            <Popup>
              <div className="hot-popup">
                <h4>{s.name}</h4>
                <div className="hp-row"><span>District</span><b>{s.district}</b></div>
                {s.cases != null && <div className="hp-row"><span>FIRs</span><b>{fmt(s.cases)}</b></div>}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Clusters render last so they sit on top — they are the point of the map */}
        {shown('clusters') && clusters.map((c) => c.lat != null && (
          <CircleMarker
            key={c.cluster_id}
            center={[c.lat, c.lon]}
            radius={11 + (c.case_count / maxCluster) * 15}
            pathOptions={{
              color: c.priority === 'CRITICAL' ? '#b3261e' : '#a4530b',
              fillColor: c.priority === 'CRITICAL' ? '#b3261e' : '#a4530b',
              fillOpacity: 0.2, weight: 2.4,
            }}
          >
            <Popup>
              <div className="hot-popup">
                <div style={{ marginBottom: 5 }}><Tag level={c.priority || 'HIGH'} /></div>
                <h4>{c.area || c.district}</h4>
                <div style={{ fontWeight: 700, marginBottom: 5 }}>
                  {c.crime_type} — {c.case_count} incidents{' '}
                  {c.change_pct != null && <Delta pct={c.change_pct} />}
                </div>
                <div className="hp-row"><span>Previous period</span><b>{c.baseline}</b></div>
                <div className="hp-row"><span>Peak time</span><b>{c.peak_window || `${String(c.peak_hour).padStart(2, '0')}:00`}</b></div>
                <div className="hp-row"><span>Related FIRs</span><b>{c.cases?.length ?? c.case_count}</b></div>
                <div className="hp-row"><span>Confidence</span><b>{Math.round((c.confidence || 0) * 100)}%</b></div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => onInvestigate?.(c)}>
                    Investigate pattern
                  </button>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="map-layers">
        <h5>Layers</h5>
        {layers.map((l) => (
          <label key={l.id}>
            <input type="checkbox" checked={on.has(l.id)} onChange={() => toggle(l.id)} />
            {l.label}
          </label>
        ))}
      </div>

      <div className="map-legend">
        {shown('change') && (
          <>
            <span><i style={{ background: '#b3261e' }} /> Crime up vs previous 30 days</span>
            <span><i style={{ background: '#16653f' }} /> Crime down</span>
          </>
        )}
        {shown('clusters') && <span><i style={{ background: '#a4530b' }} /> Emerging cluster</span>}
        {shown('hotspots') && <span><i style={{ background: '#b3261e' }} /> Established hotspot</span>}
        {shown('firs') && <span><i style={{ background: '#1f56d6' }} /> FIR location</span>}
      </div>
    </div>
  );
}

function FlyTo({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus && focus[0] != null) map.flyTo(focus, 10, { duration: 0.8 });
  }, [focus, map]);
  return null;
}
