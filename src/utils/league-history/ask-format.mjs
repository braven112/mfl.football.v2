/**
 * Ask the History — how an answer table's cells read and link. Shared by the
 * server-rendered answer page and the question box's client script, so an
 * answer looks the same when it is asked and when it is shared.
 */
import { gapChart, historyChart } from './record-charts.mjs';

const TWO_DECIMALS = new Set(['pf', 'pa', 'pointDiff', 'avgPf', 'highGame', 'lowGame', 'finalPf', 'score', 'oppScore', 'margin', 'combined', 'points', 'avgStart', 'bestWeek', 'benchPoints', 'playoffPoints', 'pointsGot', 'pointsGave', 'pointsNet', 'pointsAfter', 'seasonPoints', 'pointsWithTeam']);
const DOLLARS = new Set(['salary', 'bid', 'dollarsPerPoint']);

/** Display text for one cell. */
export function formatCell(key, value) {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'winPct' && typeof value === 'number') return value.toFixed(3).replace(/^0(?=\.)/, '');
  if (DOLLARS.has(key) && typeof value === 'number') return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (TWO_DECIMALS.has(key) && typeof value === 'number') {
    return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * Where a cell links, given the league's history base path (`/theleague`, or
 * '' on a league's own domain): the owner column opens the owner page, the
 * team column that franchise's all-owners history.
 */
export function cellHref(key, row, base) {
  if (key === 'owner' && row.ownerSlug) return `${base}/owners/${row.ownerSlug}`;
  if (key === 'team' && row.franchiseId) return `${base}/franchises/${row.franchiseId}?view=all`;
  return null;
}

/** Columns that read as numbers (right-aligned). */
export function isNumericColumn(table, index) {
  return table.rows.some((r) => typeof r.cells[index] === 'number');
}

/** The Record Book board an answer cites (AskRecordLink.query is its query string). */
export const recordHref = (base, query) => `${base}/history/record-book?${query}`;

const PHONE_W = 290;
const WIDE_W = 400;

/**
 * An answer's charts, drawn by the Record Book's own chart code from the
 * board the query built (ask-query.mjs chartBoard): the top ten on one scale,
 * and every matching result season by season (or everyone on one line, for a
 * board with no seasons). Each comes at the Record Book's two drawing widths,
 * and CSS (record-charts.css) shows one.
 * @returns {Array<{ title: string, phone: string, wide: string, take: string }>}
 */
export function answerCharts(chart, base) {
  if (!chart?.rows?.length) return [];
  const href = (row) => (row.franchiseId ? `${base}/franchises/${row.franchiseId}?view=all` : null);
  const bySeason = chart.population.length > 0 && chart.population.every((p) => p[1] != null);
  // One dot per entity reads for a league's owners, not for every player ever rostered.
  const oneLine = !bySeason && chart.population.length <= 120;
  const out = [];
  for (const [title, draw] of [
    [`Top ${Math.min(10, chart.rows.length)} by ${chart.label}`, gapChart],
    ...(bySeason || oneLine ? [[bySeason ? 'Every result, season by season' : 'Everyone on one line', historyChart]] : []),
  ]) {
    const wide = draw(chart, WIDE_W, { href });
    if (!wide) continue;
    const phone = draw(chart, PHONE_W, { href }) ?? wide;
    out.push({ title, phone: phone.svg, wide: wide.svg, take: wide.take });
  }
  return out;
}
