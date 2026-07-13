// Validated data-viz palette for the dark command-center console.
//
// Every value below was checked with the dataviz validator against the console's
// actual panel surface (#0e1626), not eyeballed:
//
//   SERIES  -> lightness band PASS, chroma floor PASS, contrast >=3:1 PASS,
//              worst adjacent CVD dE 10.7 (protan). That sits in the 8-12 floor
//              band, which is only legal alongside a secondary encoding — so every
//              categorical chart here also ships direct labels and 2px mark gaps.
//   BAND    -> status palette (good/warning/serious/critical). Reserved for risk
//              state; never reused as a series colour, and always paired with the
//              band name so colour is not the sole carrier of meaning.

export const SURFACE = '#0e1626';

// Categorical — assign in fixed slot order, never cycled.
export const SERIES = [
  '#3987e5', // 1 blue
  '#199e70', // 2 aqua
  '#c98500', // 3 yellow
  '#9085e9', // 4 violet
  '#e66767', // 5 red
  '#d55181', // 6 magenta
  '#d95926', // 7 orange
  '#008300', // 8 green
];

// Status — risk bands. Ordered by severity, distinct from the series slots.
export const BAND_COLOR = {
  Low: '#0ca30c',
  Medium: '#fab219',
  High: '#ec835a',
  Critical: '#d03b3b',
};

export const BAND_ORDER = ['Critical', 'High', 'Medium', 'Low'];

// Sequential (single hue, light -> dark) for continuous magnitude.
export const SEQ_BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export const HOTSPOT_COLOR = { established: '#d03b3b', emerging: '#fab219', none: '#3a4a63' };

export const GRAVITY_COLOR = { Heinous: '#e66767', 'Non-Heinous': '#3987e5' };

// Pick a sequential step for a 0..1 magnitude.
export function seqStep(t) {
  const i = Math.min(SEQ_BLUE.length - 1, Math.max(0, Math.round(t * (SEQ_BLUE.length - 1))));
  return SEQ_BLUE[i];
}

export const fmt = (n) => (n == null ? '—' : n.toLocaleString('en-IN'));
export const pct = (n, d = 1) => (n == null ? '—' : `${(n * 100).toFixed(d)}%`);
export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
