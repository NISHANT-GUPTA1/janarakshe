import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import CrimeMap from '../CrimeMap.jsx';
import Intelligence from '../Intelligence.jsx';
import Correlations from '../Correlations.jsx';
import FIRIntelligence from '../FIRIntelligence.jsx';
import District3D from './District3D.jsx';

// three.js + the force-graph engine are heavy; keep them out of the initial bundle.
const NetworkGraph = lazy(() => import('../NetworkGraph.jsx'));
import { AreaTrend, Donut, HourBars, RankBars } from './charts.jsx';
import { BAND_COLOR, BAND_ORDER, SERIES, fmt, pct, hourLabel } from './palette.js';
import './dashboard.css';

const STATUS_LABEL = { none: 'Stable', emerging: 'Emerging', established: 'Hotspot' };
// The console model uses "Medium"; the portal shows it as "Moderate".
const BAND_LABEL = { Critical: 'Critical', High: 'High', Medium: 'Moderate', Low: 'Low' };

// Left sidebar sections. Selecting one swaps the main panel (only one heavy
// section — 3D scene / force-graph — is ever mounted at a time, so the page
// stays responsive).
const RAIL = [
  { id: 'cc-overview', label: 'Overview', icon: 'grid' },
  { id: 'cc-3d', label: '3D Terrain', icon: 'cube' },
  { id: 'cc-network', label: 'Network', icon: 'network' },
  { id: 'cc-analytics', label: 'Analytics', icon: 'chart' },
  { id: 'cc-intel', label: 'Crime Intelligence', icon: 'shield' },
  { id: 'cc-fir', label: 'FIR Intelligence', icon: 'file' },
  { id: 'cc-alerts', label: 'Alerts', icon: 'bell', dot: true },
  { id: 'cc-reports', label: 'Reports', icon: 'report' },
  { id: 'cc-admin', label: 'Administration', icon: 'gear' },
];

// Bottom navigation tiles — shortcuts into the deep-dive sections.
const TILES = [
  { id: 'cc-3d', label: '3D Terrain', sub: 'Explore crime terrain', icon: 'cube' },
  { id: 'cc-network', label: 'Network', sub: 'Offender relationships', icon: 'network' },
  { id: 'cc-analytics', label: 'Analytics', sub: 'Trends & insights', icon: 'chart' },
  { id: 'cc-fir', label: 'FIR Intelligence', sub: 'Case level analysis', icon: 'file' },
  { id: 'cc-intel', label: 'Crime Intelligence', sub: 'AI-driven insights', icon: 'shield' },
];

