import React, { useMemo, useState } from 'react';
import IntelMap from '../ops/IntelMap.jsx';
import {
  ActionBar, ClaimTag, Confidence, Delta, Empty, Field, Panel, Select, Spark,
  SummaryStrip, Tag, WhyPanel, fmt, pClass,
} from '../ops/ui.jsx';

// ===========================================================
// Crime Intelligence overview.
//
// The page answers "what changed?" before it answers "how much
// crime is there?". The old version opened with cluster counts and
// network node totals — true numbers that tell a station officer
// nothing they can act on. This one opens with the findings, ranked,
// and every one of them leads somewhere.
//
// Layout: what changed -> where (map) -> what to do about it (feed).
// ===========================================================

const KIND_LABEL = {
  emerging_cluster: 'Emerging hotspot',
  crime_spike: 'Crime spike',
  unusual_pattern: 'Unusual pattern',
  network_link: 'New offender connection',
  repeat_offender: 'Repeat offender activity',
  forecast: 'Projection',
};

const EMPTY = { district: '', crimeType: '', priority: '', kind: '', claim: '', period: '30d' };

export default function Overview({
  overview, districtIntel, boundaries, firRows, clusters,
  onOpenFinding, onOpenDistrict, onOpenPattern, onAct,
}) {
  const [f, setF] = useState(EMPTY);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const [bucket, setBucket] = useState(null);

  const period = overview.periods.find((p) => p.key === f.period) || overview.periods[1];

  // Filters apply to the findings, the map and the feed together — one filter
  // state, so the three panels can never disagree about what is on screen.
  const findings = useMemo(() => overview.findings.filter((x) => {
    if (bucket && x.kind !== bucket) return false;
    if (f.district && x.where.district !== f.district) return false;
    if (f.priority && x.priority !== f.priority) return false;
    if (f.kind && x.kind !== f.kind) return false;
    if (f.claim && x.claim_type !== f.claim) return false;
    if (f.crimeType) {
      const hay = `${x.headline} ${x.summary}`.toLowerCase();
      if (!hay.includes(f.crimeType.toLowerCase())) return false;
    }
    return true;
  }), [overview.findings, f, bucket]);

  const mapClusters = useMemo(() => clusters.filter(
    (c) => !f.district || c.district === f.district,
  ), [clusters, f.district]);

  const mapDistricts = useMemo(() => Object.values(districtIntel || {}).map((d) => ({
    geo_unit_id: d.geo_unit_id, name: d.name, centroid: d.centroid,
    risk_band: d.risk_band, risk_score: d.risk_score,
    hotspot_status: d.hotspot_status, crime_rate_per_100k: d.crime_rate_per_100k,
    change_pct: d.period?.change_pct,
  })), [districtIntel]);

  const mapFirs = useMemo(
    () => (f.district ? firRows.filter((r) => r.district === f.district) : firRows),
    [firRows, f.district],
  );

  const cells = overview.what_changed.map((w) => ({
    key: w.key, label: w.label, value: w.count, tone: w.priority,
    note: KIND_NOTE[w.key],
  }));

  const activeFilters = Object.entries(f).filter(([k, v]) => v && k !== 'period').length;

  return (
    <>
      {/* -------- global filters -------- */}
      <div className="filterbar">
        <Field label="District">
          <Select value={f.district} onChange={(v) => set('district', v)}
            options={overview.facets.districts} all="All districts" />
        </Field>
        <Field label="Crime type">
          <Select value={f.crimeType} onChange={(v) => set('crimeType', v)}
            options={overview.facets.crime_types} all="All crime types" />
        </Field>
        <Field label="Period">
          <select value={f.period} onChange={(e) => set('period', e.target.value)}>
            {overview.periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(v) => set('priority', v)}
            options={overview.facets.priorities} all="All priorities" />
        </Field>
        <Field label="Finding type">
          <Select value={f.kind} onChange={(v) => set('kind', v)}
            options={overview.facets.kinds.map((k) => ({ value: k, count: null }))} all="All types" />
        </Field>
        <Field label="Evidence type">
          <select value={f.claim} onChange={(e) => set('claim', e.target.value)}>
            <option value="">All evidence types</option>
            <option value="observed">Counted from records</option>
            <option value="statistical">Statistical test</option>
            <option value="ml">Machine learning</option>
            <option value="prediction">Projection</option>
          </select>
        </Field>
        {(activeFilters > 0 || bucket) && (
          <button className="btn" onClick={() => { setF({ ...EMPTY, period: f.period }); setBucket(null); }}>
            Clear filters
          </button>
        )}
      </div>

      {/* -------- 1. what changed -------- */}
      <div>
        <h2 style={{ marginBottom: 7 }}>What changed?</h2>
        <SummaryStrip cells={cells} active={bucket} onPick={setBucket} />
      </div>

      {/* -------- 2. period movement: the number is the message -------- */}
      <Panel
        title={`Movement — ${period.label.toLowerCase()}`}
        note={`${fmt(period.total)} FIRs vs ${fmt(period.previous_total)} in the previous ${period.days} days`}
        right={<span className="delta-wrap"><Delta pct={period.change_pct} /></span>}
      >
        {!period.by_crime_type.length && <Empty>Not enough registrations in this window to compare.</Empty>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 10 }}>
          {period.by_crime_type.slice(0, 8).map((c) => (
            <button
              key={c.crime_type}
              className="btn"
              style={{
                height: 'auto', padding: '9px 11px', alignItems: 'flex-start',
                flexDirection: 'column', gap: 3, textAlign: 'left',
              }}
              onClick={() => set('crimeType', c.crime_type)}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%' }}>
                <b style={{ fontSize: '0.92rem' }}>{c.crime_type}</b>
                <span style={{ marginLeft: 'auto', fontSize: '1rem' }}><Delta pct={c.change_pct} /></span>
              </span>
              <span className="muted-note">
                {c.current} this period · {c.previous} previous
              </span>
              <Spark values={[c.previous, c.current]} w={70} h={16}
                tone={c.direction === 'up' ? 'var(--ops-up)' : 'var(--ops-down)'} />
            </button>
          ))}
        </div>
        <p className="muted-note" style={{ marginTop: 9 }}>
          Counts are FIR registrations in the operational window. A rise in registrations can
          reflect a change in reporting or a registration drive as well as a change in offending.
        </p>
      </Panel>

      {/* -------- 3 + 4. where it is happening, and what to do -------- */}
      <div className="grid-main">
        <Panel
          title="Crime intelligence map"
          note="Change against the previous 30 days, with the emerging clusters on top"
          flush
        >
          <IntelMap
            clusters={mapClusters}
            firs={mapFirs}
            districts={mapDistricts}
            boundaries={boundaries}
            height={560}
            onInvestigate={(c) => onOpenPattern(c.cluster_id)}
            onOpenDistrict={onOpenDistrict}
          />
        </Panel>

        <Panel
          title="Intelligence feed"
          note={`${findings.length} finding${findings.length === 1 ? '' : 's'}`}
          flush
        >
          <div className="feed" style={{ maxHeight: 560, overflowY: 'auto' }}>
            {findings.map((x) => (
              <FeedItem key={x.finding_id} finding={x} onOpen={onOpenFinding} onAct={onAct} />
            ))}
            {!findings.length && <Empty>No findings match these filters.</Empty>}
          </div>
        </Panel>
      </div>
    </>
  );
}

