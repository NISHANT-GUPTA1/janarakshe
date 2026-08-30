import React, { useMemo, useState } from 'react';
import {
  ActionBar, Confidence, Crumbs, Empty, KV, Panel, Progress, Skeleton, Tag, WhyPanel,
  dateLabel, fmt, pClass, relDays,
} from '../ops/ui.jsx';

// ===========================================================
// One FIR, as an investigation workspace.
//
// The order of the page is the order an officer thinks in:
// what is this case -> how far has it got -> who is involved ->
// what is it connected to -> what does the intelligence layer
// think, and on what evidence -> what happened when -> what do
// I do now.
//
// Nothing on this page is a dead end: every person, entity and
// related FIR opens something.
// ===========================================================

const TL_KINDS = [
  ['system', 'System record'],
  ['officer', 'Officer action'],
  ['evidence', 'Evidence added'],
  ['intelligence', 'Intelligence discovery'],
  ['status', 'Status change'],
];

const CASE_ACTIONS = [
  { label: 'Update Case', kind: 'update_case' },
  { label: 'Assign Investigator', kind: 'assign' },
  { label: 'Generate Case Brief', kind: 'brief' },
];

const SECONDARY_ACTIONS = [
  { label: 'Add Note', kind: 'note' },
  { label: 'Upload Evidence', kind: 'evidence' },
  { label: 'Link FIR', kind: 'link_fir' },
  { label: 'Add Person', kind: 'add_person' },
  { label: 'Add Vehicle', kind: 'add_vehicle' },
  { label: 'Add Investigation Update', kind: 'update_stage' },
  { label: 'Export Report', kind: 'export' },
];

