import React, { useMemo, useState } from 'react';
import { Bar, Crumbs, Delta, Empty, Field, Panel, Select, fmt } from '../ops/ui.jsx';
import { ProfileRow, Scatter, StrengthBar, WhyItMatters, bandClass } from './SEParts.jsx';

// ===========================================================
// 1. What stands out — the statewide headline findings.
//    Three to five of them, never fifty. The full matrix is still
//    published; it lives in Advanced analysis.
// ===========================================================

export function StandOut({ data, onOpen, onExplore }) {
  const byId = useMemo(
    () => new Map(data.associations.map((a) => [a.association_id, a])),
    [data.associations],
  );
  const headline = data.headline_ids.map((id) => byId.get(id)).filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Panel
        title="What stands out"
        note={`The ${headline.length} strongest district-level associations in this dataset`}
      >
        <p className="muted-note" style={{ marginBottom: 12 }}>
          Selected from {data.associations.length} indicator × crime-category pairs: only those
          that are statistically significant and at least moderately strong, and excluding the
          protected population attributes. Every one of them is an association between district
          aggregates.
        </p>

        {headline.map((a) => (
          <div
            key={a.association_id}
            className="assoc"
            style={{ '--sc': a.strength_code === 'STRONG' ? 'var(--p-critical)' : 'var(--p-high)' }}
          >
            <div className="assoc-body">
              <div className="assoc-top">
                <span className="assoc-pair">{a.indicator_name} &amp; {a.crime_name.toLowerCase()}</span>
              </div>
              <StrengthBar r={a.r} strengthCode={a.strength_code} strengthLabel={a.strength_label} showScale />
              <div className="assoc-mean" style={{ marginTop: 8 }}>{a.meaning}</div>
              <div className="btn-row">
                <button className="btn btn-sm btn-primary" onClick={() => onOpen(a.association_id)}>
                  Why does this matter?
                </button>
                <button className="btn btn-sm" onClick={() => onExplore(a.indicator)}>
                  Explore districts
                </button>
              </div>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ===========================================================
// 2. Guided explorer — one indicator at a time, against every crime
//    category. The same information the matrix holds, in the shape
//    a question actually arrives in.
// ===========================================================

export function Explorer({ data, indicator, setIndicator, onOpen }) {
  const rows = useMemo(() => {
    const ids = data.by_indicator[indicator] || [];
    return ids
      .map((id) => data.associations.find((a) => a.association_id === id))
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  }, [data, indicator]);

  const meta = data.indicators.find((i) => i.id === indicator);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="filterbar" style={{ paddingTop: 0 }}>
        <Field label="Socio-economic indicator">
          <select value={indicator} onChange={(e) => setIndicator(e.target.value)} style={{ minWidth: 230 }}>
            {data.indicators.map((i) => (
              <option key={i.id} value={i.id}>{i.name}{i.protected ? ' (protected)' : ''}</option>
            ))}
          </select>
        </Field>
      </div>

      {meta?.protected && (
        <div className="why-caveat">
          <b>Protected attribute</b>{data.protected_note}
        </div>
      )}

      <Panel
        title={meta?.name || indicator}
        note={meta?.plain}
      >
        <p className="muted-note" style={{ marginBottom: 12 }}>
          How this indicator moves alongside each recorded crime category across the {data.n_districts}{' '}
          districts. A strong association here is a reason to look, not an explanation.
        </p>
        {rows.map((a) => (
          <div className="assoc" key={a.association_id} style={{ '--sc': strengthColor(a.strength_code) }}>
            <div className="assoc-body">
              <div className="assoc-top">
                <span className="assoc-pair" style={{ fontSize: '0.9rem' }}>{a.crime_name}</span>
                <span className="muted-note">{a.significant ? 'Statistically significant' : 'Not significant'}</span>
              </div>
              <StrengthBar r={a.r} strengthCode={a.strength_code} strengthLabel={a.strength_label} />
              <div className="assoc-mean">{a.meaning}</div>
              <button className="btn btn-sm" onClick={() => onOpen(a.association_id)}>
                View evidence
              </button>
            </div>
          </div>
        ))}
        {!rows.length && <Empty>No association computed for this indicator.</Empty>}
      </Panel>
    </div>
  );
}

const strengthColor = (code) => ({
  STRONG: 'var(--p-critical)', MODERATE: 'var(--p-high)', WEAK: 'var(--p-watch)',
}[code] || 'var(--ops-line-2)');

// ===========================================================
// 3. One association, in full — the scatter, the evidence, the
//    limits, and the way back into the operational modules.
// ===========================================================

export function AssociationDetail({
  data, association: a, district, onBack, onOpenDistrict, onOpenCrimeIntel,
}) {
  if (!a) return <Empty>Association not found.</Empty>;
  const indMeta = data.indicators.find((i) => i.id === a.indicator);

  const ranked = [...a.scatter].sort((p, q) => q.y - p.y);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Crumbs items={[
        { label: 'Socio-economic intelligence', onClick: onBack },
        { label: `${a.indicator_name} & ${a.crime_name.toLowerCase()}` },
      ]} />

      <div className="case-head" style={{ '--pc': strengthColor(a.strength_code) }}>
        <div className="case-head-main">
          <span className="case-no">{a.association_id} · district-level association</span>
          <div className="case-title">
            <h1 style={{ textTransform: 'none' }}>
              {a.indicator_name} &amp; {a.crime_name.toLowerCase()}
            </h1>
          </div>
          <div style={{ maxWidth: 420, marginTop: 6 }}>
            <StrengthBar r={a.r} strengthCode={a.strength_code} strengthLabel={a.strength_label} showScale />
          </div>
        </div>
        <div className="stat-line">
          <div><b>{a.r >= 0 ? '+' : ''}{a.r.toFixed(2)}</b><span>Association strength</span></div>
          <div><b>{a.n}</b><span>Districts</span></div>
          <div>
            <b>{a.significant ? 'Yes' : 'No'}</b>
            <span>Statistically significant</span>
          </div>
        </div>
      </div>

      <div className="grid-case">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel
            title="District distribution"
            note={`Each dot is one district${district ? ` · ${district.name} highlighted` : ''}`}
          >
            <Scatter
              points={a.scatter}
              xLabel={`${a.indicator_name} (${indMeta?.unit || ''})`}
              yLabel={`${a.crime_name} per 100k`}
              highlight={district?.geo_unit_id}
              onPick={(p) => onOpenDistrict(p.geo_unit_id)}
              height={280}
            />
            <p className="muted-note" style={{ marginTop: 8 }}>
              The dashed line is the straight-line fit through the districts. It summarises the
              pattern; it does not predict any district's crime rate.
            </p>
          </Panel>

          <Panel title="Supporting data" note={`All ${a.scatter.length} districts, highest crime rate first`} flush>
            <div className="ops-table-wrap" style={{ maxHeight: 330 }}>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>District</th>
                    <th style={{ textAlign: 'right' }}>{a.indicator_name}</th>
                    <th style={{ textAlign: 'right' }}>{a.crime_name} / 100k</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((p) => (
                    <tr key={p.geo_unit_id}
                      className={district?.geo_unit_id === p.geo_unit_id ? 'sel' : ''}
                      onClick={() => onOpenDistrict(p.geo_unit_id)}>
                      <td className="strong">{p.name}</td>
                      <td className="num">{fmt(p.x)}</td>
                      <td className="num strong">{fmt(p.y)}</td>
                      <td><Bar value={p.y} max={ranked[0].y} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="Why does this matter?">
            <WhyItMatters association={a} />
          </Panel>

          <Panel title="Take this further">
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => onOpenCrimeIntel(a)}>
                View crime hotspots
              </button>
              {district && (
                <button className="btn" onClick={() => onOpenDistrict(district.geo_unit_id)}>
                  Back to {district.name}
                </button>
              )}
            </div>
            <p className="muted-note" style={{ marginTop: 9 }}>
              Statistical detail — Pearson r, Spearman r, p-value and sample size — is in
              Advanced analysis.
            </p>
            <details style={{ marginTop: 8 }}>
              <summary className="btn-link" style={{ fontSize: '0.76rem' }}>Statistical detail</summary>
              <table className="ops-table" style={{ marginTop: 7 }}>
                <tbody>
                  <tr style={{ cursor: 'default' }}><td>Pearson r</td><td className="num strong">{a.r.toFixed(3)}</td></tr>
                  <tr style={{ cursor: 'default' }}><td>Spearman r</td><td className="num strong">{a.spearman_r.toFixed(3)}</td></tr>
                  <tr style={{ cursor: 'default' }}><td>p-value</td><td className="num strong">{a.p}</td></tr>
                  <tr style={{ cursor: 'default' }}><td>Sample size</td><td className="num strong">{a.n} districts</td></tr>
                </tbody>
              </table>
            </details>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ===========================================================
// 4. Compare two or three districts side by side.
// ===========================================================

export function Compare({ data, ids, setIds, onOpenDistrict, onOpenCrimeIntel }) {
  const picked = ids.map((id) => data.districts[id]).filter(Boolean);
  const options = Object.values(data.districts)
    .map((d) => ({ value: d.geo_unit_id, label: d.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const indicators = data.indicators.filter((i) => !i.protected);
  const groups = picked[0]?.crime.map((c) => c.group) || [];

  // The interesting sentence is not "these are similar" — it is "these are
  // similar, and yet". So the page computes the widest divergence itself.
  const divergence = useMemo(() => {
    if (picked.length < 2) return null;
    let best = null;
    groups.forEach((g) => {
      const vals = picked.map((d) => d.crime.find((c) => c.group === g));
      if (vals.some((v) => !v)) return;
      const rates = vals.map((v) => v.rate);
      const spread = Math.max(...rates) / (Math.min(...rates) || 1);
      if (!best || spread > best.spread) {
        best = { group: g, name: vals[0].name, spread, vals, rates };
      }
    });
    return best;
  }, [picked, groups]);

  const sharedTraits = useMemo(() => {
    if (picked.length < 2) return [];
    return indicators
      .filter((i) => {
        const bands = picked.map((d) => d.indicators.find((x) => x.id === i.id)?.band);
        return bands.every((b) => b && b === bands[0]);
      })
      .map((i) => ({ ...i, band: picked[0].indicators.find((x) => x.id === i.id).band }));
  }, [picked, indicators]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="filterbar" style={{ paddingTop: 0 }}>
        {[0, 1, 2].map((slot) => (
          <Field key={slot} label={slot === 0 ? 'District' : `Compare with ${slot}`}>
            <select
              value={ids[slot] || ''}
              onChange={(e) => {
                const next = [...ids];
                if (e.target.value) next[slot] = e.target.value; else next.splice(slot, 1);
                setIds(next.filter(Boolean));
              }}
              style={{ minWidth: 175 }}
            >
              <option value="">{slot === 0 ? 'Select…' : 'None'}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        ))}
      </div>

      {picked.length < 2 && <Empty>Choose at least two districts to compare.</Empty>}

      {picked.length >= 2 && (
        <>
          {divergence && (
            <Panel title="Key difference">
              <p style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: 8 }}>
                {sharedTraits.length
                  ? `Despite comparable ${sharedTraits.slice(0, 2).map((t) => t.name.toLowerCase()).join(' and ')}, `
                  : 'Across these districts, '}
                recorded {divergence.name.toLowerCase()} rates differ by{' '}
                {divergence.spread.toFixed(1)}× — from {fmt(Math.min(...divergence.rates))} to{' '}
                {fmt(Math.max(...divergence.rates))} per 100,000.
              </p>
              <div className="btn-row">
                {picked.map((d) => (
                  <button key={d.geo_unit_id} className="btn btn-sm" onClick={() => onOpenCrimeIntel(d)}>
                    Explore {d.name}
                  </button>
                ))}
              </div>
              <p className="muted-note" style={{ marginTop: 9 }}>
                A difference of this size between similar districts usually reflects local
                conditions, policing intensity or registration practice. It is a question to
                take into the crime intelligence view, not an answer.
              </p>
            </Panel>
          )}

          <Panel title="Socio-economic context" flush>
            <div className="panel-body">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th>Indicator</th>
                    {picked.map((d) => <th key={d.geo_unit_id}>{d.name}</th>)}
                    <th>State avg</th>
                  </tr>
                </thead>
                <tbody>
                  {indicators.map((i) => (
                    <tr key={i.id}>
                      <td className="metric">{i.name}</td>
                      {picked.map((d) => {
                        const v = d.indicators.find((x) => x.id === i.id);
                        return (
                          <td className="v" key={d.geo_unit_id}>
                            <b>{fmt(v?.value)}</b>
                            <span className={`prof-band ${bandClass(v?.band)}`} style={{ marginLeft: 7 }}>
                              {v?.band}
                            </span>
                          </td>
                        );
                      })}
                      <td className="v muted-note">{fmt(data.state.indicators[i.id]?.mean)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Crime profile" flush>
            <div className="panel-body">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th>Crime category</th>
                    {picked.map((d) => <th key={d.geo_unit_id}>{d.name}</th>)}
                    <th>State avg</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const vals = picked.map((d) => d.crime.find((c) => c.group === g));
                    const max = Math.max(...vals.map((v) => v?.rate || 0), 1);
                    return (
                      <tr key={g}>
                        <td className="metric">{vals[0]?.name || g}</td>
                        {vals.map((v, i) => (
                          <td className="v" key={picked[i].geo_unit_id}>
                            <b>{fmt(v?.rate)}</b>
                            <span style={{ marginLeft: 7 }}>
                              {v?.rate === max ? <span className="delta up">↑ highest</span>
                                : v?.rate === Math.min(...vals.map((x) => x?.rate || 0))
                                  ? <span className="delta down">↓ lowest</span>
                                  : <span className="delta flat">→</span>}
                            </span>
                          </td>
                        ))}
                        <td className="v muted-note">{fmt(data.state.crime[g]?.mean)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

// ===========================================================
// 5. Advanced analysis — the full matrix, unchanged. Nothing was
//    deleted from the old page; it was moved behind the intelligence.
// ===========================================================

export function Advanced({ data, onOpen }) {
  const [showProtected, setShowProtected] = useState(false);

  const indicators = data.indicators.filter((i) => showProtected || !i.protected);
  const groups = data.crime_groups.map((g) => g.code);
  const lookup = useMemo(() => {
    const m = new Map();
    data.associations.forEach((a) => m.set(`${a.indicator}|${a.crime_group}`, a));
    return m;
  }, [data.associations]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="data-note">
        <b>Analyst view</b>
        <span>
          The complete correlation matrix, with Pearson r, Spearman r, p-values and sample size.
          This is the same analysis the officer view is built on — nothing here is additional
          evidence, and nothing there is a simplification of a different result.
        </span>
      </div>

      <Panel
        title="Correlation matrix"
        note={`${indicators.length} indicators × ${groups.length} crime categories · n = ${data.n_districts}`}
        right={(
          <label className="graph-toggle" style={{ margin: 0 }}>
            <input type="checkbox" checked={showProtected}
              onChange={(e) => setShowProtected(e.target.checked)} />
            Include protected attributes
          </label>
        )}
        flush
      >
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th className="rowh">Indicator</th>
                {groups.map((g) => (
                  <th key={g}>{data.crime_groups.find((x) => x.code === g)?.name || g}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indicators.map((i) => (
                <tr key={i.id}>
                  <th className="rowh">
                    {i.name}
                    {i.protected && <span className="chip warn" style={{ marginLeft: 6 }}>protected</span>}
                  </th>
                  {groups.map((g) => {
                    const a = lookup.get(`${i.id}|${g}`);
                    if (!a) return <td key={g} className="muted-note">—</td>;
                    return (
                      <td
                        key={g}
                        className={`${a.significant ? 'sig' : ''} ${a.protected ? 'flagged' : ''}`}
                        style={{ background: cellColor(a.r) }}
                        title={`${i.name} × ${a.crime_name}\nPearson r ${a.r}  p ${a.p}\nSpearman r ${a.spearman_r}\n${a.strength_label}`}
                        onClick={() => onOpen(a.association_id)}
                      >
                        {a.r >= 0 ? '+' : ''}{a.r.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel-body" style={{ borderTop: '1px solid var(--ops-line)' }}>
          <div className="tl-legend">
            <span><i style={{ background: cellColor(0.8) }} /> Positive association</span>
            <span><i style={{ background: cellColor(-0.8) }} /> Negative association</span>
            <span><b>Bold</b> = statistically significant (p &lt; {data.method.significance_alpha})</span>
            <span>Dashed outline = protected attribute</span>
          </div>
          <p className="muted-note" style={{ marginTop: 6 }}>
            Click any cell to open the full evidence for that pair. Colour intensity tracks |r|;
            the value is printed in every cell so nothing depends on reading the shade.
          </p>
        </div>
      </Panel>

      <Panel title="All associations" note={`${data.associations.length} pairs`} flush>
        <div className="ops-table-wrap" style={{ maxHeight: 460 }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Indicator</th><th>Crime category</th><th>Strength</th>
                <th style={{ textAlign: 'right' }}>Pearson r</th>
                <th style={{ textAlign: 'right' }}>Spearman r</th>
                <th style={{ textAlign: 'right' }}>p</th>
                <th>Expected relationship</th>
              </tr>
            </thead>
            <tbody>
              {data.associations
                .filter((a) => showProtected || !a.protected)
                .slice()
                .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
                .map((a) => (
                  <tr key={a.association_id} onClick={() => onOpen(a.association_id)}>
                    <td className="strong">{a.indicator_name}</td>
                    <td>{a.crime_name}</td>
                    <td><span className={`strength-tag s-${a.strength_code}`}>{a.strength_label}</span></td>
                    <td className="num strong">{a.r >= 0 ? '+' : ''}{a.r.toFixed(3)}</td>
                    <td className="num">{a.spearman_r >= 0 ? '+' : ''}{a.spearman_r.toFixed(3)}</td>
                    <td className="num">{a.p}</td>
                    <td className="muted-note">
                      {a.expectation ? a.expectation.label : 'No prior expectation'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ===========================================================
// 6. District register — the sortable directory of all 30 districts
//    that the old Reports page led with. It is still here; it is now
//    a way into a district rather than the whole page.
// ===========================================================

export function Register({ data, onOpenDistrict, onOpenCrimeIntel }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => Object.values(data.districts)
    .filter((d) => !q || d.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)), [data.districts, q]);

  return (
    <Panel
      title="District register"
      note={`${rows.length} districts · sorted by district crime risk`}
      right={(
        <input
          value={q}
          placeholder="Filter districts…"
          onChange={(e) => setQ(e.target.value)}
          style={{ height: 28, border: '1px solid var(--ops-line-2)', borderRadius: 4, padding: '0 8px', font: 'inherit', minWidth: 180 }}
        />
      )}
      flush
    >
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>District</th>
              <th style={{ textAlign: 'right' }}>Rate / 100k</th>
              <th style={{ textAlign: 'right' }}>Total cases</th>
              <th>Status</th>
              <th>District crime risk</th>
              <th>Dominant category</th>
              <th>Context</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.geo_unit_id} onClick={() => onOpenDistrict(d.geo_unit_id)}>
                <td className="strong">{d.name}</td>
                <td className="num strong">{fmt(d.crime_rate_per_100k)}</td>
                <td className="num">{fmt(d.total_cognizable_cases)}</td>
                <td>
                  <span className="chip">{d.hotspot_status === 'none' ? 'Stable' : d.hotspot_status}</span>
                </td>
                <td>
                  <span className={`prof-band ${d.risk_band === 'Critical' ? 'band-High'
                    : d.risk_band === 'High' ? 'band-Above'
                      : d.risk_band === 'Medium' ? 'band-Near' : 'band-Low'}`}>
                    {d.risk_band} {d.risk_score}
                  </span>
                </td>
                <td>{d.dominant_crime}</td>
                <td className="muted-note" style={{ fontSize: '0.72rem' }}>
                  {d.context_summary.slice(0, 2).join(' · ')}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="btn-row">
                    <button className="btn btn-sm btn-primary" onClick={() => onOpenDistrict(d.geo_unit_id)}>
                      Profile
                    </button>
                    <button className="btn btn-sm" onClick={() => onOpenCrimeIntel(d)}>Intel</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body" style={{ borderTop: '1px solid var(--ops-line)' }}>
        <p className="muted-note">
          District crime risk is an analytical indicator derived from recorded crime patterns and
          district-level data. It describes a caseload, not a population, and it is not a
          prediction of anyone's behaviour.
        </p>
      </div>
    </Panel>
  );
}

// Red for positive, blue for negative, intensity by |r| — the same convention
// the previous matrix used, so an analyst reading both sees one scheme.
function cellColor(r) {
  const a = Math.min(Math.abs(r), 1);
  const alpha = 0.08 + a * 0.5;
  return r >= 0 ? `rgba(179,38,30,${alpha})` : `rgba(31,86,214,${alpha})`;
}
