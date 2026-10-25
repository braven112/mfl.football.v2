/**
 * Record Book charts — three views of one board, drawn as SVG strings on the
 * server so the page stays zero-JS (Brandon picked these three on 2026-10-25,
 * from the concepts at /mnt/project-files/mfl-history/record-book-charts.html):
 *
 * - **gap** (the default): the top ten on one value axis, so you can see
 *   whether the record holder is out on their own or the top is bunched up.
 * - **spread**: every result the board ranked, as a histogram, with the
 *   top-ten territory in gold — how rare a top-ten performance is.
 * - **history** (the highlighted one): every result season by season with the
 *   record's progression as a step line; for a board with no seasons (careers,
 *   titles) every entity on one line instead.
 *
 * Each returns `{ svg, take }`: the drawing and one plain sentence saying what
 * it shows. Colors are classes (`rbc-*`), styled with the site tokens by
 * RecordBookPage, so both themes come from one place. Names are escaped.
 *
 * Every chart takes the same options (all optional):
 * - `mine(entityKey)`: true for the viewer's own results, drawn in their team
 *   color (`rbc-mine*`) so they can find themselves in thousands of dots.
 * - `href(row)` / `entityHref(entityKey)`: where a dot opens (the game's
 *   rivalry page, the team's franchise page, the owner's page). Links are
 *   plain SVG `<a>`, so a tap works with no script.
 * - `watch`: this season's on-pace entries for the board (records.mjs
 *   recordWatch), marked on the history chart.
 */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const px = (n) => Math.round(n * 10) / 10;

/** Round axis ticks across [a, b], never finer than `minStep` (1 for counts). */
export function ticks(a, b, n = 5, minStep = 0) {
  const raw = Math.max((b - a) / n || 1, minStep);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag;
  const out = [];
  for (let t = Math.ceil(a / step) * step; t <= b + step * 1e-6; t += step) out.push(Number(t.toFixed(6)));
  return out;
}

/**
 * Format axis values the way the board formats its own: a rate (".700") keeps
 * three places, a decimal keeps its places, a count none. `fmt.step` is the
 * finest tick that still prints distinct labels (1 for a count, so a 15-to-16
 * axis does not print "15 16 16").
 */
export function formatterFor(display) {
  const d = String(display ?? '').replace(/^[+−-]/, '').replace(/,/g, '');
  if (/^(1\.000|\.\d{3})$/.test(d)) {
    return Object.assign((v) => v.toFixed(3).replace(/^0(?=\.)/, ''), { step: 0.001 });
  }
  const places = d.includes('.') ? d.split('.')[1].length : 0;
  return Object.assign(
    (v) => v.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }),
    { step: 10 ** -places }
  );
}

