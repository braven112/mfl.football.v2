#!/usr/bin/env node
/**
 * Backfill exact points-for/against into historical standings.json files.
 *
 * Problem: MFL's plain TYPE=leagueStandings export returns only the columns
 * that league-year had *configured* on its standings page. AFL 2010–2022 were
 * configured with avgpf/avgpa but no raw pf/pa, so the committed feeds carry
 * no exact points and src/utils/afl-career-stats.ts has to approximate with
 * avgpf × games. Re-running the plain fetch returns the same sparse columns
 * forever — but the endpoint's ALL=1 parameter requests the full column set
 * regardless of league config (see docs/features/mfl-api.md).
 *
 * This script re-fetches ONLY standings.json (deliberately narrow — see the
 * 2026-07-04 insight about backfill-historical-feeds.mjs --force clobbering
 * rich playoff-brackets files) with ALL=1, and only overwrites a year after
 * verifying the response:
 *   - franchise count and id set match the committed league.json/standings.json
 *   - pf is present on every franchise and non-zero somewhere
 *   - no field the committed file had is missing from the new payload
 *     (h2hw/h2hl/h2ht, divwlt, avgpf, ... — everything the site reads)
 *   - pf roughly agrees with the old avgpf × games approximation (warn-only;
 *     a large disagreement means the response is a different league's data)
 *
 * Per-year host + league ID resolve from the current league.json's
 * history.league array, same as backfill-historical-feeds.mjs — MFL reuses
 * league IDs across years, so querying an old year with the current ID
 * silently returns a different league.
 *
 * Usage:
 *   node scripts/backfill-standings-points.mjs --dry-run          # AFL, report only
 *   node scripts/backfill-standings-points.mjs                    # AFL, write verified years
 *   node scripts/backfill-standings-points.mjs --league=theleague
 *   node scripts/backfill-standings-points.mjs --year=2015 --year=2016
 *
 * With no --year flags it targets every committed season whose standings.json
 * lacks a usable pf (missing, or zero on every franchise) — for AFL that is
 * 2003 and 2010–2022.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAGUES } from '../src/config/leagues-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Same shape as backfill-historical-feeds.mjs: historySourceYear is a year
// whose cached league.json is verified to belong to THIS league and carries
// the full history block.
const BACKFILL_LEAGUES = {
  theleague: { registry: LEAGUES.theleague, historySourceYear: '2025' },
  afl: { registry: LEAGUES['afl-fantasy'], historySourceYear: '2026' },
};

const args = process.argv.slice(2);
const LEAGUE_KEY = (args.find((a) => a.startsWith('--league=')) ?? '--league=afl')
  .slice('--league='.length);
const LEAGUE = BACKFILL_LEAGUES[LEAGUE_KEY];
if (!LEAGUE) {
  console.error(`Unknown --league=${LEAGUE_KEY} (expected: ${Object.keys(BACKFILL_LEAGUES).join(' | ')})`);
  process.exit(1);
}
const DRY_RUN = args.includes('--dry-run');
const ONLY_YEARS = args
  .filter((a) => a.startsWith('--year='))
  .map((a) => Number(a.slice('--year='.length)))
  .filter((y) => Number.isInteger(y));

const FEEDS_DIR = path.join(ROOT, LEAGUE.registry.dataPath, 'mfl-feeds');

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
  return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// Resolve per-year host + league ID from the verified-current league.json.
// ---------------------------------------------------------------------------
const currentLeaguePath = path.join(FEEDS_DIR, `${LEAGUE.historySourceYear}/league.json`);
const current = readJson(currentLeaguePath);
if (!current) {
  console.error(`Cannot read ${currentLeaguePath}`);
  process.exit(1);
}
if (String(current.league?.id ?? '') !== LEAGUE.registry.id) {
  console.error(
    `History source ${currentLeaguePath} has league id ${current.league?.id} — ` +
    `expected ${LEAGUE.registry.id}. Refusing to run from a contaminated file.`
  );
  process.exit(1);
}

const historyByYear = new Map();
for (const entry of current.league?.history?.league ?? []) {
  const m = String(entry.url).match(/^https?:\/\/(www\d+\.myfantasyleague\.com)\/(\d+)\/home\/(\d+)/);
  if (m) historyByYear.set(Number(m[2]), { host: m[1], leagueId: m[3] });
}

// ---------------------------------------------------------------------------
// Pick target years: explicit --year flags, else every committed season whose
// standings lack a usable (non-zero-somewhere) pf.
// ---------------------------------------------------------------------------
const franchiseRows = (data) => data?.leagueStandings?.franchise ?? null;

const hasUsablePf = (rows) =>
  rows.every((r) => r.pf != null) && rows.some((r) => num(r.pf) > 0);

const committedYears = fs
  .readdirSync(FEEDS_DIR)
  .filter((d) => /^\d{4}$/.test(d))
  .map(Number)
  .sort();

// Auto-selection stays clear of the in-progress season (its pf is legitimately
// zero until games are played); an explicit --year can still target it.
const targetYears = ONLY_YEARS.length
  ? ONLY_YEARS
  : committedYears.filter((year) => {
      if (year >= Number(LEAGUE.historySourceYear)) return false;
      const rows = franchiseRows(readJson(path.join(FEEDS_DIR, `${year}/standings.json`)));
      return rows && !hasUsablePf(rows);
    });

if (!targetYears.length) {
  console.log('No target years — every committed standings.json already has usable pf.');
  process.exit(0);
}

console.log(`League: ${LEAGUE_KEY} (${LEAGUE.registry.id})${DRY_RUN ? ' [DRY RUN]' : ''}`);
console.log(`Target years: ${targetYears.join(', ')}\n`);

// ---------------------------------------------------------------------------
// Per-year fetch + verify (+ write).
// ---------------------------------------------------------------------------
const results = [];

for (const year of targetYears) {
  const label = `${year}:`;
  const hist = historyByYear.get(year);
  if (!hist) {
    results.push({ year, status: 'error', detail: 'no history.league entry for this year' });
    console.log(label, 'ERROR — no history entry');
    continue;
  }

  const yearDir = path.join(FEEDS_DIR, String(year));
  const committedLeague = readJson(path.join(yearDir, 'league.json'));
  const committedRows = franchiseRows(readJson(path.join(yearDir, 'standings.json')));
  if (!committedLeague || !committedRows) {
    results.push({ year, status: 'error', detail: 'missing committed league.json or standings.json' });
    console.log(label, 'ERROR — missing committed feeds');
    continue;
  }
  // Contamination guard: the committed year must already be this league's data.
  if (String(committedLeague.league?.id ?? '') !== hist.leagueId) {
    results.push({
      year,
      status: 'error',
      detail: `committed league.json id ${committedLeague.league?.id} != history id ${hist.leagueId} — fix contamination first`,
    });
    console.log(label, 'ERROR — committed league.json does not match history id');
    continue;
  }

  const url = `https://${hist.host}/${year}/export?TYPE=leagueStandings&L=${hist.leagueId}&ALL=1&JSON=1`;
  let payload;
  try {
    payload = await fetchJson(url);
  } catch (err) {
    results.push({ year, status: 'error', detail: `fetch failed: ${err.message}` });
    console.log(label, `ERROR — fetch failed (${err.message})`);
    await sleep(1000);
    continue;
  }
  await sleep(1000);

  const newRows = franchiseRows(payload);
  if (!newRows || payload.error) {
    results.push({ year, status: 'error', detail: `invalid payload: ${JSON.stringify(payload).slice(0, 120)}` });
    console.log(label, 'ERROR — invalid payload');
    continue;
  }

  // Identity checks: same franchise set as the committed feeds.
  const oldIds = new Set(committedRows.map((r) => r.id));
  const newIds = new Set(newRows.map((r) => r.id));
  const idsMatch =
    newRows.length === committedRows.length &&
    [...oldIds].every((id) => newIds.has(id));
  if (!idsMatch) {
    results.push({
      year,
      status: 'error',
      detail: `franchise mismatch: committed ${committedRows.length} ids, response ${newRows.length}`,
    });
    console.log(label, 'ERROR — franchise id set mismatch (wrong league?)');
    continue;
  }

  // Strong wrong-league detector: MFL franchise ids are generic (0001…), but
  // every franchise's exact H2H and division records matching the committed
  // feed means this is certainly the same league-season.
  const newById = new Map(newRows.map((r) => [r.id, r]));
  const recordMismatches = [];
  for (const oldRow of committedRows) {
    const newRow = newById.get(oldRow.id);
    for (const key of ['h2hw', 'h2hl', 'h2ht', 'divwlt']) {
      if (oldRow[key] != null && newRow[key] != null && String(oldRow[key]) !== String(newRow[key])) {
        recordMismatches.push(`${oldRow.id}.${key} ${oldRow[key]}→${newRow[key]}`);
      }
    }
  }
  if (recordMismatches.length) {
    results.push({
      year,
      status: 'error',
      detail: `record values differ from committed feed (wrong league?): ${recordMismatches.slice(0, 6).join(', ')}`,
    });
    console.log(label, `ERROR — record mismatch vs committed feed: ${recordMismatches.slice(0, 6).join(', ')}`);
    continue;
  }
  const lostFields = new Set();
  for (const oldRow of committedRows) {
    const newRow = newById.get(oldRow.id);
    for (const key of Object.keys(oldRow)) {
      if (!(key in newRow)) lostFields.add(key);
    }
  }
  if (lostFields.size) {
    results.push({ year, status: 'error', detail: `response drops fields: ${[...lostFields].join(', ')}` });
    console.log(label, `ERROR — response missing committed fields: ${[...lostFields].join(', ')}`);
    continue;
  }

  const gainedFields = [...new Set(newRows.flatMap((r) => Object.keys(r)))]
    .filter((k) => !committedRows.some((r) => k in r))
    .sort();

  // The point of the exercise: usable pf.
  if (!hasUsablePf(newRows)) {
    // Distinguish "MFL has no points for this year" (2003 — committed file had
    // none either; not a failure, nothing to gain) from "ALL=1 didn't help".
    const detail = newRows.every((r) => r.pf != null)
      ? 'pf present but zero on every franchise — MFL has no points data for this year'
      : 'response still has no pf field';
    results.push({ year, status: 'no-points', detail, gainedFields });
    console.log(label, `NO POINTS — ${detail}`);
    continue;
  }

  // Diagnostic (not a gate — record-value identity above is the wrong-league
  // check): how does exact pf compare to the avgpf × games approximation the
  // site has been using? A consistent ratio ≠ 1 means the approximation was
  // systematically off for this season (e.g. double-header weeks make games
  // exceed the week count avgpf divides by), which is worth recording.
  let disagreements = 0;
  const ratios = [];
  let sample = null;
  for (const oldRow of committedRows) {
    const newRow = newById.get(oldRow.id);
    const games = num(oldRow.h2hw) + num(oldRow.h2hl) + num(oldRow.h2ht);
    const approx = num(oldRow.avgpf) * games;
    const exact = num(newRow.pf);
    if (approx > 0 && exact > 0) {
      ratios.push(exact / approx);
      if (Math.abs(exact - approx) / approx > 0.02) disagreements++;
    }
    if (!sample) sample = { id: oldRow.id, games, avgpf: oldRow.avgpf, approx: approx.toFixed(2), exact: newRow.pf };
  }
  const meanRatio = ratios.length ? ratios.reduce((a, b) => a + b) / ratios.length : 0;
  const ratioSpread = ratios.length ? Math.max(...ratios) - Math.min(...ratios) : 0;

  results.push({ year, status: 'ok', gainedFields, disagreements, sample });
  console.log(label, `OK — records match committed feed; pf usable (sample ${sample.id}: ` +
    `${sample.games} games × avgpf ${sample.avgpf} = ${sample.approx} vs exact pf ${sample.exact})`);
  if (disagreements) {
    console.log(
      `  note: avgpf×games approximation was off >2% for ${disagreements}/${ratios.length} franchises ` +
      `(pf/approx mean ${meanRatio.toFixed(4)}, spread ${ratioSpread.toFixed(4)})`
    );
  }
  console.log(`  gained fields: ${gainedFields.join(', ') || '(none)'}`);

  if (!DRY_RUN) {
    fs.writeFileSync(path.join(yearDir, 'standings.json'), JSON.stringify(payload, null, 2));
    console.log('  wrote standings.json');
  }
}

// ---------------------------------------------------------------------------
// Summary + exit code.
// ---------------------------------------------------------------------------
const ok = results.filter((r) => r.status === 'ok');
const noPoints = results.filter((r) => r.status === 'no-points');
const errors = results.filter((r) => r.status === 'error');

console.log(`\nSummary: ${ok.length} verified${DRY_RUN ? '' : ' + written'}, ` +
  `${noPoints.length} with no points on MFL, ${errors.length} failed`);
for (const r of errors) console.log(`  FAILED ${r.year}: ${r.detail}`);
for (const r of noPoints) console.log(`  NO POINTS ${r.year}: ${r.detail}`);

// "MFL genuinely has no points" (2003) is not a failure; anything else is.
process.exit(errors.length ? 1 : 0);