const KIND_NOTE = {
  emerging_cluster: 'Rising, with a location',
  crime_spike: 'Against district history',
  unusual_pattern: 'Multi-dimensional outliers',
  network_link: 'Formed this period',
  repeat_offender: 'Active this period',
  forecast: 'Projection, not a fact',
};

function FeedItem({ finding: x, onOpen, onAct }) {
  const [why, setWhy] = useState(false);
  return (
    <div className={`feed-item ${pClass(x.priority)}`}>
      <div className="feed-top">
        <Tag level={x.priority} />
        <ClaimTag type={x.claim_type} label={x.claim_label} />
        <span className="feed-when">{KIND_LABEL[x.kind] || x.kind}</span>
      </div>
      <div className="feed-title">{x.headline}</div>
      {x.where?.district && (
        <div className="feed-where">
          {x.where.area || x.where.district}
          {x.when?.peak_window ? ` · peak ${x.when.peak_window}` : ''}
        </div>
      )}
      <div className="feed-why">{x.summary}</div>

      <div className="feed-metrics">
        {x.metrics.slice(0, 4).map((m) => (
          <div className="feed-metric" key={m.label}>
            <b className={m.tone || ''}>{m.value}</b>
            <span>{m.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7, flexWrap: 'wrap' }}>
        <Confidence value={x.confidence} label={x.confidence_label} />
        <button className="btn-link" onClick={() => setWhy((v) => !v)}>
          {why ? 'Hide explanation' : 'Why was this flagged?'}
        </button>
      </div>

      <ActionBar
        actions={[{ label: 'Investigate', kind: 'open_finding', target: x.finding_id }, ...x.actions.slice(0, 2)]}
        onAct={(a) => (a.kind === 'open_finding' ? onOpen(x) : onAct(a, x))}
        primaryCount={1}
        size="sm"
      />

      {why && (
        <div style={{ marginTop: 8, marginLeft: -12, marginRight: -12, marginBottom: -10 }}>
          <WhyPanel
            signals={x.signals}
            action={x.actions[0]?.label ? `Start with “${x.actions[0].label}”.` : null}
            method={x.method}
          />
        </div>
      )}
    </div>
  );
}