const svg = (w, h, body, label) =>
  `<svg class="rbc" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;
const tip = (text) => `<title>${esc(text)}</title>`;
const who = (r) => (r.owner ? `${r.name} (${r.owner})` : r.name);
const link = (href, body) => (href ? `<a href="${esc(href)}">${body}</a>` : body);
const isMine = (opts, key) => !!(key && opts.mine?.(key));

/** A · the top ten on one axis. */
export function gapChart(board, W, opts = {}) {
  const top = board.rows.slice(0, 10);
  if (top.length < 2) return null;
  const fmt = formatterFor(top[0].display);
  const L = Math.min(150, W * 0.36), R = 62, rowH = 26, T = 6, H = T + top.length * rowH + 24;
  const vals = top.map((r) => r.value);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  // Better is always to the right: a fewest-is-best board runs its axis backward.
  const x = board.asc ? scale(hi + pad, lo - pad, L, W - R) : scale(lo - pad, hi + pad, L, W - R);
  const chars = Math.floor(L / 7.2);
  let g = '';
  for (const t of ticks(lo - pad, hi + pad, W < 480 ? 3 : 5, fmt.step)) {
    g += `<line class="rbc-grid" x1="${px(x(t))}" x2="${px(x(t))}" y1="${T}" y2="${H - 20}"/>`;
    g += `<text class="rbc-axis" x="${px(x(t))}" y="${H - 5}" text-anchor="middle">${fmt(t)}</text>`;
  }
  top.forEach((r, i) => {
    const y = T + i * rowH + rowH / 2, lead = r.rank === 1, cx = px(x(r.value));
    const mine = isMine(opts, r.entity?.key);
    const dot = mine ? 'rbc-mine' : lead ? 'rbc-lead' : 'rbc-top';
    let row = `<text class="rbc-name${mine ? ' rbc-name--mine' : ''}" x="0" y="${y + 4}">${r.rank}. ${esc(short(r.name, chars))}</text>`;
    row += `<line class="rbc-stem" x1="${L}" x2="${cx}" y1="${y}" y2="${y}"/>`;
    row += `<circle class="${dot}" cx="${cx}" cy="${y}" r="${lead ? 7 : 5}">${tip(`#${r.rank} ${who(r)} · ${r.display} · ${r.context}`)}</circle>`;
    row += `<text class="rbc-val" x="${cx + 10}" y="${y + 4}">${esc(r.display)}</text>`;
    // The whole row is the tap target: on a phone a 10px dot is too small to hit.
    g += link(opts.href?.(r), `<rect class="rbc-hit" x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}"/>${row}`);
  });
  const gap = Math.abs(top[0].value - top[1].value);
  const spread = Math.abs(top[1].value - top[top.length - 1].value);
  const span = Math.abs(top[0].value - top[top.length - 1].value);
  let take;
  if (gap === 0) take = `Shared at the top: ${top.filter((r) => r.rank === 1).length} hold the record, and the top ${top.length} span ${fmt(span)}.`;
  else if (spread === 0 && top.length > 2) {
    const tied = board.population.filter((p) => p[0] === top[1].value).length || top.length - 1;
    take = `The record is ${fmt(gap)} clear of the ${tied} tied for #2.`;
  }
  else if (gap > spread * 0.5) take = `The record is ${fmt(gap)} clear of #2, while #2 to #${top.length} sit within ${fmt(spread)} of each other.`;
  else take = `Tight at the top: #1 leads #2 by ${fmt(gap)}, and the top ${top.length} span ${fmt(span)}.`;
  return { svg: svg(W, H, g, `The top ${top.length} on one scale`), take };
}

/** B · every result as a histogram, the top ten in gold. */
export function spreadChart(board, W, opts = {}) {
  const top = board.rows.slice(0, 10);
  const vals = board.population.map((p) => p[0]).sort((a, b) => a - b);
  const n = vals.length;
  if (!top.length || n < 5) return null;
  const fmt = formatterFor(top[0].display);
  const cut = top[top.length - 1].value;
  // The viewer's best result on this board, marked in their team color.
  const own = board.population.filter((p) => isMine(opts, p[4])).map((p) => p[0]);
  const yours = own.length ? (board.asc ? Math.min(...own) : Math.max(...own)) : null;
  const T = yours == null ? 28 : 46, H = T + 158, L = 8, R = 8, base = H - 20;
  const lo = vals[0], hi = vals[n - 1];
  const integers = vals.every((v) => Number.isInteger(v));
  // Whole numbers with a short range get one bar per value; anything else is binned.
  const perValue = integers && hi - lo + 1 <= 40;
  const bins = perValue ? hi - lo + 1 : Math.max(10, Math.min(36, Math.round(W / 15)));
  const bw = perValue ? 1 : (hi - lo) / bins || 1;
  const start = perValue ? lo - 0.5 : lo;
  const counts = new Array(bins).fill(0);
  for (const v of vals) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - start) / bw)))]++;
  const x = scale(start, start + bins * bw, L, W - R);
  const y = scale(0, Math.max(...counts), base, T);
  const median = vals[Math.floor(n / 2)];
  const record = top[0].value;
  let g = '';
  counts.forEach((c, i) => {
    const a = start + i * bw, b = a + bw;
    const inTop = board.asc ? a <= cut : b > cut;
    const hgt = c ? Math.max(2, base - y(c)) : 0;
    const label = perValue ? fmt(a + 0.5) : `${fmt(a)} to ${fmt(b)}`;
    g += `<rect class="${inTop ? 'rbc-bar-top' : 'rbc-bar'}" x="${px(x(a) + 1)}" y="${px(base - hgt)}" width="${px(Math.max(1, x(b) - x(a) - 2))}" height="${px(hgt)}" rx="2">${tip(`${label}: ${c.toLocaleString('en-US')}`)}</rect>`;
  });
  g += `<line class="rbc-base" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>`;
  const mx = px(x(median)), rx = px(x(record));
  const nearRecord = Math.abs(mx - rx) < 90;
  g += `<line class="rbc-median" x1="${mx}" x2="${mx}" y1="${T - 4}" y2="${base}"/>`;
  if (!nearRecord) g += `<text class="rbc-axis" x="${mx}" y="${T - 10}" text-anchor="middle">Typical ${fmt(median)}</text>`;
  g += `<line class="rbc-record" x1="${rx}" x2="${rx}" y1="${T - 4}" y2="${base}"/>`;
  g += `<text class="rbc-big" x="${rx}" y="${T - 10}" text-anchor="${board.asc ? 'start' : 'end'}">Record ${esc(top[0].display)}</text>`;
  if (yours != null) {
    const yx = px(x(yours));
    const anchor = yx < W * 0.25 ? 'start' : yx > W * 0.75 ? 'end' : 'middle';
    g += `<line class="rbc-mine-line" x1="${yx}" x2="${yx}" y1="${T - 22}" y2="${base}"/>`;
    g += `<text class="rbc-mine-label" x="${yx}" y="${T - 28}" text-anchor="${anchor}">Your best ${fmt(yours)}</text>`;
  }
  for (const t of ticks(lo, hi, W < 480 ? 4 : 6, fmt.step)) g += `<text class="rbc-axis" x="${px(x(t))}" y="${H - 4}" text-anchor="middle">${fmt(t)}</text>`;
  const share = (top.length / n) * 100;
  const pct = share >= 10 ? share.toFixed(0) : share >= 1 ? share.toFixed(1) : share.toFixed(2);
  const diff = Math.abs(record - median);
  const versus = `The record is ${fmt(diff)} ${board.asc ? 'below' : 'above'} the typical one (${fmt(median)}).`;
  // A board of a dozen title winners has no "rare tail" to speak of.
  const take = share > 50
    ? `${n} on this board. ${versus}`
    : `The top ${top.length} are the best ${pct}% of ${n.toLocaleString('en-US')} results on this board. ${versus}`;
  return { svg: svg(W, H, g, 'Every result on this board'), take };
}

