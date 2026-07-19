import React, { useMemo, useRef, useState } from 'react';
import { SERIES, BAND_COLOR, fmt } from './palette.js';

// ===========================================================
// Hand-rolled SVG chart primitives for the console.
//
// House rules applied throughout (see the data-viz method):
//   - thin marks: 2px lines, 4px rounded data-ends anchored to the baseline
//   - recessive chrome: hairline grid, muted axis ink, no chart junk
//   - a hover layer by default: crosshair + tooltip on line/area, per-mark
//     tooltip on bars and arcs
//   - text wears text tokens, never the series colour; a colour swatch beside
//     the label carries identity instead
//   - single y-axis only, always zero-baselined
// ===========================================================

const GRID = 'rgba(20,36,58,0.08)';
const AXIS = '#6a7a90';

// ---------- Sparkline: trend shape only, no axes. ----------
export function Sparkline({ data, color = SERIES[0], w = 120, h = 34, fill = true }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i) => (i / (data.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 3 - ((v - min) / span) * (h - 8);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const id = `sp-${color.slice(1)}`;

  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${x(data.length - 1)},${h} L${x(0)},${h} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r="2.8" fill={color} />
    </svg>
  );
}

// ---------- Area chart with crosshair + tooltip. ----------
export function AreaTrend({ series, xKey = 'year', yKey = 'total', color = SERIES[0], height = 210, valueLabel = 'cases' }) {
  const box = useRef(null);
  const [hover, setHover] = useState(null);
  const W = 760;
  const H = height;
  const P = { t: 14, r: 16, b: 26, l: 48 };

  const { pts, ticks, yTicks, max } = useMemo(() => {
    const vals = series.map((d) => d[yKey]);
    const rawMax = Math.max(...vals, 1);
    const step = Math.pow(10, Math.floor(Math.log10(rawMax)) - 1);
    const max = Math.ceil(rawMax / (step * 5)) * step * 5;
    const x = (i) => P.l + (i / Math.max(series.length - 1, 1)) * (W - P.l - P.r);
    const y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
    const pts = series.map((d, i) => ({ ...d, x: x(i), y: y(d[yKey]), i }));
    const every = series.length > 9 ? 2 : 1;
    return {
      pts,
      max,
      ticks: pts.filter((_, i) => i % every === 0 || i === series.length - 1),
      yTicks: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: max * f, y: y(max * f) })),
    };
  }, [series, yKey, H]);

  if (!series?.length) return null;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x},${H - P.b} L${pts[0].x},${H - P.b} Z`;
  const last = pts[pts.length - 1];

  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let near = pts[0];
    for (const p of pts) if (Math.abs(p.x - px) < Math.abs(near.x - px)) near = p;
    setHover(near);
  };

  return (
    <div className="chart" ref={box} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Trend of ${valueLabel} over time`}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={P.l} x2={W - P.r} y1={t.y} y2={t.y} stroke={GRID} strokeWidth="1" />
            <text x={P.l - 10} y={t.y + 4} textAnchor="end" className="ax">
              {t.v >= 1000 ? `${Math.round(t.v / 1000)}k` : Math.round(t.v)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {ticks.map((t) => (
          <text key={t[xKey]} x={t.x} y={H - 8} textAnchor="middle" className="ax">{t[xKey]}</text>
        ))}

        {/* direct label on the terminal point — never a number on every point */}
        <circle cx={last.x} cy={last.y} r="4" fill={color} stroke="#fff" strokeWidth="2" />

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={P.t} y2={H - P.b} stroke="rgba(20,36,58,0.28)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hover.x} cy={hover.y} r="5" fill={color} stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="tip"
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
        >
          <b>{hover[xKey]}</b>
          <span><i style={{ background: color }} />{fmt(hover[yKey])} {valueLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Donut: risk-band composition. ----------
export function Donut({ data, total, centerLabel = 'Districts', size = 168 }) {
  const [hover, setHover] = useState(null);
  const sum = data.reduce((a, d) => a + d.value, 0) || 1;
  const R = size / 2;
  const r0 = R * 0.62;
  const r1 = R * 0.94;
  const GAP = 0.028; // ~2px surface gap between adjacent fills

  let acc = -Math.PI / 2;
  const arcs = data.map((d) => {
    const frac = d.value / sum;
    const a0 = acc + GAP / 2;
    const a1 = acc + frac * Math.PI * 2 - GAP / 2;
    acc += frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => `${(R + r * Math.cos(a)).toFixed(2)},${(R + r * Math.sin(a)).toFixed(2)}`;
    const d2 = a1 > a0
      ? `M${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`
      : '';
    return { ...d, d: d2, frac };
  });

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel} by risk band`}>
        {arcs.map((a) => (
          <path
            key={a.label}
            d={a.d}
            fill={a.color}
            opacity={hover && hover !== a.label ? 0.35 : 1}
            onMouseEnter={() => setHover(a.label)}
            onMouseLeave={() => setHover(null)}
            style={{ transition: 'opacity .15s' }}
          />
        ))}
        <text x={R} y={R - 4} textAnchor="middle" className="donut-num">{total ?? sum}</text>
        <text x={R} y={R + 16} textAnchor="middle" className="donut-cap">{centerLabel}</text>
      </svg>

      <ul className="legend-list">
        {arcs.map((a) => (
          <li
            key={a.label}
            className={hover === a.label ? 'on' : ''}
            onMouseEnter={() => setHover(a.label)}
            onMouseLeave={() => setHover(null)}
          >
            <i style={{ background: a.color }} />
            <span className="ll-label">{a.label}</span>
            <b>{a.value}</b>
            <span className="ll-pct">{Math.round(a.frac * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 24-hour bars: click to scrub the 3D scene. ----------
export function HourBars({ histogram, gravityByHour, selected, onSelect, height = 132 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...histogram, 1);
  const heinous = gravityByHour?.Heinous ?? [];

  return (
    <div className="hourbars" style={{ height }}>
      {histogram.map((v, h) => {
        const on = selected === h;
        const dim = selected != null && !on;
        const hv = heinous[h] ?? 0;
        return (
          <button
            key={h}
            className={`hb ${on ? 'on' : ''} ${dim ? 'dim' : ''}`}
            style={{ height: `${(v / max) * 100}%` }}
            onMouseEnter={() => setHover(h)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(on ? null : h)}
            aria-label={`${String(h).padStart(2, '0')}:00 — ${v} cases, ${hv} heinous`}
            aria-pressed={on}
          >
            {/* heinous sub-segment, offset by a 2px surface gap */}
            <span className="hb-heinous" style={{ height: `${(hv / Math.max(v, 1)) * 100}%` }} />
            {hover === h && (
              <span className="hb-tip">
                <b>{String(h).padStart(2, '0')}:00</b>
                {v} cases · {hv} heinous
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Horizontal ranked bars (categories, stations). ----------
export function RankBars({ items, colorFor, max, unit = '' }) {
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="rankbars">
      {items.map((it, i) => (
        <li key={it.label}>
          <span className="rb-label" title={it.label}>{it.label}</span>
          <span className="rb-track">
            <span
              className="rb-fill"
              style={{ width: `${(it.value / top) * 100}%`, background: colorFor ? colorFor(it, i) : SERIES[i % SERIES.length] }}
            />
          </span>
          <b className="rb-val">{fmt(it.value)}{unit}</b>
        </li>
      ))}
    </ul>
  );
}

export { BAND_COLOR };
