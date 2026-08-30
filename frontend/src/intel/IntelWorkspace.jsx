import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import '../ops/ops.css';
import { Panel, Skeleton, dateLabel, fmt } from '../ops/ui.jsx';
import LinkGraph from '../ops/LinkGraph.jsx';
import PatternView from '../ops/PatternView.jsx';
import Overview from './Overview.jsx';
import DistrictIntel from './DistrictIntel.jsx';
import { Anomalies, FindingView, Offenders, Profiles } from './IntelPanels.jsx';

// ===========================================================
// Crime Intelligence — the district / pattern intelligence workspace.
//
// The old module went DATA -> ML -> CHART and left the officer to
// interpret it. This one goes:
//
//   DATA -> DETECTION -> FINDING -> EXPLANATION -> INVESTIGATION -> ACTION
//
// Every model the pipeline already ran still runs; what changed is
// that its output now arrives as a ranked finding with a headline,
// its evidence, its method, its caveats and its next step — and the
// algorithm's name lives under "technical details" where it belongs.
// ===========================================================

const VIEWS = {
  OVERVIEW: 'overview',
  PATTERNS: 'patterns',
  ANOMALIES: 'anomalies',
  PROFILES: 'profiles',
  OFFENDERS: 'offenders',
  NETWORK: 'network',
  DISTRICT: 'district',
  FINDING: 'finding',
  PATTERN: 'pattern',
};