export default function Dashboard({ meta }) {
  const [districts, setDistricts] = useState([]);
  const [boundaries, setBoundaries] = useState(null);
  const [trends, setTrends] = useState(null);
  const [fir, setFir] = useState(null);
  const [spatio, setSpatio] = useState(null);
  const [patterns, setPatterns] = useState(null);
  const [network, setNetwork] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  // filter state
  const [q, setQ] = useState('');
  const [bands, setBands] = useState([]);       // [] = all bands
  const [hotOnly, setHotOnly] = useState(false);
  const [applied, setApplied] = useState({ q: '', bands: [], hotOnly: false });
  const [hour, setHour] = useState(null);       // 0..23 scrub for the 3D scene
  const [view, setView] = useState('cc-overview');

  useEffect(() => {
    let dead = false;
    const soft = (p) => p.catch(() => null); // optional panels must not sink the page

    Promise.all([
      api.districts(),
      fetch('/data/karnataka_districts.geojson').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      soft(api.trends()),
      soft(api.firOverview()),
      soft(api.firSpatiotemporal()),
      soft(api.intelPatterns()),
      soft(api.firNetwork()),
    ])
      .then(([d, b, t, f, s, p, n]) => {
        if (dead) return;
        setDistricts(d); setBoundaries(b); setTrends(t); setFir(f);
        setSpatio(s); setPatterns(p); setNetwork(n);
      })
      .catch((e) => !dead && setError(e.message));

    return () => { dead = true; };
  }, []);

  // Switching views always starts at the top of the panel. The crime map lives
  // in the Overview, so "Crime Map" / "View map" resolve back to it.
  const go = useCallback((id) => {
    if (id === 'cc-map') {
      setView('cc-overview');
      setTimeout(() => document.getElementById('ov-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return;
    }
    setView(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const select = useCallback((id) => {
    api.district(id).then(setSelected).catch((e) => setError(e.message));
  }, []);

  // Drill into a district: load it and open the Reports view where the detail shows.
  const viewDistrict = useCallback((id) => {
    api.district(id).then(setSelected).catch((e) => setError(e.message));
    setView('cc-reports');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // ---------- derived analytics (filters apply on "Apply Filters") ----------
  const filtered = useMemo(() => districts.filter((d) => {
    if (applied.q && !d.name.toLowerCase().includes(applied.q.toLowerCase())) return false;
    if (applied.bands.length && !applied.bands.includes(d.risk_band)) return false;
    if (applied.hotOnly && d.hotspot_status === 'none') return false;
    return true;
  }), [districts, applied]);

  const focusIds = useMemo(
    () => (filtered.length === districts.length ? null : new Set(filtered.map((d) => d.geo_unit_id))),
    [filtered, districts.length]
  );

  const stats = useMemo(() => {
    if (!districts.length) return null;
    const series = trends?.series ?? [];
    const latest = series[series.length - 1]?.total_cognizable_cases ?? null;
    const prev = series[series.length - 2]?.total_cognizable_cases ?? null;
    const delta = latest && prev ? (latest - prev) / prev : null;

    const bandCounts = BAND_ORDER
      .map((b) => ({ label: b, value: districts.filter((d) => d.risk_band === b).length, color: BAND_COLOR[b] }))
      .filter((b) => b.value > 0);

    const hotspots = districts.filter((d) => d.hotspot_status !== 'none');
    const hist = spatio?.hour_histogram ?? [];
    const peakHour = hist.length ? hist.indexOf(Math.max(...hist)) : null;

    return {
      series, latest, delta, bandCounts,
      established: hotspots.filter((d) => d.hotspot_status === 'established').length,
      emerging: hotspots.filter((d) => d.hotspot_status === 'emerging').length,
      peakHour, hist,
    };
  }, [districts, trends, spatio]);

  const advisory = useMemo(() => {
    if (!districts.length) return null;
    const top = [...districts].sort((a, b) => b.risk_score - a.risk_score)[0];
    const hist = spatio?.hour_histogram ?? [];
    if (!hist.length) return { top, window: null, peak: null };
    const peak = hist.indexOf(Math.max(...hist));
    let bestStart = 0, best = -1;
    for (let h = 0; h < 24; h++) {
      const sum = hist[h] + hist[(h + 1) % 24] + hist[(h + 2) % 24];
      if (sum > best) { best = sum; bestStart = h; }
    }
    const share = best / hist.reduce((a, b) => a + b, 0);
    return { top, peak, window: { start: bestStart, end: (bestStart + 3) % 24, share } };
  }, [districts, spatio]);

  const anomalies = useMemo(() => {
    const a = patterns?.anomalies ?? [];
    return [...a].sort((x, y) => Math.abs(y.zscore) - Math.abs(x.zscore)).slice(0, 8);
  }, [patterns]);

  const topRisk = useMemo(
    () => [...filtered].sort((a, b) => b.risk_score - a.risk_score).slice(0, 5),
    [filtered]
  );

  const liveAlerts = useMemo(() => {
    const sorted = [...districts].sort((a, b) => b.risk_score - a.risk_score);
    const a = sorted[0]?.name ?? 'Bengaluru';
    const b = sorted[1]?.name ?? 'Mysuru';
    const c = [...districts].find((d) => d.risk_band === 'Low')?.name ?? 'Shivamogga';
    return [
      { level: 'HIGH', text: `Cyber fraud cases spiked in ${a}`, time: '2 mins ago' },
      { level: 'MEDIUM', text: `Vehicle theft cluster detected in ${b}`, time: '10 mins ago' },
      { level: 'LOW', text: `Trend stabilized in ${c} district`, time: '20 mins ago' },
    ];
  }, [districts]);

  const toggleBand = (b) => setBands((cur) => {
    const effective = cur.length === 0 ? BAND_ORDER : cur;
    const next = effective.includes(b) ? effective.filter((x) => x !== b) : [...effective, b];
    return next.length === BAND_ORDER.length ? [] : next;
  });
  const applyFilters = () => setApplied({ q, bands: [...bands], hotOnly });
  const clearFilters = () => { setQ(''); setBands([]); setHotOnly(false); setApplied({ q: '', bands: [], hotOnly: false }); };

  const years = meta?.years;
  const yearRange = years ? `${years[0]} – ${years[years.length - 1]}` : '2018 – 2024';

  if (error) {
    return (
      <div className="dash">
        <div className="cc-error">
          <b>Could not reach the analytics API</b> ({error}).<br />
          Start the backend, then reload.
        </div>
      </div>
    );
  }

  return (
    <div className="dash">
      <Sidebar active={view} onNav={go} />

      <div className="dash-main">
        {view === 'cc-overview' && (
          <>
            {/* ---------- Topline ---------- */}
            <div className="dash-topline">
              <span className="dash-crumb">Dashboard</span>
              <div className="topline-meta">
                <span><em>Districts</em><b>{districts.length || meta?.district_count || 31}</b></span>
                <span><em>Year Range</em><b>{yearRange}</b></span>
                <span><em>Latest Year</em><b>{meta?.latest_year ?? 2024}</b></span>
                <span className="tl-live"><i /> Last Updated: 2 mins ago</span>
              </div>
            </div>

            {/* ---------- KPI row ---------- */}
            <section className="kpi-row">
              <StatCard
                tone="blue" icon="file" label="Cognizable Cases"
                value={stats?.latest ? fmt(stats.latest) : '—'}
                delta={stats?.delta} deltaBase={`vs ${(stats?.series?.at(-2)?.year) ?? '2023'}`}
                link="View trends" onLink={() => go('cc-analytics')}
              />
              <StatCard
                tone="red" icon="target" label="Active Hotspots"
                value={stats ? String(stats.established + stats.emerging) : '—'}
                sub={stats ? `${stats.emerging} Emerging` : ''}
                link="View map" onLink={() => go('cc-map')}
              />
              <StatCard
                tone="green" icon="shield" label="Detection Rate"
                value={fir ? pct(fir.detection.detection_rate, 1) : '—'}
                delta={0.041} deltaBase="vs 2023"
                link="View details" onLink={() => go('cc-fir')}
              />
              <StatCard
                tone="violet" icon="clock" label="Peak Crime Hour"
                value={stats?.peakHour != null ? hourLabel(stats.peakHour) : '—'}
                sub={advisory?.window ? `3-hr Window: ${hourLabel(advisory.window.start)} – ${hourLabel(advisory.window.end)}` : ''}
                link="View insights" onLink={() => go('cc-3d')}
              />
            </section>

            {/* ---------- Filter bar (top) ---------- */}
            <section className="filter-bar">
              <div className="fb-main">
                <span className="fb-search search-in">
                  <Icon name="search" />
                  <input type="search" value={q} placeholder="Search district…" onChange={(e) => setQ(e.target.value)} />
                </span>
                <div className="fb-bands">
                  {BAND_ORDER.map((b) => {
                    const on = bands.length === 0 || bands.includes(b);
                    return (
                      <label key={b} className={`band-check b-${b.toLowerCase()} ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleBand(b)} />
                        <span className="bc-box" aria-hidden="true"><Icon name="check" /></span>
                        {BAND_LABEL[b]}
                      </label>
                    );
                  })}
                </div>
                <button
                  className={`hot-toggle ${hotOnly ? 'on' : ''}`}
                  onClick={() => setHotOnly((v) => !v)}
                  role="switch" aria-checked={hotOnly}
                >
                  <span className="ht-track"><span className="ht-dot" /></span>
                  Hotspots Only
                </button>
                <button className="btn-primary" onClick={applyFilters}>Apply Filters</button>
                <button className="link-btn" onClick={clearFilters}>Clear all</button>
                <span className="fb-showing">Showing <b>{filtered.length}</b> of {districts.length}</span>
              </div>
              {stats && (
                <div className="fb-comp">
                  <span className="fb-comp-h">Risk Composition</span>
                  <RiskComposition counts={stats.bandCounts} total={districts.length} />
                </div>
              )}
            </section>

            {/* ---------- Main grid: map | rail ---------- */}
            <section className="dash-grid2">
              {/* --- Map --- */}
              <div className="card map-card" id="ov-map">
                <div className="card-h">
                  <h3>Karnataka Crime Map</h3>
                </div>
                {districts.length > 0 ? (
                  <CrimeMap
                    districts={districts}
                    boundaries={boundaries}
                    selectedId={selected?.geo_unit_id}
                    focusIds={focusIds}
                    height={452}
                    onSelect={(id) => (id ? select(id) : setSelected(null))}
                  />
                ) : (
                  <Skeleton h={452} />
                )}
              </div>

              {/* --- Right rail --- */}
              <aside className="dash-rail">
                <div className="card">
                  <div className="card-h">
                    <h3>Top Risk Districts</h3>
                    <button className="link-btn" onClick={() => go('cc-reports')}>View all</button>
                  </div>
                  <table className="risk-table">
                    <thead>
                      <tr><th>#</th><th>District</th><th className="r">Rate /100k</th><th className="r">Risk Score</th></tr>
                    </thead>
                    <tbody>
                      {topRisk.map((d, i) => (
                        <tr key={d.geo_unit_id} onClick={() => { select(d.geo_unit_id); go('cc-reports'); }}>
                          <td className="rt-rank">{i + 1}</td>
                          <td className="rt-name">
                            {d.name}
                            <span className={`band-pill b-${d.risk_band.toLowerCase()}`}>{BAND_LABEL[d.risk_band]}</span>
                          </td>
                          <td className="r">{d.crime_rate_per_100k}</td>
                          <td className="r rt-score">{d.risk_score}</td>
                        </tr>
                      ))}
                      {!topRisk.length && <tr><td colSpan={4} className="tl-empty">No districts match.</td></tr>}
                    </tbody>
                  </table>
                </div>

                {advisory && (
                  <div className="card ai-rec">
                    <div className="card-h">
                      <h3><span className="ai-badge"><Icon name="shield" /></span> AI Recommendation</h3>
                      <span className="action-req">ACTION REQUIRED</span>
                    </div>
                    <p className="ai-lead">
                      <b>{advisory.top.name}</b> has the highest risk ({advisory.top.risk_score}).
                    </p>
                    <p className="ai-sub">Recommended Action</p>
                    <p className="ai-body">
                      <Icon name="spark" />
                      {advisory.window ? (
                        <span>Increase concentrated patrol between <b>{hourLabel(advisory.window.start)} – {hourLabel(advisory.window.end)} hrs</b> in identified hotspot zones.</span>
                      ) : (
                        <span>Increase concentrated patrol in identified hotspot zones.</span>
                      )}
                    </p>
                    <div className="ai-cta">
                      <button className="btn-primary" onClick={() => { select(advisory.top.geo_unit_id); go('cc-reports'); }}>
                        Drill into {advisory.top.name} <span aria-hidden="true">→</span>
                      </button>
                      <button className="btn-outline" onClick={() => go('cc-reports')}>View full analysis</button>
                    </div>
                  </div>
                )}

                <div className="card">
                  <div className="card-h">
                    <h3>Live Alerts</h3>
                    <button className="link-btn" onClick={() => go('cc-alerts')}>View all</button>
                  </div>
                  <ul className="live-alerts">
                    {liveAlerts.map((a) => (
                      <li key={a.text}>
                        <span className={`lv-badge lv-${a.level.toLowerCase()}`}><i />{a.level}</span>
                        <span className="lv-text">{a.text}</span>
                        <span className="lv-time">{a.time}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            </section>

            {/* ---------- Feature tiles ---------- */}
            <section className="feature-tiles">
              {TILES.map((t) => (
                <button key={t.id} className="tile" onClick={() => go(t.id)}>
                  <span className="tile-icon"><Icon name={t.icon} /></span>
                  <span className="tile-txt">
                    <b>{t.label}</b>
                    <em>{t.sub}</em>
                  </span>
                  <span className="tile-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </section>

            <div className="dash-footnote">
              <span>✚ Note: Data is synthetic and for demonstration purposes only.</span>
            </div>
          </>
        )}

        {/* ---------- 3D terrain ---------- */}
        {view === 'cc-3d' && (
          <div className="cc-deep">
            <DeepHead title="3D Crime Terrain" back={() => go('cc-overview')}
              sub="District polygons extruded by magnitude and coloured by risk band. Scrub an hour to drop that hour's incidents onto the terrain." />
            <div className="cc-deep-grid">
              {boundaries && districts.length ? (
                <District3D
                  districts={districts}
                  boundaries={boundaries}
                  firHotspots={spatio?.hotspots ?? []}
                  firPoints={spatio?.points ?? []}
                  hour={hour}
                  selectedId={selected?.geo_unit_id}
                  onSelect={select}
                />
              ) : <Skeleton h={540} />}
              <div className="cc-deep-side">
                <h4>Incidents by hour of day</h4>
                <p className="cc-deep-sub">Click a bar to project that hour into the scene.</p>
                {spatio ? (
                  <>
                    <HourBars histogram={spatio.hour_histogram} gravityByHour={spatio.gravity_by_hour} selected={hour} onSelect={setHour} />
                    <div className="hb-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
                    <dl className="statlist">
                      <div><dt>FIR points plotted</dt><dd>{fmt(spatio.points.length)}</dd></div>
                      <div><dt>Hotspot cells</dt><dd>{fmt(spatio.hotspots.length)}</dd></div>
                      <div><dt>Peak hour</dt><dd>{stats?.peakHour != null ? hourLabel(stats.peakHour) : '—'}</dd></div>
                    </dl>
                  </>
                ) : <Skeleton h={300} />}
              </div>
            </div>
          </div>
        )}

        {/* ---------- Offender network ---------- */}
        {view === 'cc-network' && (
          <div className="cc-deep">
            <DeepHead title="3D Offender Network" back={() => go('cc-overview')}
              sub="Force-directed co-offender graph — drag to rotate, scroll to zoom."
              right={network && (
                <div className="net-stats">
                  <span><b>{fmt(network.summary.nodes)}</b>offenders</span>
                  <span><b>{fmt(network.summary.edges)}</b>links</span>
                  <span><b>{fmt(network.summary.components)}</b>crews</span>
                </div>
              )} />
            {network?.graph ? (
              <Suspense fallback={<Skeleton h={560} />}>
                <NetworkGraph graph={network.graph} caseGraph={network.case_graph} summary={network.summary} embedded />
              </Suspense>
            ) : <Skeleton h={560} />}
          </div>
        )}

        {/* ---------- Analytics ---------- */}
        {view === 'cc-analytics' && (
          <div className="cc-deep">
            <DeepHead title="Analytics" back={() => go('cc-overview')}
              sub="Statewide trends, risk-band distribution and statistical anomalies." />
            <div className="cc-deep-analytics">
              <div className="cc-deep-panel">
                <h4>Statewide Crime Trend</h4>
                {trends ? <AreaTrend series={trends.series} xKey="year" yKey="total_cognizable_cases" valueLabel="cases" /> : <Skeleton h={210} />}
              </div>
              <div className="cc-deep-panel">
                <h4>Risk Distribution</h4>
                {stats ? <Donut data={stats.bandCounts.map((b) => ({ ...b, label: BAND_LABEL[b.label] }))} total={districts.length} centerLabel="Districts" /> : <Skeleton h={200} />}
              </div>
              <div className="cc-deep-panel">
                <h4>Anomaly Alerts</h4>
                <AnomalyList anomalies={anomalies} onView={viewDistrict} />
              </div>
            </div>
          </div>
        )}

        {/* ---------- Alerts ---------- */}
        {view === 'cc-alerts' && (
          <div className="cc-deep">
            <DeepHead title="Alerts" back={() => go('cc-overview')}
              sub="Live operational alerts and statistical anomalies." />
            <div className="cc-deep-two">
              <div className="cc-deep-panel">
                <h4>Live Alerts</h4>
                <ul className="alerts">
                  {liveAlerts.map((a) => (
                    <li key={a.text}>
                      <span className={`al-icon ${a.level === 'LOW' ? 'down' : 'up'}`}>{a.level === 'LOW' ? '▼' : '▲'}</span>
                      <span className="al-text"><b>{a.text}</b><em>{a.level} · {a.time}</em></span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="cc-deep-panel">
                <h4>Anomaly Alerts</h4>
                <AnomalyList anomalies={anomalies} onView={viewDistrict} />
              </div>
            </div>
          </div>
        )}

        {/* ---------- Crime intelligence ---------- */}
        {view === 'cc-intel' && (
          <div className="deep-embed">
            <DeepHead title="Crime Intelligence" back={() => go('cc-overview')} light />
            <Intelligence />
          </div>
        )}

        {/* ---------- FIR intelligence ---------- */}
        {view === 'cc-fir' && (
          <div className="deep-embed">
            <DeepHead title="FIR Intelligence" back={() => go('cc-overview')} light />
            <FIRIntelligence />
          </div>
        )}

        {/* ---------- Reports ---------- */}
        {view === 'cc-reports' && (
          <div className="cc-deep">
            <DeepHead title="District Register" back={() => go('cc-overview')}
              sub="Full district table with drill-down and socio-economic correlations." />
            <div className="cc-deep-report">
              <div className="cc-table-wrap">
                <table className="cc-table">
                  <thead><tr><th>District</th><th className="num">Rate/100k</th><th className="num">Cases</th><th>Status</th><th>Risk</th></tr></thead>
                  <tbody>
                    {filtered.map((d) => (
                      <tr key={d.geo_unit_id} className={selected?.geo_unit_id === d.geo_unit_id ? 'sel' : ''} onClick={() => select(d.geo_unit_id)}>
                        <td>{d.name}</td>
                        <td className="num">{d.crime_rate_per_100k}</td>
                        <td className="num">{fmt(d.total_cognizable_cases)}</td>
                        <td>{STATUS_LABEL[d.hotspot_status]}</td>
                        <td><span className="band" style={{ background: BAND_COLOR[d.risk_band] }}>{BAND_LABEL[d.risk_band]} {d.risk_score}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cc-detail">
                {selected ? <DistrictDetail d={selected} /> : <p className="hint">Select a district from the table to drill down.</p>}
              </div>
            </div>
            <div className="cc-deep-embed"><Correlations /></div>
          </div>
        )}

        {/* ---------- Administration ---------- */}
        {view === 'cc-admin' && (
          <div className="deep-embed">
            <DeepHead title="Administration" back={() => go('cc-overview')} light />
            <div className="card">
              <p className="hint" style={{ textAlign: 'left' }}>
                User roles, data sources and platform configuration are managed here.
                {meta && <><br /><br /><b>Data note:</b> {meta.data_note}</>}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================
// Pieces
// ===========================================================

function Sidebar({ active, onNav }) {
  return (
    <aside className="dash-side">
      <nav className="side-nav" aria-label="Dashboard sections">
        {RAIL.map((r) => (
          <button key={r.id} className={active === r.id ? 'on' : ''} onClick={() => onNav(r.id)}>
            <span className="sn-icon"><Icon name={r.icon} /></span>
            <span className="sn-label">{r.label}</span>
            {r.dot && <span className="sn-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      <div className="side-emergency">
        <span className="se-phone"><Icon name="phone" /></span>
        <span className="se-txt">
          <em>Emergency</em>
          <b>112</b>
          <span>Police Emergency</span>
        </span>
      </div>

      <button className="side-help" onClick={() => { window.location.hash = '/contact'; }}>
        <Icon name="help" /> Help &amp; Support
      </button>
    </aside>
  );
}

function DeepHead({ title, sub, back, right, light }) {
  return (
    <div className={`cc-deep-head ${light ? 'light' : ''} ${right ? 'row' : ''}`}>
      <div>
        <div className="cc-deep-title">
          <h3>{title}</h3>
          <button className="link-btn" onClick={back}>← Back to overview</button>
        </div>
        {sub && <p>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

function StatCard({ tone, icon, label, value, sub, delta, deltaBase, link, onLink }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon si-${tone}`}><Icon name={icon} /></div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-foot">
          {delta != null ? (
            <span className={`stat-delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}% <em>{deltaBase}</em>
            </span>
          ) : (
            <span className="stat-sub">{sub}</span>
          )}
          <button className="stat-link" onClick={onLink}>{link}</button>
        </div>
      </div>
    </div>
  );
}

function AnomalyList({ anomalies, onView }) {
  if (!anomalies.length) return <p className="tl-empty">No anomalies detected.</p>;
  return (
    <ul className="alerts">
      {anomalies.map((a) => {
        const spike = a.direction === 'spike';
        return (
          <li key={`${a.geo_unit_id}-${a.year}`}>
            <span className={`al-icon ${spike ? 'up' : 'down'}`}>{spike ? '▲' : '▼'}</span>
            <span className="al-text"><b>{a.name}</b><em>{spike ? 'Spike' : 'Drop'} in {a.year} — {fmt(a.cases)} cases (z {a.zscore > 0 ? '+' : ''}{a.zscore})</em></span>
            <button className="al-go" onClick={() => onView(a.geo_unit_id)}>View</button>
          </li>
        );
      })}
    </ul>
  );
}

// Segmented composition bar with % labels above and a legend below.
function RiskComposition({ counts, total }) {
  const sum = total || counts.reduce((a, c) => a + c.value, 0) || 1;
  const parts = counts.map((c) => ({ ...c, pct: Math.round((c.value / sum) * 100) }));
  return (
    <div className="risk-comp">
      <div className="rc-pcts">
        {parts.map((p) => <span key={p.label} style={{ flex: p.value }}>{p.pct}%</span>)}
      </div>
      <div className="rc-bar">
        {parts.map((p) => <span key={p.label} style={{ flex: p.value, background: p.color }} title={`${BAND_LABEL[p.label]}: ${p.value}`} />)}
      </div>
      <div className="rc-legend">
        {parts.map((p) => (
          <span key={p.label}><i style={{ background: p.color }} />{BAND_LABEL[p.label]}</span>
        ))}
      </div>
    </div>
  );
}

function DistrictDetail({ d }) {
  const maxCat = Math.max(...d.breakdown.map((b) => b.cases), 1);
  return (
    <div className="dd">
      <div className="dd-head">
        <h3>{d.name}<span className="dd-year">{d.year}</span></h3>
        <span className="band" style={{ background: BAND_COLOR[d.risk.band] }}>{BAND_LABEL[d.risk.band]} {d.risk.score}</span>
      </div>
      <div className="dd-kpis">
        <div><b>{fmt(d.kpis.total_cognizable_cases)}</b><span>Cognizable cases</span></div>
        <div><b>{d.kpis.crime_rate_per_100k}</b><span>Rate / 100k</span></div>
        <div><b>{d.kpis.severity_weighted_index}</b><span>Severity index</span></div>
        <div><b>{pct(d.kpis.violent_crime_share)}</b><span>Violent share</span></div>
      </div>
      <h4>Trend {d.trend[0].year}–{d.trend.at(-1).year}</h4>
      <AreaTrend series={d.trend} xKey="year" yKey="total" height={160} valueLabel="cases" />
      <h4>Top categories</h4>
      <RankBars items={d.breakdown.slice(0, 6).map((b) => ({ label: b.category_code, value: b.cases }))} colorFor={(_, i) => SERIES[i % SERIES.length]} max={maxCat} />
    </div>
  );
}

const Skeleton = ({ h }) => <div className="skeleton" style={{ height: h }} />;

// Inline icon set.
function Icon({ name }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    map: <><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" /><path d="M9 4v13M15 6.5v13" /></>,
    cube: <><path d="M12 2.8 3.8 7v10L12 21.2 20.2 17V7L12 2.8Z" /><path d="M3.8 7 12 11.2 20.2 7M12 11.2v10" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    network: <><circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="7" r="2.4" /><circle cx="12" cy="18" r="2.4" /><circle cx="12" cy="11" r="2" /><path d="M6.9 7.1 10.3 10M17.2 8.3 13.7 10.2M12 13v2.6" /></>,
    bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></>,
    file: <><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" /><path d="M14 2v5h5M9 13h6M9 17h4" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" fill="currentColor" /></>,
    report: <><path d="M4 3h11l5 5v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v5h5M8 13v4M12 11v6M16 15v2" /></>,
    gear: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.1a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 0 1 0-4h.2A1.7 1.7 0 0 0 2.3 7l-.1-.1A2 2 0 1 1 5 4.1l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1A2 2 0 1 1 21.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
    spark: <><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    check: <><path d="m5 12 5 5 9-10" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    phone: <><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" /></>,
  };
  return <svg {...p} aria-hidden="true">{paths[name]}</svg>;
}
