/**
 * Fetch NFL snap count data from NFLverse and match to MFL player IDs.
 *
 * Downloads per-game snap counts from the NFLverse GitHub releases,
 * aggregates to season totals, and fuzzy-matches players to MFL IDs.
 * The arithmetic lives in scripts/lib/snap-counts.mjs, which documents what
 * each field means and which two of them were wrong.
 *
 * ── Snap Count Lifecycle ────────────────────────────────────────────────────
 *
 *   Offseason (end of season → kickoff):
 *     The last completed season's file is what the page shows. No fetch is
 *     needed; the final in-season run already captured it.
 *
 *   Regular season (kickoff → week 18):
 *     .github/workflows/snap-counts-sync.yml refetches every Tuesday at
 *     noon PT, after Monday night finalizes. The page switches to the new
 *     season the moment week 1 kicks off, so the first Tuesday run is what
 *     fills it in.
 *
 * The season this script fetches and the season the page displays are ONE
 * decision, made by src/utils/snap-count-season.mjs. Do not re-derive it here
 * — a fetcher and a reader that disagree is exactly how the page spent the
 * 2026 opener showing 2025 totals. `--year` overrides for backfills.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/fetch-snap-counts.mjs              # Current season, use cache
 *   node scripts/fetch-snap-counts.mjs --force      # Re-fetch (what the cron runs)
 *   node scripts/fetch-snap-counts.mjs --year 2024  # Specific season
 *
 * Output: data/theleague/nfl-cache/snap-counts-{YEAR}.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { snapCountSeason } from '../src/utils/snap-count-season.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import {
  parseCSV,
  aggregateSnapCounts,
  matchToMflPlayers,
} from './lib/snap-counts.mjs';

// ── Config ──────────────────────────────────────────────────────────────────
const force = process.argv.includes('--force');

const now = new Date();
const calendarYear = now.getFullYear();

const yearFlag = process.argv.find((_, i, a) => a[i - 1] === '--year');
const SNAP_YEAR = yearFlag ? parseInt(yearFlag, 10) : snapCountSeason(now);

const NFLVERSE_URL = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${SNAP_YEAR}.csv.gz`;

// MFL data — use current league year for player ID matching
const laborDay = (() => {
  const sept1 = new Date(calendarYear, 8, 1);
  const dow = sept1.getDay();
  const offset = dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow;
  return new Date(calendarYear, 8, 1 + offset);
})();
const getCurrentLeagueYear = () => {
  const febCutoff = new Date(Date.UTC(calendarYear, 1, 15, 4, 45, 0, 0));
  const baseYear = now >= laborDay ? calendarYear : calendarYear - 1;
  return now >= febCutoff ? baseYear + 1 : baseYear;
};
const leagueYear = getCurrentLeagueYear();

const MFL_PLAYERS_PATH = path.join('data', 'theleague', 'mfl-feeds', String(leagueYear), 'players.json');
const MFL_PLAYERS_FALLBACK = path.join('data', 'theleague', 'mfl-feeds', String(leagueYear - 1), 'players.json');

const OUT_DIR = path.join('data', 'theleague', 'nfl-cache');
const OUT_FILE = path.join(OUT_DIR, `snap-counts-${SNAP_YEAR}.json`);

// ── Main ────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`Snap count season: ${SNAP_YEAR}${yearFlag ? ' (--year)' : ' (kickoff-gated)'}`);

  // The Tuesday cron runs year-round; this job may only DO anything while the
  // season it would fetch is being played. "The file already exists" is not a
  // schedule guard — `fetchedAt` moves every run, so an offseason refetch
  // commits a new file every week to say nothing changed. A backfill (--year)
  // is a deliberate human act and skips the gate.
  if (!yearFlag && !isSeasonWindowOpen(SNAP_YEAR, now)) {
    console.log(`The ${SNAP_YEAR} season is not in progress — nothing to refresh.`);
    return;
  }

  // Check cache
  if (!force && fs.existsSync(OUT_FILE)) {
    console.log(`Snap counts for ${SNAP_YEAR} already cached at ${OUT_FILE}; use --force to refetch.`);
    return;
  }

  // Load MFL players for matching
  const mflPath = fs.existsSync(MFL_PLAYERS_PATH) ? MFL_PLAYERS_PATH : MFL_PLAYERS_FALLBACK;
  if (!fs.existsSync(mflPath)) {
    console.error(`No MFL players.json found at ${MFL_PLAYERS_PATH} or ${MFL_PLAYERS_FALLBACK}`);
    console.error('Run "node scripts/fetch-mfl-feeds.mjs" first.');
    process.exit(1);
  }

  console.log(`Loading MFL players from ${mflPath}`);
  const mflData = JSON.parse(fs.readFileSync(mflPath, 'utf8'));
  const mflPlayers = mflData?.players?.player || [];
  console.log(`Loaded ${mflPlayers.length} MFL players`);

  // Download snap counts
  console.log(`Downloading snap counts from ${NFLVERSE_URL}`);
  const response = await fetch(NFLVERSE_URL, { redirect: 'follow' });
  if (!response.ok) {
    // Before the season's first Tuesday NFLverse has no file for it yet. The
    // page falls back to the last completed season and labels it, so this is
    // a normal state, not a failure worth failing the job over.
    if (response.status === 404) {
      console.log(`NFLverse has no ${SNAP_YEAR} snap counts yet (404) — nothing to update.`);
      return;
    }
    throw new Error(`Failed to download snap counts: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`Downloaded ${(buffer.length / 1024).toFixed(0)} KB, decompressing...`);

  const csvText = gunzipSync(buffer).toString('utf8');
  const rows = parseCSV(csvText);
  console.log(`Parsed ${rows.length} snap count records`);

  // Aggregate to season totals
  const snapPlayers = aggregateSnapCounts(rows);
  console.log(`Aggregated ${snapPlayers.length} unique players`);

  // Match to MFL IDs
  const { matched, matchCount, missCount } = matchToMflPlayers(snapPlayers, mflPlayers);
  console.log(`Matched ${matchCount} players to MFL IDs (${missCount} unmatched)`);

  // The weeks covered are what tells a reader a 58% is one game, not a season.
  const weeksCovered = rows.reduce((max, r) => {
    if ((r.game_type || '') !== 'REG') return max;
    const wk = parseInt(r.week, 10) || 0;
    return wk > max ? wk : max;
  }, 0);

  // Write output. `fetchedAt` moves on every run, so it is excluded from the
  // comparison — a bye-week-quiet refetch must not produce a commit.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const output = {
    season: SNAP_YEAR,
    weeksCovered,
    fetchedAt: new Date().toISOString(),
    source: NFLVERSE_URL,
    players: matched,
  };

  const wrote = writeJsonIfChanged(OUT_FILE, output, { ignoreKeys: ['fetchedAt'] });
  console.log(wrote
    ? `Saved snap counts -> ${OUT_FILE} (${Object.keys(matched).length} players, through week ${weeksCovered})`
    : `Snap counts unchanged for ${SNAP_YEAR} — left ${OUT_FILE} untouched.`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
