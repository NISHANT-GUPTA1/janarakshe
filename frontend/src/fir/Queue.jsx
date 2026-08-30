import React, { useEffect, useMemo, useState } from 'react';
import {
  Delta, Field, Pager, Panel, Pips, Select, SortHead, SummaryStrip, Tag,
  dateLabel, fmt, pClass, relDays, useSortPage,
} from '../ops/ui.jsx';

// ===========================================================
// The FIR work queue.
//
// This is a duty list, not a report. It opens on what needs the
// officer's attention, and everything below it is the same set of
// cases seen through whichever filter they chose. There is exactly
// one number on this screen the officer cannot act on, and that is
// the total.
// ===========================================================

const DATE_RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
];

const STATUS_TONE = {
  'Under Investigation': 'warn',
  'Charge Sheeted': 'ok',
  'Pending Trial': '',
  Disposed: 'ok',
  Closed: '',
};

const SAVED_FILTERS = [
  { id: 'mine-critical', label: 'Critical & unworked', apply: { bucket: 'critical', status: 'Under Investigation' } },
  { id: 'sla', label: 'SLA at risk', apply: { bucket: 'sla_risk' } },
  { id: 'stalled', label: 'Stalled 14+ days', apply: { bucket: 'attention' } },
  { id: 'heinous', label: 'Heinous, open', apply: { gravity: 'Heinous', status: 'Under Investigation' } },
];

const EMPTY = {
  q: '', district: '', station: '', crimeType: '', priority: '', status: '',
  range: '', gravity: '', bucket: null,
};

