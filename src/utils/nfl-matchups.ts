/**
 * NFL defense-vs-position helper (the Opp # pill) for the AFL roster page.
 *
 * `fantasyPointsAllowed.json` (committed under data/theleague/mfl-feeds/
 * because the data is NFL-wide, not league-specific) gives each NFL team's
 * defensive rank by position, which colours the OPP # pill.
 *
 * This file used to fetch the week's ESPN scoreboard too (`fetchNflMatchups`)
 * — a separate copy of the odds code whose weather was never backfilled, so
 * the AFL showed none. Odds and weather now come from the one system every
 * league uses, `loadLiveOdds` in coach-data.ts; `tests/nfl-odds-weather-guard.test.ts`
 * keeps a copy from coming back here.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PositionFpa {
  rank: number; // 1 (worst defense) to 32 (best defense)
  avg: number;
}

export interface FpaData {
  /** Map of NFL team code to per-position FPA stats */
  byTeam: Record<string, Record<string, PositionFpa>>;
  /** Number of completed weeks the FPA was computed across */
  completedWeeks?: number;
}

const fpaCache = new Map<number, FpaData | null>();

/**
 * Load FPA data for a season from the committed JSON file. Cached per year
 * so we only hit disk once. Returns null when the file doesn't exist (early
 * in a season, missing snapshot).
 */
export function loadFantasyPointsAllowed(year: number): FpaData | null {
  if (fpaCache.has(year)) return fpaCache.get(year) ?? null;

  const path = resolve(
    process.cwd(),
    `data/theleague/mfl-feeds/${year}/fantasyPointsAllowed.json`
  );
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    const result: FpaData = {
      byTeam: parsed.fantasyPointsAllowed ?? {},
      completedWeeks: parsed.completedWeeks,
    };
    fpaCache.set(year, result);
    return result;
  } catch {
    fpaCache.set(year, null);
    return null;
  }
}

/**
 * Reverse mapping for FPA lookup: ESPN-style codes ↔ MFL-style codes.
 * The committed FPA file uses MFL codes (JAC, WAS); ESPN scoreboard
 * returns ESPN codes (JAX, WSH). Try both at lookup time.
 */
const FPA_LOOKUP_FALLBACKS: Record<string, string> = {
  JAX: 'JAC',
  WSH: 'WAS',
  JAC: 'JAX',
  WAS: 'WSH',
};

/**
 * Look up the FPA stats for a given (opponent team, player position) pair.
 * Returns null when either the team or the position isn't in the data.
 * Defenses (DEF/Def) and kickers (PK) typically don't have FPA — caller
 * decides whether to show "—".
 */
export function getOpponentFpa(
  fpa: FpaData | null,
  opponentCode: string,
  position: string
): PositionFpa | null {
  if (!fpa || !opponentCode) return null;
  const upper = opponentCode.toUpperCase();
  const teamStats =
    fpa.byTeam[upper] ??
    fpa.byTeam[FPA_LOOKUP_FALLBACKS[upper] ?? ''];
  if (!teamStats) return null;
  return teamStats[position] ?? null;
}

/**
 * Bucket an FPA rank into one of four tiers for color coding.
 *   tier 4 = ranks 25-32 (worst defense → green / good matchup)
 *   tier 3 = ranks 17-24
 *   tier 2 = ranks  9-16
 *   tier 1 = ranks  1- 8 (best defense → red / tough matchup)
 */
export function fpaTier(rank: number): 1 | 2 | 3 | 4 {
  if (rank >= 25) return 4;
  if (rank >= 17) return 3;
  if (rank >= 9) return 2;
  return 1;
}
