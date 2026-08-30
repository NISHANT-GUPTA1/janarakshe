import React, { useMemo, useState } from 'react';
import { Empty, Panel, fmt } from '../ops/ui.jsx';

// ===========================================================
// Shared pieces of the socio-economic view.
//
// The rule running through all of them: a bar never carries meaning
// on its own. Every meter prints its value and its band in words, so
// the page is readable without decoding colour or length.
// ===========================================================

export const bandClass = (band) => `band-${String(band || '').split(' ')[0]}`;

// One profile row: name, meter, value, band. Used for both socio-economic
// indicators and crime rates so the two blocks read as one instrument.
export function ProfileRow({ name, sub, percentile, value, unit, band, note, onClick }) {
  const Row = onClick ? 'button' : 'div';
  return (
    <Row
      className="prof-row"
      onClick={onClick}
      style={onClick ? { width: '100%', border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', textAlign: 'left' } : undefined}
    >
      <span className="prof-name">
        {name}
        {sub && <small>{sub}</small>}
      </span>
      <span className="prof-meter">
        <span className="prof-track" title={`${Math.round(percentile * 100)}th percentile of 30 districts`}>
          <span className="prof-mid" />
          <span className="prof-fill" style={{ width: `${Math.max(percentile * 100, 2)}%` }} />
        </span>
      </span>
      <span className="prof-val">
        {typeof value === 'number' ? fmt(value) : value}
        {unit && <small>{unit}</small>}
      </span>
      <span className={`prof-band ${bandClass(band)}`} title={note}>{band}</span>
    </Row>
  );
}

// The signed association bar. Zero sits in the middle; the value is printed.
export function StrengthBar({ r, strengthCode, strengthLabel, showScale }) {
  const pct = Math.min(Math.abs(r), 1) * 50;
  return (
    <>
      <div className="rbar">
        <span className={`strength-tag s-${strengthCode}`}>{strengthLabel}</span>
        <span className="rbar-track">
          <span className="rbar-zero" />
          <span className={`rbar-fill ${r >= 0 ? 'pos' : 'neg'}`} style={{ width: `${pct}%` }} />
        </span>
        <span className="rbar-val">{r >= 0 ? '+' : ''}{r.toFixed(2)}</span>
      </div>
      {showScale && (
        <div className="rbar-scale"><span>−1.0</span><span>0</span><span>+1.0</span></div>
      )}
    </>
  );
}

// Why this matters / what it cannot be used for. The second list is not
// decoration: it is the guard-rail that keeps a district statistic from being
// read as a statement about a person.
export function WhyItMatters({ association: a }) {
  return (
    <div className="why-panel">
      <h5>What this means</h5>
      <p style={{ fontSize: '0.8rem', marginBottom: 9 }}>{a.meaning}</p>

      <h5>Evidence</h5>
      <ul className="why-list">
        {a.evidence.map((e, i) => <li key={i}>{e}</li>)}
      </ul>

      {a.expectation && (
        <div className={a.expectation.matches ? 'why-action' : 'why-caveat'} style={{ marginTop: 9 }}>
          <b>{a.expectation.label}</b>
          {a.expectation.theory}
          {a.expectation.note && <div style={{ marginTop: 5 }}>{a.expectation.note}</div>}
        </div>
      )}

      <div className="why-caveat" style={{ marginTop: 9 }}>
        <b>Important limitation</b>
        {a.limitation}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
        <div>
          <h5>Use this for</h5>
          <ul className="why-list">{a.use_for.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
        <div>
          <h5>Do not use this for</h5>
          <ul className="why-list no-tick">
            {a.not_for.map((u, i) => (
              <li key={i} style={{ color: 'var(--p-critical)' }}>
                <span style={{ fontWeight: 800 }}>✕</span> {u}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// Scatter of the 30 districts behind one association, with the fitted line.
// It is supporting evidence for the sentence above it, never the finding itself.
export function Scatter({ points, xLabel, yLabel, highlight, onPick, height = 250 }) {
  const [tip, setTip] = useState(null);
  const W = 460;
  const H = height;
  const pad = { l: 46, r: 12, t: 12, b: 34 };

  const geom = useMemo(() => {
    if (!points?.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const sx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
    const sy = (v) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

    // least-squares fit, drawn dashed so it reads as a summary, not a prediction
    const n = points.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
    const den = points.reduce((s, p) => s + (p.x - mx) ** 2, 0) || 1;
    const slope = num / den;
    const fit = [
      { x: x0, y: my + slope * (x0 - mx) },
      { x: x1, y: my + slope * (x1 - mx) },
    ];
    return { sx, sy, x0, x1, y0, y1, fit };
  }, [points, H]);

  if (!geom) return <Empty>No district data for this pair.</Empty>;

  return (
    <div className="scatter-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Scatter of ${points.length} districts: ${xLabel} against ${yLabel}`}>
        <line className="scatter-axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} />
        <line className="scatter-axis" x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} />

        <line className="scatter-fit"
          x1={geom.sx(geom.fit[0].x)} y1={geom.sy(geom.fit[0].y)}
          x2={geom.sx(geom.fit[1].x)} y2={geom.sy(geom.fit[1].y)} />

        {points.map((p) => (
          <circle
            key={p.geo_unit_id}
            className={`scatter-dot ${highlight === p.geo_unit_id ? 'hi' : ''}`}
            cx={geom.sx(p.x)} cy={geom.sy(p.y)}
            r={highlight === p.geo_unit_id ? 6 : 4}
            onMouseEnter={() => setTip({ ...p, cx: geom.sx(p.x), cy: geom.sy(p.y) })}
            onMouseLeave={() => setTip(null)}
            onClick={() => onPick?.(p)}
            style={{ cursor: onPick ? 'pointer' : 'default' }}
          />
        ))}

        <text className="scatter-lab" x={pad.l} y={H - pad.b + 14}>{fmt(round2(geom.x0))}</text>
        <text className="scatter-lab" x={W - pad.r} y={H - pad.b + 14} textAnchor="end">{fmt(round2(geom.x1))}</text>
        <text className="scatter-lab" x={(W + pad.l) / 2} y={H - 6} textAnchor="middle">{xLabel}</text>
        <text className="scatter-lab" x={pad.l - 6} y={H - pad.b} textAnchor="end">{fmt(round2(geom.y0))}</text>
        <text className="scatter-lab" x={pad.l - 6} y={pad.t + 8} textAnchor="end">{fmt(round2(geom.y1))}</text>
        <text className="scatter-lab" x={12} y={pad.t + 4} transform={`rotate(-90 12 ${pad.t + 4})`}
          textAnchor="end">{yLabel}</text>
      </svg>
      {tip && (
        <span className="scatter-tip" style={{ left: `${(tip.cx / W) * 100}%`, top: `${(tip.cy / H) * 100}%` }}>
          {tip.name}: {fmt(tip.x)} → {fmt(tip.y)}/100k
        </span>
      )}
    </div>
  );
}

const round2 = (v) => Math.round(v * 100) / 100;

// A compact "data & methodology" drawer. Always available, never in the way.
export function MethodologyDrawer({ data }) {
  return (
    <Panel title="Data &amp; methodology">
      <details>
        <summary className="btn-link" style={{ fontSize: '0.8rem' }}>
          Sources, method and limitations
        </summary>
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div>
            <h4 style={{ marginBottom: 5 }}>Data sources</h4>
            <ul className="why-list">
              <li>Census of India 2011 — socio-economic indicators, district level</li>
              <li>NCRB district IPC crime — recorded cognizable cases, {data.crime_year}</li>
              <li>District boundary geometry — area computed geodesically</li>
            </ul>
          </div>
          <div>
            <h4 style={{ marginBottom: 5 }}>Analysis</h4>
            <ul className="why-list">
              <li>Geographic level: district ({data.n_districts} districts)</li>
              <li>Tests: {data.method.tests.join(', ')}</li>
              <li>Target: {data.method.target}</li>
              <li>Significance threshold: p &lt; {data.method.significance_alpha}</li>
            </ul>
          </div>
          <div>
            <h4 style={{ marginBottom: 5 }}>Association strength scale</h4>
            <table className="ops-table">
              <tbody>
                {data.strength_scale.map((s) => (
                  <tr key={s.code} style={{ cursor: 'default' }}>
                    <td><span className={`strength-tag s-${s.code}`}>{s.label}</span></td>
                    <td className="muted-note">{s.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4 style={{ marginBottom: 5 }}>Limitations</h4>
            {Object.entries(data.ethics).map(([k, v]) => (
              <div className="why-caveat" key={k} style={{ marginBottom: 6 }}>
                <b>{k.replace(/_/g, ' ')}</b>{v}
              </div>
            ))}
          </div>
          <div className="why-caveat">
            <b>Protected attributes</b>{data.protected_note}
          </div>
        </div>
      </details>
    </Panel>
  );
}
