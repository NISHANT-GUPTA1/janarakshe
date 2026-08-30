import React, { useMemo } from 'react';
import {
  Bar, ClaimTag, Confidence, Crumbs, Delta, Empty, Panel, Spark, Tag, fmt, pClass,
} from '../ops/ui.jsx';

// ===========================================================
// District intelligence drill-down.
//
// Sits at the second level of STATE -> DISTRICT -> STATION ->
// AREA -> PATTERN -> FIR, and every block on the page is a step
// further down that ladder.
// ===========================================================

const RISK_TONE = { Critical: 'CRITICAL', High: 'HIGH', Medium: 'WATCH', Low: 'RESOLVED' };

export default function DistrictIntel({
  district, findings, patterns, queueById, onBack, onOpenFinding,
  onOpenPattern, onOpenCase, onFilterFirs, onMap,
}) {
  if (!district) return <Empty>Select a district.</Empty>;
  const d = district;

  const mine = useMemo(
    () => findings.filter((f) => d.findings.includes(f.finding_id)),
    [findings, d.findings],
  );
  const myPatterns = useMemo(
    () => patterns.filter((p) => p.district === d.name),
    [patterns, d.name],
  );
  const anomalies = mine.filter((f) => f.kind === 'crime_spike' || f.kind === 'unusual_pattern');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Crumbs items={[
        { label: 'Crime Intelligence', onClick: onBack },
        { label: 'Karnataka' },
        { label: d.name },
      ]} />

      {/* ---------------- header ---------------- */}
      <div className={`case-head ${pClass(RISK_TONE[d.risk_band] || 'INFORMATION')}`}>
        <div className="case-head-main">
          <span className="case-no">District intelligence</span>
          <div className="case-title"><h1>{d.name}</h1></div>
          <div className="case-badges">
            <Tag level={RISK_TONE[d.risk_band] || 'INFORMATION'}>{d.risk_band} district crime risk</Tag>
            <span className="chip">{d.hotspot_status === 'none' ? 'Stable' : d.hotspot_status}</span>
            <span className="chip">{fmt(d.crime_rate_per_100k)} per 100k</span>
          </div>
          <p className="muted-note" style={{ maxWidth: 620, marginTop: 4 }}>
            District crime risk is an analytical indicator derived from recorded crime patterns and
            district-level data. It describes the caseload, not the people who live here, and it is
            not a prediction of anyone's behaviour.
          </p>
        </div>

        <div className="stat-line">
          <div>
            <b><Delta pct={d.period.change_pct} /></b>
            <span>Last 30 days</span>
          </div>
          <div><b>{myPatterns.length}</b><span>Active patterns</span></div>
          <div><b>{anomalies.length}</b><span>Anomalies</span></div>
          <div><b>{fmt(d.open_cases)}</b><span>Open FIRs</span></div>
          <div><b>{fmt(d.critical_cases)}</b><span>Critical FIRs</span></div>
        </div>
      </div>

      <div className="grid-main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <Panel
            title="Top crime types"
            note={`Last 30 days vs the 30 before · ${d.period.current} FIRs this period`}
            right={<button className="btn btn-sm" onClick={() => onFilterFirs({ district: d.name })}>
              Open in FIR queue
            </button>}
          >
            {!d.top_crime_types.length && <Empty>No FIRs registered in this district this period.</Empty>}
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Crime type</th><th style={{ textAlign: 'right' }}>This period</th>
                  <th style={{ textAlign: 'right' }}>Previous</th><th>Change</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {d.top_crime_types.map((t) => (
                  <tr key={t.crime_type} onClick={() => onFilterFirs({ district: d.name, crimeType: t.crime_type })}>
                    <td className="strong">{t.crime_type}</td>
                    <td className="num strong">{t.current}</td>
                    <td className="num muted-note">{t.previous}</td>
                    <td>
                      <Delta pct={t.change_pct} />
                      <Spark values={[t.previous, t.current]} w={54} h={15}
                        tone={t.current >= t.previous ? 'var(--ops-up)' : 'var(--ops-down)'} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm"
                        onClick={() => onFilterFirs({ district: d.name, crimeType: t.crime_type })}>
                        View FIRs
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Hotspot areas" note="Localities with the most recorded FIRs">
            {!d.hotspot_areas.length && <Empty>No localities recorded.</Empty>}
            <table className="ops-table">
              <thead>
                <tr>
                  <th>#</th><th>Area</th><th style={{ textAlign: 'right' }}>FIRs</th>
                  <th style={{ textAlign: 'right' }}>Last 30 days</th><th>Dominant offence</th>
                </tr>
              </thead>
              <tbody>
                {d.hotspot_areas.map((a, i) => (
                  <tr key={a.area} style={{ cursor: 'default' }}>
                    <td className="muted-note">{i + 1}</td>
                    <td className="strong">{a.area}</td>
                    <td className="num">{a.cases}</td>
                    <td className="num">
                      {a.recent ? <b className="delta up">{a.recent}</b> : <span className="muted-note">0</span>}
                    </td>
                    <td>{a.top_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {onMap && (
              <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => onMap(d)}>
                View on map
              </button>
            )}
          </Panel>

          <Panel title="Police stations" note="Caseload and open work by station">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Station</th><th style={{ textAlign: 'right' }}>FIRs</th>
                  <th style={{ textAlign: 'right' }}>Open</th>
                  <th style={{ textAlign: 'right' }}>Critical</th><th>Open share</th>
                </tr>
              </thead>
              <tbody>
                {d.stations.map((s) => (
                  <tr key={s.unit_id} onClick={() => onFilterFirs({ district: d.name, station: s.station })}>
                    <td className="strong">{s.station}</td>
                    <td className="num">{s.cases}</td>
                    <td className="num">{s.open}</td>
                    <td className="num">
                      {s.critical ? <b className="delta up">{s.critical}</b> : <span className="muted-note">0</span>}
                    </td>
                    <td><Bar value={s.open} max={s.cases} title={`${s.open} of ${s.cases} open`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="Emerging patterns" note={`${myPatterns.length} in this district`} flush>
            <div className="feed">
              {myPatterns.map((p) => (
                <div key={p.cluster_id} className={`feed-item ${pClass(p.case_count >= 6 ? 'CRITICAL' : 'HIGH')}`}>
                  <div className="feed-top">
                    <Tag level={p.case_count >= 6 ? 'CRITICAL' : 'HIGH'} />
                    <span className="feed-when">{p.window_days}d</span>
                  </div>
                  <div className="feed-title">{p.crime_type}</div>
                  <div className="feed-where">{p.area} · peak {String(p.peak_hour).padStart(2, '0')}:00</div>
                  <div className="feed-metrics">
                    <div className="feed-metric"><b>{p.case_count}</b><span>Incidents</span></div>
                    <div className="feed-metric"><b>{p.baseline}</b><span>Previous</span></div>
                    <div className="feed-metric">
                      <b className="up">{p.change_pct != null ? `+${p.change_pct}%` : 'new'}</b><span>Change</span>
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary" onClick={() => onOpenPattern(p.cluster_id)}>
                    Investigate
                  </button>
                </div>
              ))}
              {!myPatterns.length && <Empty>No emerging pattern in this district.</Empty>}
            </div>
          </Panel>

          <Panel title="Findings" note={`${mine.length} flagged here`} flush>
            <div className="feed">
              {mine.map((f) => (
                <div key={f.finding_id} className={`feed-item ${pClass(f.priority)}`}>
                  <div className="feed-top">
                    <Tag level={f.priority} />
                    <ClaimTag type={f.claim_type} label={f.claim_label} />
                  </div>
                  <div className="feed-title">{f.headline}</div>
                  <div className="feed-metrics">
                    {f.metrics.slice(0, 3).map((m) => (
                      <div className="feed-metric" key={m.label}>
                        <b className={m.tone || ''}>{m.value}</b><span>{m.label}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginBottom: 6 }}><Confidence value={f.confidence} label={f.confidence_label} /></div>
                  <button className="btn btn-sm btn-primary" onClick={() => onOpenFinding(f)}>
                    Why was this flagged?
                  </button>
                </div>
              ))}
              {!mine.length && <Empty>Nothing flagged in this district.</Empty>}
            </div>
          </Panel>

          <Panel title="Long-run trend" note="Recorded cognizable cases, NCRB">
            {d.trend?.length ? (
              <>
                <div className="stat-line" style={{ marginBottom: 10 }}>
                  <div><b>{fmt(d.trend[d.trend.length - 1].total)}</b><span>Latest year</span></div>
                  <div><b><Delta pct={d.yoy_change_pct} /></b><span>Year on year</span></div>
                </div>
                <Spark values={d.trend.map((t) => t.total)} w={250} h={52} />
                <p className="muted-note" style={{ marginTop: 6 }}>
                  {d.trend[0].year}–{d.trend[d.trend.length - 1].year}. The chart supports the
                  numbers above; it is not the finding.
                </p>
              </>
            ) : <Empty>No series available.</Empty>}
          </Panel>

          <Panel title="What drives the risk score" note={`Score ${d.risk_score}`}>
            {d.risk_components?.length ? (
              <table className="ops-table">
                <tbody>
                  {d.risk_components.map((c) => (
                    <tr key={c.name || c.component} style={{ cursor: 'default' }}>
                      <td>{(c.name || c.component || '').replace(/_/g, ' ')}</td>
                      <td><Bar value={c.contribution ?? c.value ?? 0} max={
                        Math.max(...d.risk_components.map((x) => x.contribution ?? x.value ?? 0), 1)
                      } /></td>
                      <td className="num strong">{(c.contribution ?? c.value ?? 0).toFixed?.(1) ?? c.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>Components unavailable.</Empty>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
