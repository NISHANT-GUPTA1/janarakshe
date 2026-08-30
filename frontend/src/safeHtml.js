// HTML escaping for the two places this app builds markup as a string.
//
// React escapes interpolated values automatically, but two third-party widgets
// take an HTML *string* and inject it with innerHTML:
//
//   • Leaflet  — layer.bindTooltip('<b>…</b>')      (CrimeMap district tooltips)
//   • react-force-graph — nodeLabel: () => '<div>…' (3D offender network tooltips)
//
// The values interpolated there (district names, offender names, categories) come
// from fetched JSON. That data is synthetic today, but the deployment guide states
// real FIR records can be dropped into the same tables with no code change — at
// which point an unescaped name would be a stored-XSS payload executing in an
// analyst's browser. Everything data-derived goes through escapeHtml first.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a value for interpolation into an HTML string. Nullish -> ''. */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

/**
 * Tagged template that escapes every interpolated value:
 *   html`<b>${name}</b>`
 * Static markup in the template literal is preserved as-is.
 */
export function html(strings, ...values) {
  return strings.reduce(
    (out, chunk, i) => out + chunk + (i < values.length ? escapeHtml(values[i]) : ''),
    ''
  );
}
