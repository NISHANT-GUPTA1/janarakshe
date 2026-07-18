import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

// ===========================================================
// Phase 7 — FIR-record intelligence, modelled on the KSP Police
// FIR System ER schema. Record-level analytics (station drill-down,
// spatiotemporal hotspots, real co-accused network, repeat-offender
// MO, case lifecycle) that the open NCRB aggregates cannot provide.
// ===========================================================

const FIR_TABS = [
  { id: 'overview', label: 'Case Lifecycle' },
  { id: 'hotspots', label: 'Spatiotemporal Hotspots' },
  { id: 'network', label: 'Crime Network' },
  { id: 'offenders', label: 'Repeat Offenders & MO' },
  { id: 'stations', label: 'Station Drill-down' },
  { id: 'cases', label: 'Case Records' },
  { id: 'schema', label: 'Data Model' },
];

export default function FIRIntelligence() {
  const [tab, setTab] = useState('overview');
  return (
    <div>
      <div className="synthetic-tag">
        ⚠ Schema-shaped <b>synthetic</b> FIR records (KSP Police FIR System ER model) — real
        record-level data is confidential. Anchored to real district crime volumes &amp; mix; deterministic.
      </div>
      <div className="subnav subnav-2">
        {FIR_TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Lifecycle />}
      {tab === 'hotspots' && <Hotspots />}
      {tab === 'network' && <Network />}
      {tab === 'offenders' && <Offenders />}
      {tab === 'stations' && <Stations />}
      {tab === 'cases' && <CaseRecords />}
      {tab === 'schema' && <DataModel />}
    </div>
  );
}

