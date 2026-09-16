#!/usr/bin/env node
/**
 * Compute the Top Players season leaderboard → data/<league>/derived/top-players.json.
 *
 * Why this exists (load-bearing — read before editing):
 *
 * The page src/pages/<league>/top-players.astro is server-rendered, like
 * /players, because the apex-domain middleware rewrites www.<league>.com/top-players
 * via context.rewrite(), which only resolves to routes registered in the SSR
 * function. An SSR page that eager-globs the feeds would bundle them into the
 * shared `_render` serverless function, which already runs near Vercel's 250 MB
 * limit. So the heavy read happens HERE, at build time, in a node script whose
 * fs reads are not traced into that function, and the page imports one finished
 * file. Same reasoning, same shape, as scripts/compute-afl-free-agents.mjs.
 *
 * The source is `player-scores-weekly.json`, NOT `weekly-results-raw.json`.
 * The latter records a player's score only for weeks he sat on some roster, so
 * the free-agent pool is structurally invisible in it — measured on TheLeague's
 * week 1 2026, 163 of 484 scoring players were on nobody's roster. See
 * docs/claude/insights/domains/mfl-api.md § 2026-08-10 and
 * docs/plans/top-players-page.md § 1.
 *
 * Usage: node scripts/compute-top-players.mjs [--league=<slug>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Mirror astro.config.ts: hydrate process.env from .env / .env.local so this
// standalone script resolves PUBLIC_BASE_YEAR / PUBLIC_MFL_YEAR the way the app
// does, and therefore picks the same season year the page would.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', ROOT, '');
for (const [k, v] of Object.entries(fileEnv)) process.env[k] ??= v;

const slugArg = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
const league = getLeagueBySlug(slugArg || 'theleague');
if (!league) {
  console.error(`[compute-top-players] unknown league "${slugArg}"`);
  process.exit(1);
}

const FEEDS_DIR = path.join(ROOT, league.dataPath, 'mfl-feeds');
const OUTPUT_DIR = path.join(ROOT, league.dataPath, 'derived');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'top-players.json');

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};
const readFeed = (year, file) => readJson(path.join(FEEDS_DIR, String(year), file));
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Which feed directory holds this season's scores.
 *
 * TWO CLOCKS, and they disagree for half the year (CLAUDE.md "Year rollover").
 * A results page wants `currentSeasonYear`, and season N's scores do live in
 * `mfl-feeds/N/` — but between the league rollover (Feb 14; Jun 1 for the AFL)
 * and Labor Day, directory N+1 already exists and is EMPTY, and a naive
 * `currentLeagueYear` lookup would read it and publish a blank leaderboard.
 *
 * So: start at the season year and walk BACK to the most recent directory that
 * actually carries scored weeks, then stamp whichever year we landed on. The
 * payload never claims a year it did not read.
 */
function resolveSeason() {
  const { currentSeasonYear } = getCurrentYears();
  for (let year = currentSeasonYear; year >= currentSeasonYear - 2; year -= 1) {
    const weeks = asArray(readFeed(year, 'player-scores-weekly.json'));
    if (weeks.length > 0) return { seasonYear: year, weeks };
  }
  return { seasonYear: currentSeasonYear, weeks: [] };
}

const { seasonYear, weeks } = resolveSeason();

// ── Week range and franchise names come from the league's own feed ──
// NEVER a constant: TheLeague runs weeks 1-17 and the AFL 1-18.
const leagueFeed = readFeed(seasonYear, 'league.json')?.league ?? {};
const startWeek = num(leagueFeed.startWeek) ?? 1;
const endWeek = num(leagueFeed.endWeek) ?? 17;
const lastRegularSeasonWeek = num(leagueFeed.lastRegularSeasonWeek);
const franchiseNames = new Map(
  asArray(leagueFeed.franchises?.franchise)
    .filter((f) => f?.id)
    .map((f) => [f.id, (f.name ?? '').trim() || f.id]),
);

// Franchise CRESTS, from the league's own config (registry `configPath`), so
// the Owner column can show the mark rather than a name that truncates to
// "Dead Ca…" on a phone. Only the light `icon` is carried: `TeamIconDarkStyles`
// in the shared layout head swaps to `iconDark` by CSS keyed on the light src,
// and picking a theme's src server-side is wrong anyway — with theme
// preference 'auto' the server cannot know the resolved theme.
const leagueConfig = readJson(path.join(ROOT, league.configPath)) ?? {};
const franchiseIcons = new Map(
  asArray(leagueConfig.teams)
    .filter((t) => t?.franchiseId && t?.icon)
    .map((t) => [t.franchiseId, t.icon]),
);

