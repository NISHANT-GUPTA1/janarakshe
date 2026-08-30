import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import { escapeHtml } from './safeHtml.js';

// Shared chrome for the hover tooltips (static markup, no interpolation).
const TOOLTIP_STYLE =
  'font:600 12px Inter,sans-serif;color:#fff;background:#181818;'
  + 'border:1px solid #383838;border-radius:6px;padding:6px 9px';

// Vivid palette to distinguish co-offending clusters (component id -> color).
// Netflix red leads; the rest give enough separation for many components.
const PALETTE = [
  '#e50914', '#ff6a70', '#f5b301', '#4f9dff', '#7c5cff',
  '#1ec98b', '#ff8a3d', '#d36bff', '#36c5d8', '#c0c0c0',
];
const colorFor = (component) =>
  component == null ? '#6b6b6b' : PALETTE[component % PALETTE.length];

// In the "cases" (bipartite) view we use just two colors so the two kinds of
// dot are unmistakable: red = a person, amber = a case.
const PERSON_COLOR = '#e50914';
const CASE_COLOR = '#f5b301';

const idOf = (end) => (end && end.id != null ? end.id : end);

// Everything connected to one person ("ego network"), so a name search can
// drop the view to just that individual's world.
//   • partnerships: the person + their direct co-offenders + links among them.
//   • cases:        the person + every case they're in + the other people in
//                   those cases (their co-offenders), so you see the full reach.
function egoNetwork(base, mode, pid) {
  if (mode === 'people') {
    const keep = new Set([pid]);
    base.links.forEach((l) => {
      const s = idOf(l.source), t = idOf(l.target);
      if (s === pid) keep.add(t);
      if (t === pid) keep.add(s);
    });
    return {
      nodes: base.nodes.filter((n) => keep.has(n.id)),
      links: base.links.filter((l) => keep.has(idOf(l.source)) && keep.has(idOf(l.target))),
    };
  }
  const caseIds = new Set();
  base.links.forEach((l) => { if (idOf(l.source) === pid) caseIds.add(idOf(l.target)); });
  const peopleIds = new Set([pid]);
  base.links.forEach((l) => { if (caseIds.has(idOf(l.target))) peopleIds.add(idOf(l.source)); });
  return {
    nodes: base.nodes.filter(
      (n) => (n.kind === 'case' ? caseIds.has(n.id) : peopleIds.has(n.id)),
    ),
    links: base.links.filter(
      (l) => caseIds.has(idOf(l.target)) && peopleIds.has(idOf(l.source)),
    ),
  };
}

