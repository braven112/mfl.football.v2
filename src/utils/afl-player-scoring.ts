/**
 * AFL player-scoring helpers.
 *
 * Surfaces season scoring (total points, games, average) and the week's
 * projection for the Coach-mode columns on the AFL roster page, reading the
 * AFL feeds under `data/afl-fantasy/mfl-feeds/<year>/`.
 *
 * THE PER-GAME RATE COMES FROM `weekly-results-raw.json`, NOT
 * `playerScores.json`. That is the whole point of this module. MFL's
 * `TYPE=playerScores` export is fetched with no `W=`, and MFL answers a W-less
 * request with the CURRENT WEEK ALONE
 * (`docs/claude/insights/domains/mfl-api.md`, 2026-08-10). Averaging that file
 * gives you last week's score with a season label on it — which is exactly what
 * the roster page shipped: an "Avg" column that silently meant "most recent
 * week" from week 2 onward. `weekly-results-raw.json` carries every week of the
 * season and is refreshed for the live week every 5 minutes by the roster sync,
 * so it is both complete and current for the weeks a roster held the player.
 *
 * Two AFL-specific traps make a naive sum wrong, and `processWeeklyScores`
 * (src/utils/coach-data.ts) sidesteps both by keying scores per WEEK rather
 * than accumulating them:
 *
 *   1. The AFL rosters the same NFL player in BOTH conferences — Breece Hall
 *      sat on 0001 (AL) and 0024 (NL) every week of 2025 — so every player
 *      appears at least twice per week in this feed.
 *   2. The AFL plays double-header weeks (three in 2026), where a franchise
 *      appears in two matchups and its players' scores are listed twice more.
 *
 * Summing the rows would have doubled or quadrupled every total.
 *
 * WHAT THIS IS FOR, AND WHAT IT IS NOT FOR. The numbers here are a RATE and
 * its denominator — points per game played, over the weeks a roster held the
 * player. `total` exists to be divided; it must NOT be rendered as the season
 * total. A displayed total comes from `playerScores-ytd.json` via
 * `parseYtdPlayerScores` (src/utils/stats-season.mjs), because this feed
 * cannot see a week nobody rostered him, and because the rate survives a
 * double-count that a total does not: any duplicate lands in both numerator
 * and denominator and cancels. See
 * docs/claude/insights/features/free-agent-season-points.md.
 *
 * Coverage note: `data/` feeds older than the three most recent seasons are
 * deliberately kept out of the Vercel function (scripts/lib/archived-feed-files.mjs),
 * so an archive season reads back empty here and the caller renders an em dash —
 * the same behaviour the old playerScores reader had.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asArray as ensureArray } from './mfl-normalize';
import { processWeeklyScores } from './coach-data';

interface ScoreEntry {
  id: string;
  week: string;
  score: string;
}

interface ProjectedScoresFile {
  projectedScores?: { week?: string; playerScore?: ScoreEntry | ScoreEntry[] };
}

/** Per-player week→score map, exactly as `processWeeklyScores` returns it. */
export type SeasonScores = Map<string, Record<number, number>>;

export interface PlayerSeasonScoring {
  /** Season points to date (null when no week has been scored). */
  total: number | null;
  /** Weeks with a recorded score. A bye carries no score and is not counted. */
  games: number;
  /** total / games (null when games is 0). */
  average: number | null;
  /** Most recent scored week's points. */
  lastScore: number | null;
  /** Week number `lastScore` came from. */
  lastWeek: number | null;
}

const seasonScoresCache = new Map<string, SeasonScores>();
const projectionsCache = new Map<string, Map<string, number>>();

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/**
 * Load every scored week of the given AFL season as a
 * {playerId → {week → score}} map. Cached per year.
 *
 * Returns an empty map when the feed is absent (offseason, archive seasons
 * excluded from the serverless bundle) so callers can render an em dash.
 */
export function loadAflSeasonScores(year: number): SeasonScores {
  const cacheKey = String(year);
  const hit = seasonScoresCache.get(cacheKey);
  if (hit) return hit;

  const path = resolve(
    process.cwd(),
    `data/afl-fantasy/mfl-feeds/${year}/weekly-results-raw.json`
  );
  const file = readJson<unknown>(path);
  // The second argument is the current week, which the canonical
  // implementation does not use; every scored week counts.
  const map = processWeeklyScores(file ?? [], 0);
  seasonScoresCache.set(cacheKey, map);
  return map;
}

/**
 * Load the projectedScores.json snapshot for the given AFL season as a
 * {playerId → projected points} map. Cached per year.
 */
export function loadAflProjections(year: number): Map<string, number> {
  const cacheKey = String(year);
  const hit = projectionsCache.get(cacheKey);
  if (hit) return hit;

  const path = resolve(
    process.cwd(),
    `data/afl-fantasy/mfl-feeds/${year}/projectedScores.json`
  );
  const file = readJson<ProjectedScoresFile>(path);
  const entries = ensureArray(file?.projectedScores?.playerScore);
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry?.id) continue;
    const n = parseFloat(entry.score);
    if (Number.isFinite(n) && n > 0) {
      map.set(entry.id, n);
    }
  }
  projectionsCache.set(cacheKey, map);
  return map;
}

/**
 * Season total / games / average for one player, from a pre-loaded season map.
 *
 * A scored 0.00 counts as a game played — MFL records a real zero for a player
 * who suited up and did nothing, and omits the score field entirely on a bye
 * (verified across Breece Hall's 2025: every week carries a score except NYJ's
 * week 9 bye, which carries none). Dropping zeros would flatter every average
 * by hiding the weeks an owner actually lost.
 */
export function summarizeSeasonScores(
  scoresByPlayer: SeasonScores,
  playerId: string
): PlayerSeasonScoring {
  const byWeek = scoresByPlayer.get(playerId);
  const weeks = byWeek
    ? Object.keys(byWeek)
        .map((w) => Number(w))
        .filter((w) => Number.isFinite(w))
        .sort((a, b) => a - b)
    : [];

  if (weeks.length === 0) {
    return { total: null, games: 0, average: null, lastScore: null, lastWeek: null };
  }

  let total = 0;
  for (const week of weeks) total += byWeek![week];
  const lastWeek = weeks[weeks.length - 1];

  return {
    total,
    games: weeks.length,
    average: total / weeks.length,
    lastScore: byWeek![lastWeek],
    lastWeek,
  };
}
