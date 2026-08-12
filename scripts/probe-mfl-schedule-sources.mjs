#!/usr/bin/env node
/**
 * Diagnostic: find ANY MFL surface that still carries head-to-head pairings for
 * a season whose schedule export comes back empty.
 *
 * Read-only. Writes nothing, commits nothing — it answers "which request should
 * the backfill be making?" before we build anything on the answer.
 *
 * Why this exists: AFL 2007-2019 regular-season weeks return bare
 * `{"week":"1"}` from `TYPE=schedule` — no matchup key. Two requests (season-
 * wide and per-week) both came back empty, which is NOT evidence the data is
 * gone. This repo already knows MFL gates exports on per-league-year DISPLAY
 * CONFIG rather than on what it stores: `TYPE=leagueStandings` omitted pf/pa
 * for AFL 2010-2022 until `ALL=1` was passed (see
 * scripts/backfill-standings-points.mjs). The same trick, a different endpoint,
 * or the XML encoder may still hold the games.
 *
 * Hypotheses probed, cheapest first:
 *   1. ALL=1 on the schedule export, season-wide and per-week.
 *   2. XML instead of JSON — `{"week":"1"}` with no matchup key is exactly what
 *      a JSON encoder emits for an element it decided was empty; the XML may
 *      still carry <matchup> children.
 *   3. liveScoring, which returns its own matchup structure with franchise ids
 *      and is a different code path from schedule.
 *   4. The rendered HTML pages, which frequently outlive the export API.
 *
 * Usage:
 *   node scripts/probe-mfl-schedule-sources.mjs --league=afl --year=2016 --week=5
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
const YEAR = String(argOf('year', '2016'));
const WEEK = String(argOf('week', '5'));

const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${SLUG}`);
  process.exit(1);
}

// Per-year host + league id, same source of truth the backfill uses: MFL reuses
// league ids across years, so querying an old year with the current id silently
// returns a DIFFERENT league.
const hostMapPath = path.join(ROOT, league.dataPath, 'year-host-map.json');
const hostMap = JSON.parse(fs.readFileSync(hostMapPath, 'utf8'));
const entry = hostMap.years?.[YEAR];
if (!entry) {
  console.error(`No host-map entry for ${SLUG} ${YEAR}`);
  process.exit(1);
}
const HOST = entry.host.includes('.') ? entry.host : `${entry.host}.myfantasyleague.com`;
const LID = entry.leagueId;

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// MFL's own docs for TYPE=schedule: "Private league access restricted to league
// owners." An unauthenticated request against a private league's archive
// returns the week skeleton with matchups stripped, which is indistinguishable
// from the data being gone. Probing with AND without the key is the whole point
// — the difference between the two rows IS the diagnosis.
const getNonEmpty = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const MFL_API_KEY =
  getNonEmpty(process.env.MFL_APIKEY) || getNonEmpty(process.env.MFL_API_KEY);
const KEY_QS = MFL_API_KEY ? `&APIKEY=${encodeURIComponent(MFL_API_KEY)}` : '';

const exp = (qs) => `https://${HOST}/${YEAR}/export?L=${LID}&${qs}`;
const expAuth = (qs) => `${exp(qs)}${KEY_QS}`;

// Never print a key: workflow logs are visible to anyone who can read the repo.
const redact = (url) => String(url).replace(/APIKEY=[^&]+/, 'APIKEY=***');

const CANDIDATES = [
  // --- baselines: what we already fetch, to prove the probe agrees with reality
  { name: 'schedule (season, JSON)', url: exp('TYPE=schedule&JSON=1') },
  { name: 'schedule (week, JSON)', url: exp(`TYPE=schedule&JSON=1&W=${WEEK}`) },

  // --- hypothesis 0 (most likely): the league is private and we never sent a key
  { name: 'schedule (season, JSON, APIKEY)', url: expAuth('TYPE=schedule&JSON=1') },
  { name: 'schedule (week, JSON, APIKEY)', url: expAuth(`TYPE=schedule&JSON=1&W=${WEEK}`) },
  { name: 'schedule (week, XML, APIKEY)', url: expAuth(`TYPE=schedule&W=${WEEK}`) },
  { name: 'weeklyResults (week, JSON, APIKEY)', url: expAuth(`TYPE=weeklyResults&JSON=1&W=${WEEK}`) },

  // --- hypothesis 1: display-config gating, same as leagueStandings/ALL=1
  { name: 'schedule (season, JSON, ALL=1)', url: exp('TYPE=schedule&JSON=1&ALL=1') },
  { name: 'schedule (week, JSON, ALL=1)', url: exp(`TYPE=schedule&JSON=1&W=${WEEK}&ALL=1`) },

  // --- hypothesis 2: the JSON encoder is dropping it, XML is not
  { name: 'schedule (season, XML)', url: exp('TYPE=schedule') },
  { name: 'schedule (week, XML)', url: exp(`TYPE=schedule&W=${WEEK}`) },
  { name: 'schedule (week, XML, ALL=1)', url: exp(`TYPE=schedule&W=${WEEK}&ALL=1`) },

  // --- hypothesis 3: a different export that carries its own matchup structure
  { name: 'liveScoring (week, JSON)', url: exp(`TYPE=liveScoring&JSON=1&W=${WEEK}`) },
  { name: 'liveScoring (week, XML)', url: exp(`TYPE=liveScoring&W=${WEEK}`) },
  { name: 'weeklyResults (week, JSON, ALL=1)', url: exp(`TYPE=weeklyResults&JSON=1&W=${WEEK}&ALL=1`) },
  { name: 'weeklyResults (week, XML)', url: exp(`TYPE=weeklyResults&W=${WEEK}`) },

  // --- hypothesis 4: the rendered site outlives the export API
  { name: 'HTML schedule page', url: `https://${HOST}/${YEAR}/options?L=${LID}&O=03&W=${WEEK}` },
  { name: 'HTML results page', url: `https://${HOST}/${YEAR}/results?L=${LID}&W=${WEEK}` },
  { name: 'HTML schedule view', url: `https://${HOST}/${YEAR}/schedule?L=${LID}&W=${WEEK}` },
];

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * How many head-to-head pairings does this payload contain? Shape-agnostic on
 * purpose — the point is to detect pairings wherever they hide, not to parse
 * any one format properly. That comes after we know which URL to use.
 */