// Interactive 3D network — drag to rotate 360°, scroll to zoom, drag a node to
// reposition, click a node to inspect. Two views:
//   • "partnerships" — person<->person, a line = they shared a case (co-offending)
//   • "cases"        — person<->case,  a line = this person was in this case,
//                       so one person branching to many cases = a repeat offender.
// `embedded` renders the same graph inline as a dashboard panel instead of as a
// modal over a backdrop: no scrim, no close button, no Escape handler.
export default function NetworkGraph({ graph, caseGraph, summary, onClose, embedded = false }) {
  const fgRef = useRef();
  const boxRef = useRef();
  const dialogRef = useRef();
  const [dims, setDims] = useState({ w: 800, h: 520 });
  const [selected, setSelected] = useState(null);
  const [focusLargest, setFocusLargest] = useState(false);
  const [showLegend, setShowLegend] = useState(true);
  const [mode, setMode] = useState('people'); // 'people' | 'cases'
  const [query, setQuery] = useState('');
  const [focusPerson, setFocusPerson] = useState(null); // pinned person node
  const [autoRotate, setAutoRotate] = useState(true); // slow globe-style spin
  const [isFull, setIsFull] = useState(false); // native fullscreen ("view large")

  const hasCases = !!(caseGraph && caseGraph.nodes && caseGraph.nodes.length);

  // "View large" — native fullscreen on the graph panel, like the crime map.
  const toggleFull = () => {
    const el = dialogRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Globe-style auto-rotation — nudge the whole graph scene a touch each frame.
  // This is independent of the camera controls, so drag-to-rotate / scroll-to-
  // zoom still work while it turns, and it doesn't change any render setup.
  useEffect(() => {
    if (!autoRotate) return undefined;
    let raf;
    const spin = () => {
      const fg = fgRef.current;
      const scene = fg && fg.scene ? fg.scene() : null;
      if (scene) scene.rotation.y += 0.0016;
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  // size the canvas to its container
  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setDims({ w: Math.max(320, width), h: Math.max(360, height) });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  // close on Escape (modal only — embedded has nothing to close)
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const data = useMemo(() => {
    const base = mode === 'cases' ? caseGraph : graph;
    if (!base) return { nodes: [], links: [] };
    if (focusPerson) return egoNetwork(base, mode, focusPerson.id);
    if (!focusLargest) return base;

    if (mode === 'people') {
      const nodes = base.nodes.filter((n) => n.component === 0); // 0 = largest
      const ids = new Set(nodes.map((n) => n.id));
      const links = base.links.filter(
        (l) => ids.has(idOf(l.source)) && ids.has(idOf(l.target)),
      );
      return { nodes, links };
    }
    // cases view: keep the biggest crew's people + the cases they appear in
    const people = base.nodes.filter((n) => n.kind === 'person' && n.component === 0);
    const pids = new Set(people.map((n) => n.id));
    const links = base.links.filter((l) => pids.has(idOf(l.source)));
    const cids = new Set(links.map((l) => idOf(l.target)));
    const cases = base.nodes.filter((n) => n.kind === 'case' && cids.has(n.id));
    return { nodes: [...people, ...cases], links };
  }, [graph, caseGraph, mode, focusLargest, focusPerson]);

  // searchable person list for the current view
  const persons = useMemo(() => {
    const base = mode === 'cases' ? caseGraph : graph;
    return base ? base.nodes.filter((n) => n.kind !== 'case') : [];
  }, [graph, caseGraph, mode]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return persons
      .filter((p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
      .sort((a, b) => (b.incidents || 0) - (a.incidents || 0))
      .slice(0, 8);
  }, [persons, query]);

  // when a person is pinned, frame the small ego graph once it has laid out
  useEffect(() => {
    if (!focusPerson || !fgRef.current) return;
    const t = setTimeout(() => fgRef.current && fgRef.current.zoomToFit(700, 60), 700);
    return () => clearTimeout(t);
  }, [focusPerson, mode]);

  const pickPerson = (p) => {
    setFocusPerson(p);
    setFocusLargest(false);
    setSelected(p);
    setQuery('');
  };

  const clearFocus = () => { setFocusPerson(null); setSelected(null); };

  const personCount = useMemo(
    () => data.nodes.filter((n) => n.kind !== 'case').length,
    [data],
  );
  const caseCount = useMemo(
    () => data.nodes.filter((n) => n.kind === 'case').length,
    [data],
  );

  const switchMode = (next) => {
    setMode(next);
    setSelected(focusPerson || null);
    setFocusLargest(false);
  };

  const focusNode = (node) => {
    setSelected(node);
    const fg = fgRef.current;
    if (!fg || node.x == null) return;
    const dist = 70;
    const ratio = 1 + dist / Math.hypot(node.x, node.y, node.z || 1);
    fg.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      node,
      1200,
    );
  };

  const isCaseMode = mode === 'cases';

  return (
    <div
      className={embedded ? 'graph-embed' : 'graph-modal'}
      onMouseDown={(e) => !embedded && e.target === e.currentTarget && onClose()}
    >
      <div className={`graph-dialog${isFull ? ' is-full' : ''}`} ref={dialogRef}>
        <div className="graph-head">
          <div>
            <h2>{isCaseMode ? 'Who appears across multiple cases' : 'Who committed crimes together'}</h2>
            <div className="muted small">
              {isCaseMode ? (
                <>
                  Red dots are people, amber dots are cases; a line means
                  {' '}<b>this person was in this case</b>. A person joined to several amber
                  {' '}dots is a <b>repeat offender</b>.{' '}
                  {personCount} people · {caseCount} cases
                </>
              ) : (
                <>
                  Each dot is a person; a line means they were in the <b>same case together</b>.
                  {' '}{personCount} people · {data.links.length} partnerships ·
                  {' '}{summary.components} crews
                </>
              )}
              {' '}— drag to rotate · scroll to zoom · click a dot
            </div>
          </div>
          <div className="graph-actions">
            {hasCases && (
              <div className="graph-toggle">
                <button
                  className={!isCaseMode ? 'on' : ''}
                  onClick={() => switchMode('people')}
                >
                  Partnerships
                </button>
                <button
                  className={isCaseMode ? 'on' : ''}
                  onClick={() => switchMode('cases')}
                >
                  Cases
                </button>
              </div>
            )}
            <button
              className={showLegend ? 'on' : ''}
              onClick={() => setShowLegend((v) => !v)}
            >
              {showLegend ? 'Hide guide' : 'How to read this'}
            </button>
            <button
              className={focusLargest ? 'on' : ''}
              onClick={() => { setFocusLargest((v) => !v); setSelected(null); }}
            >
              {focusLargest ? 'Show all crews' : 'Focus biggest crew'}
            </button>
            <button
              className={autoRotate ? 'on' : ''}
              onClick={() => setAutoRotate((v) => !v)}
              title="Slowly rotate the network like a globe"
            >
              {autoRotate ? 'Stop rotation' : 'Auto-rotate'}
            </button>
            <button className="graph-full" onClick={toggleFull} title={isFull ? 'Exit fullscreen' : 'View large'}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
              {isFull ? 'Exit large' : 'View large'}
            </button>
            {!embedded && (
              <button className="graph-close" onClick={onClose} aria-label="Close">✕</button>
            )}
          </div>
        </div>

        <div className="graph-canvas" ref={boxRef}>
          <ForceGraph3D
            ref={fgRef}
            width={dims.w}
            height={dims.h}
            graphData={data}
            backgroundColor="#0b0b0b"
            showNavInfo={false}
            nodeRelSize={4}
            nodeVal={(n) =>
              isCaseMode
                ? (n.kind === 'case' ? 2 + (n.size || 1) * 1.6 : 1 + (n.incidents || 0))
                : 1 + n.degree}
            nodeColor={(n) => {
              if (selected && n.id === selected.id) return '#ffffff';
              if (isCaseMode) return n.kind === 'case' ? CASE_COLOR : PERSON_COLOR;
              return colorFor(n.component);
            }}
            nodeOpacity={0.92}
            nodeLabel={(n) => {
              // nodeLabel is injected as HTML by react-force-graph. Node fields
              // (name, district, category) come from the API, so each one is
              // escaped before interpolation — see safeHtml.js.
              const e = escapeHtml;
              if (isCaseMode && n.kind === 'case') {
                return `<div style="${TOOLTIP_STYLE}">
                   <span style="color:#f5b301">Case</span> &middot; ${e(n.district ?? '—')} &middot; ${e(n.year ?? '')}<br/>
                   ${e((n.category || '').replace(/_/g, ' '))} &middot;
                   <span style="color:#ff6a70">${e(n.size)} ${n.size === 1 ? 'person' : 'people'} involved</span></div>`;
              }
              const cases = `across ${e(n.incidents)} ${n.incidents === 1 ? 'case' : 'cases'}`;
              const partners = `worked with ${e(n.degree)} ${n.degree === 1 ? 'person' : 'people'}`;
              return `<div style="${TOOLTIP_STYLE}">
                 ${e(n.name)} &middot; <span style="color:#8c8c8c">${e(n.district ?? '—')}</span><br/>
                 <span style="color:#ff6a70">${isCaseMode ? cases : partners}</span> &middot;
                 ${isCaseMode ? partners : cases}</div>`;
            }}
            linkColor={() => (isCaseMode ? 'rgba(245,179,1,0.35)' : 'rgba(229,9,20,0.45)')}
            linkOpacity={0.5}
            linkWidth={(l) => (isCaseMode ? 0.5 : 0.4 + (l.weight || 1) * 0.5)}
            linkDirectionalParticles={1}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleColor={() => (isCaseMode ? '#f5d272' : '#ff6a70')}
            onNodeClick={focusNode}
            onBackgroundClick={() => setSelected(null)}
          />

          <div className="graph-search">
            <div className="gs-box">
              <span className="gs-icon">🔍</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a person by name…"
                aria-label="Search a person by name"
              />
              {query && (
                <button className="gs-clear" onClick={() => setQuery('')} aria-label="Clear search">✕</button>
              )}
            </div>
            {matches.length > 0 && (
              <ul className="gs-results">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => pickPerson(p)}>
                      <b>{p.name}</b>
                      <span className="muted small">
                        {p.district ?? '—'} · {p.incidents} {p.incidents === 1 ? 'case' : 'cases'}
                        {' · '}{p.degree} {p.degree === 1 ? 'partner' : 'partners'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() && matches.length === 0 && (
              <div className="gs-empty muted small">No person matches “{query.trim()}”.</div>
            )}
            {focusPerson && (
              <div className="gs-focus">
                <span>Showing <b>{focusPerson.name}</b>’s {isCaseMode ? 'cases & co-offenders' : 'co-offenders'}</span>
                <button onClick={clearFocus}>Show everyone</button>
              </div>
            )}
          </div>

          {showLegend && (
            <div className="graph-legend">
              <div className="gl-title">
                {isCaseMode ? 'People & their cases' : 'How to read this graph'}
              </div>
              {isCaseMode ? (
                <>
                  <div className="gl-item">
                    <span className="gl-dot" />
                    <span><b>Red dot</b> = a person (offender).</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-dot gl-dot-case" />
                    <span><b>Amber dot</b> = one case (a single crime).</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-line gl-line-case" />
                    <span><b>A line</b> = this person <b>was in this case</b>.</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-dot gl-dot-big" />
                    <span><b>Bigger red dot</b> = person in <b>more cases</b> (repeat offender).</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-dot gl-dot-case gl-dot-big" />
                    <span><b>Bigger amber dot</b> = <b>more people</b> in that case.</span>
                  </div>
                  <div className="gl-note">
                    One red dot joined to several amber dots = the <b>same person</b> across
                    several crimes — matched by their personal ID, not their name.
                  </div>
                </>
              ) : (
                <>
                  <div className="gl-item">
                    <span className="gl-dot" />
                    <span><b>A dot</b> = one person (an offender).</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-line" />
                    <span><b>A line</b> = these two people were in the <b>same crime together</b>.</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-line gl-line-thick" />
                    <span><b>Thicker line</b> = they shared <b>more cases</b> together.</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-dot gl-dot-big" />
                    <span><b>Bigger dot</b> = worked with <b>more people</b>.</span>
                  </div>
                  <div className="gl-item">
                    <span className="gl-swatch" />
                    <span><b>Same color</b> = the same <b>crew</b> (a connected group).</span>
                  </div>
                  <div className="gl-note">
                    Want to see one person's repeat crimes? Switch to <b>Cases</b> at the top.
                  </div>
                </>
              )}
            </div>
          )}

          {selected && (
            <div className="graph-detail">
              <button className="graph-close" onClick={() => setSelected(null)} aria-label="Close details">✕</button>
              {selected.kind === 'case' ? (
                <>
                  <div className="gd-name">Case</div>
                  <div className="gd-row"><span>District</span><b>{selected.district ?? '—'}</b></div>
                  <div className="gd-row"><span>Year</span><b>{selected.year ?? '—'}</b></div>
                  <div className="gd-row"><span>Type</span><b>{(selected.category || '—').replace(/_/g, ' ')}</b></div>
                  <div className="gd-row"><span title="How many people were involved in this single case">People involved</span><b>{selected.size}</b></div>
                  <div className="muted small" style={{ marginTop: 8 }}>
                    Synthetic case · ID {selected.id}
                  </div>
                </>
              ) : (
                <>
                  <div className="gd-name">{selected.name}</div>
                  <div className="gd-row"><span>District</span><b>{selected.district ?? '—'}</b></div>
                  <div className="gd-row"><span title="How many different people this person committed crimes with">Partners</span><b>{selected.degree}</b></div>
                  <div className="gd-row"><span title="Total cases this person was involved in (their own offence count)">Cases involved in</span><b>{selected.incidents}</b></div>
                  {!isCaseMode && (
                    <div className="gd-row"><span title="The crew / connected group this person belongs to">Crew</span><b>#{selected.component}</b></div>
                  )}
                  <div className="muted small" style={{ marginTop: 8 }}>
                    Synthetic entity · ID {selected.id}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
