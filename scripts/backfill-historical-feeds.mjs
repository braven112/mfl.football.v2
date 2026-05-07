#!/usr/bin/env node
/**
 * Backfill missing or invalid historical MFL feeds for TheLeague.
 *
 * Reads the history.league array from data/theleague/mfl-feeds/2025/league.json
 * (which contains the URL + league ID for every season the league has ever
 * had on MFL) and, for each gap year — missing standings.json or one that
 * returned "Invalid league ID" — refetches against the historical URL.
 *
 * What it pulls per year (when available):
 *   standings.json, league.json, transactions.json, draftResults.json,
 *   auctionResults.json, playoff-brackets.json, weekly-results.json
 *
 * Run from the repo root:
 *   node scripts/backfill-historical-feeds.mjs
 *
 * Add --dry-run to print what it would fetch without writing anything.
 * Add --force to refetch every year, even ones that already have data.
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
  !data || data.error || /Invalid league/i.test(JSON.stringify(data?.error || ''));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const text = await res.text();
  try {
    return { ok: true, data: JSON.parse(text), raw: text };
  } catch {
    return { ok: false, data: null, raw: text };
  }
}

const ENDPOINTS = [
  { type: 'league', file: 'league.json' },
  { type: 'leagueStandings', file: 'standings.json' },
  { type: 'transactions', file: 'transactions.json', extra: 'W=YTD&TRANS_TYPE=*' },
  { type: 'draftResults', file: 'draftResults.json' },
  { type: 'auctionResults', file: 'auctionResults.json' },
  { type: 'playoffBrackets', file: 'playoff-brackets.json' },
  { type: 'weeklyResults', file: 'weekly-results.json', extra: 'W=YTD' },
];

function buildUrl(host, year, leagueId, type, extra) {
  const base = `https://${host}/${year}/export?TYPE=${type}&L=${leagueId}&JSON=1`;
  return extra ? `${base}&${extra}` : base;
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

let totalAttempted = 0;
let totalWritten = 0;
let totalSkipped = 0;
let totalErrors = 0;

for (const entry of yearList) {
  const yearDir = path.join(FEEDS_DIR, String(entry.year));
  const standingsPath = path.join(yearDir, 'standings.json');
  const existing = readJson(standingsPath);

  const needsFetch =
    FORCE ||
    !fs.existsSync(standingsPath) ||
    isInvalidFeed(existing);

  if (!needsFetch) {
    console.log(`[${entry.year}] standings.json exists and is valid — skipping (use --force to refetch)`);
    totalSkipped++;
    continue;
  }

  console.log(`\n[${entry.year}] host=${entry.host} leagueId=${entry.leagueId}`);
  fs.mkdirSync(yearDir, { recursive: true });

  for (const { type, file, extra } of ENDPOINTS) {
    const url = buildUrl(entry.host, entry.year, entry.leagueId, type, extra);
    const dest = path.join(yearDir, file);
    totalAttempted++;
    if (DRY_RUN) {
      console.log(`  [dry-run] would fetch ${type} → ${file}`);
      continue;
    }
    try {
      const result = await fetchJson(url);
      if (!result.ok) {
        console.log(`  ✗ ${type} → not JSON (probably an HTML error page)`);
        totalErrors++;
        continue;
      }
      if (isInvalidFeed(result.data)) {
        console.log(`  ✗ ${type} → MFL says invalid league`);
        totalErrors++;
        continue;
      }
      fs.writeFileSync(dest, JSON.stringify(result.data, null, 2));
      console.log(`  ✓ ${type} → ${file} (${result.raw.length} bytes)`);
      totalWritten++;
    } catch (err) {
      console.log(`  ✗ ${type} → ${err.message}`);
      totalErrors++;
    }
    await sleep(750); // be polite to MFL
  }
}

console.log(
  `\nDone. attempted=${totalAttempted} written=${totalWritten} errors=${totalErrors} years-skipped=${totalSkipped}`
);
console.log(
  `\nIf any years got new data, re-run: pnpm compute:franchise-history`
);