/** D · every result by season with the record's progression, or every entity on one line. */
export function historyChart(board, W, opts = {}) {
  const top = board.rows.slice(0, 10);
  const pop = board.population;
  if (!top.length || !pop.length) return null;
  const seasons = pop.every((p) => p[1] != null);
  return seasons ? seasonHistory(board, top, pop, W, opts) : entityLine(board, top, pop, W, opts);
}

function seasonHistory(board, top, pop, W, opts) {
  const fmt = formatterFor(top[0].display);
  const watch = opts.watch ?? [];
  // A watch's season may not be on the board yet (fewest points counts only
  // finished seasons), so the axes stretch to hold its marker.
  const years = [...pop.map((p) => p[1]), ...watch.map((w) => w.year)];
  const y0 = Math.min(...years), y1 = Math.max(...years);
  const vals = [...pop.map((p) => p[0]), ...watch.map((w) => w.projected)];
  const vlo = Math.min(...vals), vhi = Math.max(...vals), vpad = (vhi - vlo) * 0.04 || 1;
  const yTicks = ticks(vlo, vhi, 4, fmt.step);
  // The left margin fits the widest axis label (about 6px a character at 11px).
  const T = 14, H = 220, R = 10, base = H - 22;
  const L = 10 + Math.max(...yTicks.map((t) => fmt(t).length)) * 6;
  const x = scale(y0 - 0.5, y1 + 0.5, L, W - R);
  const y = scale(vlo - vpad, vhi + vpad, base, T);
  const colW = Math.max(2, (x(y0 + 1) - x(y0)) * 0.7);
  let g = '';
  for (const t of yTicks) {
    g += `<line class="rbc-grid" x1="${L}" x2="${W - R}" y1="${px(y(t))}" y2="${px(y(t))}"/>`;
    g += `<text class="rbc-axis" x="${L - 6}" y="${px(y(t)) + 4}" text-anchor="end">${fmt(t)}</text>`;
  }
  // The cloud is ONE path of zero-length round-capped segments: thousands of
  // results as a few KB, where a circle each would be hundreds.
  let seed = 7;
  const jitter = () => (seed = (seed * 9301 + 49297) % 233280) / 233280 - 0.5;
  let cloud = '';
  let mineCloud = '';
  for (const p of pop) {
    const seg = `M${Math.round(x(p[1]) + jitter() * colW)} ${Math.round(y(p[0]))}h0`;
    if (isMine(opts, p[4])) mineCloud += seg;
    else cloud += seg;
  }
  g += `<path class="rbc-cloud" d="${cloud}"/>`;
  if (mineCloud) g += `<path class="rbc-mine-cloud" d="${mineCloud}"/>`;
  // The record as it stood after each result, in the order they were played.
  const order = pop.slice().sort((a, b) => a[1] - b[1] || (a[2] ?? 0) - (b[2] ?? 0));
  const better = (a, b) => (board.asc ? a < b : a > b);
  let best = null, path = '', raised = 0;
  for (const p of order) {
    if (best !== null && !better(p[0], best)) continue;
    const cx = px(x(p[1])), cy = px(y(p[0]));
    path += path ? `H${cx}V${cy}` : `M${cx} ${cy}`;
    best = p[0];
    raised += 1;
  }
  path += `H${px(x(y1 + 0.5))}`;
  g += `<path class="rbc-progress" d="${path}"/>`;
  // Leader last, so it draws on top of a top-ten dot from the same season.
  for (const r of [...top].reverse()) {
    if (r.year == null) continue;
    const lead = r.rank === 1;
    const cls = isMine(opts, r.entity?.key) ? 'rbc-mine' : lead ? 'rbc-lead' : 'rbc-top';
    g += link(
      opts.href?.(r),
      `<circle class="${cls}" cx="${px(x(r.year))}" cy="${px(y(r.value))}" r="${lead ? 6 : 4.5}">${tip(`#${r.rank} ${who(r)} · ${r.display} · ${r.context}`)}</circle>`
    );
  }
  // This season's pace: a dashed ring where the team would finish.
  for (const w of watch) {
    const cx = px(x(w.year)), cy = px(y(w.projected));
    g += `<circle class="rbc-watch" cx="${cx}" cy="${cy}" r="7">${tip(`${w.name} · on pace for ${w.display}`)}</circle>`;
  }
  const every = Math.max(1, Math.ceil((y1 - y0 + 1) / (W < 480 ? 5 : 10)));
  for (let yr = y0; yr <= y1; yr += every) g += `<text class="rbc-axis" x="${px(x(yr))}" y="${H - 5}" text-anchor="middle">${yr}</text>`;
  const holder = top[0];
  const recent = top.filter((r) => r.year != null && r.year >= y1 - 4).length;
  const take =
    `The record has been ${board.asc ? 'lowered' : 'raised'} ${raised - 1} ${raised - 1 === 1 ? 'time' : 'times'} since ${y0}` +
    (holder.year != null ? ` and has stood since ${holder.year}` : '') +
    `. ${recent ? `${recent} of the top ${top.length} came` : `None of the top ${top.length} came`} in the last five seasons.`;
  return { svg: svg(W, H, g, 'Every result, season by season'), take };
}

