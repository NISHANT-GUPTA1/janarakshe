import React, { useEffect, useState } from 'react';
import { api } from './api.js';

// Phase 3: pattern detection (real data) + synthetic offender intelligence.
// The 3D network lives on the dashboard itself (see dash/Dashboard.jsx), so this
// module shows the tabular summary only — no duplicate "open graph" modal.
export default function Intelligence() {
  const [patterns, setPatterns] = useState(null);
  const [repeat, setRepeat] = useState(null);
  const [network, setNetwork] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([api.intelPatterns(), api.intelRepeat(), api.intelNetwork()])
      .then(([p, r, n]) => { setPatterns(p); setRepeat(r); setNetwork(n); })
      .catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="error">Intelligence API error: {err}</div>;
  if (!patterns) return <p className="hint">Loading intelligence…</p>;

  return (
    <div className="cols">
      <section className="panel">
        <h2>Crime pattern clusters <span className="year">(ML · real data {patterns.latest_year})</span></h2>
        <p className="hint">Districts grouped by crime-type signature (K-means on category mix).</p>
        {patterns.clusters.map((c) => (
          <div key={c.cluster} className="cluster">
            <div className="cluster-head">
              <span className="band" style={{ background: '#3a4a6b' }}>Cluster {c.cluster}</span>
              <b>{c.dominant_groups.join(' + ')}</b> <span className="muted">· {c.size} districts</span>
            </div>
            <div className="muted small">{c.districts.join(', ')}</div>
          </div>
        ))}

        <h3>Anomalies <span className="year">(year-over-year z ≥ 1.8)</span></h3>
        <div className="scroll" style={{ maxHeight: 220 }}>
          <table>
            <thead><tr><th>District</th><th>Year</th><th>Type</th><th>z</th><th>Cases</th></tr></thead>
            <tbody>
              {patterns.anomalies.map((a, i) => (
                <tr key={i}>
                  <td>{a.name}</td><td>{a.year}</td>
                  <td><span className={a.direction === 'spike' ? 'spike' : 'drop'}>{a.direction}</span></td>
                  <td>{a.zscore}</td><td>{a.cases.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Repeat offenders & network</h2>
        <div className="synthetic-tag">⚠ Synthetic data — no open person-level crime data exists (PII). Anchored to real district volumes.</div>
        <div className="kpis">
          <Kpi label="Offenders" value={repeat.total_offenders} />
          <Kpi label="Repeat (≥2)" value={`${repeat.repeat_offenders} (${(repeat.repeat_ratio * 100).toFixed(0)}%)`} />
          <Kpi label="Network nodes" value={network.summary.nodes} />
          <Kpi label="Co-offence links" value={network.summary.edges} />
        </div>

        <h3>Top repeat offenders</h3>
        <div className="scroll" style={{ maxHeight: 200 }}>
          <table>
            <thead><tr><th>ID</th><th>District</th><th>Cases</th><th>Co-off.</th><th>Active</th></tr></thead>
            <tbody>
              {repeat.top.slice(0, 12).map((o) => (
                <tr key={o.entity_id}>
                  <td>{o.name}</td><td>{o.district}</td><td>{o.incident_count}</td>
                  <td>{o.degree}</td><td className="muted small">{o.first_seen?.slice(0, 4)}–{o.last_seen?.slice(0, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Network <span className="year">({network.summary.components} clusters, largest {network.summary.largest_component})</span></h3>
        <ul className="components">
          {network.top_central_offenders.slice(0, 6).map((o) => (
            <li key={o.entity_id}><span>{o.name} · {o.district}</span> <b>{o.co_offenders} links</b></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const Kpi = ({ label, value }) => (
  <div className="kpi"><div className="kpi-val">{value}</div><div className="kpi-label">{label}</div></div>
);
