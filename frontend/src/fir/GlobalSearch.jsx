import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ENTITY_ICON, ENTITY_LABEL, SearchIcon, Tag, dateLabel, fmt, useSlashFocus,
} from '../ops/ui.jsx';

// ===========================================================
// Global intelligence search.
//
// The officer types what they have — a plate, a number, a name, an
// FIR number, a locality — and the platform works out which module
// holds it. Knowing that vehicles live in one place and persons in
// another is the system's problem, not the officer's.
// ===========================================================

const GROUP_ORDER = ['fir', 'person', 'vehicle', 'phone', 'location', 'station', 'crime_type', 'district'];

// A plate, a phone number and an FIR number all look different enough to guess
// at, so a query that clearly *is* one of them promotes that kind to the top.
function guessKind(q) {
  const s = q.replace(/[\s-]/g, '').toUpperCase();
  if (/^KA\d{2}[A-Z]{0,2}\d{0,4}$/.test(s)) return 'vehicle';
  if (/^[6-9]\d{5,9}$/.test(s)) return 'phone';
  if (/^KA[A-Z]{2,3}\d{4}\d*$/.test(s) || /^\d{12,}$/.test(s)) return 'fir';
  return null;
}

function score(entity, q, promoted) {
  const label = entity.label.toLowerCase();
  const sub = (entity.subtitle || '').toLowerCase();
  const norm = label.replace(/[\s-]/g, '');
  const qn = q.replace(/[\s-]/g, '');
  let s = 0;
  if (label === q || norm === qn) s = 100;
  else if (label.startsWith(q) || norm.startsWith(qn)) s = 80;
  else if (label.includes(q) || norm.includes(qn)) s = 60;
  else if (sub.includes(q)) s = 30;
  else return 0;
  if (promoted && entity.kind === promoted) s += 25;
  return s + Math.min(entity.fir_count || 0, 12);
}

export default function GlobalSearch({ index, onPick, asOf, placeholder }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  useSlashFocus(inputRef);

  useEffect(() => {
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2 || !index?.length) return [];
    const promoted = guessKind(term);
    return index
      .map((e) => ({ e, s: score(e, term, promoted) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.e);
  }, [q, index]);

  const grouped = useMemo(() => {
    const g = new Map();
    results.forEach((r) => {
      if (!g.has(r.kind)) g.set(r.kind, []);
      g.get(r.kind).push(r);
    });
    return GROUP_ORDER.filter((k) => g.has(k)).map((k) => [k, g.get(k)]);
  }, [results]);

  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  useEffect(() => { setCursor(0); }, [q]);

  const choose = (entity) => {
    setOpen(false);
    setQ('');
    onPick(entity);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % flat.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c - 1 + flat.length) % flat.length); }
    if (e.key === 'Enter') { e.preventDefault(); choose(flat[cursor]); }
  };

  return (
    <div className="gsearch" ref={boxRef}>
      <div className="gsearch-box">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={q}
          placeholder={placeholder || 'Search FIR, person, vehicle, phone, location…'}
          aria-label="Global intelligence search"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {!q && <kbd>/</kbd>}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="gsearch-panel" role="listbox">
          {!flat.length && <div className="gsearch-empty">No entity matches “{q}”.</div>}
          {grouped.map(([kind, items]) => (
            <div className="gsearch-group" key={kind}>
              <div className="gsearch-group-h">
                {ENTITY_ICON[kind]} {ENTITY_LABEL[kind] || kind} · {items.length}
              </div>
              {items.map((it) => {
                const i = flat.indexOf(it);
                return (
                  <button
                    key={it.entity_id}
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    className={`gsearch-item ${i === cursor ? 'on' : ''}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(it)}
                  >
                    <span className="gs-kind">{ENTITY_ICON[kind]}</span>
                    <span className="gs-main">
                      <span className="gs-label">{it.label}</span>
                      <span className="gs-sub">{it.subtitle}</span>
                    </span>
                    <span className="gs-meta">
                      {it.priority && kind === 'fir'
                        ? <Tag level={it.priority} />
                        : <>{fmt(it.fir_count)} FIR{it.fir_count === 1 ? '' : 's'}</>}
                      {it.last_seen && <div>{dateLabel(it.last_seen)}</div>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The resolution card shown after picking a non-FIR entity: what it is, what it
// touches, and the one button that matters — see it in the network.
export function EntityCard({ entity, onOpenFir, onNetwork, onClear, queueById }) {
  if (!entity) return null;
  const firs = (entity.firs || []).map((id) => queueById?.get(id)).filter(Boolean);
  return (
    <div className="entity-card">
      <div className="entity-id">
        <span className="ek">{ENTITY_ICON[entity.kind]} {ENTITY_LABEL[entity.kind] || entity.kind}</span>
        <span className="el">{entity.label}</span>
        <span className="es">{entity.subtitle}</span>
      </div>

      <div className="entity-stats">
        <div className="entity-stat"><b>{fmt(entity.fir_count)}</b><span>Linked FIRs</span></div>
        {entity.person_count != null && (
          <div className="entity-stat"><b>{fmt(entity.person_count)}</b><span>Associated persons</span></div>
        )}
        {entity.location_count != null && (
          <div className="entity-stat"><b>{fmt(entity.location_count)}</b><span>Associated locations</span></div>
        )}
        <div className="entity-stat">
          <b style={{ fontSize: '0.95rem' }}>{dateLabel(entity.last_seen)}</b>
          <span>Last associated incident</span>
        </div>
        {!!entity.districts?.length && (
          <div className="entity-stat">
            <b style={{ fontSize: '0.95rem' }}>{entity.districts.join(', ')}</b>
            <span>Districts</span>
          </div>
        )}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => onNetwork(entity)}>View intelligence network</button>
          <button className="btn" onClick={onClear}>Clear</button>
        </div>
        {!!firs.length && (
          <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
            {firs.slice(0, 6).map((f) => (
              <button key={f.fir_id} className="btn btn-sm" onClick={() => onOpenFir(f.fir_id)}>
                {f.fir_no}
              </button>
            ))}
            {firs.length > 6 && <span className="muted-note">+{firs.length - 6} more</span>}
          </div>
        )}
      </div>
    </div>
  );
}
