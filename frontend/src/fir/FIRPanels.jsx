import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import {
  ActionBar, Bar, Empty, Panel, Skeleton, SummaryStrip, Tag, dateLabel, fmt, pClass, useAsync,
} from '../ops/ui.jsx';

// ===========================================================
// Intelligence alerts.
//
// Not a notification list. Every alert answers three questions —
// what happened, why it matters, what the officer can do — and
// carries the buttons that do it. An alert with nothing to act on
// does not belong here.
// ===========================================================

const SEVERITIES = ['CRITICAL', 'HIGH', 'WATCH', 'INVESTIGATION'];

export function Alerts({ alerts, asOf, queueById, onAct }) {
  const [sev, setSev] = useState(null);

  const counts = useMemo(() => {
    const c = {};
    alerts.forEach((a) => { c[a.severity] = (c[a.severity] || 0) + 1; });
    return c;
  }, [alerts]);

  const shown = sev ? alerts.filter((a) => a.severity === sev) : alerts;

  return (
    <>
      <SummaryStrip
        active={sev}
        onPick={setSev}
        cells={SEVERITIES.map((s) => ({
          key: s, label: s === 'INVESTIGATION' ? 'Investigation' : s,
          value: counts[s] || 0, tone: s,
          note: s === 'INVESTIGATION' ? 'Steps outstanding' : undefined,
        }))}
      />

      <Panel title="Intelligence alerts" note={`${shown.length} actionable`} flush>
        <div className="feed">
          {shown.map((a) => (
            <div key={a.alert_id} className={`feed-item ${pClass(a.severity)}`}>
              <div className="feed-top">
                <Tag level={a.severity} />
                {a.fir_no && <span className="mono muted-note">{a.fir_no}</span>}
                <span className="feed-when">{dateLabel(a.at)}</span>
              </div>
              <div className="feed-title">{a.title}</div>
              <div className="feed-why">{a.why}</div>
              {(a.station || a.district) && (
                <div className="feed-where">{[a.station, a.district].filter(Boolean).join(' · ')}</div>
              )}
              {!!a.evidence.length && (
                <ul className="feed-ev">
                  {a.evidence.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
              <ActionBar actions={a.actions} onAct={(act) => onAct(act, a)} primaryCount={1} size="sm" />
            </div>
          ))}
          {!shown.length && <Empty>No alerts at this severity.</Empty>}
        </div>
      </Panel>
    </>
  );
}

// ===========================================================
// Statistical profile.
//
// The demographic breakdowns that used to sit on the FIR landing
// page live here, out of the investigation workflow. They are kept
// because they are legitimate reporting output — and framed so they
// cannot be read as risk factors, which is exactly what putting them
// next to a live case queue invited.
// ===========================================================

const DEMO_BLOCKS = [
  ['accused_gender', 'Accused — gender'],
  ['accused_age', 'Accused — age band'],
  ['victim_gender', 'Victims — gender'],
  ['complainant_religion', 'Complainants — religion'],
  ['complainant_caste', 'Complainants — caste'],
  ['complainant_occupation', 'Complainants — occupation'],
];

export function StatisticalProfile() {
  const { data, error, loading } = useAsync(
    () => Promise.all([api.firOverview(), api.firStations(), api.firSchema()])
      .then(([overview, stations, schema]) => ({ overview, stations, schema })),
    [],
  );
  const [stationQ, setStationQ] = useState('');
  if (loading) return <Skeleton h={340} />;
  if (error) return <div className="data-note"><b>Error</b><span>{error}</span></div>;

  const d = data.overview;
  const det = d.detection;
  const stationRows = (data.stations?.stations || []).filter(
    (st) => !stationQ
      || st.name.toLowerCase().includes(stationQ.toLowerCase())
      || st.district.toLowerCase().includes(stationQ.toLowerCase()),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="data-note">
        <b>Reporting only</b>
        <span>
          These are aggregate counts of people recorded on FIRs, published for statutory and
          statistical reporting. They describe <b>who appears in records</b>, which reflects
          reporting and registration practice as much as offending. They are <b>not</b> risk
          factors, are not used anywhere in the priority or intelligence layers, and must never
          be used to infer anything about an individual or a community.
        </span>
      </div>

      <div className="grid-2">
        <Panel title="Case lifecycle" note={`${fmt(d.total_cases)} FIRs · ${d.latest_year}`}>
          <div className="stat-line" style={{ marginBottom: 12 }}>
            <div><b>{fmt(d.total_cases)}</b><span>FIR records</span></div>
            <div><b>{Math.round(det.detection_rate * 100)}%</b><span>Detection rate</span></div>
            <div><b>{fmt(det.chargesheeted)}</b><span>Chargesheeted (A)</span></div>
            <div><b>{fmt(det.undetected)}</b><span>Undetected (C)</span></div>
          </div>
          <h4 style={{ marginBottom: 6 }}>By case status</h4>
          <DistTable items={d.by_status} />
          <h4 style={{ margin: '12px 0 6px' }}>Final report type</h4>
          <DistTable items={[
            { label: 'A · Chargesheet', count: det.chargesheeted },
            { label: 'B · False case', count: det.false },
            { label: 'C · Undetected', count: det.undetected },
          ]} />
        </Panel>

        <Panel title="Case composition">
          <h4 style={{ marginBottom: 6 }}>By gravity</h4>
          <DistTable items={d.by_gravity} />
          <h4 style={{ margin: '12px 0 6px' }}>By major crime head</h4>
          <DistTable items={d.by_major_head.slice(0, 8)} />
          <h4 style={{ margin: '12px 0 6px' }}>By case category</h4>
          <DistTable items={d.by_category} />
        </Panel>
      </div>

      {/* Station performance: kept from the previous module, but it belongs with
          reporting rather than in the officer's case queue. */}
      <Panel
        title="Police-station drill-down"
        note={`${data.stations?.total_stations ?? 0} stations`}
        right={(
          <input
            value={stationQ}
            placeholder="Filter by station or district…"
            onChange={(e) => setStationQ(e.target.value)}
            style={{
              height: 28, border: '1px solid var(--ops-line-2)', borderRadius: 4,
              padding: '0 8px', font: 'inherit', minWidth: 200,
            }}
          />
        )}
        flush
      >
        <div className="ops-table-wrap" style={{ maxHeight: 420 }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Station</th><th>District</th><th style={{ textAlign: 'right' }}>FIRs</th>
                <th style={{ textAlign: 'right' }}>Heinous</th><th>Heinous share</th>
                <th>Chargesheet rate</th><th>Top category</th>
              </tr>
            </thead>
            <tbody>
              {stationRows.map((st) => (
                <tr key={st.unit_id} style={{ cursor: 'default' }}>
                  <td className="strong">{st.name}</td>
                  <td>{st.district}</td>
                  <td className="num strong">{fmt(st.cases)}</td>
                  <td className="num">{fmt(st.heinous)}</td>
                  <td>
                    <Bar value={st.heinous_share} max={1} />
                    <span className="sub">{Math.round(st.heinous_share * 100)}%</span>
                  </td>
                  <td>
                    <Bar value={st.detection_rate} max={1} />
                    <span className="sub">{Math.round(st.detection_rate * 100)}%</span>
                  </td>
                  <td className="muted-note">{st.top_category}</td>
                </tr>
              ))}
              {!stationRows.length && (
                <tr><td colSpan={7}><Empty>No station matches that filter.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Demographic breakdown"
        note="Aggregate reporting figures — see the note above"
      >
        <div className="grid-2">
          {DEMO_BLOCKS.map(([key, label]) => (
            <div key={key}>
              <h4 style={{ marginBottom: 6 }}>{label}</h4>
              <DistTable items={(d.demographics[key] || []).slice(0, 8)} />
            </div>
          ))}
        </div>
      </Panel>

      {data.schema && <DataModel schema={data.schema} />}
    </div>
  );
}

// The ER model behind every screen in this module. Kept available — it is what
// makes the record-level analytics auditable — but folded away by default.
function DataModel({ schema }) {
  return (
    <Panel title="Data model" note={`${schema.tables.length} tables · KSP Police FIR System`}>
      <p className="muted-note" style={{ marginBottom: 9 }}>{schema.note}</p>
      <details>
        <summary className="btn-link" style={{ fontSize: '0.78rem' }}>
          Show tables and relationships
        </summary>
        <div style={{ marginTop: 10 }}>
          {schema.crime_no_format && (
            <p className="muted-note" style={{ marginBottom: 9 }}>
              <b>Key format:</b> {schema.crime_no_format}
            </p>
          )}
          <div className="ops-table-wrap" style={{ maxHeight: 340 }}>
            <table className="ops-table">
              <thead><tr><th>Table</th><th>Role</th><th>Columns</th></tr></thead>
              <tbody>
                {schema.tables.map((t) => (
                  <tr key={t.name} style={{ cursor: 'default' }}>
                    <td className="strong mono">{t.name}</td>
                    <td>{t.role}{t.group && <span className="sub">{t.group}</span>}</td>
                    <td className="muted-note" style={{ fontSize: '0.72rem' }}>{t.columns.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4 style={{ margin: '12px 0 6px' }}>Relationships ({schema.relationships.length})</h4>
          <ul className="why-list">
            {schema.relationships.map((r, i) => (
              <li key={i}>
                {typeof r === 'string' ? r : (
                  <span><b>{r.parent}</b> {r.type} <b>{r.child}</b>{' '}
                    <span className="muted-note">via {r.via}</span></span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </Panel>
  );
}

function DistTable({ items }) {
  if (!items?.length) return <Empty>No data.</Empty>;
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <table className="ops-table">
      <tbody>
        {items.map((i) => (
          <tr key={i.label} style={{ cursor: 'default' }}>
            <td style={{ width: '42%' }}>{i.label}</td>
            <td><Bar value={i.count} max={max} /></td>
            <td className="num strong" style={{ width: 64 }}>{fmt(i.count)}</td>
            <td className="num muted-note" style={{ width: 52 }}>
              {Math.round((i.count / total) * 100)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
