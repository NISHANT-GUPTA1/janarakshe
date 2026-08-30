import React, { useEffect, useMemo, useRef, useState } from 'react';

// ===========================================================
// Shared operational primitives for the FIR investigation
// workspace and the Crime Intelligence workspace.
//
// The two modules deliberately draw from one set: an officer who
// learns that red means CRITICAL on the FIR queue must not have
// to relearn it on the intelligence feed.
// ===========================================================

export const PRIORITIES = ['CRITICAL', 'HIGH', 'WATCH', 'INFORMATION', 'RESOLVED'];

// canonical class for a priority band; also accepts the FIR queue's "INFO"
export const pClass = (p) => {
  const k = String(p || '').toUpperCase();
  if (k === 'INFO' || k === 'INFORMATION') return 'p-info';
  if (k === 'INVESTIGATION') return 'p-info';
  if (PRIORITIES.includes(k)) return `p-${k.toLowerCase()}`;
  return 'p-none';
};

export const PRIORITY_MEANING = {
  CRITICAL: 'Immediate attention',
  HIGH: 'Requires investigation',
  WATCH: 'Potential emerging pattern',
  INFORMATION: 'Contextual intelligence',
  INFO: 'Contextual intelligence',
  RESOLVED: 'No action required',
  INVESTIGATION: 'Investigation step outstanding',
};

export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

export function Tag({ level, children, lg, title }) {
  const k = String(level || '').toUpperCase();
  return (
    <span
      className={`tag ${pClass(level)} ${lg ? 'tag-lg' : ''}`}
      title={title || PRIORITY_MEANING[k] || undefined}
    >
      {children || k}
    </span>
  );
}

// Claim type is the guard-rail: a projection must never be able to pass for a
// counted fact, so it is labelled everywhere it appears.
export function ClaimTag({ type, label }) {
  return <span className={`claim c-${type}`} title={label}>{type}</span>;
}

export function Confidence({ value, label }) {
  const pctv = Math.round((value || 0) * 100);
  const tone = value >= 0.8 ? 'high' : value >= 0.55 ? 'med' : 'low';
  return (
    <span className={`conf ${tone}`} title={`Confidence ${pctv}%`}>
      <span className="conf-track">
        <span className="conf-fill" style={{ width: `${pctv}%` }} />
      </span>
      {label || ''} {pctv}%
    </span>
  );
}

export function Delta({ pct, invert }) {
  if (pct == null) return <span className="delta flat">new</span>;
  const dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const tone = invert ? (dir === 'up' ? 'down' : dir === 'down' ? 'up' : 'flat') : dir;
  return (
    <span className={`delta ${tone}`}>
      {dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'} {Math.abs(pct)}%
    </span>
  );
}

export function Panel({ title, note, right, children, flush, id }) {
  return (
    <section className="panel-ops" id={id}>
      {(title || right) && (
        <header>
          <h3>{title}{note && <span className="ph-note">{note}</span>}</h3>
          {right}
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function Select({ value, onChange, options, all = 'All', width }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={width ? { minWidth: width } : undefined}>
      <option value="">{all}</option>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : `${o.value}${o.count != null ? ` (${o.count})` : ''}`;
        return <option key={v} value={v}>{label}</option>;
      })}
    </select>
  );
}

// One strip of clickable counters. Deliberately not a row of cards: the officer
// reads it as a single instrument panel, and the active filter stays visible.
export function SummaryStrip({ cells, active, onPick }) {
  return (
    <div className="summary-strip" role="group" aria-label="Operational summary">
      {cells.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`sum-cell ${pClass(c.tone)} ${active === c.key ? 'on' : ''}`}
          aria-pressed={active === c.key}
          onClick={() => onPick(active === c.key ? null : c.key)}
          title={c.title || `${c.label} — click to filter`}
        >
          <span className="sum-val">{fmt(c.value)}</span>
          <span className="sum-label">{c.label}</span>
          {c.note && <span className="sum-note">{c.note}</span>}
        </button>
      ))}
    </div>
  );
}