export default function Queue({ queue, initialFilter, onOpenCase, onOpenPattern, onAct }) {
  const [f, setF] = useState(EMPTY);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  // Seeded from a Crime Intelligence handoff. `at` is a timestamp so the same
  // filter arriving twice still re-applies.
  useEffect(() => {
    if (!initialFilter) return;
    const { at, ...rest } = initialFilter;
    setF({ ...EMPTY, ...rest });
  }, [initialFilter]);

  const asOf = queue.as_of;
  const buckets = queue.buckets || {};

  // A bucket click is a filter, not a navigation: the queue below re-scopes and
  // the strip shows which one is active, so the officer never loses their place.
  const bucketSet = useMemo(
    () => (f.bucket && buckets[f.bucket] ? new Set(buckets[f.bucket]) : null),
    [f.bucket, buckets],
  );

  const rows = useMemo(() => {
    const term = f.q.trim().toLowerCase();
    const cutoff = f.range
      ? new Date(new Date(`${asOf}T00:00:00`).getTime() - Number(f.range) * 86400000)
      : null;
    return queue.rows.filter((r) => {
      if (bucketSet && !bucketSet.has(r.fir_id)) return false;
      if (f.district && r.district !== f.district) return false;
      if (f.station && r.station !== f.station) return false;
      if (f.crimeType && r.crime_type !== f.crimeType) return false;
      if (f.priority && r.priority !== f.priority) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.gravity && r.gravity !== f.gravity) return false;
      if (cutoff && new Date(`${r.occurred_at.slice(0, 10)}T00:00:00`) < cutoff) return false;
      if (term) {
        const hay = `${r.fir_no} ${r.crime_type} ${r.station} ${r.location} ${r.complainant} `
          + `${r.accused.join(' ')} ${r.io} ${r.status}`;
        if (!hay.toLowerCase().includes(term)) return false;
      }
      return true;
    });
  }, [queue.rows, f, bucketSet, asOf]);

  const { slice, sort, toggle, page, pages, setPage, total, pageSize } =
    useSortPage(rows, { key: 'priority', dir: 'asc', get: (r) => ['CRITICAL', 'HIGH', 'WATCH', 'INFO', 'RESOLVED'].indexOf(r.priority) }, 25);

  const s = queue.summary;
  const cells = [
    { key: 'critical', label: 'Critical', value: s.critical, tone: 'CRITICAL', note: 'Immediate attention' },
    { key: 'high', label: 'High', value: s.high, tone: 'HIGH', note: 'Requires investigation' },
    { key: 'watch', label: 'Watch', value: s.watch, tone: 'WATCH', note: 'Emerging concern' },
    { key: 'attention', label: 'Needs attention', value: s.attention, tone: 'HIGH', note: `No activity ${queue.stale_days}d+` },
    { key: 'sla_risk', label: 'SLA at risk', value: s.sla_risk, tone: 'CRITICAL', note: `${queue.sla_days}-day window` },
    { key: 'recent', label: 'Updated this week', value: s.recent, tone: 'INFORMATION', note: 'Last 7 days' },
  ];

  const activeFilters = Object.entries(f).filter(([k, v]) => v && k !== 'q').length;

  return (
    <>
      {/* -------- filters -------- */}
      <div className="filterbar">
        <Field label="Find in queue">
          <input
            value={f.q}
            placeholder="FIR no, person, station, location…"
            onChange={(e) => set('q', e.target.value)}
            style={{ minWidth: 210 }}
          />
        </Field>
        <Field label="District">
          <Select value={f.district} onChange={(v) => set('district', v)}
            options={queue.facets.districts} all="All districts" />
        </Field>
        <Field label="Police station">
          <Select
            value={f.station}
            onChange={(v) => set('station', v)}
            options={queue.facets.stations.filter(
              (st) => !f.district || queue.rows.some((r) => r.station === st.value && r.district === f.district),
            )}
            all="All stations"
          />
        </Field>
        <Field label="Date range">
          <Select value={f.range} onChange={(v) => set('range', v)} options={DATE_RANGES} all="All time" />
        </Field>
        <Field label="Crime type">
          <Select value={f.crimeType} onChange={(v) => set('crimeType', v)}
            options={queue.facets.crime_types} all="All crime types" />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(v) => set('priority', v)}
            options={queue.facets.priorities} all="All priorities" />
        </Field>
        <Field label="Investigation status">
          <Select value={f.status} onChange={(v) => set('status', v)}
            options={queue.facets.statuses} all="All statuses" />
        </Field>
        {activeFilters > 0 && (
          <button className="btn" onClick={() => setF(EMPTY)}>Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}</button>
        )}
      </div>

      {/* -------- what needs attention -------- */}
      <SummaryStrip cells={cells} active={f.bucket} onPick={(k) => set('bucket', k)} />

      <div className="btn-row" style={{ alignItems: 'center' }}>
        <span className="muted-note" style={{ fontWeight: 650 }}>Saved views:</span>
        {SAVED_FILTERS.map((sf) => (
          <button key={sf.id} className="btn btn-sm"
            onClick={() => setF({ ...EMPTY, ...sf.apply })}>{sf.label}</button>
        ))}
      </div>

      {/* -------- emerging patterns -------- */}
      {!!queue.patterns?.length && (
        <Panel
          title="Emerging patterns"
          note={`${queue.patterns.length} detected across the last ${queue.patterns[0].window_days} days`}
          flush
        >
          <div className="feed">
            {queue.patterns.map((p) => (
              <div key={p.cluster_id} className={`feed-item ${pClass(p.case_count >= 6 ? 'CRITICAL' : 'HIGH')}`}>
                <div className="feed-top">
                  <Tag level={p.case_count >= 6 ? 'CRITICAL' : 'HIGH'} />
                  <span className="feed-title" style={{ margin: 0 }}>
                    {p.crime_type} · {p.district}
                  </span>
                  <span className="feed-when">{p.window_days}-day window</span>
                </div>
                <div className="feed-where">Concentrated around {p.area} · peak {String(p.peak_hour).padStart(2, '0')}:00</div>
                <div className="feed-metrics">
                  <div className="feed-metric"><b>{p.case_count}</b><span>Incidents</span></div>
                  <div className="feed-metric"><b>{p.baseline}</b><span>Previous period</span></div>
                  <div className="feed-metric">
                    <b className="up">{p.change_pct != null ? `+${p.change_pct}%` : 'new'}</b>
                    <span>Change</span>
                  </div>
                  <div className="feed-metric"><b>{Math.round(p.confidence * 100)}%</b><span>Confidence</span></div>
                </div>
                <div className="btn-row">
                  <button className="btn btn-sm btn-primary" onClick={() => onOpenPattern(p.cluster_id)}>
                    Investigate pattern
                  </button>
                  <button className="btn btn-sm" onClick={() => setF({ ...EMPTY, district: p.district, crimeType: p.crime_type })}>
                    Filter queue to these
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* -------- the queue -------- */}
      <Panel
        title="FIR case queue"
        note={`${fmt(total)} of ${fmt(queue.rows.length)} cases`}
        right={<span className="muted-note">Sorted by {sort?.key === 'priority' ? 'priority' : sort?.key} · click a row to open the case file</span>}
        flush
      >
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <SortHead label="Priority" k="priority" sort={sort} onSort={toggle}
                  get={(r) => ['CRITICAL', 'HIGH', 'WATCH', 'INFO', 'RESOLVED'].indexOf(r.priority)} />
                <SortHead label="FIR number" k="fir_no" sort={sort} onSort={toggle} />
                <SortHead label="Crime type" k="crime_type" sort={sort} onSort={toggle} />
                <SortHead label="Date / time" k="occurred_at" sort={sort} onSort={toggle} />
                <SortHead label="Station / location" k="station" sort={sort} onSort={toggle} />
                <SortHead label="Complainant" k="complainant" sort={sort} onSort={toggle} />
                <SortHead label="Accused" k="accused_count" sort={sort} onSort={toggle} num />
                <SortHead label="Investigating officer" k="io" sort={sort} onSort={toggle} />
                <SortHead label="Status" k="status" sort={sort} onSort={toggle} />
                <SortHead label="Progress" k="stage_done" sort={sort} onSort={toggle} num />
                <SortHead label="Last activity" k="days_since_activity" sort={sort} onSort={toggle} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.fir_id} className={pClass(r.priority)} onClick={() => onOpenCase(r.fir_id)}>
                  <td className="row-spine">
                    <Tag level={r.priority} title={r.priority_reasons.join(' · ')} />
                  </td>
                  <td className="strong mono">{r.fir_no}</td>
                  <td className="strong">
                    {r.crime_type}
                    <span className="sub">{r.major_head}{r.gravity === 'Heinous' ? ' · Heinous' : ''}</span>
                  </td>
                  <td>
                    {dateLabel(r.occurred_at)}
                    <span className="sub">{r.occurred_at.slice(11, 16)} hrs</span>
                  </td>
                  <td>
                    {r.station}
                    <span className="sub">{r.location}</span>
                  </td>
                  <td>{r.complainant}</td>
                  <td className="num">
                    {r.accused_count || '—'}
                    {!!r.accused.length && <span className="sub">{r.accused[0]}{r.accused_count > 1 ? ` +${r.accused_count - 1}` : ''}</span>}
                  </td>
                  <td>{r.io}</td>
                  <td>
                    <span className={`chip ${STATUS_TONE[r.status] || ''}`}>{r.status}</span>
                    {r.sla_state === 'breached' && <span className="sub" style={{ color: 'var(--p-critical)', fontWeight: 650 }}>SLA +{Math.abs(r.sla_days_left)}d</span>}
                    {r.sla_state === 'due' && <span className="sub" style={{ color: 'var(--p-high)', fontWeight: 650 }}>SLA in {r.sla_days_left}d</span>}
                  </td>
                  <td className="num"><Pips done={r.stage_done} total={r.stage_total} /></td>
                  <td>
                    {r.last_activity}
                    <span className="sub">{relDays(r.last_activity_at, asOf)}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="btn-row">
                      <button className="btn btn-sm btn-primary" onClick={() => onOpenCase(r.fir_id)}>Open</button>
                      <button className="btn btn-sm" onClick={() => onAct({ kind: 'update_case', label: 'Update case' }, r)}>Update</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!slice.length && (
                <tr><td colSpan={12}><div className="empty">No cases match these filters.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={total} pageSize={pageSize} noun="FIRs" />
      </Panel>
    </>
  );
}
