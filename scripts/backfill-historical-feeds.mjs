#!/usr/bin/env node
/**
 * Backfill missing historical MFL feeds for TheLeague.
 *
 * Reads history.league from data/theleague/mfl-feeds/2025/league.json (which
 * contains the URL + league ID for every season the league has lived under
 * on MFL) and, per year, fetches whichever feeds we don't yet have on disk.
 *
 * What it pulls per year:
 *   league.json, standings.json, schedule.json (H2H pairings — needed for
 *   rivalry pages), transactions.json, draftResults.json, auctionResults.json,
 *   playoff-brackets.json, weekly-results-raw.json + weekly-results.json.
 *
 * Usage:
 *   node scripts/backfill-historical-feeds.mjs           # fill gaps only
 *   node scripts/backfill-historical-feeds.mjs --force   # refetch everything
 *   node scripts/backfill-historical-feeds.mjs --dry-run # preview
 *
 * If anything new comes back, re-run:
 *   pnpm compute:franchise-history
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, 'data/theleague/mfl-feeds');
const CURRENT_LEAGUE_JSON = path.join(FEEDS_DIR, '2025/league.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const isInvalidFeed = (data) =>
  !data ||
  data.error ||
  /Invalid league/i.test(JSON.stringify(data?.error || ''));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  try {
    return { ok: true, data: JSON.parse(text), raw: text };
  } catch {
    return { ok: false, data: null, raw: text };
  }
}

// Single-call endpoints. Schedule is the new one — gives per-week H2H pairings
// that we need for rivalry pages.
const SIMPLE_ENDPOINTS = [
  { type: 'league', file: 'league.json' },
  { type: 'leagueStandings', file: 'standings.json' },
  { type: 'schedule', file: 'schedule.json' },
  { type: 'transactions', file: 'transactions.json', extra: 'W=YTD&TRANS_TYPE=*' },
  { type: 'draftResults', file: 'draftResults.json' },
  { type: 'auctionResults', file: 'auctionResults.json' },
  { type: 'playoffBrackets', file: 'playoff-brackets.json' },
];

function buildUrl(host, year, leagueId, type, extra) {
  const base = `https://${host}/${year}/export?TYPE=${type}&L=${leagueId}&JSON=1`;
  return extra ? `${base}&${extra}` : base;
}

// Attempt one endpoint, return outcome string + whether anything was written.
async function attemptEndpoint(host, year, leagueId, type, file, extra, dest) {
  if (!FORCE && fs.existsSync(dest)) {
    const existing = readJson(dest);
    if (!isInvalidFeed(existing)) {
      return { skipped: true, reason: 'already valid' };
    }
  }
  if (DRY_RUN) {
    return { dryRun: true };
  }
  const url = buildUrl(host, year, leagueId, type, extra);
  try {
    const result = await fetchJson(url);
    if (!result.ok) return { error: 'not JSON (HTML error page)' };
    if (isInvalidFeed(result.data)) return { error: 'invalid league' };
    fs.writeFileSync(dest, JSON.stringify(result.data, null, 2));
    return { written: true, bytes: result.raw.length };
  } catch (err) {
    return { error: err.message };
  } finally {
    await sleep(500);
  }
}

// Fetch all 17 weeks of weekly results and produce both raw and normalized
// outputs, matching the format produced by scripts/fetch-mfl-feeds.mjs.
async function fetchWeeklyResults(host, year, leagueId, yearDir) {
  const rawPath = path.join(yearDir, 'weekly-results-raw.json');
  const normPath = path.join(yearDir, 'weekly-results.json');

  if (!FORCE && fs.existsSync(rawPath) && fs.existsSync(normPath)) {
    const existingRaw = readJson(rawPath);
    if (Array.isArray(existingRaw) && existingRaw.length > 0) {
      return { skipped: true, reason: 'already cached' };
    }
  }

  if (DRY_RUN) {
    return { dryRun: true, weeksToFetch: 17 };
  }

  const rawWeeks = [];
  for (let week = 1; week <= 17; week++) {
    const url = buildUrl(host, year, leagueId, 'weeklyResults', `W=${week}`);
    try {
      const result = await fetchJson(url);
      if (!result.ok) continue;
      if (isInvalidFeed(result.data)) continue;
      rawWeeks.push(result.data);
    } catch {
      // skip
    }
    await sleep(500);
  }

  if (rawWeeks.length === 0) {
    return { error: 'no weeks returned' };
  }

  fs.writeFileSync(rawPath, JSON.stringify(rawWeeks, null, 2));

  // Normalize: { weeks: [{ week, scores: { fid: pts } }] }
  const normalized = {
    weeks: rawWeeks.map((payload) => {
      const weekVal = Number(payload?.weeklyResults?.week) || undefined;
      const matchups = payload?.weeklyResults?.matchup
        ? Array.isArray(payload.weeklyResults.matchup)
          ? payload.weeklyResults.matchup
          : [payload.weeklyResults.matchup]
        : [];
      const scores = {};
      for (const m of matchups) {
        const franchises = m?.franchise
          ? Array.isArray(m.franchise)
            ? m.franchise
            : [m.franchise]
          : [];
        for (const f of franchises) {
          if (f?.id != null) scores[f.id] = Number(f.score) || 0;
        }
      }
      return { week: weekVal, scores };
    }),
  };
  fs.writeFileSync(normPath, JSON.stringify(normalized, null, 2));

  return { written: true, weeks: rawWeeks.length };
}

const current = readJson(CURRENT_LEAGUE_JSON);
if (!current) {
  console.error(`Cannot read ${CURRENT_LEAGUE_JSON}`);
  process.exit(1);
}

const historyEntries = current.league?.history?.league ?? [];
const yearList = historyEntries
  .map((e) => {
    const m = String(e.url).match(/^https?:\/\/(www\d+\.myfantasyleague\.com)\/(\d+)\/home\/(\d+)/);
    if (!m) return null;
    return { year: Number(e.year), host: m[1], leagueId: m[3] };
  })
  .filter(Boolean)
  .sort((a, b) => a.year - b.year);

console.log(`Found ${yearList.length} historical league entries.`);
console.log(`Mode: ${DRY_RUN ? 'dry-run' : FORCE ? 'force-refetch' : 'fill gaps only'}`);

let totalWritten = 0;
let totalSkipped = 0;
let totalErrors = 0;
let totalDryRun = 0;

for (const entry of yearList) {
  const yearDir = path.join(FEEDS_DIR, String(entry.year));
  fs.mkdirSync(yearDir, { recursive: true });
  console.log(`\n[${entry.year}] host=${entry.host} leagueId=${entry.leagueId}`);

  // Simple per-endpoint loop
  for (const { type, file, extra } of SIMPLE_ENDPOINTS) {
    const dest = path.join(yearDir, file);
    const outcome = await attemptEndpoint(
      entry.host, entry.year, entry.leagueId, type, file, extra, dest
    );
    if (outcome.skipped) { console.log(`  ◦ ${file} — ${outcome.reason}`); totalSkipped++; }
    else if (outcome.dryRun) { console.log(`  [dry-run] would fetch ${type} → ${file}`); totalDryRun++; }
    else if (outcome.written) { console.log(`  ✓ ${type} → ${file} (${outcome.bytes} bytes)`); totalWritten++; }
    else if (outcome.error) { console.log(`  ✗ ${type} → ${outcome.error}`); totalErrors++; }
  }

  // Weekly results: special-cased because it needs 17 separate fetches.
  const wkOutcome = await fetchWeeklyResults(entry.host, entry.year, entry.leagueId, yearDir);
  if (wkOutcome.skipped) { console.log(`  ◦ weekly-results — ${wkOutcome.reason}`); totalSkipped++; }
  else if (wkOutcome.dryRun) { console.log(`  [dry-run] would fetch ${wkOutcome.weeksToFetch} weeks of weeklyResults`); totalDryRun++; }
  else if (wkOutcome.written) { console.log(`  ✓ weeklyResults → weekly-results-raw.json + weekly-results.json (${wkOutcome.weeks} weeks)`); totalWritten++; }
  else if (wkOutcome.error) { console.log(`  ✗ weeklyResults → ${wkOutcome.error}`); totalErrors++; }
}

console.log(
  `\nDone. written=${totalWritten} skipped=${totalSkipped} errors=${totalErrors}` +
  (DRY_RUN ? ` dry-run=${totalDryRun}` : '')
);
if (totalWritten > 0) {
  console.log(`\nIf any years got new data, re-run: pnpm compute:franchise-history`);
}
