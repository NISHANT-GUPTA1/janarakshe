import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import CrimeMap from '../CrimeMap.jsx';
import Intelligence from '../Intelligence.jsx';
import Correlations from '../Correlations.jsx';
import FIRIntelligence from '../FIRIntelligence.jsx';
import District3D from './District3D.jsx';

// three.js + the force-graph engine are heavy; keep them out of the initial bundle.
const NetworkGraph = lazy(() => import('../NetworkGraph.jsx'));
import { AreaTrend, Donut, HourBars, RankBars, Sparkline } from './charts.jsx';
import { BAND_COLOR, BAND_ORDER, SERIES, fmt, pct, hourLabel } from './palette.js';
import './dashboard.css';

const STATUS_LABEL = { none: 'Stable', emerging: 'Emerging', established: 'Hotspot' };

const RAIL = [
  { id: 'cc-overview', label: 'Overview', icon: 'grid' },
  { id: 'cc-map', label: 'Heat Map', icon: 'map' },
  { id: 'cc-3d', label: '3D Terrain', icon: 'cube' },
  { id: 'cc-network', label: 'Network', icon: 'network' },
  { id: 'cc-analytics', label: 'Analytics', icon: 'chart' },
  { id: 'cc-alerts', label: 'Alerts', icon: 'bell' },
  { id: 'cc-deepdive', label: 'Deep Dive', icon: 'layers' },
];

