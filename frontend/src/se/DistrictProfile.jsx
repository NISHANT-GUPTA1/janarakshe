import React from 'react';
import { Bar, Delta, Empty, Panel, Spark, Tag, fmt } from '../ops/ui.jsx';
import { ProfileRow, StrengthBar } from './SEParts.jsx';

// ===========================================================
// District intelligence — the page an officer lands on once they
// have chosen a district.
//
// Order: what is this district like -> how does it compare with the
// state -> what crime stands out -> which associations apply here ->
// which districts are comparable -> what changed.
// ===========================================================

const RISK_TONE = { Critical: 'CRITICAL', High: 'HIGH', Medium: 'WATCH', Low: 'RESOLVED' };

export default function DistrictProfile({
  district, state, associations, headlineIds, onOpenAssociation,
  onCompare, onOpenCrimeIntel, onOpenFirs,
}) {
  if (!district) return <Empty>Select a district to begin.</Empty>;
  const d = district;

  // The headline associations, re-read for this district: does its own profile
  // put it on the high side of the indicator this association is about?
  const relevant = headlineIds
    .map((id) => associations.find((a) => a.association_id === id))
    .filter(Boolean)
    .map((a) => {
      const ind = d.indicators.find((i) => i.id === a.indicator);
      const crime = d.crime.find((c) => c.group === a.crime_group);
      return { a, ind, crime };
    })
    .filter((x) => x.ind && x.crime);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ---------------- header ---------------- */}
      <div className={`case-head p-${(RISK_TONE[d.risk_band] || 'INFORMATION').toLowerCase()}`}>
        <div className="case-head-main">
          <span className="case-no">Socio-economic &amp; crime context</span>
          <div className="case-title"><h1>{d.name}</h1></div>
          <div className="case-badges">
            <Tag level={RISK_TONE[d.risk_band] || 'INFORMATION'}>
              {d.risk_band} district crime risk · {d.risk_score}
            </Tag>
            <span className="chip">{fmt(d.population)} residents</span>
            <span className="chip">{d.hotspot_status === 'none' ? 'Stable' : d.hotspot_status}</span>
          </div>

          <div style={{ marginTop: 9 }}>
            <h4 style={{ marginBottom: 4 }}>Context summary</h4>
            <div className="btn-row">
              {d.context_summary.map((c) => <span key={c} className="chip">{c}</span>)}
            </div>
            <p style={{ fontSize: '0.83rem', marginTop: 8, maxWidth: 640 }}>
              <b>Crime profile:</b> {d.dominant_crime?.toLowerCase()} is the district's
              highest-ranking recorded category relative to the rest of Karnataka.
            </p>
            <p className="muted-note" style={{ marginTop: 5, maxWidth: 640 }}>
              These characteristics are observed alongside the crime pattern below. Nothing here
              says one causes the other, and none of it describes the people who live here.
            </p>
          </div>
        </div>

        <div className="stat-line">
          <div><b>{fmt(d.crime_rate_per_100k)}</b><span>Crime rate / 100k</span></div>
          <div>
            <b>{fmt(d.indicators.find((i) => i.id === 'population_density')?.value)}</b>
            <span>Population density</span>
          </div>
          <div>
            <b>{d.indicators.find((i) => i.id === 'urbanization_rate')?.value}%</b>
            <span>Urbanisation</span>
          </div>
          <div>
            <b>{d.indicators.find((i) => i.id === 'literacy_rate')?.value}%</b>
            <span>Literacy</span>
          </div>
        </div>
      </div>

      {/* ---------------- what stands out, for this district ---------------- */}
      <Panel
        title="What stands out here"
        note="Statewide associations, read against this district's own position"
      >
        {!relevant.length && <Empty>No headline association applies to this district's profile.</Empty>}
        {relevant.map(({ a, ind, crime }) => (
          <div className="assoc" key={a.association_id}
            style={{ '--sc': a.strength_code === 'STRONG' ? 'var(--p-critical)' : 'var(--p-high)' }}>
            <div className="assoc-body">
              <div className="assoc-top">
                <span className="assoc-pair">{a.indicator_name} &amp; {a.crime_name.toLowerCase()}</span>
              </div>
              <StrengthBar r={a.r} strengthCode={a.strength_code} strengthLabel={a.strength_label} />
              <div className="assoc-mean">{a.meaning}</div>
              <div className="btn-row" style={{ marginBottom: 8 }}>
                <span className={`chip ${ind.band === 'High' ? 'bad' : ind.band === 'Low' ? 'ok' : ''}`}>
                  {d.name}: {ind.band.toLowerCase()} {a.indicator_name.toLowerCase()}
                </span>
                <span className={`chip ${crime.band === 'High' ? 'bad' : crime.band === 'Low' ? 'ok' : ''}`}>
                  {crime.band.toLowerCase()} {a.crime_name.toLowerCase()} ({crime.rate}/100k)
                </span>
              </div>
              <div className="btn-row">
                <button className="btn btn-sm btn-primary" onClick={() => onOpenAssociation(a.association_id)}>
                  Why does this matter?
                </button>
                <button className="btn btn-sm" onClick={() => onOpenCrimeIntel(d)}>
                  View crime hotspots
                </button>
              </div>
            </div>
          </div>
        ))}
      </Panel>

      <div className="grid-2">
        {/* ---------------- socio-economic profile ---------------- */}
        <Panel
          title="Socio-economic profile"
          note="Bar = rank among the 30 districts · value = the district's own figure"
        >
          {d.indicators.filter((i) => !i.protected).map((i) => (
            <ProfileRow
              key={i.id}
              name={i.name}
              sub={i.ratio_label}
              percentile={i.percentile}
              value={i.value}
              unit={i.unit}
              band={i.band}
              note={`${i.definition || ''} · state average ${i.state_mean}`}
            />
          ))}
          <details style={{ marginTop: 10 }}>
            <summary className="btn-link" style={{ fontSize: '0.75rem' }}>
              Show protected attributes ({d.indicators.filter((i) => i.protected).length})
            </summary>
            <div className="why-caveat" style={{ margin: '8px 0' }}>
              <b>Handle with care</b>
              These are population composition figures, published here for completeness. They
              describe a district, never an individual, and must not be read as characteristics
              of offenders.
            </div>
            {d.indicators.filter((i) => i.protected).map((i) => (
              <ProfileRow key={i.id} name={i.name} sub={i.ratio_label}
                percentile={i.percentile} value={i.value} unit={i.unit} band={i.band} />
            ))}
          </details>
        </Panel>

        {/* ---------------- crime profile ---------------- */}
        <Panel
          title="Crime profile"
          note={`Recorded rates per 100,000 · bar = rank among 30 districts`}
        >
          {d.crime.map((c) => (
            <ProfileRow
              key={c.group}
              name={c.name}
              sub={c.ratio_label}
              percentile={c.percentile}
              value={c.rate}
              unit="/100k"
              band={c.band}
              note={c.plain}
              onClick={() => onOpenFirs({ district: d.name })}
            />
          ))}
          <div className="btn-row" style={{ marginTop: 11 }}>
            <button className="btn btn-sm btn-primary" onClick={() => onOpenCrimeIntel(d)}>
              View crime intelligence
            </button>
            <button className="btn btn-sm" onClick={() => onOpenFirs({ district: d.name })}>
              View related FIRs
            </button>
          </div>
        </Panel>
      </div>

      <div className="grid-2">
        {/* ---------------- against the state ---------------- */}
        <Panel title="Compared with the state" note="Difference computed for you">
          <table className="cmp-table">
            <thead>
              <tr><th>Indicator</th><th>{d.name}</th><th>State average</th><th>Difference</th></tr>
            </thead>
            <tbody>
              {d.indicators.filter((i) => !i.protected).slice(0, 7).map((i) => (
                <tr key={i.id}>
                  <td className="metric">{i.name}</td>
                  <td className="v"><b>{fmt(i.value)}</b>{i.unit === '%' ? '%' : ''}</td>
                  <td className="v muted-note">{fmt(i.state_mean)}</td>
                  <td className="v">
                    <span className={`prof-band ${i.ratio >= 1.15 ? 'band-High' : i.ratio <= 0.85 ? 'band-Low' : 'band-Near'}`}>
                      {i.ratio >= 1.15 ? '↑ ' : i.ratio <= 0.85 ? '↓ ' : ''}{i.ratio_label}
                    </span>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="metric">Crime rate</td>
                <td className="v"><b>{fmt(d.crime_rate_per_100k)}</b></td>
                <td className="v muted-note">{fmt(state.crime.OVERALL?.mean)}</td>
                <td className="v">
                  <span className="prof-band band-Near">
                    {(d.crime_rate_per_100k / (state.crime.OVERALL?.mean || 1)).toFixed(1)}× state average
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </Panel>

        {/* ---------------- similar districts ---------------- */}
        <Panel
          title="Similar districts"
          note="Comparable socio-economic profile"
        >
          <p className="muted-note" style={{ marginBottom: 10 }}>
            These districts look most like {d.name} on the socio-economic indicators. The point
            is not that they are the same — it is that where two similar districts report
            different crime, the difference is worth explaining.
          </p>
          <table className="cmp-table">
            <thead>
              <tr><th>District</th><th>Closeness</th><th>Crime rate</th><th>vs {d.name}</th><th /></tr>
            </thead>
            <tbody>
              {d.similar.map((s) => (
                <tr key={s.geo_unit_id}>
                  <td className="metric">{s.name}</td>
                  <td className="v">
                    <Bar value={s.similarity} max={1} />
                    <span className="muted-note" style={{ fontSize: '0.7rem' }}>{s.similarity_label}</span>
                  </td>
                  <td className="v"><b>{fmt(s.crime_rate_per_100k)}</b></td>
                  <td className="v"><Delta pct={s.rate_gap_pct != null ? -s.rate_gap_pct : null} /></td>
                  <td>
                    <button className="btn btn-sm" onClick={() => onCompare(s.geo_unit_id)}>Compare</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid-2">
        {/* ---------------- change over time ---------------- */}
        <Panel title="How the district has changed" note="Recorded cognizable cases">
          {d.change ? (
            <>
              <div className="stat-line" style={{ marginBottom: 11 }}>
                <div><b>{fmt(d.change.to)}</b><span>{d.change.to_year}</span></div>
                <div><b>{fmt(d.change.from)}</b><span>{d.change.from_year}</span></div>
                <div><b><Delta pct={d.change.pct} /></b><span>Year on year</span></div>
              </div>
              <Spark values={d.trend.map((t) => t.total)} w={340} h={58} />
              <p className="muted-note" style={{ marginTop: 7 }}>
                {d.trend[0].year}–{d.trend[d.trend.length - 1].year}. Socio-economic indicators are
                Census 2011 and do not have an annual series, so this shows the crime side only.
                A change in crime is not evidence that a socio-economic change caused it.
              </p>
            </>
          ) : <Empty>No series available.</Empty>}
        </Panel>

        {/* ---------------- what drives the risk score ---------------- */}
        <Panel title="District crime risk" note={`Score ${d.risk_score} · ${d.risk_band}`}>
          <p className="muted-note" style={{ marginBottom: 10 }}>
            An analytical indicator derived from recorded crime patterns and district-level data.
            It describes the caseload, not the population, and it is not a prediction of anyone's
            behaviour.
          </p>
          <div className="stat-line" style={{ marginBottom: 11 }}>
            <div><b>{d.risk_score}</b><span>This district</span></div>
            <div><b>{d.risk_band}</b><span>Band</span></div>
            <div>
              <b>{d.hotspot_status === 'none' ? 'Stable' : d.hotspot_status}</b>
              <span>Hotspot status</span>
            </div>
          </div>
          <h4 style={{ marginBottom: 6 }}>Top contributing signals</h4>
          {d.risk_components?.length ? (
            <table className="ops-table">
              <tbody>
                {d.risk_components.map((c) => {
                  const v = c.contribution ?? c.value ?? 0;
                  const max = Math.max(...d.risk_components.map((x) => x.contribution ?? x.value ?? 0), 1);
                  return (
                    <tr key={c.name || c.component} style={{ cursor: 'default' }}>
                      <td>{String(c.name || c.component || '').replace(/_/g, ' ')}</td>
                      <td><Bar value={v} max={max} /></td>
                      <td className="num strong">{typeof v === 'number' ? v.toFixed(1) : v}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <Empty>Components unavailable.</Empty>}
        </Panel>
      </div>
    </div>
  );
}
