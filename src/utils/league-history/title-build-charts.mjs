/**
 * Ask the History — the stacked bar chart the title-build answers draw
 * (ask-title-builds.mjs titleBuildChart): one bar per row, split into series.
 * How each champion's starter points split by acquisition method; each title
 * trade's regular-season and playoff points; each trade's two hauls.
 *
 * Drawn as an SVG string like the Record Book charts (record-charts.mjs), on
 * the server and in the ask screen alike, and styled by the same sheet
 * (record-charts.css): `rbc-s1`…`rbc-s7` are the categorical series and
 * `rbc-s0` is "unknown", gray, each defined for both themes in tokens.css /
 * tokens-dark.css. A legend always names the series, so identity is never
 * color alone, and every segment carries its exact value as a tooltip.
 */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const px = (n) => Math.round(n * 10) / 10;
const num = (v, places = 2) => v.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((s) => s >= v) ?? v;
}

/**
 * @param {{ label: string, percent: boolean, series: Array<{ label: string, tone: number }>, bars: Array<{ name: string, context?: string, values: number[], display: string }>, take?: string }} chart
 * @param {number} W drawing width
 * @param {{ href?: (bar: any) => string | null }} [opts]
 * @returns {{ svg: string, take: string } | null}
 */
export function stackChart(chart, W, opts = {}) {
  const bars = chart?.bars ?? [];
  if (!bars.length) return null;
  const used = chart.series.map((_, i) => bars.some((b) => (b.values[i] ?? 0) > 0));
  const narrow = W < 360;

  // Legend: the series any bar uses, wrapped to the width.
  let lx = 0;
  let ly = 10;
  let legend = '';
  chart.series.forEach((s, i) => {
    if (!used[i]) return;
    const w = 16 + s.label.length * 6.2 + 12;
    if (lx > 0 && lx + w > W) {
      lx = 0;
      ly += 16;
    }
    legend += `<rect class="rbc-s${s.tone}" x="${px(lx)}" y="${ly - 8}" width="10" height="10" rx="2"/><text x="${px(lx + 14)}" y="${ly + 1}">${esc(s.label)}</text>`;
    lx += w;
  });

  const T = ly + 14;
  const rowH = 34;
  const L = Math.min(150, W * (narrow ? 0.44 : 0.36));
  const R = chart.percent ? 8 : narrow ? 58 : 70;
  const H = T + bars.length * rowH + 20;
  const max = chart.percent ? 100 : niceMax(Math.max(...bars.map((b) => b.values.reduce((a, v) => a + Math.max(0, v), 0))));
  const x = (v) => L + (v / max) * (W - L - R);
  const chars = Math.floor((L - 6) / (narrow ? 6.9 : 6.6));

  let g = legend;
  const tickN = W < 480 ? 2 : 4;
  for (let i = 0; i <= tickN; i++) {
    const t = (max / tickN) * i;
    g += `<line class="rbc-grid" x1="${px(x(t))}" x2="${px(x(t))}" y1="${T - 4}" y2="${H - 18}"/>`;
    g += `<text class="rbc-axis" x="${px(x(t))}" y="${H - 5}" text-anchor="middle">${chart.percent ? `${Math.round(t)}%` : Math.round(t).toLocaleString('en-US')}</text>`;
  }

  bars.forEach((b, r) => {
    const y = T + r * rowH;
    const barY = y + 14;
    const barH = 14;
    let row = `<text class="rbc-name" x="0" y="${y + 11}">${esc(short(b.name, chars))}</text>`;
    if (b.context) row += `<text class="rbc-axis" x="0" y="${y + 25}">${esc(short(b.context, chars + 4))}</text>`;
    let at = 0;
    const total = b.values.reduce((a, v) => a + Math.max(0, v), 0);
    chart.series.forEach((s, i) => {
      const v = Math.max(0, b.values[i] ?? 0);
      if (!v) return;
      const x0 = x(at);
      const x1 = x(at + v);
      at += v;
      // A 2px gap between segments, so neighbors read apart without color.
      const w = Math.max(1, x1 - x0 - 2);
      const share = !chart.percent && total ? ` (${Math.round((v / total) * 100)}%)` : '';
      const value = chart.percent ? `${num(v, 1)}%` : `${num(v)}${share}`;
      row += `<rect class="rbc-s${s.tone}" x="${px(x0)}" y="${barY}" width="${px(w)}" height="${barH}" rx="3"><title>${esc(`${b.name} · ${s.label}: ${value}`)}</title></rect>`;
    });
    if (!chart.percent && b.display) row += `<text class="rbc-val" x="${px(x(at) + 6)}" y="${barY + 11}">${esc(b.display)}</text>`;
    const href = opts.href?.(b);
    g += href ? `<a href="${esc(href)}"><rect class="rbc-hit" x="0" y="${y}" width="${W}" height="${rowH}"/>${row}</a>` : row;
  });

  const svg = `<svg class="rbc" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(chart.label)}">${g}</svg>`;
  return { svg, take: chart.take ?? '' };
}