function entityLine(board, top, pop, W, opts) {
  const fmt = formatterFor(top[0].display);
  const H = 132, L = 12, R = 16, mid = 56, step = 9;
  const vals = pop.map((p) => p[0]);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals);
  const x = scale(lo, hi, L, W - R);
  const ranks = new Map(top.map((r) => [r.name, r.rank]));
  const sorted = pop.slice().sort((a, b) => a[0] - b[0]);
  // A simple beeswarm: each dot takes the first free lane, alternating above
  // and below the line.
  const placed = [];
  let g = '';
  for (const p of sorted) {
    const cx = x(p[0]);
    let lane = 0;
    while (placed.some((q) => q.lane === lane && Math.abs(q.cx - cx) < step)) lane += 1;
    placed.push({ lane, cx });
    const cy = mid + (lane === 0 ? 0 : (lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * step);
    const rank = ranks.get(p[3]);
    const cls = isMine(opts, p[4]) ? 'rbc-mine' : rank === 1 ? 'rbc-lead' : rank ? 'rbc-top' : 'rbc-dot';
    g += link(
      opts.entityHref?.(p[4]),
      `<circle class="${cls}" cx="${px(cx)}" cy="${px(Math.max(6, Math.min(H - 26, cy)))}" r="${rank === 1 ? 6 : 4}">${tip(`${p[3] ?? ''} · ${fmt(p[0])}`)}</circle>`
    );
  }
  for (const t of ticks(lo, hi, W < 480 ? 4 : 6, fmt.step)) g += `<text class="rbc-axis" x="${px(x(t))}" y="${H - 5}" text-anchor="middle">${fmt(t)}</text>`;
  const sortedVals = sorted.map((p) => p[0]);
  const median = sortedVals[Math.floor(sortedVals.length / 2)];
  const take =
    `${pop.length} on this board. The record holder is ${fmt(Math.abs(top[0].value - median))} ` +
    `${board.asc ? 'below' : 'above'} the middle of the pack (${fmt(median)}).`;
  return { svg: svg(W, H, g, 'Everyone on this board'), take };
}