function countPairings(body, contentType) {
  // JSON: walk for any object holding a 2+ element `franchise` array.
  if (/json/i.test(contentType) || body.trimStart().startsWith('{')) {
    try {
      const data = JSON.parse(body);
      let n = 0;
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);
        const fr = toArray(node.franchise);
        if (fr.length >= 2 && fr.every((f) => f && typeof f === 'object' && 'id' in f)) n++;
        for (const v of Object.values(node)) walk(v);
      };
      walk(data);
      return { pairings: n, note: '' };
    } catch {
      return { pairings: 0, note: 'unparseable JSON' };
    }
  }
  // XML: count <matchup> elements that hold 2+ <franchise id=...>.
  if (/xml/i.test(contentType) || body.trimStart().startsWith('<?xml')) {
    const matchups = body.match(/<matchup\b[\s\S]*?<\/matchup>/g) ?? [];
    const withPair = matchups.filter(
      (m) => (m.match(/<franchise\b[^>]*\bid=/g) ?? []).length >= 2
    );
    // Self-closing <matchup ... /> can also carry two franchise attrs inline.
    return { pairings: withPair.length, note: matchups.length ? '' : 'no <matchup> elements' };
  }
  // HTML: look for franchise-id links, a strong signal the page renders games.
  const ids = body.match(/[?&]F=(\d{4})\b/g) ?? [];
  const unique = new Set(ids.map((s) => s.slice(-4)));
  return {
    pairings: 0,
    note: unique.size ? `HTML mentions ${unique.size} franchise ids` : 'no franchise ids in HTML',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`Probing ${SLUG} ${YEAR} week ${WEEK} — host=${HOST} L=${LID}`);
console.log(
  MFL_API_KEY
    ? 'APIKEY present — authenticated rows are live.\n'
    : 'NO APIKEY set: the authenticated rows below are duplicates of the ' +
      'unauthenticated ones and prove nothing. Set MFL_APIKEY.\n'
);

const rows = [];
for (const c of CANDIDATES) {
  let row = { name: c.name, status: '—', bytes: 0, pairings: 0, note: '' };
  try {
    const res = await fetch(c.url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
    const body = await res.text();
    const ct = res.headers.get('content-type') ?? '';
    const { pairings, note } = countPairings(body, ct);
    row = { name: c.name, status: String(res.status), bytes: body.length, pairings, note };
  } catch (err) {
    row.note = `error: ${err.message}`;
  }
  rows.push(row);
  const flag = row.pairings > 0 ? '  <-- HAS PAIRINGS' : '';
  console.log(
    `${row.name.padEnd(36)} ${row.status.padStart(3)}  ${String(row.bytes).padStart(8)}B  pairings=${String(row.pairings).padStart(3)}  ${row.note}${flag}`
  );
  await sleep(700);
}

const winners = rows.filter((r) => r.pairings > 0);
console.log(
  `\n${winners.length ? `FOUND pairings via: ${winners.map((w) => w.name).join(', ')}` : 'No source returned pairings for this week.'}`
);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `### MFL schedule-source probe — ${SLUG} ${YEAR} week ${WEEK}`,
    '',
    `\`host=${HOST}\` \`L=${LID}\``,
    '',
    '| Source | HTTP | Bytes | Pairings | Note |',
    '|---|---:|---:|---:|---|',
    ...rows.map(
      (r) => `| ${r.name} | ${r.status} | ${r.bytes} | ${r.pairings > 0 ? `**${r.pairings}**` : r.pairings} | ${r.note} |`
    ),
    '',
    winners.length
      ? `**Found pairings via: ${winners.map((w) => w.name).join(', ')}** — wire this into the backfill.`
      : '**No source returned pairings.** MFL is not serving this week from any probed surface.',
  ].join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}