export default function IntelWorkspace({ jump, onOpenFir }) {
  const [overview, setOverview] = useState(null);
  const [districts, setDistricts] = useState(null);
  const [offenders, setOffenders] = useState(null);
  const [queue, setQueue] = useState(null);
  const [graph, setGraph] = useState(null);
  const [boundaries, setBoundaries] = useState(null);
  const [error, setError] = useState(null);

  const [view, setView] = useState(VIEWS.OVERVIEW);
  const [findingId, setFindingId] = useState(null);
  const [patternId, setPatternId] = useState(null);
  const [districtId, setDistrictId] = useState(null);
  const [focusEntity, setFocusEntity] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let dead = false;
    const soft = (p) => p.catch(() => null);
    api.ciOverview()
      .then((o) => !dead && setOverview(o))
      .catch((e) => !dead && setError(e.message));
    Promise.all([
      soft(api.ciDistricts()),
      soft(api.ciOffenders()),
      soft(api.firQueue()),
      soft(api.firGraph()),
      fetch('/data/karnataka_districts.geojson').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([d, o, q, g, b]) => {
      if (dead) return;
      setDistricts(d?.districts || {});
      setOffenders(o);
      setQueue(q);
      setGraph(g);
      setBoundaries(b);
    });
    return () => { dead = true; };
  }, []);

  const queueById = useMemo(() => {
    const m = new Map();
    queue?.rows.forEach((r) => m.set(r.fir_id, r));
    return m;
  }, [queue]);

  const patternsById = useMemo(() => {
    const m = new Map();
    queue?.patterns.forEach((p) => m.set(p.cluster_id, p));
    return m;
  }, [queue]);

  const findingsById = useMemo(() => {
    const m = new Map();
    overview?.findings.forEach((f) => m.set(f.finding_id, f));
    return m;
  }, [overview]);

  // Cluster markers for the map, given a centroid from their member FIRs.
  const clusters = useMemo(() => (queue?.patterns || []).map((p) => {
    const cases = p.cases.map((id) => queueById.get(id)).filter((r) => r && r.lat != null);
    return {
      ...p,
      priority: p.case_count >= 6 ? 'CRITICAL' : p.tier === 'head' ? 'WATCH' : 'HIGH',
      peak_window: `${String(p.peak_hour).padStart(2, '0')}:00–${String((p.peak_hour + 4) % 24).padStart(2, '0')}:00`,
      lat: cases.length ? cases.reduce((n, c) => n + c.lat, 0) / cases.length : null,
      lon: cases.length ? cases.reduce((n, c) => n + c.lon, 0) / cases.length : null,
    };
  }), [queue, queueById]);

  const go = useCallback((v) => { setView(v); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  const openFinding = useCallback((f) => {
    // an FIR cluster has a richer, record-level workspace of its own
    if (f.cluster_id && patternsById.has(f.cluster_id)) { setPatternId(f.cluster_id); go(VIEWS.PATTERN); return; }
    setFindingId(f.finding_id);
    go(VIEWS.FINDING);
  }, [go, patternsById]);

  const openPattern = useCallback((id) => { setPatternId(id); go(VIEWS.PATTERN); }, [go]);

  const openDistrict = useCallback((idOrName) => {
    let id = idOrName;
    if (districts && !districts[idOrName]) {
      const hit = Object.values(districts).find((d) => d.name === idOrName);
      if (hit) id = hit.geo_unit_id;
    }
    setDistrictId(id);
    go(VIEWS.DISTRICT);
  }, [districts, go]);

  const openNetwork = useCallback((entity) => {
    setFocusEntity(entity?.entity_id || null);
    go(VIEWS.NETWORK);
  }, [go]);

  // A handoff from the socio-economic module: open the district it was reading.
  useEffect(() => {
    if (jump?.districtId) openDistrict(jump.districtId);
  }, [jump, openDistrict]);

  const note = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 5200);
  }, []);

  // The intelligence module hands off to FIR Intelligence rather than
  // reimplementing case work — that is the whole point of one platform.
  const act = useCallback((action, subject) => {
    const target = action.target || subject?.finding_id;
    switch (action.kind) {
      case 'open_district': openDistrict(target); return;
      case 'open_pattern': case 'open_cluster': openPattern(target); return;
      case 'open_graph': openNetwork({ entity_id: target }); return;
      case 'open_person': openNetwork({ entity_id: target }); return;
      case 'open_case':
        // `?? note(...)` would always fire: an optional call that succeeds still
        // returns undefined. Test the handler itself.
        if (onOpenFir) onOpenFir(target);
        else note('Open FIR Intelligence to view this case.');
        return;
      case 'open_map': go(VIEWS.OVERVIEW); return;
      case 'open_firs': {
        const p = patternsById.get(target);
        if (p) { openPattern(target); return; }
        onOpenFir?.(target);
        return;
      }
      case 'open_evidence': openDistrict(target); return;
      default:
        note(`“${action.label}” is a write/export action. This pilot serves the analysis read-only, `
          + `so it is not committed${target ? ` (target: ${target})` : ''}.`);
    }
  }, [openDistrict, openPattern, openNetwork, onOpenFir, note, go, patternsById]);

  const filterFirs = useCallback((f) => {
    note(`Opening FIR Intelligence filtered to ${[f.district, f.station, f.crimeType].filter(Boolean).join(' · ')}.`);
    onOpenFir?.(null, f);
  }, [note, onOpenFir]);

  if (error) {
    return (
      <div className="ops"><div className="ops-body">
        <div className="data-note"><b>API error</b><span>{error}</span></div>
      </div></div>
    );
  }
  if (!overview) return <div className="ops"><div className="ops-body"><Skeleton h={420} /></div></div>;

  const counts = Object.fromEntries(overview.priority_counts.map((p) => [p.priority, p.count]));
  const anomalyCount = overview.findings.filter(
    (f) => ['crime_spike', 'unusual_pattern', 'forecast'].includes(f.kind),
  ).length;

  const tabs = [
    { id: VIEWS.OVERVIEW, label: 'What changed', count: overview.findings.length },
    { id: VIEWS.PATTERNS, label: 'Crime patterns', count: queue?.patterns.length },
    { id: VIEWS.ANOMALIES, label: 'Anomalies', count: anomalyCount },
    { id: VIEWS.PROFILES, label: 'Crime profiles', count: overview.profiles.profiles.length },
    { id: VIEWS.OFFENDERS, label: 'Repeat offenders', count: offenders?.repeat_offenders },
    { id: VIEWS.NETWORK, label: 'Link analysis' },
  ];

  return (
    <div className="ops">
      <div className="ops-head">
        <div className="ops-head-top">
          <div className="ops-title">
            <h1>Crime Intelligence</h1>
            <span className="ops-sub">
              What changed, where it is happening, and what to investigate next
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <span className="ops-asof">
            {fmt(counts.CRITICAL || 0)} critical · {fmt(counts.HIGH || 0)} high · as of {dateLabel(overview.as_of)}
          </span>
        </div>

        <nav className="ops-tabs" aria-label="Crime Intelligence sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={view === t.id
                || (t.id === VIEWS.OVERVIEW && [VIEWS.FINDING, VIEWS.DISTRICT].includes(view))
                || (t.id === VIEWS.PATTERNS && view === VIEWS.PATTERN) ? 'on' : ''}
              onClick={() => go(t.id)}
            >
              {t.label}
              {t.count != null && <span className="tab-count">{fmt(t.count)}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="ops-body">
        {toast && <div className="data-note"><b>Action</b><span>{toast}</span></div>}

        {view === VIEWS.OVERVIEW && (
          <Overview
            overview={overview}
            districtIntel={districts}
            boundaries={boundaries}
            firRows={queue?.rows || []}
            clusters={clusters}
            onOpenFinding={openFinding}
            onOpenDistrict={openDistrict}
            onOpenPattern={openPattern}
            onAct={act}
          />
        )}

        {view === VIEWS.PATTERNS && (
          <Panel title="Crime patterns" note={`${clusters.length} emerging clusters in the record layer`} flush>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Offence</th><th>District</th><th>Area</th>
                    <th style={{ textAlign: 'right' }}>Incidents</th>
                    <th style={{ textAlign: 'right' }}>Previous</th>
                    <th>Change</th><th>Peak</th><th>Confidence</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((c) => (
                    <tr key={c.cluster_id} onClick={() => openPattern(c.cluster_id)}>
                      <td className="strong">
                        {c.crime_type}
                        {c.tier === 'head' && <span className="sub">broad crime-head signal</span>}
                      </td>
                      <td>{c.district}</td>
                      <td>{c.area}</td>
                      <td className="num strong">{c.case_count}</td>
                      <td className="num muted-note">{c.baseline}</td>
                      <td><b className="delta up">{c.change_pct != null ? `+${c.change_pct}%` : 'new'}</b></td>
                      <td>{c.peak_window}</td>
                      <td>{Math.round(c.confidence * 100)}%</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-sm btn-primary" onClick={() => openPattern(c.cluster_id)}>
                          Investigate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {view === VIEWS.ANOMALIES && (
          <Anomalies findings={overview.findings} onOpen={openFinding} onAct={act} />
        )}

        {view === VIEWS.PROFILES && (
          <Profiles profiles={overview.profiles} onOpenDistrict={openDistrict} />
        )}

        {view === VIEWS.OFFENDERS && (
          offenders
            ? <Offenders offenders={offenders} queueById={queueById}
                onOpenCase={(id) => onOpenFir?.(id)} onNetwork={openNetwork} />
            : <Skeleton h={360} />
        )}

        {view === VIEWS.NETWORK && (
          <Panel title="Link analysis" note="Person · vehicle · phone · location · FIR · station" flush>
            {graph
              ? <LinkGraph graph={graph} focusId={focusEntity || graph.nodes.find((n) => n.kind === 'person')?.id}
                  onOpen={(n) => (n.kind === 'fir' ? onOpenFir?.(n.id) : openNetwork({ entity_id: n.id }))}
                  height={620} />
              : <Skeleton h={560} />}
          </Panel>
        )}

        {view === VIEWS.FINDING && (
          <FindingView
            finding={findingsById.get(findingId)}
            districtIntel={districts}
            onBack={() => go(VIEWS.OVERVIEW)}
            onAct={act}
            onOpenDistrict={openDistrict}
          />
        )}

        {view === VIEWS.PATTERN && (
          <PatternView
            pattern={patternsById.get(patternId)}
            queueById={queueById}
            onOpenCase={(id) => onOpenFir?.(id)}
            onNetwork={openNetwork}
            onBack={() => go(VIEWS.PATTERNS)}
            onAct={act}
            backLabel="Crime patterns"
          />
        )}

        {view === VIEWS.DISTRICT && (
          <DistrictIntel
            district={districts?.[districtId]}
            findings={overview.findings}
            patterns={clusters}
            queueById={queueById}
            onBack={() => go(VIEWS.OVERVIEW)}
            onOpenFinding={openFinding}
            onOpenPattern={openPattern}
            onOpenCase={(id) => onOpenFir?.(id)}
            onFilterFirs={filterFirs}
            onMap={() => go(VIEWS.OVERVIEW)}
          />
        )}

        <div className="data-note"><b>Data</b><span>{overview.data_note}</span></div>
      </div>
    </div>
  );
}