export default function CaseFile({
  detail, stages, rules, queueById, asOf, role,
  onOpenCase, onNetwork, onBack, onAct, onOpenPattern, patternsById,
}) {
  if (!detail) return <Skeleton h={420} />;
  const c = detail;
  const cluster = c.cluster ? patternsById?.get(c.cluster) : null;

  const pendingStages = stages
    .map((s, i) => ({ ...s, done: c.stages[i]?.done }))
    .filter((s) => !s.done);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Crumbs items={[
        { label: 'FIR work queue', onClick: onBack },
        { label: c.fir_no },
      ]} />

      {/* ---------------- header ---------------- */}
      <div className={`case-head ${pClass(c.priority)}`}>
        <div className="case-head-main">
          <span className="case-no">FIR #{c.fir_no} · Crime No. {c.crime_no}</span>
          <div className="case-title">
            <h1>{c.crime_type}</h1>
            {c.gravity === 'Heinous' && <span className="chip bad">Heinous</span>}
          </div>
          <div className="case-where">
            {c.station} · {dateLabel(c.occurred_at)} · {c.occurred_at.slice(11, 16)} hrs
          </div>
          <div className="case-badges">
            <Tag level={c.priority} lg />
            <span className="chip">{c.status}</span>
            {c.sla_state === 'breached' && (
              <span className="chip bad">SLA breached by {Math.abs(c.sla_days_left)} days</span>
            )}
            {c.sla_state === 'due' && (
              <span className="chip warn">SLA due in {c.sla_days_left} days</span>
            )}
            {c.sla_state === 'met' && <span className="chip ok">Within SLA</span>}
          </div>
          <details style={{ marginTop: 4 }}>
            <summary className="btn-link" style={{ fontSize: '0.75rem' }}>
              Why is this {c.priority.toLowerCase()}?
            </summary>
            <ul className="why-list" style={{ marginTop: 6 }}>
              {c.priority_reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </details>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <ActionBar actions={CASE_ACTIONS} onAct={(a) => onAct(a, c)} primaryCount={1} />
          {role && role !== 'analyst' && (
            <span className="muted-note">Actions available to your role: {role}</span>
          )}
        </div>
      </div>

      <div className="grid-case">
        {/* ================= left column ================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <Panel title="Case summary">
            <KV items={[
              { k: 'Incident location', v: c.location },
              { k: 'Date of offence', v: dateLabel(c.occurred_at) },
              { k: 'Time of offence', v: `${c.occurred_at.slice(11, 16)} hrs` },
              { k: 'Crime type', v: `${c.crime_type} (${c.major_head})` },
              { k: 'Police station', v: c.station, small: true },
              { k: 'District', v: c.district },
              { k: 'Current status', v: c.status },
              { k: 'Investigating officer', v: c.io.name, small: true },
              { k: 'FIR registered', v: dateLabel(c.registered_at, true), small: true },
              { k: 'Case category', v: c.category },
              { k: 'Act & section', v: `${c.act}${c.section ? ` ${c.section}` : ''}` },
              { k: 'Case age', v: `${c.age_days} days` },
            ]} />
            <p className="muted-note" style={{ marginTop: 10 }}>{c.brief_facts}</p>
          </Panel>

          <Panel
            title="Investigation progress"
            note={`${c.stage_done} of ${c.stage_total} stages complete`}
            right={pendingStages.length ? (
              <button className="btn btn-sm" onClick={() => onAct({ kind: 'update_stage', label: 'Record next stage' }, c)}>
                Record “{pendingStages[0].label}”
              </button>
            ) : <span className="chip ok">All stages complete</span>}
          >
            <Progress done={c.stage_done} total={c.stage_total} />
            <div className="stages">
              {stages.map((s, i) => {
                const st = c.stages[i] || {};
                const isNext = !st.done && i === c.stage_done;
                return (
                  <div key={s.key} className={`stage ${st.done ? 'done' : ''} ${isNext ? 'next' : ''}`}>
                    <span className="stage-mark">{st.done ? '✓' : isNext ? '→' : '○'}</span>
                    <span className="stage-main">
                      <span className="stage-label">{s.label}</span>
                      {st.done && st.at && <span className="stage-at">Completed {dateLabel(st.at)}</span>}
                      {isNext && <span className="stage-pending">Next step — pending</span>}
                      {!st.done && !isNext && <span className="stage-at">Not started</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="People involved" note="Click a person to open their intelligence profile">
            <h4 style={{ marginBottom: 7 }}>Complainant</h4>
            {c.complainant ? (
              <button className="person" onClick={() => onNetwork({ kind: 'person', label: c.complainant.name })}>
                <span className="avatar">{initials(c.complainant.name)}</span>
                <span className="person-main">
                  <span className="person-name">{c.complainant.name}</span>
                  <span className="person-meta">
                    {c.complainant.age} yrs · {c.complainant.gender} · {c.complainant.occupation}
                  </span>
                  <span className="person-chips">
                    <span className="chip">☎ {c.complainant.phone}</span>
                    <span className="chip">{c.complainant.address}</span>
                  </span>
                </span>
              </button>
            ) : <Empty>No complainant on record.</Empty>}

            <h4 style={{ margin: '13px 0 7px' }}>Accused / suspects ({c.accused.length})</h4>
            {c.accused.map((a) => (
              <button key={a.person_id} className="person"
                onClick={() => onNetwork({ kind: 'person', entity_id: a.person_id, label: a.name })}>
                <span className="avatar acc">{initials(a.name)}</span>
                <span className="person-main">
                  <span className="person-name">
                    {a.name}
                    <span className="muted-note">alias {a.alias}</span>
                  </span>
                  <span className="person-meta">
                    {a.gender} · {a.age_band} · {a.person_id}
                    {a.phone ? ` · ☎ ${a.phone}` : ''}
                  </span>
                  <span className="person-chips">
                    <span className={`chip ${a.prior_firs >= 3 ? 'bad' : a.prior_firs ? 'warn' : ''}`}>
                      {a.prior_firs} previous FIR{a.prior_firs === 1 ? '' : 's'}
                    </span>
                    <span className={`chip ${a.custody_status === 'In custody' ? 'ok' : a.custody_status === 'Absconding' ? 'bad' : ''}`}>
                      {a.custody_status}
                    </span>
                    {!!a.associates && <span className="chip">{a.associates} known associate{a.associates === 1 ? '' : 's'}</span>}
                  </span>
                  {!!a.cases.length && (
                    <span className="person-chips" style={{ marginTop: 5 }}>
                      {a.cases.map((id) => {
                        const r = queueById.get(id);
                        return r ? (
                          <button key={id} className="btn btn-sm"
                            onClick={(e) => { e.stopPropagation(); onOpenCase(id); }}>
                            {r.fir_no} · {r.crime_type}
                          </button>
                        ) : null;
                      })}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {!c.accused.length && <Empty>No accused named yet.</Empty>}

            {!!c.victims.length && (
              <>
                <h4 style={{ margin: '13px 0 7px' }}>Victims ({c.victims.length})</h4>
                {c.victims.map((v, i) => (
                  <div className="person" key={i} style={{ cursor: 'default' }}>
                    <span className="avatar">{initials(v.name)}</span>
                    <span className="person-main">
                      <span className="person-name">{v.name}</span>
                      <span className="person-meta">{v.age} yrs · {v.gender}</span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </Panel>

          <Panel
            title="Connected FIRs"
            note={`${c.related.length} case${c.related.length === 1 ? '' : 's'} linked, each with its reason`}
          >
            {!c.related.length && <Empty>No other FIR shares an entity, location or MO with this case.</Empty>}
            {c.related.map((r) => {
              const row = queueById.get(r.fir_id);
              if (!row) return null;
              return (
                <div key={r.fir_id} className={`link-item ${pClass(row.priority)}`}>
                  <div className="link-head">
                    <button className="btn-link link-no" onClick={() => onOpenCase(r.fir_id)}>
                      {row.fir_no}
                    </button>
                    <Tag level={row.priority} />
                    <span className="link-meta">
                      {row.crime_type} · {row.location} · {dateLabel(row.occurred_at)}
                    </span>
                    <Confidence value={r.confidence} label={r.confidence_label} />
                  </div>
                  <div className="reasons">
                    {r.reasons.map((rs, i) => (
                      <span className="reason" key={i}>
                        <b>{rules[rs.code] || rs.code}</b>
                        <span>{rs.detail}</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </Panel>

          <Panel title="Case timeline" note="Chronological record of everything on this file">
            <div className="tl-legend">
              {TL_KINDS.map(([k, label]) => (
                <span key={k}>
                  <i className={`tl-legend-${k}`} style={{ background: TL_COLOR[k] }} />{label}
                </span>
              ))}
            </div>
            <div className="timeline">
              {c.timeline.map((e, i) => (
                <div className={`tl-item tl-${e.kind}`} key={i}>
                  <span className="tl-dot" />
                  <div className="tl-at">{dateLabel(e.at, true)}</div>
                  <div className="tl-title">
                    {e.title}
                    <span className="tl-kind">{e.kind}</span>
                  </div>
                  <div className="tl-detail">{e.detail}</div>
                  {e.actor && e.actor !== '—' && <div className="tl-actor">by {e.actor}</div>}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* ================= right column ================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <Panel
            title="Related entities"
            right={<button className="btn btn-sm btn-primary" onClick={() => onNetwork({ kind: 'fir', entity_id: c.fir_id, label: c.fir_no })}>
              View intelligence network
            </button>}
          >
            <div className="entity-row">
              <div className="entity-cell"><b>{fmt(c.entities.persons)}</b><span>Persons</span></div>
              <div className="entity-cell"><b>{fmt(c.entities.vehicles)}</b><span>Vehicles</span></div>
              <div className="entity-cell"><b>{fmt(c.entities.phones)}</b><span>Phones</span></div>
              <div className="entity-cell"><b>{fmt(c.entities.locations)}</b><span>Locations</span></div>
              <div className="entity-cell"><b>{fmt(c.entities.related_firs)}</b><span>Related FIRs</span></div>
            </div>
            {!!c.entities.items.length && (
              <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {c.entities.items.map((it) => (
                  <button key={it.id} className="btn btn-sm"
                    style={{ justifyContent: 'flex-start', height: 'auto', padding: '5px 8px' }}
                    onClick={() => onNetwork({ kind: it.kind, entity_id: it.id, label: it.label })}>
                    <span>{ICON[it.kind]}</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      {it.label}
                      {it.primary && <span className="chip" style={{ marginLeft: 6 }}>on this FIR</span>}
                    </span>
                    <span className="muted-note">{it.sub}</span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Intelligence insights"
            note={`${c.insights.length} signal${c.insights.length === 1 ? '' : 's'}`}
          >
            {!c.insights.length && (
              <Empty>Nothing in the wider record set connects to this case yet.</Empty>
            )}
            {c.insights.map((ins) => (
              <Insight key={ins.id} insight={ins} queueById={queueById}
                onOpenCase={onOpenCase} onAct={(a) => onAct(a, c)} />
            ))}
            <p className="muted-note" style={{ marginTop: 9 }}>
              Insights are leads for the investigating officer to verify. They are generated from
              record matches and statistical comparison — not conclusions, and never a substitute
              for the officer's judgement.
            </p>
          </Panel>

          {cluster && (
            <Panel title="Part of an emerging pattern" note={`${cluster.window_days}-day window`}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {cluster.crime_type} · {cluster.district}
              </div>
              <div className="stat-line" style={{ marginBottom: 9 }}>
                <div><b>{cluster.case_count}</b><span>Incidents</span></div>
                <div><b>{cluster.baseline}</b><span>Previous period</span></div>
                <div><b>{String(cluster.peak_hour).padStart(2, '0')}:00</b><span>Peak hour</span></div>
              </div>
              <button className="btn btn-primary" onClick={() => onOpenPattern(cluster.cluster_id)}>
                Investigate pattern
              </button>
            </Panel>
          )}

          <Panel title="Case actions">
            <ActionBar actions={SECONDARY_ACTIONS} onAct={(a) => onAct(a, c)} primaryCount={0} size="sm" />
            <p className="muted-note" style={{ marginTop: 9 }}>
              Write actions are recorded against {c.io.name} and are subject to the role permissions
              on your account.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

const TL_COLOR = {
  system: '#64748b', officer: '#16419e', evidence: '#1f56d6',
  intelligence: '#a4530b', status: '#16653f',
};
const ICON = { vehicle: '🚗', phone: '📱', location: '📍', person: '👤', fir: '📄' };

function initials(name) {
  return String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

// One insight, with its "why" disclosure. The panel is collapsed by default so
// the column stays scannable, and every insight can be opened to its evidence.
function Insight({ insight, queueById, onOpenCase, onAct }) {
  const [open, setOpen] = useState(false);
  const records = useMemo(
    () => insight.records.map((r) => {
      const row = r.kind === 'fir' ? queueById.get(r.id) : null;
      return { ...r, label: row ? row.fir_no : r.label || r.id,
        note: r.note || (row ? `${row.crime_type} · ${row.occurred_at.slice(0, 10)}` : undefined) };
    }),
    [insight.records, queueById],
  );

  return (
    <div className="insight">
      <div className="insight-head">
        <div className="insight-top">
          <Confidence value={insight.confidence} label={insight.confidence_label} />
          <span className="claim c-ml">AI-generated lead</span>
        </div>
        <div className="insight-h">{insight.headline}</div>
        <div className="insight-d">{insight.detail}</div>
      </div>
      <div className="insight-foot">
        <button className="btn-link" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide explanation' : 'Why am I seeing this?'}
        </button>
        <span className="muted-note">{records.length} supporting record{records.length === 1 ? '' : 's'}</span>
      </div>
      {open && (
        <WhyPanel
          signals={insight.evidence}
          records={records}
          action={insight.action}
          onRecord={(r) => r.kind === 'fir' && onOpenCase(r.id)}
          method={{
            name: 'Record-match and comparison',
            detail: 'Generated by matching identities, registrations and locations across FIR '
              + 'records, and by comparing this case against the surrounding caseload.',
            source: 'FIR record set',
            caveat: 'A match on record is a lead, not a finding of fact. Confirm against the '
              + 'case files before acting, and record what you find.',
          }}
        />
      )}
    </div>
  );
}