// ── Ownership is a LIST, never a scalar ──
// The AFL is `duplicatePlayers: true` — the same NFL player is routinely
// rostered once per conference — so a `franchiseId ===` compare is the exact
// shape that put a rival's player on someone's own homepage. See
// docs/claude/insights/features/player-composites.md.
const ownersByPlayer = new Map();
for (const f of asArray(readFeed(seasonYear, 'rosters.json')?.rosters?.franchise)) {
  for (const p of asArray(f?.player)) {
    if (!p?.id) continue;
    if (!ownersByPlayer.has(p.id)) ownersByPlayer.set(p.id, []);
    ownersByPlayer.get(p.id).push(f.id);
  }
}

// ── Player identity ──
// ESPN ids drive the headshot (`getPlayerHeadshot`); without one every avatar
// falls through to the grey silhouette — which is exactly how this page first
// shipped. players.json carries `espn_id` for most of the pool; the college-id
// map covers rookies whose NFL headshot does not exist yet. Same two sources,
// same order, as /players.
const espnCollegeIds =
  readJson(path.join(ROOT, getLeagueBySlug('theleague').dataPath, 'espn-college-ids.json'))
    ?.players ?? {};

const playerInfo = new Map();
for (const p of asArray(readFeed(seasonYear, 'players.json')?.players?.player)) {
  if (!p?.id) continue;
  // MFL splits receivers into SWR/LWR/RWR; the league scores them as one WR.
  let position = (p.position ?? '').toUpperCase();
  if (['SWR', 'LWR', 'RWR'].includes(position)) position = 'WR';
  playerInfo.set(p.id, {
    // MFL stores names "Last, First"; the site renders "First Last".
    name: String(p.name ?? '').includes(',')
      ? String(p.name).split(',').map((s) => s.trim()).reverse().join(' ')
      : String(p.name ?? ''),
    position,
    team: p.team ?? null,
    espnId: p.espn_id || espnCollegeIds[p.id]?.espnCollegeId || null,
  });
}

// ── Per-week scores, full pool ──
const scoresByPlayer = new Map();
const completedWeeks = [];
for (const payload of weeks) {
  const week = num(payload?.playerScores?.week);
  if (week == null) continue;
  let scored = 0;
  for (const row of asArray(payload?.playerScores?.playerScore)) {
    const score = num(row?.score);
    if (!row?.id || score == null) continue;
    if (!scoresByPlayer.has(row.id)) scoresByPlayer.set(row.id, {});
    scoresByPlayer.get(row.id)[week] = score;
    scored += 1;
  }
  if (scored > 0) completedWeeks.push(week);
}
completedWeeks.sort((a, b) => a - b);

// ── Rows ──
const players = [];
let unknownIds = 0;
for (const [id, byWeek] of scoresByPlayer) {
  const info = playerInfo.get(id);
  if (!info?.name) {
    // A scoring id with no row in players.json — cannot be labelled, so it
    // cannot be shown. Counted and reported rather than dropped in silence.
    unknownIds += 1;
    continue;
  }
  const values = Object.values(byWeek);
  const total = values.reduce((a, b) => a + b, 0);
  // `games` counts weeks the player ACTUALLY scored. A week MFL has not scored
  // yet is absent, not zero — counting it would read "0.0 per game" for someone
  // who has played once, the bug weekly-player-results.ts already carries a
  // comment about.
  const games = values.length;
  const owners = (ownersByPlayer.get(id) ?? []).map((fid) => ({
    id: fid,
    name: franchiseNames.get(fid) ?? fid,
    icon: franchiseIcons.get(fid) ?? null,
  }));
  players.push({
    id,
    name: info.name,
    position: info.position || 'UNK',
    team: info.team,
    espnId: info.espnId,
    owners,
    weeks: byWeek,
    total: Math.round(total * 100) / 100,
    avg: games > 0 ? Math.round((total / games) * 100) / 100 : 0,
    games,
    best: games > 0 ? Math.max(...values) : 0,
  });
}

// Ordinal ranking by total desc, ties broken by name so the order is stable
// across runs (MFL returns rows in nondeterministic order — an unstable sort
// here would rewrite the file every build and churn .git).
players.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
players.forEach((p, i) => {
  p.rank = i + 1;
});
const seenAtPosition = new Map();
for (const p of players) {
  const next = (seenAtPosition.get(p.position) ?? 0) + 1;
  seenAtPosition.set(p.position, next);
  p.posRank = next;
}

const output = {
  seasonYear,
  startWeek,
  endWeek,
  lastRegularSeasonWeek,
  completedWeeks,
  positions: [...seenAtPosition.keys()].sort(),
  players,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJsonIfChanged(OUTPUT_PATH, output);

const freeAgents = players.filter((p) => p.owners.length === 0).length;
const withHeadshot = players.filter((p) => p.espnId).length;
console.log(
  `[compute-top-players] ${league.slug} season=${seasonYear} weeks=${completedWeeks.join(',') || 'none'} ` +
    `players=${players.length} freeAgents=${freeAgents} espnIds=${withHeadshot} ` +
    `crests=${franchiseIcons.size} unlabelled=${unknownIds} → ${path.relative(ROOT, OUTPUT_PATH)}`,
);
