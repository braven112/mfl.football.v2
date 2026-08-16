#!/usr/bin/env node
/**
 * League record book — every game ever played, not just the attributable ones.
 *
 * WHY THIS DOES NOT USE franchise-history.json: that ledger is owner-scoped. It
 * credits a season only to the franchise whose CURRENT owner played it, so games
 * played under a slot's previous owner are dropped. For the AFL that removes 63%
 * of 2004, roughly half of 2005-2011, and none of 2022-2025 — a record book
 * built on it would quietly mean "since the current owners arrived" while
 * claiming to mean "ever", and would bias every all-time record toward the
 * modern era. See docs/claude/insights/features/franchise-history.md.
 *
 * So this walks the committed feeds directly and names each franchise as it was
 * named THAT SEASON, the way a real record book does: "Cliffside Killer Clowns,
 * 2008", not whoever holds that slot today.
 *
 * Output: <league dataPath>/derived/record-book.json — only the top slices, so
 * the file stays small enough for a page to import.
 *
 * Usage:
 *   node scripts/compute-record-book.mjs --league=afl
 *   node scripts/compute-record-book.mjs --league=theleague
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { bracketKindFromName } from '../src/utils/afl-bracket-kind.mjs';
import {
  gamesFromSchedule,
  longestStreaks,
  rivalryTotals,
  rankBy,
  officialRecord,
  MIN_LOPSIDED_MEETINGS,
} from '../src/utils/record-book.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const argOf = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const rawLeague = argOf('league', 'afl');
const SLUG = rawLeague === 'afl' ? 'afl-fantasy' : rawLeague;
const league = getLeagueBySlug(SLUG);
if (!league) {
  console.error(`Unknown --league=${rawLeague}`);
  process.exit(1);
}

const LIMIT = Number(argOf('limit', '5'));
const FEEDS = path.join(ROOT, league.dataPath, 'mfl-feeds');
const OUT = path.join(ROOT, league.dataPath, 'derived', 'record-book.json');

const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

const years = fs.existsSync(FEEDS)
  ? fs.readdirSync(FEEDS).filter((y) => /^\d{4}$/.test(y)).sort()
  : [];

const games = [];
const seasons = [];
const seasonsSeen = new Set();

for (const year of years) {
  const dir = path.join(FEEDS, year);
  const schedule = readJson(path.join(dir, 'schedule.json'));
  const leagueJson = readJson(path.join(dir, 'league.json'));
  const standings = readJson(path.join(dir, 'standings.json'));
  if (!schedule) continue;

  // Names as of THAT season. Falling back to the id keeps a missing feed from
  // rendering an empty label.
  const teams = new Map(
    toArray(leagueJson?.league?.franchises?.franchise).map((f) => [
      f.id,
      { name: String(f.name ?? f.id).trim(), icon: f.icon ?? null },
    ])
  );
  const nameOf = (id) => teams.get(id)?.name || id;

  // The AFL Cup is an in-season knockout starting as early as week 4, so it is
  // not a postseason marker — classify with the shared resolver.
  const starts = toArray(readJson(path.join(dir, 'playoff-brackets.json'))?.playoffBrackets?.playoffBracket)
    .filter((b) => bracketKindFromName(b.name, String(b.id)) !== 'cup')
    .map((b) => Number(b.startWeek))
    .filter((n) => Number.isFinite(n) && n > 0);
  const firstPlayoffWeek = starts.length ? Math.min(...starts) : Infinity;

  const seasonGames = gamesFromSchedule(schedule, {
    nameOf,
    year: Number(year),
    firstPlayoffWeek,
    toArray,
  });
  for (const g of seasonGames) {
    games.push(g);
    seasonsSeen.add(g.year);
  }

  for (const f of toArray(standings?.leagueStandings?.franchise)) {
    const { wins, losses, ties } = officialRecord(f);
    const played = wins + losses + ties;
    if (!played) continue;
    seasons.push({
      year: Number(year),
      franchiseId: f.id,
      name: nameOf(f.id),
      wins,
      losses,
      ties,
      pointsFor: Number(f?.pf) || 0,
      winPct: (wins + ties * 0.5) / played,
    });
  }
}

const rank = (rows, value, asc = false) => rankBy(rows, value, LIMIT, asc);

// Games arrive season by season, so they are already oldest-first — which
// rivalryTotals relies on to leave each slot under its most recent name.
const rivalries = rivalryTotals(games);

const book = {
  generatedAt: new Date().toISOString(),
  league: SLUG,
  totalGames: games.length,
  seasonsCovered: seasonsSeen.size,
  firstSeason: seasonsSeen.size ? Math.min(...seasonsSeen) : null,
  lastSeason: seasonsSeen.size ? Math.max(...seasonsSeen) : null,
  minLopsidedMeetings: MIN_LOPSIDED_MEETINGS,
  highestScore: rank(games, (g) => g.winnerScore),
  biggestBlowout: rank(games.filter((g) => !g.tie), (g) => g.margin),
  closestGame: rank(games.filter((g) => !g.tie), (g) => g.margin, true),
  highestCombined: rank(games, (g) => g.combined),
  longestWinStreak: longestStreaks(games, 'win', LIMIT),
  longestLosingStreak: longestStreaks(games, 'loss', LIMIT),
  mostPlayed: rank(rivalries, (r) => r.meetings),
  mostLopsided: rank(
    rivalries.filter((r) => r.meetings >= MIN_LOPSIDED_MEETINGS),
    (r) => Math.abs(r.aWins - r.bWins)
  ),
  bestSeason: rank(seasons, (s) => s.winPct),
  mostPointsSeason: rank(seasons, (s) => s.pointsFor),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(book, null, 2) + '\n');
console.log(
  `[record-book] ${SLUG}: ${book.totalGames} games across ${book.seasonsCovered} seasons ` +
    `(${book.firstSeason}-${book.lastSeason}) -> ${path.relative(ROOT, OUT)}`
);
