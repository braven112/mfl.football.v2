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
 *   2. HTML — MFL's rendered schedule page frequently outlives its export.
 *      The earlier probe only looked for `F=####` links and found none, which
 *      is weak evidence: a schedule table is far more likely to print team
 *      NAMES. This counts occurrences of that season's actual franchise names
 *      (from the committed league.json) and reports how many appear, so a page
 *      that really does list the matchups announces itself.
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
    const htmlUrl = `https://${host}/${year}/options?L=${lid}&O=03`;
    const r = await fetchWithBackoff(htmlUrl);
    if (r.status === 200) {
      const text = stripTags(r.body);
      const names = franchiseNames(year);
      const present = names.filter((n) => text.includes(n));
      html = { bytes: r.body.length, namesTotal: names.length, namesFound: present.length };
      if (String(year) === String(DUMP_HTML_YEAR)) {
        console.log(`\n--- HTML sample for ${year} (first 1200 chars of text) ---`);
        console.log(text.slice(0, 1200));
        console.log('--- end sample ---\n');
      }
    }
    await sleep(1200);
  }

  rows.push({ year, status, rateLimited, total, filledWeeks, emptyWeeks, html, parseNote });
  const weekSummary = perWeek.length
    ? `weeks with games: ${filledWeeks.join(',') || 'none'}${emptyWeeks.length ? ` | empty: ${emptyWeeks.join(',')}` : ''}`
    : parseNote || 'no weeklySchedule';
  const htmlNote = html
    ? ` | HTML ${html.bytes}B, ${html.namesFound}/${html.namesTotal} team names`
    : '';
  console.log(
    `${year}  HTTP ${rateLimited ? '429(RATE LIMITED)' : status}  pairings=${String(total).padStart(3)}  ${weekSummary}${htmlNote}`
  );
  await sleep(1500);
}

const limited = rows.filter((r) => r.rateLimited);
const short = rows.filter((r) => !r.rateLimited && r.emptyWeeks.length > 0 && r.total > 0);
const htmlPromising = rows.filter((r) => r.html && r.html.namesFound >= r.html.namesTotal / 2);

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
    ? `HTML schedule page LOOKS POPULATED for: ${htmlPromising.map((r) => r.year).join(', ')} — worth parsing.`
    : 'HTML schedule page does not contain the franchise names — no second source.'
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### MFL schedule availability — ${SLUG}`,
    '',
    '| Season | HTTP | Pairings | Weeks with games | Empty weeks | HTML team names |',
    '|---|---:|---:|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.year} | ${r.rateLimited ? '**429**' : r.status} | ${r.total} | ${r.filledWeeks.join(', ') || '—'} | ${r.emptyWeeks.join(', ') || '—'} | ${r.html ? `${r.html.namesFound}/${r.html.namesTotal}` : '—'} |`
    ),
    '',
    limited.length ? `⚠️ Rate limited (inconclusive): ${limited.map((r) => r.year).join(', ')}` : '',
    short.length ? `Export short for: ${short.map((r) => r.year).join(', ')}` : '',
    htmlPromising.length
      ? `**HTML page looks populated for: ${htmlPromising.map((r) => r.year).join(', ')} — parse it.**`
      : 'HTML schedule page carries none of the franchise names — no second source.',
  ]
    .filter(Boolean)
    .join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
