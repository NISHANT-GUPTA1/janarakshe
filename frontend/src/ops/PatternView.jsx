import React from 'react';
import {
  ActionBar, Confidence, Crumbs, Empty, Panel, Tag, WhyPanel, dateLabel, fmt, pClass,
} from './ui.jsx';

// ===========================================================
// Pattern investigation workspace.
//
// Opened from anywhere a pattern is surfaced — the FIR queue, the
// intelligence feed, the map. It answers, in order: what we found,
// which FIRs it is made of, what they have in common, who and what
// is in the network, and what to do about it.
//
// Shared by both workspaces on purpose: a burglary cluster is the
// same object whether the officer reached it from their duty queue
// or from the district intelligence view.
// ===========================================================

export default function PatternView({
  pattern, rows, queueById, onOpenCase, onNetwork, onBack, onAct, onMap, backLabel = 'Back',
}) {
  if (!pattern) return <Empty>Pattern not found.</Empty>;

  const cases = (pattern.cases || []).map((id) => queueById.get(id)).filter(Boolean);
  const priority = pattern.case_count >= 6 ? 'CRITICAL' : pattern.tier === 'head' ? 'WATCH' : 'HIGH';

  // what the member FIRs actually have in common — computed here rather than
  // asserted, so the "common signals" list is always true of this set
  const stations = [...new Set(cases.map((c) => c.station))];
  const areas = countBy(cases, (c) => c.location);
  const hours = cases.map((c) => Number(c.occurred_at.slice(11, 13)));
  const hourSpan = hours.length ? Math.max(...hours) - Math.min(...hours) : 0;
  const accused = new Set(cases.flatMap((c) => c.accused));
  const open = cases.filter((c) => c.status === 'Under Investigation').length;
  const linked = cases.reduce((n, c) => n + (c.linked_firs || 0), 0);

  const signals = [
    `All ${cases.length} FIRs registered under ${pattern.crime_type}`,
    `Concentrated in ${areas.length === 1 ? areas[0][0] : `${areas.length} localities, led by ${areas[0]?.[0]}`}`,
    hourSpan <= 6
      ? `Offence times fall inside a ${hourSpan + 1}-hour band around ${String(pattern.peak_hour).padStart(2, '0')}:00`
      : `Peak offence hour ${String(pattern.peak_hour).padStart(2, '0')}:00`,
    stations.length === 1
      ? `Single jurisdiction — ${stations[0]}`
      : `Spans ${stations.length} police stations`,
    pattern.baseline
      ? `Up from ${pattern.baseline} in the preceding ${pattern.window_days} days`
      : `No comparable FIRs in the preceding ${pattern.window_days} days`,
  ];

  const actions = [
    { label: 'Generate Intelligence Brief', kind: 'brief', target: pattern.cluster_id },
    { label: 'View Related FIRs', kind: 'open_firs', target: pattern.cluster_id },
    { label: 'Open Network', kind: 'open_graph', target: pattern.cluster_id },
    { label: 'Add Investigation Note', kind: 'note', target: pattern.cluster_id },
    { label: 'Share With Station', kind: 'share', target: pattern.cluster_id },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Crumbs items={[{ label: backLabel, onClick: onBack }, { label: `${pattern.crime_type} pattern` }]} />

      <div className={`case-head ${pClass(priority)}`}>
        <div className="case-head-main">
          <span className="case-no">Pattern {pattern.cluster_id} · {pattern.window_days}-day window</span>
          <div className="case-title">
            <h1>{pattern.crime_type} pattern</h1>
          </div>
          <div className="case-where">{pattern.area}</div>
          <div className="case-badges">
            <Tag level={priority} lg />
            <Confidence value={pattern.confidence} label="Confidence" />
            <span className="claim c-statistical">statistical</span>
            {pattern.tier === 'head' && (
              <span className="chip warn">Broad crime-head signal — weaker than an offence-level cluster</span>
            )}
          </div>
        </div>
        <ActionBar actions={actions.slice(0, 3)} onAct={onAct} primaryCount={1} />
      </div>

      <div className="grid-case">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <Panel title="What we found">
            <div className="stat-line" style={{ marginBottom: 12 }}>
              <div>
                <b>{pattern.case_count}</b>
                <span>Incidents</span>
              </div>
              <div>
                <b>{pattern.baseline}</b>
                <span>Previous {pattern.window_days} days</span>
              </div>
              <div>
                <b style={{ color: 'var(--ops-up)' }}>
                  {pattern.change_pct != null ? `+${pattern.change_pct}%` : 'new'}
                </b>
                <span>Change</span>
              </div>
              <div>
                <b>{String(pattern.peak_hour).padStart(2, '0')}:00</b>
                <span>Peak time</span>
              </div>
              <div>
                <b>{open}</b>
                <span>Still open</span>
              </div>
            </div>
            <h4 style={{ marginBottom: 6 }}>Primary locations</h4>
            <div className="btn-row">
              {areas.slice(0, 5).map(([area, n]) => (
                <span key={area} className="chip">{area} · {n}</span>
              ))}
            </div>
            {onMap && (
              <button className="btn btn-sm" style={{ marginTop: 10 }}
                onClick={() => onMap(pattern)}>View on map</button>
            )}
          </Panel>

          <Panel title="Related FIRs" note={`${cases.length} case${cases.length === 1 ? '' : 's'} in this pattern`} flush>
            <div className="ops-table-wrap" style={{ maxHeight: 400 }}>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Priority</th><th>FIR number</th><th>Date / time</th>
                    <th>Location</th><th>Station</th><th>Status</th><th>Accused</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.fir_id} className={pClass(c.priority)} onClick={() => onOpenCase(c.fir_id)}>
                      <td className="row-spine"><Tag level={c.priority} /></td>
                      <td className="strong mono">{c.fir_no}</td>
                      <td>{dateLabel(c.occurred_at)}<span className="sub">{c.occurred_at.slice(11, 16)} hrs</span></td>
                      <td>{c.location}</td>
                      <td>{c.station}</td>
                      <td><span className="chip">{c.status}</span></td>
                      <td>{c.accused.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="Common signals">
            <WhyPanel
              signals={signals}
              action={`Brief the ${stations.length === 1 ? stations[0] : 'stations concerned'} and align night-beat cover to the observed window.`}
              method={{
                name: 'Rolling-window rate comparison',
                detail: `FIRs grouped by district and ${pattern.tier === 'offence' ? 'offence type' : 'crime head'}, `
                  + `then the last ${pattern.window_days} days compared against the ${pattern.window_days} before them.`,
                source: 'FIR records',
                caveat: 'A rise in registrations is a deployment signal. It can also follow a '
                  + 'registration drive or a change in reporting, so confirm against the case files.',
              }}
            />
          </Panel>

          <Panel title="Network"
            right={<button className="btn btn-sm btn-primary"
              onClick={() => onNetwork({ kind: 'fir', entity_id: cases[0]?.fir_id, label: cases[0]?.fir_no })}>
              Open network
            </button>}>
            <div className="entity-row">
              <div className="entity-cell"><b>{fmt(accused.size)}</b><span>Persons</span></div>
              <div className="entity-cell"><b>{fmt(cases.length)}</b><span>FIRs</span></div>
              <div className="entity-cell"><b>{fmt(stations.length)}</b><span>Stations</span></div>
              <div className="entity-cell"><b>{fmt(linked)}</b><span>Outward links</span></div>
            </div>
          </Panel>

          <Panel title="Actions">
            <ActionBar actions={actions} onAct={onAct} primaryCount={0} size="sm" />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function countBy(items, fn) {
  const m = new Map();
  items.forEach((i) => { const k = fn(i); m.set(k, (m.get(k) || 0) + 1); });
  return [...m].sort((a, b) => b[1] - a[1]);
}
