/**
 * NFL matchup helper — used by AFL roster page (and reusable by anything
 * else that wants to surface "this week's NFL opponent" data alongside
 * fantasy players.
 *
 * Two pieces of data feed the Coach-mode columns:
 *
 *   1. ESPN scoreboard for the current NFL week — gives each NFL team's
 *      opponent for the week + home/away.
 *
 *   2. fantasyPointsAllowed.json (committed under data/theleague/mfl-feeds/
 *      because the data is NFL-wide, not league-specific) — gives each NFL
 *      team's defensive rank by position so we can color the OPP # pill.
 *
 * Both are cached in-process for 5 minutes so multiple page renders during
 * a single dev session (or repeated SSR hits) don't hammer ESPN.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface NflMatchup {
  /** Opponent NFL team code (e.g. "BUF") */
  opponent: string;
  /** True when the player's NFL team is hosting */
  isHome: boolean;
}

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

const ODDS_TTL_MS = 5 * 60 * 1000;
type OddsMap = Record<string, NflMatchup>;
const oddsCache = new Map<string, { data: OddsMap; fetchedAt: number }>();
const fpaCache = new Map<number, FpaData | null>();

/** ESPN sometimes uses a different code than MFL/our NFL logos. */
function normalizeNflCode(code: string): string {
  if (!code) return '';
  const map: Record<string, string> = {
    JAC: 'JAX',
    WAS: 'WSH',
  };
  const upper = code.toUpperCase();
  return map[upper] ?? upper;
}

/**
 * Fetch the ESPN scoreboard for a given week and build a {teamCode → matchup}
 * map. Returns an empty map if the fetch fails (offseason, network blip,
 * timeout) so callers can render "BYE" rather than crash.
 */
export async function fetchNflMatchups(
  week: number,
  options: { signal?: AbortSignal; year?: number } = {}
): Promise<OddsMap> {
  const cacheKey = `${options.year ?? new Date().getFullYear()}-${week}`;
  const cached = oddsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ODDS_TTL_MS) {
    return cached.data;
  }

  // ESPN: regular season = seasontype 2 (weeks 1-18), playoffs = seasontype 3 (weeks 1-4)
  const isPlayoffs = week > 18;
  const seasonType = isPlayoffs ? 3 : 2;
  const espnWeek = isPlayoffs ? week - 18 : week;
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${espnWeek}&seasontype=${seasonType}`;

  try {
    const res = await fetch(url, {
      signal: options.signal ?? AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[nfl-matchups] ESPN returned ${res.status} for week ${week}`);
      oddsCache.set(cacheKey, { data: {}, fetchedAt: Date.now() });
      return {};
    }
    const data = await res.json();
    const map: OddsMap = {};
    for (const event of data?.events ?? []) {
      const competition = event?.competitions?.[0];
      if (!competition) continue;
      const home = competition.competitors?.find((t: any) => t.homeAway === 'home');
      const away = competition.competitors?.find((t: any) => t.homeAway === 'away');
      if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;
      const homeCode = normalizeNflCode(home.team.abbreviation);
      const awayCode = normalizeNflCode(away.team.abbreviation);
      map[homeCode] = { opponent: awayCode, isHome: true };
      map[awayCode] = { opponent: homeCode, isHome: false };
    }
    oddsCache.set(cacheKey, { data: map, fetchedAt: Date.now() });
    return map;
  } catch (err) {
    console.warn('[nfl-matchups] ESPN fetch failed:', err);
    oddsCache.set(cacheKey, { data: {}, fetchedAt: Date.now() });
    return {};
  }
}

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