export function ActionBar({ actions, onAct, primaryCount = 1, size }) {
  return (
    <div className="btn-row">
      {actions.map((a, i) => (
        <button
          key={`${a.kind}-${a.label}`}
          type="button"
          className={`btn ${size === 'sm' ? 'btn-sm' : ''} ${i < primaryCount ? 'btn-primary' : ''}`}
          onClick={() => onAct?.(a)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// "Why am I seeing this?" — the disclosure every AI finding must carry.
// Evidence, the records behind it, what to do, and the method's own caveat.
export function WhyPanel({ signals, records, action, method, onRecord, recordLabel }) {
  return (
    <div className="why-panel">
      <h5>Why this was flagged</h5>
      <ul className="why-list">
        {signals.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      {action && (
        <div className="why-action">
          <b>Suggested next step</b>
          {action}
        </div>
      )}
      {!!records?.length && (
        <>
          <h5>Supporting records</h5>
          <div className="btn-row" style={{ marginBottom: 9 }}>
            {records.map((r) => (
              <button key={r.id} type="button" className="btn btn-sm" onClick={() => onRecord?.(r)}>
                {recordLabel ? recordLabel(r) : r.label || r.id}
                {r.note && <span className="muted-note"> · {r.note}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      {method && (
        <details>
          <summary className="btn-link" style={{ fontSize: '0.75rem', marginBottom: 6 }}>
            Technical details — how this was detected
          </summary>
          <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ fontSize: '0.77rem' }}>
              <b>{method.name}.</b> {method.detail}
            </div>
            {method.quality?.reading && <div className="muted-note">{method.quality.reading}</div>}
            <div className="muted-note">Source: {method.source}</div>
            {method.caveat && (
              <div className="why-caveat"><b>Read with care</b>{method.caveat}</div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function Pips({ done, total }) {
  return (
    <span className="pips" title={`${done} of ${total} investigation stages complete`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`pip ${i < done ? 'on' : ''}`} />
      ))}
      <span className="pips-label">{done}/{total}</span>
    </span>
  );
}

export function Progress({ done, total, label }) {
  return (
    <div className="progress-line">
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <span className="progress-text">{label || `${done} / ${total} stages complete`}</span>
    </div>
  );
}

export function KV({ items }) {
  return (
    <dl className="kv-grid">
      {items.filter(Boolean).map((it) => (
        <div className="kv" key={it.k}>
          <dt>{it.k}</dt>
          <dd className={it.small ? 'small' : ''}>{it.v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DataNote({ children }) {
  return <div className="data-note"><b>Data</b><span>{children}</span></div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Skeleton({ h = 180 }) {
  return <div className="skel" style={{ height: h }} />;
}

export function Crumbs({ items }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          {i > 0 && <span className="sep">›</span>}
          {it.onClick ? (
            <button type="button" onClick={it.onClick}>{it.label}</button>
          ) : <span>{it.label}</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// A sparkline is supporting evidence, never the headline — it is always shown
// next to the number it supports.
export function Spark({ values, w = 88, h = 24, tone = 'var(--ops-navy-2)' }) {
  if (!values?.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * w;
    const y = h - ((v - min) / span) * (h - 3) - 1.5;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={tone} strokeWidth="1.6"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Bar({ value, max, title }) {
  return (
    <span className="bar-track" title={title}>
      <span className="bar-val" style={{ width: `${Math.min(100, (value / (max || 1)) * 100)}%` }} />
    </span>
  );
}

// ---- sortable / paged table state ------------------------------------------
export function useSortPage(rows, initialSort, pageSize = 25) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort?.key) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sort.get ? sort.get(a) : a[sort.key];
      const bv = sort.get ? sort.get(b) : b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort]);

  useEffect(() => { setPage(0); }, [rows, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clamped = Math.min(page, pages - 1);
  const slice = sorted.slice(clamped * pageSize, clamped * pageSize + pageSize);

  const toggle = (key, get) => setSort((s) => (
    s?.key === key
      ? { key, get, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, get, dir: 'desc' }
  ));

  return { slice, sorted, sort, toggle, page: clamped, pages, setPage, total: sorted.length, pageSize };
}

export function SortHead({ label, k, sort, onSort, get, num }) {
  const on = sort?.key === k;
  return (
    <th
      className="sortable"
      style={num ? { textAlign: 'right' } : undefined}
      onClick={() => onSort(k, get)}
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}{on && <span className="sort-ind">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}

export function Pager({ page, pages, setPage, total, pageSize, noun = 'records' }) {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="pager">
      <span>{fmt(from)}–{fmt(to)} of {fmt(total)} {noun}</span>
      <span className="pager-btns">
        <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(0)}>« First</button>
        <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
        <span style={{ padding: '0 6px' }}>Page {page + 1} / {pages}</span>
        <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>Last »</button>
      </span>
    </div>
  );
}

// ---- misc helpers -----------------------------------------------------------
export const ENTITY_ICON = {
  fir: '📄', person: '👤', vehicle: '🚗', phone: '📱', location: '📍',
  station: '🏢', crime_type: '🏷', district: '🗺', cluster: '🎯',
};

export const ENTITY_LABEL = {
  fir: 'FIR', person: 'Person', vehicle: 'Vehicle', phone: 'Phone / contact',
  location: 'Location', station: 'Police station', crime_type: 'Crime type',
  district: 'District',
};

export function relDays(iso, asOf) {
  if (!iso) return '—';
  const a = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const b = new Date(`${String(asOf).slice(0, 10)}T00:00:00`);
  const d = Math.round((b - a) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dateLabel(iso, withTime) {
  if (!iso) return '—';
  const d = String(iso);
  const day = Number(d.slice(8, 10));
  const mon = MONTHS[Number(d.slice(5, 7)) - 1];
  const year = d.slice(0, 4);
  const time = withTime && d.length > 10 ? ` · ${d.slice(11, 16)}` : '';
  return `${day} ${mon} ${year}${time}`;
}

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" />
  </svg>
);

// Focus a ref when a keyboard shortcut fires (the "/" convention).
export function useSlashFocus(ref) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}

// Load a payload once; expose {data, error, loading}.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.resolve(fnRef.current())
      .then((d) => live && setState({ data: d, error: null, loading: false }))
      .catch((e) => live && setState({ data: null, error: e.message, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
