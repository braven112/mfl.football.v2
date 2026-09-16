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
 * Output: data/nfl/snap-counts-{YEAR}.json — league-neutral, because NFLverse
 * snap counts are NFL facts and MFL player ids are global across leagues, so
 * BOTH free-agent pages read this one file.
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

// MFL data — use the current league year for player ID matching.
//
// The pivot is ALWAYS `calendarYear - 1`, and the Feb 14 cutoff is the only
// thing that advances it (CLAUDE.md, "Year rollover — two independent
// clocks"). A base year that ALSO advances at Labor Day gets +1'd twice —
// this file had that, so from Labor Day to New Year it asked for NEXT year's
// players.json and only worked because that feed does not exist yet and the
// fallback caught it. `getCurrentLeagueYear` in src/utils/league-year.ts owns
// the real formula; this is the .mjs restatement of it, not a new derivation.
const getCurrentLeagueYear = () => {
  const febCutoff = new Date(Date.UTC(calendarYear, 1, 15, 4, 45, 0, 0));
  const baseYear = calendarYear - 1;
  return now >= febCutoff ? baseYear + 1 : baseYear;
};
const leagueYear = getCurrentLeagueYear();

const MFL_PLAYERS_PATH = path.join('data', 'theleague', 'mfl-feeds', String(leagueYear), 'players.json');
const MFL_PLAYERS_FALLBACK = path.join('data', 'theleague', 'mfl-feeds', String(leagueYear - 1), 'players.json');

const OUT_DIR = path.join('data', 'nfl');
const OUT_FILE = path.join(OUT_DIR, `snap-counts-${SNAP_YEAR}.json`);

/**
 * Keep at most the current season and the one before it on disk.
 *
 * Both free-agent pages read this directory with an eager
 * `import.meta.glob('data/nfl/snap-counts-*.json')`, and everything an eager
 * glob matches is bundled into the single shared `_render` serverless
 * function. That is not a hypothetical: an eager multi-year glob on
 * /afl-fantasy/players.astro pushed the function to 256MB and ERRORED the
 * deploy in July 2026 (docs/claude/insights/domains/deployment.md, 2026-07-08).
 *
 * A `snap-counts-*.json` glob grows by one file every January forever, so the
 * bound has to live in the DIRECTORY — the glob pattern cannot express it.
 * Two seasons is everything the reader can select: the current one, and the
 * previous one it falls back to before kickoff. Older seasons are one
 * `--year` away if anyone wants them back.
 */
function pruneOldSeasons() {
  const keepFrom = SNAP_YEAR - 1;
  for (const file of fs.readdirSync(OUT_DIR)) {
    const year = Number(file.match(/^snap-counts-(\d{4})\.json$/)?.[1]);
    if (!Number.isFinite(year) || year >= keepFrom) continue;
    fs.unlinkSync(path.join(OUT_DIR, file));
    console.log(`Pruned ${file} — the pages can only ever select ${keepFrom} or ${SNAP_YEAR}.`);
  }
}

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
    // A 404 is expected in exactly one window: the season has kicked off but
    // NFLverse has not published its first file yet. Once we HAVE a file for
    // this season, a 404 means the release moved or broke — and swallowing
    // that would leave the page on a half-finished season behind a green
    // weekly job, which is the same silent staleness this whole change exists
    // to end. So it is only survivable while we have nothing to go stale.
    if (response.status === 404 && !fs.existsSync(OUT_FILE)) {
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

  // NFLverse ships `offense_pct` as a 0-1 fraction — verified at exactly 1.0
  // max across all 25,395 REG rows of 2025 and 1,492 of 2026. The whole
  // denominator (`snaps / pct` = implied team plays) rests on that. If a
  // release ever switched to 0-100, every share would inflate ~100x, and this
  // job runs unattended and now PRUNES the season it replaces — so refuse to
  // write rather than publish it and delete the good copy behind it.
  const worst = snapPlayers.reduce((m, p) => (p.offensePct > m ? p.offensePct : m), 0);
  if (worst > 100) {
    throw new Error(
      `Implausible snap share ${worst}% — NFLverse's offense_pct is no longer a 0-1 fraction. ` +
      `Fix the scale in scripts/lib/snap-counts.mjs before this writes.`,
    );
  }

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

  pruneOldSeasons();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
