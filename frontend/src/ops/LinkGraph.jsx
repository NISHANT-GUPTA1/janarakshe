import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENTITY_ICON, ENTITY_LABEL, Tag, pClass } from './ui.jsx';

// ===========================================================
// Multi-entity link analysis.
//
// Deliberately ego-centric rather than "here is the whole graph":
// a 1,700-node hairball tells an officer nothing. The view opens on
// one entity, shows what it touches, and expands only where the
// officer asks it to. Every node can be opened; every edge says what
// the relationship is.
//
// The layout is a small force simulation run on the visible subgraph
// only (typically 10-60 nodes), so it settles in a few frames and
// needs no external graph library.
// ===========================================================

const KIND_COLOR = {
  fir: '#1f56d6',
  person: '#b3261e',
  vehicle: '#a4530b',
  phone: '#7d5900',
  location: '#16653f',
  station: '#0f2f60',
};

const KIND_ORDER = ['person', 'fir', 'vehicle', 'phone', 'location', 'station'];

const EDGE_LABEL = {
  named_in: 'named in',
  recorded_on: 'recorded on',
  used_by: 'used by',
  scene_of: 'scene of',
  jurisdiction: 'registered at',
};

const W = 780;
const H = 560;

export default function LinkGraph({
  graph,             // { nodes, edges }
  focusId,           // entity to open on
  onOpen,            // (node) => void — "open this FIR / person"
  height = 600,
  title = 'Link analysis',
}) {
  const index = useMemo(() => buildIndex(graph), [graph]);

  const [expanded, setExpanded] = useState(() => new Set(focusId ? [focusId] : []));
  const [kinds, setKinds] = useState(() => new Set(KIND_ORDER));
  const [edgeKinds, setEdgeKinds] = useState(() => new Set(Object.keys(EDGE_LABEL)));
  const [selected, setSelected] = useState(focusId || null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    setExpanded(new Set(focusId ? [focusId] : []));
    setSelected(focusId || null);
  }, [focusId]);

  // ---- visible subgraph: the expanded set plus one ring of neighbours ----
  const view = useMemo(() => {
    if (!index.nodes.size) return { nodes: [], edges: [] };
    const roots = expanded.size ? [...expanded] : [focusId].filter(Boolean);
    if (!roots.length) return { nodes: [], edges: [] };

    const visible = new Set();
    roots.forEach((id) => { if (index.nodes.has(id)) visible.add(id); });
    roots.forEach((id) => {
      (index.adj.get(id) || []).forEach(({ other, kind }) => {
        if (!edgeKinds.has(kind)) return;
        const n = index.nodes.get(other);
        if (n && kinds.has(n.kind)) visible.add(other);
      });
    });

    const edges = index.edges.filter(
      (e) => visible.has(e.source) && visible.has(e.target) && edgeKinds.has(e.kind),
    );
    const nodes = [...visible]
      .map((id) => index.nodes.get(id))
      .filter((n) => n && (kinds.has(n.kind) || expanded.has(n.id)));
    return { nodes, edges };
  }, [index, expanded, kinds, edgeKinds, focusId]);

  const positions = useForceLayout(view, focusId);

  // shortest path from the focus to whatever is hovered — "how are these two
  // connected?" is the question the graph exists to answer
  const path = useMemo(
    () => (hover && focusId && hover !== focusId ? shortestPath(index, focusId, hover, edgeKinds) : null),
    [index, focusId, hover, edgeKinds],
  );
  const pathNodes = useMemo(() => new Set(path || []), [path]);
  const pathEdges = useMemo(() => {
    const s = new Set();
    if (path) for (let i = 1; i < path.length; i++) s.add(edgeKey(path[i - 1], path[i]));
    return s;
  }, [path]);

  const toggleExpand = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id) && next.size > 1) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const counts = useMemo(() => {
    const c = {};
    view.nodes.forEach((n) => { c[n.kind] = (c[n.kind] || 0) + 1; });
    return c;
  }, [view.nodes]);

  const sel = selected ? index.nodes.get(selected) : null;
  const selNeighbours = useMemo(() => {
    if (!selected) return [];
    const seen = new Map();
    (index.adj.get(selected) || []).forEach(({ other, kind }) => {
      if (!seen.has(other)) seen.set(other, kind);
    });
    return [...seen].map(([id, kind]) => ({ node: index.nodes.get(id), kind }))
      .filter((x) => x.node);
  }, [index, selected]);

  if (!graph?.nodes?.length) return <div className="empty">Link graph unavailable.</div>;

  return (
    <div className="graph-shell" style={{ height }}>
      {/* ---------------- left: what is on screen ---------------- */}
      <div className="graph-side">
        <div>
          <h4 style={{ marginBottom: 6 }}>Entity types</h4>
          {KIND_ORDER.map((k) => (
            <label key={k} className="graph-toggle">
              <input
                type="checkbox"
                checked={kinds.has(k)}
                onChange={() => setKinds((s) => toggleSet(s, k))}
              />
              <i style={{ background: KIND_COLOR[k] }} />
              {ENTITY_LABEL[k]}
              <span className="gt-count">{counts[k] || 0}</span>
            </label>
          ))}
        </div>
        <div>
          <h4 style={{ marginBottom: 6 }}>Relationships</h4>
          {Object.entries(EDGE_LABEL).map(([k, label]) => (
            <label key={k} className="graph-toggle">
              <input
                type="checkbox"
                checked={edgeKinds.has(k)}
                onChange={() => setEdgeKinds((s) => toggleSet(s, k))}
              />
              {label}
            </label>
          ))}
        </div>
        <div>
          <h4 style={{ marginBottom: 6 }}>Expanded</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...expanded].map((id) => {
              const n = index.nodes.get(id);
              if (!n) return null;
              return (
                <button key={id} type="button" className="btn btn-sm"
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => toggleExpand(id)}>
                  {ENTITY_ICON[n.kind]} {n.label} ✕
                </button>
              );
            })}
          </div>
          {expanded.size > 1 && (
            <button type="button" className="btn btn-sm" style={{ marginTop: 7 }}
              onClick={() => setExpanded(new Set(focusId ? [focusId] : []))}>
              Collapse all
            </button>
          )}
        </div>
      </div>

      {/* ---------------- centre: the graph ---------------- */}
      <div className="graph-canvas">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
          role="img" aria-label={`${title}: ${view.nodes.length} entities, ${view.edges.length} relationships`}>
          <defs>
            <marker id="lg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6"
              markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L8 4 L0 8 z" fill="#b6c1d2" />
            </marker>
          </defs>

          {view.edges.map((e) => {
            const a = positions[e.source];
            const b = positions[e.target];
            if (!a || !b) return null;
            const onPath = pathEdges.has(edgeKey(e.source, e.target));
            const touched = hover && (e.source === hover || e.target === hover);
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            return (
              <g key={`${e.source}|${e.target}|${e.kind}`}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={onPath ? '#b3261e' : touched ? '#5c7899' : '#c9d3e2'}
                  strokeWidth={onPath ? 2.4 : touched ? 1.8 : 1.1}
                  strokeOpacity={hover && !touched && !onPath ? 0.3 : 0.95}
                  markerEnd="url(#lg-arrow)"
                />
                {(touched || onPath) && (
                  <text className="edge-label" x={mx} y={my - 3} textAnchor="middle">
                    {EDGE_LABEL[e.kind] || e.kind}
                  </text>
                )}
              </g>
            );
          })}

          {view.nodes.map((n) => {
            const p = positions[n.id];
            if (!p) return null;
            const isFocus = n.id === focusId;
            const isSel = n.id === selected;
            const onPath = pathNodes.has(n.id);
            const dim = hover && !onPath && n.id !== hover
              && !(index.adj.get(hover) || []).some((x) => x.other === n.id);
            const r = isFocus ? 15 : n.kind === 'fir' ? 11 : 10;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                opacity={dim ? 0.32 : 1}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id)}
                onDoubleClick={() => toggleExpand(n.id)}
                tabIndex={0}
                role="button"
                aria-label={`${ENTITY_LABEL[n.kind]}: ${n.label}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelected(n.id);
                  if (e.key === ' ') { e.preventDefault(); toggleExpand(n.id); }
                }}
              >
                <circle
                  r={r}
                  fill={KIND_COLOR[n.kind] || '#64748b'}
                  fillOpacity={expanded.has(n.id) ? 1 : 0.82}
                  stroke={isSel ? '#10233d' : onPath ? '#b3261e' : '#fff'}
                  strokeWidth={isSel || onPath ? 2.6 : 1.8}
                />
                {expanded.has(n.id) && <circle r={r + 4} fill="none" stroke={KIND_COLOR[n.kind]} strokeWidth="1" strokeOpacity="0.45" />}
                <text className="node-label" y={r + 11} textAnchor="middle">
                  {truncate(n.label, 20)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="graph-hint">
          Click a node to inspect · double-click to expand · hover to trace the path from the focus
        </div>
      </div>

      {/* ---------------- right: the selected entity ---------------- */}
      <div className="graph-side right">
        {!sel && <p className="muted-note">Select a node to see its details.</p>}
        {sel && (
          <>
            <div>
              <h4 style={{ marginBottom: 4 }}>{ENTITY_LABEL[sel.kind]}</h4>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', wordBreak: 'break-word' }}>
                {ENTITY_ICON[sel.kind]} {sel.label}
              </div>
              {sel.sub && <div className="muted-note">{sel.sub}</div>}
              {sel.priority && (
                <div style={{ marginTop: 6 }}><Tag level={sel.priority} /></div>
              )}
            </div>

            <div className="btn-row">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => toggleExpand(sel.id)}>
                {expanded.has(sel.id) ? 'Collapse' : 'Expand node'}
              </button>
              {onOpen && (sel.kind === 'fir' || sel.kind === 'person') && (
                <button type="button" className="btn btn-sm" onClick={() => onOpen(sel)}>
                  {sel.kind === 'fir' ? 'Open FIR' : 'Open profile'}
                </button>
              )}
            </div>

            {path && selected === hover && (
              <div>
                <h4 style={{ marginBottom: 5 }}>Path from focus</h4>
                <div className="muted-note">{path.map((id) => index.nodes.get(id)?.label).join(' → ')}</div>
              </div>
            )}

            <div>
              <h4 style={{ marginBottom: 5 }}>Connected ({selNeighbours.length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {selNeighbours.slice(0, 24).map(({ node, kind }) => (
                  <button
                    key={node.id}
                    type="button"
                    className="btn btn-sm"
                    style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', padding: '4px 7px' }}
                    onMouseEnter={() => setHover(node.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => { setExpanded((s) => new Set([...s, sel.id])); setSelected(node.id); }}
                  >
                    <span style={{ flex: 'none' }}>{ENTITY_ICON[node.kind]}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {node.label}
                    </span>
                    <span className="muted-note" style={{ flex: 'none' }}>{EDGE_LABEL[kind] || kind}</span>
                  </button>
                ))}
                {selNeighbours.length > 24 && (
                  <span className="muted-note">+{selNeighbours.length - 24} more</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- helpers
function buildIndex(graph) {
  const nodes = new Map();
  const adj = new Map();
  const edges = [];
  if (!graph) return { nodes, adj, edges };
  graph.nodes.forEach((n) => nodes.set(n.id, n));
  (graph.edges || []).forEach((e) => {
    if (!nodes.has(e.source) || !nodes.has(e.target)) return;
    edges.push(e);
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push({ other: e.target, kind: e.kind });
    adj.get(e.target).push({ other: e.source, kind: e.kind });
  });
  return { nodes, adj, edges };
}

const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function toggleSet(set, k) {
  const next = new Set(set);
  if (next.has(k)) next.delete(k); else next.add(k);
  return next;
}

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function shortestPath(index, from, to, edgeKinds) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const { other, kind } of index.adj.get(cur) || []) {
      if (!edgeKinds.has(kind) || prev.has(other)) continue;
      prev.set(other, cur);
      if (other === to) {
        const path = [to];
        let p = cur;
        while (p != null) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(other);
    }
  }
  return null;
}

// A compact spring/repulsion layout. Runs only while the visible subgraph
// changes, then stops — no animation loop idling behind the page.
function useForceLayout(view, focusId) {
  const [positions, setPositions] = useState({});
  const raf = useRef(null);

  useEffect(() => {
    const nodes = view.nodes;
    if (!nodes.length) { setPositions({}); return undefined; }

    const pts = new Map();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const radius = n.id === focusId ? 0 : 150 + (i % 4) * 42;
      pts.set(n.id, {
        x: W / 2 + Math.cos(angle) * radius,
        y: H / 2 + Math.sin(angle) * radius,
        vx: 0, vy: 0,
      });
    });

    const links = view.edges
      .filter((e) => pts.has(e.source) && pts.has(e.target))
      .map((e) => [e.source, e.target]);

    let frame = 0;
    const step = () => {
      const alpha = Math.max(0.02, 0.14 * (1 - frame / 220));
      // repulsion
      const ids = [...pts.keys()];
      for (let i = 0; i < ids.length; i++) {
        const a = pts.get(ids[i]);
        for (let j = i + 1; j < ids.length; j++) {
          const b = pts.get(ids[j]);
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
          const f = 5200 / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }
      // springs
      links.forEach(([s, t]) => {
        const a = pts.get(s);
        const b = pts.get(t);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 108) * 0.045;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });
      // centring + focus pin + integrate
      pts.forEach((p, id) => {
        p.vx += (W / 2 - p.x) * 0.014;
        p.vy += (H / 2 - p.y) * 0.014;
        p.vx *= 0.82; p.vy *= 0.82;
        p.x += p.vx * alpha * 6;
        p.y += p.vy * alpha * 6;
        if (id === focusId) { p.x += (W / 2 - p.x) * 0.35; p.y += (H / 2 - p.y) * 0.35; }
        p.x = Math.max(34, Math.min(W - 34, p.x));
        p.y = Math.max(26, Math.min(H - 26, p.y));
      });

      frame += 1;
      if (frame % 6 === 0 || frame > 218) {
        const out = {};
        pts.forEach((p, id) => { out[id] = { x: p.x, y: p.y }; });
        setPositions(out);
      }
      if (frame < 220) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [view, focusId]);

  return positions;
}