const DEEP_TABS = [
  { id: 'districts', label: 'Districts & Risk' },
  { id: 'intelligence', label: 'Crime Intelligence' },
  { id: 'correlations', label: 'Socio-economic' },
  { id: 'fir', label: 'FIR Intelligence' },
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
  const [hour, setHour] = useState(null);       // 0..23 scrub for the 3D scene
  const [tab, setTab] = useState('districts');
  const [active, setActive] = useState('cc-overview');

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
      // FIR network (not intelligence/network): only this payload carries a
      // case_graph, which is what enables the person<->case "Cases" view.
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

  // scroll-spy for the icon rail
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0.1, 0.4] }
    );
    RAIL.forEach((r) => { const el = document.getElementById(r.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [districts.length]);

  // Stable identity: this is handed to the 3D scene and the map, which both key
  // expensive setup off their props.
  const select = useCallback((id) => {
    api.district(id).then(setSelected).catch((e) => setError(e.message));
    document.getElementById('cc-detail')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // ---------- derived analytics ----------
  const filtered = useMemo(() => districts.filter((d) => {
    if (q && !d.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (bands.length && !bands.includes(d.risk_band)) return false;
    if (hotOnly && d.hotspot_status === 'none') return false;
    return true;
  }), [districts, q, bands, hotOnly]);

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
      series,
      latest,
      delta,
      bandCounts,
      highRisk: districts.filter((d) => d.risk_band === 'High' || d.risk_band === 'Critical').length,
      established: hotspots.filter((d) => d.hotspot_status === 'established').length,
      emerging: hotspots.filter((d) => d.hotspot_status === 'emerging').length,
      peakHour,
      hist,
    };
  }, [districts, trends, spatio]);

  // The recommendation is *derived* from the data on screen — not a canned string.
  const advisory = useMemo(() => {
    if (!districts.length) return null;
    const top = [...districts].sort((a, b) => b.risk_score - a.risk_score)[0];
    const hist = spatio?.hour_histogram ?? [];
    if (!hist.length) return { top, window: null, peak: null };
    const peak = hist.indexOf(Math.max(...hist));
    // best contiguous 3-hour deployment window
    let bestStart = 0;
    let best = -1;
    for (let h = 0; h < 24; h++) {
      const sum = hist[h] + hist[(h + 1) % 24] + hist[(h + 2) % 24];
      if (sum > best) { best = sum; bestStart = h; }
    }
    const share = best / hist.reduce((a, b) => a + b, 0);
    return { top, peak, window: { start: bestStart, end: (bestStart + 3) % 24, share } };
  }, [districts, spatio]);

  const alerts = useMemo(() => {
    const a = patterns?.anomalies ?? [];
    return [...a].sort((x, y) => Math.abs(y.zscore) - Math.abs(x.zscore)).slice(0, 6);
  }, [patterns]);

  const topRisk = useMemo(
    () => [...filtered].sort((a, b) => b.risk_score - a.risk_score).slice(0, 6),
    [filtered]
  );

  const toggleBand = (b) => setBands((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]));
  const resetFilters = () => { setQ(''); setBands([]); setHotOnly(false); };

  if (error) {
    return (
      <div className="cc">
        <div className="cc-error">
          <b>Could not reach the analytics API</b> ({error}).<br />
          Start the backend: <code>python -m pipeline.run</code> then <code>uvicorn app.main:app --reload</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="cc">
      <IconRail active={active} />

      <div className="cc-body">
        {/* ---------- Row A — hero + KPI tiles ---------- */}
        <section id="cc-overview" className="cc-row cc-row-hero">
          <Hero meta={meta} districtCount={districts.length} />

          <div className="cc-kpis">
            <KpiCard
              tone="blue"
              icon="file"
              label="Cognizable Cases"
              value={stats?.latest ? fmt(stats.latest) : '—'}
              sub={trends ? `Karnataka · ${stats.series.at(-1)?.year ?? ''}` : 'loading…'}
              delta={stats?.delta}
              chart={stats?.series?.length ? <Sparkline data={stats.series.map((s) => s.total_cognizable_cases)} color={SERIES[0]} /> : null}
            />
            <KpiCard
              tone="red"
              icon="flame"
              label="Active Hotspots"
              value={stats ? stats.established + stats.emerging : '—'}
              sub={stats ? `${stats.established} established · ${stats.emerging} emerging` : ''}
              chart={stats ? <BandStrip counts={stats.bandCounts} /> : null}
            />
            <KpiCard
              tone="green"
              icon="shield"
              label="Detection Rate"
              value={fir ? pct(fir.detection.detection_rate, 1) : '—'}
              sub={fir ? `${fmt(fir.detection.chargesheeted)} charge-sheeted of ${fmt(fir.total_cases)} FIRs` : 'loading…'}
              chart={fir ? (
                <BandStrip counts={[
                  { label: 'Charge-sheeted', value: fir.detection.chargesheeted, color: BAND_COLOR.Low },
                  { label: 'Undetected', value: fir.detection.undetected, color: BAND_COLOR.High },
                  { label: 'False', value: fir.detection.false, color: '#3a4a63' },
                ]} />
              ) : null}
            />
            <KpiCard
              tone="violet"
              icon="clock"
              label="Peak Crime Hour"
              value={stats?.peakHour != null ? hourLabel(stats.peakHour) : '—'}
              sub={advisory?.window ? `Surge window ${hourLabel(advisory.window.start)}–${hourLabel(advisory.window.end)}` : 'loading…'}
              chart={stats?.hist?.length ? <Sparkline data={stats.hist} color={SERIES[3]} /> : null}
            />
          </div>
        </section>

        {/* ---------- Row B — filters + map + rail ---------- */}
        <section id="cc-map" className="cc-row cc-row-map">
          <aside className="panel cc-filters">
            <h3 className="panel-h">Filters</h3>

            <label className="fld">
              <span>Search district</span>
              <input
                type="search"
                value={q}
                placeholder="e.g. Bengaluru"
                onChange={(e) => setQ(e.target.value)}
              />
            </label>

            <div className="fld">
              <span>Risk band</span>
              <div className="chips">
                {BAND_ORDER.map((b) => (
                  <button
                    key={b}
                    className={`chip ${bands.includes(b) ? 'on' : ''}`}
                    onClick={() => toggleBand(b)}
                    aria-pressed={bands.includes(b)}
                  >
                    <i style={{ background: BAND_COLOR[b] }} />{b}
                  </button>
                ))}
              </div>
            </div>

            <label className="switch">
              <input type="checkbox" checked={hotOnly} onChange={(e) => setHotOnly(e.target.checked)} />
              <span className="sw-track"><span className="sw-dot" /></span>
              <span>Hotspots only</span>
            </label>

            <div className="cc-filter-out">
              <b>{filtered.length}</b> of {districts.length} districts
            </div>
            <button className="btn-ghost w-full" onClick={resetFilters}>Reset filters</button>

            <div className="cc-mini">
              <h4>Risk composition</h4>
              {stats && (
                <RankBars
                  items={stats.bandCounts.map((b) => ({ label: b.label, value: b.value }))}
                  colorFor={(it) => BAND_COLOR[it.label]}
                  unit=""
                />
              )}
            </div>
          </aside>

          <div className="panel cc-map-panel">
            <div className="panel-h-row">
              <h3 className="panel-h">Karnataka Crime Map</h3>
              <span className="panel-note">{focusIds ? 'Filtered view' : 'All districts'}</span>
            </div>
            {districts.length > 0 ? (
              <CrimeMap
                districts={districts}
                boundaries={boundaries}
                selectedId={selected?.geo_unit_id}
                focusIds={focusIds}
                height={560}
                onSelect={select}
              />
            ) : (
              <Skeleton h={520} />
            )}
          </div>

          <aside className="cc-rail">
            <div className="panel">
              <div className="panel-h-row">
                <h3 className="panel-h">Top Risk Districts</h3>
                <span className="panel-note">risk score</span>
              </div>
              <ol className="toplist">
                {topRisk.map((d, i) => (
                  <li key={d.geo_unit_id} className={selected?.geo_unit_id === d.geo_unit_id ? 'on' : ''}>
                    <button onClick={() => select(d.geo_unit_id)}>
                      <span className="tl-rank">{i + 1}</span>
                      <span className="tl-name">
                        {d.name}
                        <em>{d.crime_rate_per_100k}/100k · {STATUS_LABEL[d.hotspot_status]}</em>
                      </span>
                      <span className="tl-score" style={{ color: BAND_COLOR[d.risk_band] }}>
                        {d.risk_score}
                      </span>
                    </button>
                  </li>
                ))}
                {!topRisk.length && <li className="tl-empty">No districts match the filters.</li>}
              </ol>
            </div>

            {advisory && (
              <div className="panel advisory">
                <h3 className="panel-h">
                  <Icon name="spark" /> AI Recommendation
                </h3>
                <p>
                  <b>{advisory.top.name}</b> carries the highest composite risk
                  ({advisory.top.risk_score}, {advisory.top.risk_band.toLowerCase()} band) at{' '}
                  {advisory.top.crime_rate_per_100k} cases per 100k.
                  {advisory.window && (
                    <> Incidents concentrate between{' '}
                      <b>{hourLabel(advisory.window.start)}–{hourLabel(advisory.window.end)}</b>, carrying{' '}
                      {pct(advisory.window.share, 0)} of all FIRs — prioritise patrol density in that window.
                    </>
                  )}
                </p>
                <button className="btn-primary" onClick={() => select(advisory.top.geo_unit_id)}>
                  Drill into {advisory.top.name}
                </button>
              </div>
            )}
          </aside>
        </section>

        {/* ---------- Row C — the 3D terrain ---------- */}
        <section id="cc-3d" className="cc-row">
          <div className="panel cc-3d-panel">
            <div className="panel-h-row">
              <div>
                <h3 className="panel-h">3D Crime Terrain</h3>
                <p className="panel-sub">
                  District polygons extruded by magnitude and coloured by risk band. Pillars mark FIR
                  hotspot cells; scrub an hour below to drop that hour's incidents onto the terrain.
                </p>
              </div>
              {hour != null && (
                <button className="btn-ghost" onClick={() => setHour(null)}>Clear hour · {hourLabel(hour)}</button>
              )}
            </div>

            <div className="cc-3d-grid">
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
              ) : (
                <Skeleton h={460} />
              )}

              <div className="cc-3d-side">
                <h4>Incidents by hour of day</h4>
                <p className="panel-sub">Click a bar to project that hour into the scene.</p>
                {spatio ? (
                  <>
                    <HourBars
                      histogram={spatio.hour_histogram}
                      gravityByHour={spatio.gravity_by_hour}
                      selected={hour}
                      onSelect={setHour}
                    />
                    <div className="hb-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
                    <div className="legend-row">
                      <span><i style={{ background: SERIES[0] }} />All FIRs</span>
                      <span><i style={{ background: SERIES[4] }} />Heinous</span>
                    </div>
                    <dl className="statlist">
                      <div><dt>FIR points plotted</dt><dd>{fmt(spatio.points.length)}</dd></div>
                      <div><dt>Hotspot cells</dt><dd>{fmt(spatio.hotspots.length)}</dd></div>
                      <div><dt>Quietest hour</dt><dd>{hourLabel(spatio.hour_histogram.indexOf(Math.min(...spatio.hour_histogram)))}</dd></div>
                    </dl>
                  </>
                ) : <Skeleton h={300} />}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Row C2 — 3D co-offender network ---------- */}
        <section id="cc-network" className="cc-row">
          <div className="panel cc-net-panel">
            {/* The graph carries its own title, guide and legend, so the panel
                header stays to the stats and does not repeat them. */}
            <div className="panel-h-row">
              <h3 className="panel-h">3D Offender Network</h3>
              {network && (
                <div className="net-stats">
                  <span><b>{fmt(network.summary.nodes)}</b>offenders</span>
                  <span><b>{fmt(network.summary.edges)}</b>links</span>
                  <span><b>{fmt(network.summary.components)}</b>crews</span>
                </div>
              )}
            </div>

            {network?.graph ? (
              <Suspense fallback={<Skeleton h={560} />}>
                <NetworkGraph
                  graph={network.graph}
                  caseGraph={network.case_graph}
                  summary={network.summary}
                  embedded
                />
              </Suspense>
            ) : (
              <Skeleton h={560} />
            )}
          </div>
        </section>

        {/* ---------- Row D — trend, composition, alerts ---------- */}
        <section id="cc-analytics" className="cc-row cc-row-analytics">
          <div className="panel">
            <div className="panel-h-row">
              <h3 className="panel-h">Statewide Crime Trend</h3>
              <span className="panel-note">
                {trends ? `${trends.series[0].year}–${trends.series.at(-1).year} · cognizable cases` : ''}
              </span>
            </div>
            {trends ? (
              <AreaTrend series={trends.series} xKey="year" yKey="total_cognizable_cases" valueLabel="cases" />
            ) : <Skeleton h={210} />}
          </div>

          <div className="panel">
            <h3 className="panel-h">Risk Distribution</h3>
            {stats ? (
              <Donut data={stats.bandCounts} total={districts.length} centerLabel="Districts" />
            ) : <Skeleton h={200} />}
          </div>

          <div className="panel" id="cc-alerts">
            <div className="panel-h-row">
              <h3 className="panel-h">Anomaly Alerts</h3>
              <span className="panel-note">z-score outliers</span>
            </div>
            <ul className="alerts">
              {alerts.map((a) => {
                const spike = a.direction === 'spike';
                return (
                  <li key={`${a.geo_unit_id}-${a.year}`}>
                    <span className={`al-icon ${spike ? 'up' : 'down'}`} aria-hidden="true">{spike ? '▲' : '▼'}</span>
                    <span className="al-text">
                      <b>{a.name}</b>
                      <em>
                        {spike ? 'Spike' : 'Drop'} in {a.year} — {fmt(a.cases)} cases
                        (z {a.zscore > 0 ? '+' : ''}{a.zscore})
                      </em>
                    </span>
                    <button className="al-go" onClick={() => select(a.geo_unit_id)}>View</button>
                  </li>
                );
              })}
              {!alerts.length && <li className="tl-empty">No anomalies detected.</li>}
            </ul>
          </div>
        </section>

        {/* ---------- Row E — drill-down + the existing deep-dive modules ---------- */}
        <section id="cc-deepdive" className="cc-row">
          <div className="panel" id="cc-detail">
            <div className="cc-tabs">
              {DEEP_TABS.map((t) => (
                <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="cc-tabpane">
              {tab === 'districts' && (
                <div className="cc-drill">
                  <div className="cc-table-wrap">
                    <table className="cc-table">
                      <thead>
                        <tr><th>District</th><th>Rate/100k</th><th>Cases</th><th>Status</th><th>Risk</th></tr>
                      </thead>
                      <tbody>
                        {filtered.map((d) => (
                          <tr
                            key={d.geo_unit_id}
                            className={selected?.geo_unit_id === d.geo_unit_id ? 'sel' : ''}
                            onClick={() => select(d.geo_unit_id)}
                          >
                            <td>{d.name}</td>
                            <td className="num">{d.crime_rate_per_100k}</td>
                            <td className="num">{fmt(d.total_cognizable_cases)}</td>
                            <td>{STATUS_LABEL[d.hotspot_status]}</td>
                            <td>
                              <span className="band" style={{ background: BAND_COLOR[d.risk_band] }}>
                                {d.risk_band} {d.risk_score}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="cc-detail">
                    {selected ? <DistrictDetail d={selected} /> : (
                      <p className="hint">Select a district — on the map, the 3D terrain, or the table — to drill down.</p>
                    )}
                  </div>
                </div>
              )}
              {tab === 'intelligence' && <div className="cc-embed"><Intelligence /></div>}
              {tab === 'correlations' && <div className="cc-embed"><Correlations /></div>}
              {tab === 'fir' && <div className="cc-embed"><FIRIntelligence /></div>}
            </div>
          </div>
        </section>

        {meta && <p className="cc-note"><b>Data note:</b> {meta.data_note}</p>}
      </div>
    </div>
  );
}

// ===========================================================
// Pieces
// ===========================================================

function Hero({ meta, districtCount }) {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div className="cc-hero">
      <div className="cc-hero-txt">
        <span className="cc-eyebrow">
          <span className="dot-live" /> Live · Karnataka State Police
        </span>
        <h1>
          <span className="grad">Crime</span>Watch <span className="thin">Karnataka</span>
        </h1>
        <p>
          AI-driven crime analytics on NCRB district records and FIR-schema case data —
          surfacing hotspots, risk bands, offender networks and temporal surges for
          data-driven deployment.
        </p>
        <div className="cc-hero-cta">
          <button className="btn-primary" onClick={() => scroll('cc-map')}>
            <Icon name="map" /> Explore Map
          </button>
          <button className="btn-ghost" onClick={() => scroll('cc-3d')}>
            <Icon name="cube" /> 3D Terrain
          </button>
        </div>
        <div className="cc-hero-meta">
          {meta ? (
            <>
              <span><b>{districtCount || meta.district_count}</b> districts</span>
              <span><b>{meta.years[0]}–{meta.years.at(-1)}</b> series</span>
              <span><b>{meta.metrics_available.length}</b> KPIs</span>
            </>
          ) : <span>Connecting to analytics API…</span>}
        </div>
      </div>
      <div className="cc-hero-art" aria-hidden="true">
        <RadarArt />
      </div>
    </div>
  );
}

// Decorative sweep — pure CSS/SVG, no data meaning, so it never competes with a chart.
function RadarArt() {
  return (
    <svg viewBox="0 0 220 220" className="radar">
      <defs>
        <radialGradient id="rg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3987e5" stopOpacity="0.35" />
          <stop offset="70%" stopColor="#3987e5" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#3987e5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#3987e5" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#3987e5" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="110" cy="110" r="104" fill="url(#rg)" />
      {[34, 60, 86, 104].map((r) => (
        <circle key={r} cx="110" cy="110" r={r} fill="none" stroke="rgba(57,135,229,0.28)" strokeWidth="1" />
      ))}
      <line x1="6" y1="110" x2="214" y2="110" stroke="rgba(57,135,229,0.22)" strokeWidth="1" />
      <line x1="110" y1="6" x2="110" y2="214" stroke="rgba(57,135,229,0.22)" strokeWidth="1" />
      <g className="radar-sweep" style={{ transformOrigin: '110px 110px' }}>
        <path d="M110,110 L214,110 A104,104 0 0,0 162,20 Z" fill="url(#sweep)" />
      </g>
      {[[150, 70], [78, 148], [160, 152], [66, 74], [120, 46]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="3.5" fill={i < 2 ? '#e66767' : '#fab219'} className="blip" style={{ animationDelay: `${i * 0.6}s` }} />
      ))}
    </svg>
  );
}

function KpiCard({ tone, icon, label, value, sub, delta, chart }) {
  return (
    <div className={`kpi-card t-${tone}`}>
      <div className="kpi-top">
        <span className="kpi-icon"><Icon name={icon} /></span>
        {delta != null && (
          <span className={`kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      <div className="kpi-sub">{sub}</div>
      <div className="kpi-chart">{chart}</div>
    </div>
  );
}

// Stacked composition strip — 2px surface gaps between fills.
function BandStrip({ counts }) {
  const sum = counts.reduce((a, c) => a + c.value, 0) || 1;
  return (
    <div className="strip" role="img" aria-label={counts.map((c) => `${c.label} ${c.value}`).join(', ')}>
      {counts.map((c) => (
        <span key={c.label} style={{ width: `${(c.value / sum) * 100}%`, background: c.color }} title={`${c.label}: ${c.value}`} />
      ))}
    </div>
  );
}

function DistrictDetail({ d }) {
  const maxCat = Math.max(...d.breakdown.map((b) => b.cases), 1);
  return (
    <div className="dd">
      <div className="dd-head">
        <h3>{d.name}<span className="dd-year">{d.year}</span></h3>
        <span className="band" style={{ background: BAND_COLOR[d.risk.band] }}>
          {d.risk.band} {d.risk.score}
        </span>
      </div>

      <div className="dd-kpis">
        <div><b>{fmt(d.kpis.total_cognizable_cases)}</b><span>Cognizable cases</span></div>
        <div><b>{d.kpis.crime_rate_per_100k}</b><span>Rate / 100k</span></div>
        <div><b>{d.kpis.severity_weighted_index}</b><span>Severity index</span></div>
        <div><b>{pct(d.kpis.violent_crime_share)}</b><span>Violent share</span></div>
      </div>

      <h4>Trend {d.trend[0].year}–{d.trend.at(-1).year}</h4>
      <AreaTrend series={d.trend} xKey="year" yKey="total" height={160} valueLabel="cases" />

      <h4>Risk contributions</h4>
      <RankBars
        items={Object.entries(d.risk.components).map(([k, c]) => ({
          label: k.replace(/_/g, ' '),
          value: c.contribution,
        }))}
        colorFor={(_, i) => SERIES[i]}
      />

      <h4>Top categories</h4>
      <RankBars
        items={d.breakdown.slice(0, 6).map((b) => ({ label: b.category_code, value: b.cases }))}
        colorFor={(_, i) => SERIES[i % SERIES.length]}
        max={maxCat}
      />
    </div>
  );
}

function IconRail({ active }) {
  return (
    <nav className="cc-rail-nav" aria-label="Dashboard sections">
      {RAIL.map((r) => (
        <button
          key={r.id}
          className={active === r.id ? 'on' : ''}
          onClick={() => document.getElementById(r.id)?.scrollIntoView({ behavior: 'smooth' })}
          title={r.label}
        >
          <Icon name={r.icon} />
          <span>{r.label}</span>
        </button>
      ))}
    </nav>
  );
}

const Skeleton = ({ h }) => <div className="skeleton" style={{ height: h }} />;

// Inline icon set — stroke icons keep the rail crisp at any font size.
function Icon({ name }) {
  const p = {
    width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    map: <><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z" /><path d="M9 4v13M15 6.5v13" /></>,
    cube: <><path d="M12 2.8 3.8 7v10L12 21.2 20.2 17V7L12 2.8Z" /><path d="M3.8 7 12 11.2 20.2 7M12 11.2v10" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    network: <><circle cx="5" cy="6" r="2.4" /><circle cx="19" cy="7" r="2.4" /><circle cx="12" cy="18" r="2.4" /><circle cx="12" cy="11" r="2" /><path d="M6.9 7.1 10.3 10M17.2 8.3 13.7 10.2M12 13v2.6" /></>,
    bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
    file: <><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" /><path d="M14 2v5h5M9 13h6M9 17h4" /></>,
    flame: <><path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.8-2.9.8-2.9S9 10 9.5 11c0-3 2.5-6 2.5-9Z" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    spark: <><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /><circle cx="12" cy="12" r="3.2" /></>,
  };
  return <svg {...p} aria-hidden="true">{paths[name]}</svg>;
}
