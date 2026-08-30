import React, { useMemo, useState } from 'react';
import {
  ActionBar, Bar, ClaimTag, Confidence, Crumbs, Empty, Pager, Panel, SortHead,
  SummaryStrip, Tag, WhyPanel, fmt, pClass, useSortPage,
} from '../ops/ui.jsx';

// ===========================================================
// Finding investigation view.
//
// The generic counterpart to PatternView: opened for any finding
// that is not an FIR cluster — a spike, an outlier, a projection.
// Same spine: what we found, why it was flagged, what backs it,
// what to do, and what the method cannot tell you.
// ===========================================================

export function FindingView({ finding, districtIntel, onBack, onAct, onOpenDistrict }) {
  if (!finding) return <Empty>Finding not found.</Empty>;
  const d = finding.where?.geo_unit_id ? districtIntel?.[finding.where.geo_unit_id] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Crumbs items={[{ label: 'Crime Intelligence', onClick: onBack }, { label: finding.finding_id }]} />

      <div className={`case-head ${pClass(finding.priority)}`}>
        <div className="case-head-main">
          <span className="case-no">{finding.finding_id} · {finding.kind.replace(/_/g, ' ')}</span>
          <div className="case-title"><h1 style={{ textTransform: 'none' }}>{finding.headline}</h1></div>
          {finding.where?.district && (
            <div className="case-where">
              {finding.where.area || finding.where.district}
              {finding.when?.year ? ` · ${finding.when.year}` : ''}
              {finding.when?.window_days ? ` · ${finding.when.window_days}-day window` : ''}
            </div>
          )}
          <div className="case-badges">
            <Tag level={finding.priority} lg />
            <ClaimTag type={finding.claim_type} label={finding.claim_label} />
            <Confidence value={finding.confidence} label={finding.confidence_label} />
          </div>
        </div>
        <ActionBar actions={finding.actions} onAct={(a) => onAct(a, finding)} primaryCount={1} />
      </div>

      {finding.claim_type === 'prediction' && (
        <div className="data-note">
          <b>Projection</b>
          <span>
            This is a model projection from past totals, not something that has happened. It
            assumes the previous trend continues and takes no account of policing changes.
            Do not plan against it without the underlying series.
          </span>
        </div>
      )}

      <div className="grid-case">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="What we found">
            <p style={{ marginBottom: 12 }}>{finding.summary}</p>
            <div className="stat-line">
              {finding.metrics.map((m) => (
                <div key={m.label}>
                  <b className={m.tone === 'up' ? 'delta up' : m.tone === 'down' ? 'delta down' : ''}>
                    {m.value}
                  </b>
                  <span>{m.label}</span>
                </div>
              ))}
            </div>
          </Panel>

          {d && (
            <Panel
              title={`District context — ${d.name}`}
              right={<button className="btn btn-sm btn-primary" onClick={() => onOpenDistrict(d.geo_unit_id)}>
                Open district intelligence
              </button>}
            >
              <div className="stat-line" style={{ marginBottom: 12 }}>
                <div><b>{d.risk_band}</b><span>District crime risk</span></div>
                <div><b>{d.crime_rate_per_100k}</b><span>Rate / 100k</span></div>
                <div><b>{fmt(d.open_cases)}</b><span>Open FIRs</span></div>
                <div><b>{fmt(d.critical_cases)}</b><span>Critical FIRs</span></div>
              </div>
              {!!d.top_crime_types.length && (
                <>
                  <h4 style={{ marginBottom: 6 }}>Top crime types, last 30 days</h4>
                  <table className="ops-table">
                    <tbody>
                      {d.top_crime_types.slice(0, 5).map((t) => (
                        <tr key={t.crime_type} style={{ cursor: 'default' }}>
                          <td className="strong">{t.crime_type}</td>
                          <td className="num">{t.current}</td>
                          <td className="num muted-note">was {t.previous}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Panel>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="Why this was flagged">
            <WhyPanel
              signals={finding.signals}
              action={finding.actions[0] ? `Start with “${finding.actions[0].label}”.` : null}
              method={finding.method}
            />
          </Panel>
          <Panel title="Actions">
            <ActionBar actions={finding.actions} onAct={(a) => onAct(a, finding)} primaryCount={0} size="sm" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ===========================================================
// Crime profiles — the K-means district grouping, in the officer's
// language. The algorithm's name and its silhouette score are still
// here; they are inside "Technical details", where they belong.
// ===========================================================

export function Profiles({ profiles, onOpenDistrict }) {
  const { profiles: list, method } = profiles;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel
        title="Crime profiles"
        note="Districts grouped by the shape of their recorded caseload"
      >
        <p className="muted-note" style={{ marginBottom: 12 }}>
          Districts in the same profile report a similar mix of crime — not a similar amount, and
          nothing about the people who live there. The grouping is useful for comparison: if two
          districts share a profile but not a crime trend, the difference is worth a look.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 12 }}>
          {list.map((p) => (
            <div key={p.profile_id} className="panel-ops" style={{ borderRadius: 4 }}>
              <div className="panel-body">
                <h3 style={{ marginBottom: 3 }}>{p.label}</h3>
                <div className="muted-note" style={{ marginBottom: 9 }}>
                  {p.size} districts · average {fmt(p.avg_rate)}/100k
                  {p.rate_range && ` (range ${fmt(p.rate_range[0])}–${fmt(p.rate_range[1])})`}
                </div>
                <h4 style={{ marginBottom: 5 }}>Common characteristics</h4>
                <ul className="why-list" style={{ marginBottom: 9 }}>
                  {p.characteristics.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
                <div className="btn-row" style={{ marginBottom: 9 }}>
                  {p.risk_bands.map((b) => (
                    <span key={b.band} className="chip">{b.count} × {b.band} risk</span>
                  ))}
                </div>
                <details>
                  <summary className="btn-link" style={{ fontSize: '0.76rem' }}>
                    View districts ({p.districts.length})
                  </summary>
                  <div className="btn-row" style={{ marginTop: 7 }}>
                    {p.districts.map((n) => (
                      <button key={n} className="btn btn-sm" onClick={() => onOpenDistrict(n)}>{n}</button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Technical details">
        <div style={{ fontSize: '0.82rem', marginBottom: 8 }}>
          <b>{method.name}.</b> {method.detail}
        </div>
        <div className="stat-line" style={{ marginBottom: 10 }}>
          <div><b>{method.quality.districts}</b><span>Districts</span></div>
          <div><b>{method.quality.features}</b><span>Features</span></div>
          <div><b>{method.quality.silhouette}</b><span>Silhouette</span></div>
          <div><b>{Math.round(method.quality.pca_variance * 100)}%</b><span>PCA variance</span></div>
        </div>
        <div className="why-caveat"><b>Read with care</b>{method.quality.reading} {method.caveat}</div>
        <p className="muted-note" style={{ marginTop: 8 }}>Source: {method.source}</p>
      </Panel>
    </div>
  );
}

// ===========================================================
// Anomalies — every flagged district, as an operational card
// rather than a z-score table.
// ===========================================================

const ANOM_KINDS = ['crime_spike', 'unusual_pattern', 'forecast'];

export function Anomalies({ findings, onOpen, onAct }) {
  const [kind, setKind] = useState(null);
  const rows = useMemo(
    () => findings.filter((f) => ANOM_KINDS.includes(f.kind) && (!kind || f.kind === kind)),
    [findings, kind],
  );
  const { slice, sort, toggle, page, pages, setPage, total, pageSize } =
    useSortPage(rows, { key: 'confidence', dir: 'desc' }, 12);

  const counts = {};
  findings.forEach((f) => { if (ANOM_KINDS.includes(f.kind)) counts[f.kind] = (counts[f.kind] || 0) + 1; });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SummaryStrip
        active={kind}
        onPick={setKind}
        cells={[
          { key: 'crime_spike', label: 'Crime spikes', value: counts.crime_spike || 0, tone: 'CRITICAL', note: 'vs district history' },
          { key: 'unusual_pattern', label: 'Unusual patterns', value: counts.unusual_pattern || 0, tone: 'WATCH', note: 'Multi-dimensional' },
          { key: 'forecast', label: 'Projections', value: counts.forecast || 0, tone: 'INFORMATION', note: 'Not observed' },
        ]}
      />

      <Panel title="Flagged districts" note={`${fmt(total)} findings`} flush>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <SortHead label="Priority" k="priority" sort={sort} onSort={toggle} />
                <SortHead label="District" k="district" sort={sort} onSort={toggle} get={(r) => r.where.district} />
                <SortHead label="Finding" k="headline" sort={sort} onSort={toggle} />
                <SortHead label="Evidence" k="claim_type" sort={sort} onSort={toggle} />
                <th>Measurements</th>
                <SortHead label="Confidence" k="confidence" sort={sort} onSort={toggle} num />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((f) => (
                <tr key={f.finding_id} className={pClass(f.priority)} onClick={() => onOpen(f)}>
                  <td className="row-spine"><Tag level={f.priority} /></td>
                  <td className="strong">{f.where.district}</td>
                  <td>
                    {f.headline}
                    <span className="sub">{f.kind.replace(/_/g, ' ')}</span>
                  </td>
                  <td><ClaimTag type={f.claim_type} label={f.claim_label} /></td>
                  <td>
                    {/* Each finding type measures different things, so the metrics
                        travel with the row rather than forcing shared columns. */}
                    <div className="feed-metrics" style={{ marginBottom: 0, gap: 16 }}>
                      {f.metrics.map((m) => (
                        <div className="feed-metric" key={m.label}>
                          <b className={m.tone === 'up' ? 'delta up' : m.tone === 'down' ? 'delta down' : ''}>{m.value}</b>
                          <span>{m.label}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="num"><Confidence value={f.confidence} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-primary" onClick={() => onOpen(f)}>Why flagged?</button>
                  </td>
                </tr>
              ))}
              {!slice.length && <tr><td colSpan={7}><Empty>No anomalies of this type.</Empty></td></tr>}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={total} pageSize={pageSize} noun="findings" />
      </Panel>
    </div>
  );
}

// ===========================================================
// Repeat offender intelligence.
//
// Ordered by what an investigator needs — recent activity, then
// breadth of offending — rather than by a bare case count.
// ===========================================================

export function Offenders({ offenders, queueById, onOpenCase, onNetwork }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => offenders.offenders.filter(
    (o) => !q || o.name.toLowerCase().includes(q.toLowerCase())
      || (o.district || '').toLowerCase().includes(q.toLowerCase()),
  ), [offenders.offenders, q]);

  const { slice, sort, toggle, page, pages, setPage, total, pageSize } =
    useSortPage(rows, { key: 'active_this_period', dir: 'desc' }, 15);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="data-note">
        <b>Synthetic person-level data</b>
        <span>
          {offenders.data_note} A person named on an FIR is an accused, not a convict; several of
          these cases are still under investigation. Use this to find case connections, never as a
          judgement about a person.
        </span>
      </div>

      <div className="summary-strip">
        <div className={`sum-cell ${pClass('INFORMATION')}`} style={{ cursor: 'default' }}>
          <span className="sum-val">{fmt(offenders.repeat_offenders)}</span>
          <span className="sum-label">Repeat offenders</span>
          <span className="sum-note">named on 2+ FIRs</span>
        </div>
        <div className={`sum-cell ${pClass('HIGH')}`} style={{ cursor: 'default' }}>
          <span className="sum-val">{fmt(offenders.newly_connected)}</span>
          <span className="sum-label">Newly connected</span>
          <span className="sum-note">last {offenders.period_days} days</span>
        </div>
        <div className={`sum-cell ${pClass('WATCH')}`} style={{ cursor: 'default' }}>
          <span className="sum-val">{fmt(offenders.active_this_period)}</span>
          <span className="sum-label">Active this period</span>
          <span className="sum-note">new FIR in {offenders.period_days} days</span>
        </div>
        <div className={`sum-cell ${pClass('RESOLVED')}`} style={{ cursor: 'default' }}>
          <span className="sum-val">{Math.round(offenders.repeat_ratio * 100)}%</span>
          <span className="sum-label">Repeat share</span>
          <span className="sum-note">of all named accused</span>
        </div>
      </div>

      <Panel
        title="Repeat offender intelligence"
        note={`${fmt(total)} shown`}
        right={(
          <input
            value={q}
            placeholder="Filter by name or district…"
            onChange={(e) => setQ(e.target.value)}
            style={{ height: 28, border: '1px solid var(--ops-line-2)', borderRadius: 4, padding: '0 8px', font: 'inherit', minWidth: 200 }}
          />
        )}
        flush
      >
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <SortHead label="Person" k="name" sort={sort} onSort={toggle} />
                <SortHead label="District" k="district" sort={sort} onSort={toggle} />
                <SortHead label="Linked cases" k="linked_cases" sort={sort} onSort={toggle} num />
                <SortHead label="Crime types" k="crime_types" sort={sort} onSort={toggle} num />
                <SortHead label="Locations" k="locations" sort={sort} onSort={toggle} num />
                <SortHead label="Associates" k="associates" sort={sort} onSort={toggle} num />
                <SortHead label="Active this period" k="active_this_period" sort={sort} onSort={toggle} num />
                <SortHead label="Last seen" k="days_since_last" sort={sort} onSort={toggle} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((o) => (
                <tr key={o.person_id} onClick={() => onNetwork({ entity_id: o.person_id, label: o.name })}>
                  <td className="strong">
                    {o.name}
                    <span className="sub">{o.person_id}{o.open_cases ? ` · ${o.open_cases} open` : ''}</span>
                  </td>
                  <td>{o.district}</td>
                  <td className="num strong">{o.linked_cases}</td>
                  <td className="num">
                    {o.crime_types}
                    <span className="sub">{o.type_list.slice(0, 2).join(', ')}</span>
                  </td>
                  <td className="num">
                    {o.locations}
                    <span className="sub">{o.jurisdictions} station{o.jurisdictions === 1 ? '' : 's'}</span>
                  </td>
                  <td className="num">
                    {o.associates}
                    {!!o.new_associates && <span className="sub" style={{ color: 'var(--p-high)', fontWeight: 650 }}>+{o.new_associates} new</span>}
                  </td>
                  <td className="num">
                    {o.active_this_period
                      ? <b className="delta up">{o.active_this_period}</b>
                      : <span className="muted-note">—</span>}
                  </td>
                  <td>{o.days_since_last}d ago</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="btn-row">
                      <button className="btn btn-sm btn-primary"
                        onClick={() => onNetwork({ entity_id: o.person_id, label: o.name })}>Profile</button>
                      {!!o.cases.length && (
                        <button className="btn btn-sm" onClick={() => onOpenCase(o.cases[0])}>Latest FIR</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={total} pageSize={pageSize} noun="offenders" />
      </Panel>
    </div>
  );
}
