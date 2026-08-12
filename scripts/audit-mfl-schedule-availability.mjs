#!/usr/bin/env node
/**
 * Settle, per season and per week, exactly what MFL will serve for a league's
 * schedule — and if the export is short, whether the rendered site still has
 * the games the export does not.
 *
 * Read-only. Writes nothing.
 *
 * Why this exists: probe-mfl-schedule-sources.mjs sampled two seasons at one
 * week each and hit MFL rate limits on half its rows, so its "no data" answers
 * were not trustworthy for the years it flagged. This walks EVERY season and
 * reports the per-week shape, which is the only way to say "MFL has 42 games
 * for 2010 and no more" rather than inferring it from a sample.
 *
 * Two questions, answered separately:
 *
 *   1. EXPORT — does `TYPE=schedule` (authenticated) carry regular-season
 *      matchups? Reported as a per-week pairing map, so a season that holds
 *      only weeks 14-17 is visible as such rather than as a single total.
 *   2. HTML — MFL's rendered site sometimes outlives its export. Two earlier
 *      detectors both produced confident WRONG answers here, so this one is
 *      deliberately strict:
 *
 *        - v1 looked for `F=####` links, found none, and was read as "nothing
 *          there". Too weak: a schedule table prints team NAMES, not id links.
 *        - v2 counted franchise names anywhere on the page and scored 24/24 —
 *          on the TRANSACTIONS page, because its filter menus list every team.
 *          The URL was a guessed `O=03`, and the guess was simply wrong.
 *
 *      So: discover the page from MFL's own navigation (it labels one
 *      "Fantasy Schedule" and one "Weekly Results") rather than guessing a
 *      code, request it for a week the export has NOTHING for, and require an
 *      actual scoreboard signature — two DIFFERENT franchise names within a
 *      short span containing a decimal score. Name mentions alone no longer
 *      count for anything.
 *
 *      Note the site answers as `Guest ( Login )`: APIKEY authenticates the
 *      export API, not HTML pages. If a private league hides its schedule from
 *      guests, no amount of parsing will help and this will report zero rows.
 *
 * Usage:
 *   node scripts/audit-mfl-schedule-availability.mjs --league=afl
 *   node scripts/audit-mfl-schedule-availability.mjs --league=afl --years=2010,2016
 *   node scripts/audit-mfl-schedule-availability.mjs --league=afl --dump-html=2016
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const SLUG = argOf('league', 'afl') === 'afl' ? 'afl-fantasy' : argOf('league', 'afl');
const DUMP_HTML_YEAR = argOf('dump-html', null);

const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${SLUG}`);
  process.exit(1);
}

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const FEEDS_DIR = path.join(ROOT, league.dataPath, 'mfl-feeds');
const hostMap = readJson(path.join(ROOT, league.dataPath, 'year-host-map.json'));
if (!hostMap?.years) {
  console.error('No year-host-map.json — cannot resolve per-year hosts.');
  process.exit(1);
}

const yearsArg = argOf('years', null);
const YEARS = yearsArg
  ? yearsArg.split(',').map((y) => y.trim()).filter(Boolean)
  : Object.keys(hostMap.years).sort();

const getNonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MFL_API_KEY =
  getNonEmpty(process.env.MFL_APIKEY) || getNonEmpty(process.env.MFL_API_KEY);
const KEY_QS = MFL_API_KEY ? `&APIKEY=${encodeURIComponent(MFL_API_KEY)}` : '';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MFL rate-limits hard enough to poison a whole run's conclusions: a 429 body
// is 4 bytes and reads as "no data" unless it is called out. Retry, and label
// anything that never got past 429 so it can't be mistaken for evidence.
async function fetchWithBackoff(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const body = await res.text();
    if (res.status !== 429) return { status: res.status, body, rateLimited: false };
    await sleep(4000 * (attempt + 1));
  }
  return { status: 429, body: '', rateLimited: true };
}

/** Per-week count of two-franchise matchups in a schedule payload. */
function weeklyPairings(data) {
  const out = [];
  for (const wk of toArray(data?.schedule?.weeklySchedule)) {
    const n = toArray(wk.matchup).filter((m) => toArray(m.franchise).length === 2).length;
    out.push({ week: Number(wk.week), pairings: n });
  }
  return out.sort((a, b) => a.week - b.week);
}

