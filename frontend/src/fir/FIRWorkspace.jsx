import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, asset } from '../api.js';
import '../ops/ops.css';
import { Empty, Panel, Skeleton, dateLabel, fmt } from '../ops/ui.jsx';
import LinkGraph from '../ops/LinkGraph.jsx';
import IntelMap from '../ops/IntelMap.jsx';
import PatternView from '../ops/PatternView.jsx';
import GlobalSearch, { EntityCard } from './GlobalSearch.jsx';
import Queue from './Queue.jsx';
import CaseFile from './CaseFile.jsx';
import { Alerts, StatisticalProfile } from './FIRPanels.jsx';

// ===========================================================
// FIR Intelligence — the investigating officer's workspace.
//
// One question drives the whole information architecture:
//
//   what needs my attention -> what happened -> who is involved ->
//   what is connected -> why does it matter -> what do I do next
//
// So the module opens on a work queue, not on charts. Demographics,
// which used to lead this page, are still here in full — moved to
// "Statistical profile", out of the operational path, because
// putting caste and religion next to a live case queue frames them
// as case factors, which they are not.
// ===========================================================

const VIEWS = {
  QUEUE: 'queue',
  CASE: 'case',
  PATTERN: 'pattern',
  NETWORK: 'network',
  ALERTS: 'alerts',
  MAP: 'map',
  STATS: 'stats',
};