// small async loader hook
function useFir(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    fn().then((d) => live && setData(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [data, err];
}

const Kpi = ({ label, value }) => (
  <div className="kpi"><div className="kpi-val">{value}</div><div className="kpi-label">{label}</div></div>
);

// horizontal labelled bar list (reuses .bars styling)
function BarList({ items, max, color }) {
  const m = max || Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="bars">
      {items.map((i) => (
        <div key={i.label} className="bar-row">
          <span className="bar-label" title={i.label}>{i.label}</span>
          <div className="bar" style={{ width: `${(i.count / m) * 100}%`, background: color }} />
          <span className="bar-val">{i.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------- Case Lifecycle
function Lifecycle() {
  const [d, err] = useFir(api.firOverview);
  if (err) return <div className="error">FIR API error: {err}</div>;
  if (!d) return <p className="hint">Loading case lifecycle…</p>;
  const det = d.detection;
  return (
    <div className="cols">
      <section className="panel">
        <h2>Case lifecycle &amp; detection <span className="year">({d.latest_year})</span></h2>
        <div className="kpis">
          <Kpi label="FIR records" value={d.total_cases.toLocaleString()} />
          <Kpi label="Detection rate" value={`${(det.detection_rate * 100).toFixed(0)}%`} />
          <Kpi label="Chargesheeted (A)" value={det.chargesheeted} />
          <Kpi label="Undetected (C)" value={det.undetected} />
        </div>
        <h3>By case status</h3>
        <BarList items={d.by_status} color="#4f9dff" />
        <h3>Final report type</h3>
        <ul className="components">
          <li><span>A · Chargesheet</span><b>{det.chargesheeted}</b></li>
          <li><span>B · False case</span><b>{det.false}</b></li>
          <li><span>C · Undetected</span><b>{det.undetected}</b></li>
        </ul>
      </section>

      <section className="panel">
        <h2>Composition</h2>
        <h3>By gravity</h3>
        <BarList items={d.by_gravity} color="#e8730c" />
        <h3>By major crime head</h3>
        <BarList items={d.by_major_head.slice(0, 8)} color="#7c5cff" />
        <h3>By case category</h3>
        <BarList items={d.by_category} color="#1ec98b" />
      </section>

      <section className="panel">
        <h2>Demographics <span className="year">(case-level)</span></h2>
        <div className="demo-grid">
          <DemoBlock title="Accused — gender" items={d.demographics.accused_gender} />
          <DemoBlock title="Accused — age band" items={d.demographics.accused_age} />
          <DemoBlock title="Complainant — religion" items={d.demographics.complainant_religion} />
          <DemoBlock title="Complainant — caste" items={d.demographics.complainant_caste} />
          <DemoBlock title="Complainant — occupation" items={d.demographics.complainant_occupation.slice(0, 6)} />
          <DemoBlock title="Victim — gender" items={d.demographics.victim_gender} />
        </div>
      </section>
    </div>
  );
}

const DemoBlock = ({ title, items }) => (
  <div className="demo-block">
    <h4>{title}</h4>
    <BarList items={items} color="#36c5d8" />
  </div>
);

// ---------------------------------------------------------- Spatiotemporal
function Hotspots() {
  const [d, err] = useFir(api.firSpatiotemporal);
  if (err) return <div className="error">FIR API error: {err}</div>;
  if (!d) return <p className="hint">Loading spatiotemporal hotspots…</p>;
  const maxHour = Math.max(...d.hour_histogram, 1);
  const peak = d.hour_histogram.indexOf(maxHour);
  return (
    <>
      <section className="panel">
        <h2>Spatiotemporal hotspots <span className="year">(GPS × time-of-day)</span></h2>
        <p className="hint">
          Every dot is an FIR's incident location; bigger amber rings are grid hotspots.
          Peak offence hour overall: <b>{fmtHour(peak)}</b>.
        </p>
        <ScatterMap points={d.points} hotspots={d.hotspots} />
      </section>

      <div className="cols">
        <section className="panel">
          <h2>Offences by time of day</h2>
          <div className="hour-bars">
            {d.hour_histogram.map((v, h) => (
              <div className="hour-col" key={h} title={`${fmtHour(h)} — ${v} cases`}>
                <div className="hour-fill" style={{ height: `${(v / maxHour) * 100}%` }} />
                <span className="hour-x">{h}</span>
              </div>
            ))}
          </div>
          <p className="muted small">Hour of day (0–23). Offences skew to evening &amp; late night.</p>
        </section>

        <section className="panel">
          <h2>Top hotspot cells</h2>
          <div className="scroll" style={{ maxHeight: 320 }}>
            <table>
              <thead><tr><th>District</th><th>Lat, Lon</th><th>Cases</th><th>Heinous</th><th>Peak hr</th></tr></thead>
              <tbody>
                {d.hotspots.map((h, i) => (
                  <tr key={i}>
                    <td>{h.district}</td>
                    <td className="muted small">{h.lat.toFixed(2)}, {h.lon.toFixed(2)}</td>
                    <td>{h.count}</td><td>{h.heinous}</td><td>{fmtHour(h.peak_hour)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

// dependency-free scatter "map": project lat/lon into a box (Karnataka bbox).
function ScatterMap({ points, hotspots }) {
  const box = useMemo(() => {
    const all = [...points, ...hotspots];
    const lats = all.map((p) => p.lat), lons = all.map((p) => p.lon);
    return { minLat: Math.min(...lats), maxLat: Math.max(...lats),
             minLon: Math.min(...lons), maxLon: Math.max(...lons) };
  }, [points, hotspots]);
  const W = 720, H = 460, pad = 18;
  const x = (lon) => pad + ((lon - box.minLon) / (box.maxLon - box.minLon || 1)) * (W - 2 * pad);
  const y = (lat) => H - pad - ((lat - box.minLat) / (box.maxLat - box.minLat || 1)) * (H - 2 * pad);
  const color = (g) => (g === 'Heinous' ? '#e50914' : '#4f9dff');
  const maxC = Math.max(...hotspots.map((h) => h.count), 1);
  return (
    <div className="scatter-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="scatter-map" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width={W} height={H} fill="#0b1220" rx="10" />
        {hotspots.map((h, i) => (
          <circle key={`h${i}`} cx={x(h.lon)} cy={y(h.lat)} r={6 + (h.count / maxC) * 26}
            fill="rgba(245,179,1,0.10)" stroke="rgba(245,179,1,0.55)" strokeWidth="1.2" />
        ))}
        {points.map((p, i) => (
          <circle key={`p${i}`} cx={x(p.lon)} cy={y(p.lat)} r="2.1" fill={color(p.gravity)} fillOpacity="0.75" />
        ))}
      </svg>
      <div className="scatter-legend">
        <span><i className="dot" style={{ background: '#e50914' }} /> Heinous</span>
        <span><i className="dot" style={{ background: '#4f9dff' }} /> Non-Heinous</span>
        <span><i className="ring" /> Hotspot cell</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- Crime Network
// The interactive 3D graph is rendered on the dashboard (dash/Dashboard.jsx).
// This panel is the tabular read-out of the same network, so it no longer
// duplicates it behind an "open graph" modal.
function Network() {
  const [d, err] = useFir(api.firNetwork);
  if (err) return <div className="error">FIR network API error: {err}</div>;
  if (!d) return <p className="hint">Loading co-accused network…</p>;
  const s = d.summary;
  return (
    <section className="panel">
      <h2>Co-accused network &amp; link analysis</h2>
      <p className="hint">
        Built from <b>real co-accused relationships</b> in the FIR records — people named in the
        same case are linked. Connected colours = the same crew.
      </p>
      <div className="kpis">
        <Kpi label="Persons (nodes)" value={s.nodes} />
        <Kpi label="Co-accused links" value={s.edges} />
        <Kpi label="Crews" value={s.components} />
        <Kpi label="Largest crew" value={s.largest_component} />
      </div>
      <h3>Most connected offenders</h3>
      <ul className="components">
        {d.top_central_offenders.map((o) => (
          <li key={o.entity_id}><span>{o.name} · {o.district}</span><b>{o.co_offenders} links</b></li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------- Repeat Offenders & MO
function Offenders() {
  const [d, err] = useFir(api.firOffenders);
  if (err) return <div className="error">FIR offenders API error: {err}</div>;
  if (!d) return <p className="hint">Loading repeat-offender profiles…</p>;
  return (
    <section className="panel">
      <h2>Repeat offenders &amp; Modus Operandi</h2>
      <div className="kpis">
        <Kpi label="Distinct accused" value={d.total_accused} />
        <Kpi label="Repeat (≥2 cases)" value={`${d.repeat_offenders} (${(d.repeat_ratio * 100).toFixed(0)}%)`} />
      </div>
      <div className="scroll" style={{ maxHeight: 460 }}>
        <table>
          <thead>
            <tr><th>Offender</th><th>District</th><th>Cases</th><th>Co-acc.</th>
              <th>Jurisd.</th><th>MO (top head)</th><th>Top sections</th><th>Peak hr</th><th>Heinous</th></tr>
          </thead>
          <tbody>
            {d.top.map((o) => (
              <tr key={o.person_id}>
                <td>{o.name} <span className="muted small">{o.gender}/{o.age_band}</span></td>
                <td>{o.district}</td>
                <td><b>{o.cases}</b></td>
                <td>{o.co_offenders}</td>
                <td>{o.jurisdictions}</td>
                <td>{o.mo}</td>
                <td className="muted small">{o.top_sections.join(', ') || '—'}</td>
                <td>{fmtHour(o.peak_hour)}</td>
                <td>{o.heinous_cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        MO = the offender's most frequent crime sub-head across their cases; jurisdictions = distinct
        police stations they appear in (cross-jurisdiction tracking).
      </p>
    </section>
  );
}

// ---------------------------------------------------------- Station Drill-down
function Stations() {
  const [d, err] = useFir(api.firStations);
  const [q, setQ] = useState('');
  if (err) return <div className="error">FIR stations API error: {err}</div>;
  if (!d) return <p className="hint">Loading station drill-down…</p>;
  const rows = d.stations.filter(
    (s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.district.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <section className="panel">
      <h2>Police-station drill-down <span className="year">({d.total_stations} stations)</span></h2>
      <div className="gs-box" style={{ maxWidth: 320, marginBottom: 12 }}>
        <span className="gs-icon">🔍</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by station or district…" />
        {q && <button className="gs-clear" onClick={() => setQ('')}>✕</button>}
      </div>
      <div className="scroll" style={{ maxHeight: 460 }}>
        <table>
          <thead>
            <tr><th>Station</th><th>District</th><th>Cases</th><th>Heinous</th>
              <th>Heinous %</th><th>Detection %</th><th>Top category</th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.unit_id}>
                <td>{s.name}</td><td>{s.district}</td><td><b>{s.cases}</b></td>
                <td>{s.heinous}</td>
                <td>{(s.heinous_share * 100).toFixed(0)}%</td>
                <td>{(s.detection_rate * 100).toFixed(0)}%</td>
                <td className="muted small">{s.top_category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------- Case Records
function CaseRecords() {
  const [d, err] = useFir(api.firCases);
  if (err) return <div className="error">FIR cases API error: {err}</div>;
  if (!d) return <p className="hint">Loading case records…</p>;
  return (
    <section className="panel">
      <h2>FIR case records <span className="year">(sample of CaseMaster)</span></h2>
      <p className="hint">Raw record-level rows — the grain the platform analyses, impossible from Excel silos.</p>
      <div className="scroll" style={{ maxHeight: 480 }}>
        <table className="mono-table">
          <thead>
            <tr><th>Crime No</th><th>Cat</th><th>Major head</th><th>Sub head</th>
              <th>Act</th><th>Sec</th><th>Gravity</th><th>Status</th><th>District</th><th>Hr</th></tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={i}>
                <td className="muted small">{r.crime_no}</td>
                <td>{r.category}</td><td>{r.crime_major_head}</td><td>{r.crime_minor_head}</td>
                <td>{r.act}</td><td>{r.section || '—'}</td>
                <td>{r.gravity === 'Heinous'
                  ? <span className="band" style={{ background: '#d23b3b' }}>Heinous</span>
                  : <span className="muted small">Non-Heinous</span>}</td>
                <td className="muted small">{r.status}</td>
                <td>{r.district}</td><td>{fmtHour(r.hour)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------- Data Model
function DataModel() {
  const [d, err] = useFir(api.firSchema);
  if (err) return <div className="error">FIR schema API error: {err}</div>;
  if (!d) return <p className="hint">Loading data model…</p>;
  return (
    <>
      <section className="panel">
        <h2>{d.title}</h2>
        <p className="hint">{d.note}</p>
      </section>
      {d.crime_no_format && (
        <section className="panel">
          <h3>Key format</h3>
          <p className="hint">{d.crime_no_format}</p>
        </section>
      )}
      <section className="panel">
        <h3>Tables <span className="hint">({d.tables.length})</span></h3>
        <div className="unit-grid">
          {d.tables.map((t) => (
            <div className="unit-card" key={t.name}>
              <div className="unit-name">{t.name}{t.group ? <span className="hint"> · {t.group}</span> : null}</div>
              <div className="unit-desc">{t.role}</div>
              <div className="schema-cols">{t.columns.join(' · ')}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Relationships <span className="hint">({d.relationships.length})</span></h3>
        <ul className="bullet">
          {d.relationships.map((r, i) => (
            <li key={i}>
              {typeof r === 'string'
                ? r
                : <><b>{r.parent}</b> {r.type} <b>{r.child}</b> <span className="hint">via {r.via}</span></>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function fmtHour(h) {
  if (h == null) return '—';
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${am ? 'am' : 'pm'}`;
}