/** Franchise names for a season, from the committed feed — used to read HTML. */
function franchiseNames(year) {
  const lg = readJson(path.join(FEEDS_DIR, String(year), 'league.json'));
  return toArray(lg?.league?.franchises?.franchise)
    .map((f) => String(f.name ?? '').trim())
    .filter((n) => n.length >= 4); // short names produce junk substring hits
}

const stripTags = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Find the page MFL itself calls the schedule, instead of guessing an O= code.
 *
 * The first attempt hardcoded `O=03` and got the TRANSACTIONS page, whose
 * filter menus happen to list every franchise name — so a "how many team names
 * appear" test scored 24/24 and reported the schedule as found. Twice now a
 * loose detector has produced a confident wrong answer, so this reads MFL's own
 * navigation and follows the labelled link.
 */
function findNavLinks(html, baseHost, year) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const label = stripTags(m[2]).trim();
    if (!label) continue;
    if (!/(fantasy\s*schedule|weekly\s*results|^schedule$|^scores$)/i.test(label)) continue;
    let href = m[1].replace(/&amp;/g, '&');
    if (href.startsWith('//')) href = `https:${href}`;
    else if (href.startsWith('/')) href = `https://${baseHost}${href}`;
    else if (!/^https?:/i.test(href)) href = `https://${baseHost}/${year}/${href}`;
    out.push({ label, href });
  }
  return out;
}

/**
 * Does this page actually show MATCHUPS?
 *
 * Specific on purpose: requires two DIFFERENT franchise names close together
 * with a decimal score between or beside them — the signature of a scoreboard
 * row. Merely containing team names is what fooled the previous two checks.
 */
function matchupSignature(text, names) {
  const found = names.filter((n) => text.includes(n));
  if (found.length < 2) return { rows: 0, namesFound: found.length };
  let rows = 0;
  // Walk name occurrences in document order; count adjacent pairs of DIFFERENT
  // names separated by a short span that contains a decimal number.
  const hits = [];
  for (const n of found) {
    let i = -1;
    while ((i = text.indexOf(n, i + 1)) !== -1) hits.push({ name: n, at: i });
  }
  hits.sort((a, b) => a.at - b.at);
  for (let i = 0; i + 1 < hits.length; i++) {
    const a = hits[i];
    const b = hits[i + 1];
    if (a.name === b.name) continue;
    const span = text.slice(a.at, b.at + b.name.length);
    if (span.length <= 160 && /\d+\.\d/.test(span)) rows++;
  }
  return { rows, namesFound: found.length };
}

const rows = [];
console.log(`Auditing ${SLUG} schedule availability — ${YEARS.length} season(s)`);
console.log(MFL_API_KEY ? 'APIKEY present.\n' : 'NO APIKEY — private-league reads will be stripped.\n');