export default function FIRWorkspace({ jump }) {
  const [queue, setQueue] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [searchIndex, setSearchIndex] = useState([]);
  const [graph, setGraph] = useState(null);
  const [boundaries, setBoundaries] = useState(null);
  const [error, setError] = useState(null);

  const [view, setView] = useState(VIEWS.QUEUE);
  const [caseId, setCaseId] = useState(null);
  const [caseData, setCaseData] = useState(null);
  const [caseErr, setCaseErr] = useState(null);
  const [patternId, setPatternId] = useState(null);
  const [focusEntity, setFocusEntity] = useState(null);
  const [pickedEntity, setPickedEntity] = useState(null);
  const [queueFilter, setQueueFilter] = useState(null);
  const [toast, setToast] = useState(null);

  // The queue is the backbone: every other view joins against it, so it loads
  // first and the heavier payloads (search index, link graph) follow behind.
  useEffect(() => {
    let dead = false;
    const soft = (p) => p.catch(() => null);
    api.firQueue()
      .then((q) => { if (!dead) setQueue(q); })
      .catch((e) => !dead && setError(e.message));
    Promise.all([
      soft(api.firAlerts()),
      soft(api.firSearchIndex()),
      soft(api.firGraph()),
      soft(asset('/data/karnataka_districts.geojson')),
    ]).then(([a, s, g, b]) => {
      if (dead) return;
      setAlerts(a?.alerts || []);
      setSearchIndex(s?.entities || []);
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

  // ---- navigation -----------------------------------------------------------
  const go = useCallback((v) => { setView(v); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  const openCase = useCallback((id) => {
    setCaseId(id);
    setCaseData(null);
    setCaseErr(null);
    go(VIEWS.CASE);
    api.firCase(id).then(setCaseData).catch((e) => setCaseErr(e.message));
  }, [go]);

  const openPattern = useCallback((id) => { setPatternId(id); go(VIEWS.PATTERN); }, [go]);

  // A handoff from Crime Intelligence: open the case it named, or scope the
  // queue to the district / station / crime type it was looking at.
  useEffect(() => {
    if (!jump) return;
    if (jump.firId) { openCase(jump.firId); return; }
    if (jump.filter) { setQueueFilter({ ...jump.filter, at: jump.at }); go(VIEWS.QUEUE); }
  }, [jump, openCase, go]);

  const openNetwork = useCallback((entity) => {
    setFocusEntity(entity?.entity_id || entity?.fir_id || null);
    go(VIEWS.NETWORK);
  }, [go]);

  const pickEntity = useCallback((entity) => {
    if (entity.kind === 'fir') { openCase(entity.entity_id); return; }
    setPickedEntity(entity);
    go(VIEWS.QUEUE);
  }, [go, openCase]);

  // Actions are wired end-to-end but write operations are not part of this
  // read-only pilot; each one reports exactly what it would do and to what.
  const act = useCallback((action, subject) => {
    const target = action.target || subject?.fir_id || subject?.alert_id;
    switch (action.kind) {
      case 'open_case': openCase(target); return;
      case 'open_graph': openNetwork({ entity_id: target }); return;
      case 'open_pattern': case 'open_cluster': openPattern(target); return;
      case 'open_map': go(VIEWS.MAP); return;
      case 'open_firs': {
        const p = patternsById.get(target);
        if (p?.cases?.length) openCase(p.cases[0]);
        return;
      }
      default:
        setToast(`“${action.label}” is a write action. This pilot serves the record set read-only, `
          + `so it is not committed${target ? ` (target: ${target})` : ''}.`);
        setTimeout(() => setToast(null), 5200);
    }
  }, [openCase, openNetwork, openPattern, go, patternsById]);

  if (error) {
    return (
      <div className="ops"><div className="ops-body">
        <div className="data-note"><b>API error</b><span>{error}</span></div>
      </div></div>
    );
  }
  if (!queue) {
    return <div className="ops"><div className="ops-body"><Skeleton h={420} /></div></div>;
  }

  const s = queue.summary;
  const tabs = [
    { id: VIEWS.QUEUE, label: 'Work queue', count: s.total },
    { id: VIEWS.ALERTS, label: 'Alerts', count: alerts?.length },
    { id: VIEWS.MAP, label: 'Map' },
    { id: VIEWS.NETWORK, label: 'Link analysis' },
    { id: VIEWS.STATS, label: 'Statistical profile' },
  ];

  const clusterMarkers = queue.patterns.map((p) => {
    const cases = p.cases.map((id) => queueById.get(id)).filter((r) => r && r.lat != null);
    return {
      ...p,
      priority: p.case_count >= 6 ? 'CRITICAL' : 'HIGH',
      peak_window: `${String(p.peak_hour).padStart(2, '0')}:00`,
      lat: cases.length ? cases.reduce((n, c) => n + c.lat, 0) / cases.length : null,
      lon: cases.length ? cases.reduce((n, c) => n + c.lon, 0) / cases.length : null,
    };
  });

  return (
    <div className="ops">
      {/* ---------------- header ---------------- */}
      <div className="ops-head">
        <div className="ops-head-top">
          <div className="ops-title">
            <h1>FIR Intelligence</h1>
            <span className="ops-sub">Case work queue &amp; investigation workspace</span>
          </div>
          <GlobalSearch index={searchIndex} onPick={pickEntity} asOf={queue.as_of} />
          <span className="ops-asof">Operational clock: {dateLabel(queue.as_of)}</span>
        </div>

        <nav className="ops-tabs" aria-label="FIR Intelligence sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={view === t.id || (t.id === VIEWS.QUEUE && (view === VIEWS.CASE || view === VIEWS.PATTERN)) ? 'on' : ''}
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

        {pickedEntity && view === VIEWS.QUEUE && (
          <EntityCard
            entity={pickedEntity}
            queueById={queueById}
            onOpenFir={openCase}
            onNetwork={openNetwork}
            onClear={() => setPickedEntity(null)}
          />
        )}

        {view === VIEWS.QUEUE && (
          <Queue
            queue={queue}
            initialFilter={queueFilter}
            onOpenCase={openCase}
            onOpenPattern={openPattern}
            onAct={act}
          />
        )}

        {view === VIEWS.CASE && (
          caseErr
            ? <div className="data-note"><b>Case unavailable</b><span>{caseErr}</span></div>
            : caseData
              ? (
                <CaseFile
                  detail={caseData.case}
                  stages={caseData.stages}
                  rules={caseData.rules}
                  queueById={queueById}
                  patternsById={patternsById}
                  asOf={queue.as_of}
                  onOpenCase={openCase}
                  onOpenPattern={openPattern}
                  onNetwork={openNetwork}
                  onBack={() => go(VIEWS.QUEUE)}
                  onAct={act}
                />
              )
              : <Skeleton h={420} />
        )}

        {view === VIEWS.PATTERN && (
          <PatternView
            pattern={patternsById.get(patternId)}
            queueById={queueById}
            onOpenCase={openCase}
            onNetwork={openNetwork}
            onBack={() => go(VIEWS.QUEUE)}
            onAct={act}
            onMap={() => go(VIEWS.MAP)}
            backLabel="FIR work queue"
          />
        )}

        {view === VIEWS.ALERTS && (
          alerts
            ? <Alerts alerts={alerts} asOf={queue.as_of} queueById={queueById} onAct={act} />
            : <Skeleton h={320} />
        )}

        {view === VIEWS.MAP && (
          <Panel
            title="Crime intelligence map"
            note="Emerging clusters and FIR locations across the operational window"
            flush
          >
            <IntelMap
              clusters={clusterMarkers}
              firs={queue.rows}
              boundaries={boundaries}
              districts={[]}
              height={560}
              onInvestigate={(c) => openPattern(c.cluster_id)}
              onOpenFir={openCase}
            />
          </Panel>
        )}

        {view === VIEWS.NETWORK && (
          <Panel
            title="Link analysis"
            note="Person · vehicle · phone · location · FIR · station"
            flush
          >
            {graph
              ? (
                <LinkGraph
                  graph={graph}
                  focusId={focusEntity || queue.rows[0]?.fir_id}
                  onOpen={(n) => (n.kind === 'fir' ? openCase(n.id) : openNetwork({ entity_id: n.id }))}
                  height={620}
                />
              )
              : <Skeleton h={560} />}
          </Panel>
        )}

        {view === VIEWS.STATS && <StatisticalProfile />}

        <div className="data-note">
          <b>Data</b>
          <span>{queue.data_note}</span>
        </div>
      </div>
    </div>
  );
}