for (const year of YEARS) {
  const entry = hostMap.years[year];
  if (!entry) continue;
  const host = entry.host.includes('.') ? entry.host : `${entry.host}.myfantasyleague.com`;
  const lid = entry.leagueId;

  const url = `https://${host}/${year}/export?TYPE=schedule&L=${lid}&JSON=1${KEY_QS}`;
  const { status, body, rateLimited } = await fetchWithBackoff(url);

  let perWeek = [];
  let total = 0;
  let parseNote = '';
  if (status === 200) {
    try {
      perWeek = weeklyPairings(JSON.parse(body));
      total = perWeek.reduce((s, w) => s + w.pairings, 0);
    } catch {
      parseNote = 'unparseable';
    }
  }

  const emptyWeeks = perWeek.filter((w) => w.pairings === 0).map((w) => w.week);
  const filledWeeks = perWeek.filter((w) => w.pairings > 0).map((w) => w.week);

  // Only bother with the HTML when the export is short — that is the only case
  // where a second source would change anything.
  let html = null;
  if (!rateLimited && emptyWeeks.length > 0 && filledWeeks.length > 0) {
    const names = franchiseNames(year);
    const emptyWeek = emptyWeeks[Math.floor(emptyWeeks.length / 2)];

    // Ask MFL where its schedule lives rather than guessing an O= code.
    const home = await fetchWithBackoff(`https://${host}/${year}/home/${lid}`);
    const navLinks = home.status === 200 ? findNavLinks(home.body, host, year) : [];
    await sleep(1200);

    // Try each labelled candidate for a week the export has nothing for.
    const candidates = [];
    for (const link of navLinks.slice(0, 4)) {
      const url = link.href + (link.href.includes('?') ? '&' : '?') + `W=${emptyWeek}`;
      const r = await fetchWithBackoff(url);
      if (r.status === 200) {
        const text = stripTags(r.body);
        const sig = matchupSignature(text, names);
        candidates.push({ label: link.label, url, bytes: r.body.length, ...sig });
        if (String(year) === String(DUMP_HTML_YEAR)) {
          console.log(`\n--- ${year} "${link.label}" (week ${emptyWeek}) ${r.body.length}B, ${sig.rows} matchup-like rows ---`);
          console.log(text.slice(0, 900));
          console.log('--- end ---\n');
        }
      }
      await sleep(1500);
    }
    const best = candidates.sort((a, b) => b.rows - a.rows)[0] ?? null;
    html = best
      ? { bytes: best.bytes, namesTotal: names.length, namesFound: best.namesFound, rows: best.rows, label: best.label, week: emptyWeek }
      : { bytes: 0, namesTotal: names.length, namesFound: 0, rows: 0, label: 'no nav link found', week: emptyWeek };
  }

  rows.push({ year, status, rateLimited, total, filledWeeks, emptyWeeks, html, parseNote });
  const weekSummary = perWeek.length
    ? `weeks with games: ${filledWeeks.join(',') || 'none'}${emptyWeeks.length ? ` | empty: ${emptyWeeks.join(',')}` : ''}`
    : parseNote || 'no weeklySchedule';
  const htmlNote = html
    ? ` | HTML "${html.label}" wk${html.week} ${html.bytes}B, ${html.rows} matchup rows (${html.namesFound}/${html.namesTotal} names)`
    : '';
  console.log(
    `${year}  HTTP ${rateLimited ? '429(RATE LIMITED)' : status}  pairings=${String(total).padStart(3)}  ${weekSummary}${htmlNote}`
  );
  await sleep(1500);
}

const limited = rows.filter((r) => r.rateLimited);
const short = rows.filter((r) => !r.rateLimited && r.emptyWeeks.length > 0 && r.total > 0);
// A page qualifies only if it shows MATCHUP ROWS for a week the export has
// nothing for. Name mentions alone scored 24/24 on the transactions page and
// produced a confident wrong answer — that bar is now off the table.
const htmlPromising = rows.filter((r) => r.html && r.html.rows >= 6);

console.log('\n--- verdict ---');
if (limited.length) {
  console.log(`INCONCLUSIVE for ${limited.map((r) => r.year).join(', ')} — rate limited, re-run.`);
}
console.log(
  short.length
    ? `Export is short for: ${short.map((r) => r.year).join(', ')} (regular-season weeks carry no matchups).`
    : 'Every audited season returned a full schedule from the export.'
);
console.log(
  htmlPromising.length
    ? `HTML page SHOWS MATCHUPS for: ${htmlPromising.map((r) => `${r.year} (${r.html.rows} rows via "${r.html.label}")`).join(', ')} — parse it.`
    : 'No HTML page renders matchups for an empty week — the site is Guest-only for private leagues, so there is no second source.'
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### MFL schedule availability — ${SLUG}`,
    '',
    '| Season | HTTP | Pairings | Weeks with games | Empty weeks | HTML matchup rows |',
    '|---|---:|---:|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.year} | ${r.rateLimited ? '**429**' : r.status} | ${r.total} | ${r.filledWeeks.join(', ') || '—'} | ${r.emptyWeeks.join(', ') || '—'} | ${r.html ? `${r.html.rows} rows (${r.html.label})` : '—'} |`
    ),
    '',
    limited.length ? `⚠️ Rate limited (inconclusive): ${limited.map((r) => r.year).join(', ')}` : '',
    short.length ? `Export short for: ${short.map((r) => r.year).join(', ')}` : '',
    htmlPromising.length
      ? `**HTML page SHOWS MATCHUPS for: ${htmlPromising.map((r) => r.year).join(', ')} — parse it.**`
      : 'No HTML page renders matchups for an empty week (site is Guest-only for private leagues).',
  ]
    .filter(Boolean)
    .join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
