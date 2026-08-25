/**
 * Live Odds Utilities
 *
 * Fetches and folds NFL game odds and scores from the ESPN API, backfilling
 * weather from Open-Meteo for home stadiums ESPN leaves blank.
 *
 * This module existed, fully typed, with zero importers, while
 * `src/pages/theleague/rosters.astro` carried an untyped copy of the same
 * ~300 lines inline. The rosters.astro split (Aug 2026) merged the two: the
 * page now imports this, and the two things the page's copy had that this one
 * lacked came across with it — the bounded weather backfill and ESPN's
 * `conditionId`. Do not re-fork it.
 */

import { getCurrentLeagueYear, getCurrentSeasonYear } from './league-year';
import { fetchLiveWeather, type WeatherData } from './weather';

// Cache configuration
const LIVE_ODDS_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_VERSION = 2;

// Global cache with versioning
interface LiveOddsCache {
  data: Record<string, GameOdds> | null;
  fetchedAt: number;
  week: number | null;
  version: number;
}

// Extend globalThis for cache
declare global {
  var __liveOddsCache: LiveOddsCache | undefined;
}

const getCache = (): LiveOddsCache => {
  if (globalThis.__liveOddsCache?.version === CACHE_VERSION) {
    return globalThis.__liveOddsCache;
  }
  globalThis.__liveOddsCache = {
    data: null,
    fetchedAt: 0,
    week: null,
    version: CACHE_VERSION,
  };
  return globalThis.__liveOddsCache;
};

/** ESPN sends a `conditionId` the Open-Meteo backfill has no equivalent for. */
export interface GameWeather extends WeatherData {
  conditionId?: string;
}

export interface GameOdds {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  /** ESPN's formatted spread, e.g. `KC -3.5`, or `'N/A'` when it has no line. */
  spread: string;
  /** Number in the committed fallback file, string from ESPN and demo mode. */
  overUnder: string | number;
  /** null in demo mode — a demo game has not been played. */
  homeScore: string | null;
  awayScore: string | null;
  weather: GameWeather | null;
  /** True on the home team's entry, false on the away team's. */
  isHome: boolean;
  opponent: string;
}

/** Team code -> that team's game. Both teams in a matchup get an entry. */
export type OddsMap = Record<string, GameOdds>;

/** Only the slice of ESPN's scoreboard payload this module reads. */
interface EspnScoreboard {
  events?: Array<{
    id?: string;
    date?: string;
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: string;
        score?: string;
        team?: { abbreviation?: string };
      }>;
      odds?: Array<{ details?: string; overUnder?: string | number }>;
      weather?: { temperature?: number; displayValue?: string; conditionId?: string };
      status?: { type?: { shortDetail?: string; description?: string } };
    }>;
  }>;
}

/**
 * Normalize ESPN team abbreviations to standard format
 */
export function normalizeEspnTeamCode(espnAbbrev: string | undefined): string {
  const map: Record<string, string> = {
    WSH: 'WAS',
    JAX: 'JAX',
    JAC: 'JAX',
  };
  return (espnAbbrev && map[espnAbbrev]) || espnAbbrev || '';
}

/**
 * Build a map of team codes to game odds from ESPN data
 */
export function buildOddsMap(espnData: EspnScoreboard | null | undefined): OddsMap {
  if (!espnData?.events?.length) return {};

  const oddsData: OddsMap = {};

  espnData.events.forEach((event) => {
    const competition = event.competitions?.[0];
    if (!competition) return;

    const homeTeam = competition.competitors?.find((team) => team.homeAway === 'home');
    const awayTeam = competition.competitors?.find((team) => team.homeAway === 'away');
    if (!homeTeam || !awayTeam) return;

    const homeCode = normalizeEspnTeamCode(homeTeam.team?.abbreviation);
    const awayCode = normalizeEspnTeamCode(awayTeam.team?.abbreviation);
    if (!homeCode || !awayCode) return;

    const odds = competition.odds?.[0] || {};
    const spread = odds.details || 'N/A';
    const overUnder = odds.overUnder || 'N/A';

    const weather: GameWeather | null = competition.weather
      ? {
          temperature: competition.weather.temperature as number,
          displayValue: competition.weather.displayValue as string,
          conditionId: competition.weather.conditionId,
        }
      : null;

    const status =
      competition.status?.type?.shortDetail ||
      competition.status?.type?.description ||
      'Scheduled';

    const gameRecord = {
      id: event.id as string,
      date: event.date as string,
      homeTeam: homeCode,
      awayTeam: awayCode,
      status,
      spread,
      overUnder,
      homeScore: homeTeam.score || '0',
      awayScore: awayTeam.score || '0',
      weather,
    };

    oddsData[homeCode] = {
      ...gameRecord,
      isHome: true,
      opponent: awayCode,
    };

    oddsData[awayCode] = {
      ...gameRecord,
      isHome: false,
      opponent: homeCode,
    };
  });

  return oddsData;
}

/**
 * Load live odds data for a given week
 * Uses cache to avoid excessive API calls
 * Falls back to static data during off-season
 */
export async function loadLiveOddsData(
  week: number,
  fallbackData: OddsMap = {}
): Promise<OddsMap> {
  // Use league calendar to detect off-season
  // Off-season = Feb 14 through Labor Day (when currentLeagueYear > currentSeasonYear)
  const leagueYear = getCurrentLeagueYear();
  const seasonYear = getCurrentSeasonYear();
  const isOffSeason = leagueYear > seasonYear;

  if (isOffSeason) {
    return fallbackData;
  }

  const cache = getCache();

  // Check cache validity
  if (
    cache.data &&
    cache.week === week &&
    Date.now() - cache.fetchedAt < LIVE_ODDS_TTL_MS
  ) {
    return cache.data;
  }

  // ESPN API uses different week numbering for playoffs:
  // Regular season: seasontype=2, week=1-18
  // Playoffs: seasontype=3, week=1-4 (not 19-22)
  const isPlayoffs = week > 18;
  const seasonType = isPlayoffs ? 3 : 2;
  const espnWeek = isPlayoffs ? week - 18 : week;
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${espnWeek}&seasontype=${seasonType}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`);
    }

    const data = (await response.json()) as EspnScoreboard;
    const oddsData = buildOddsMap(data);

    // Fetch live weather for teams when ESPN doesn't provide it
    // Use home team's stadium for weather (that's where the game is played)
    const homeTeams = new Set<string>();
    for (const teamCode of Object.keys(oddsData)) {
      if (oddsData[teamCode].isHome) {
        homeTeams.add(teamCode);
      }
    }

    // Fetch weather for each home stadium in parallel
    const weatherPromises = Array.from(homeTeams).map(async (homeTeam) => {
      if (!oddsData[homeTeam].weather) {
        const weather = await fetchLiveWeather(homeTeam);
        if (weather) {
          // Apply weather to both home and away team entries
          oddsData[homeTeam].weather = weather;
          const awayTeam = oddsData[homeTeam].opponent;
          if (oddsData[awayTeam]) {
            oddsData[awayTeam].weather = weather;
          }
        }
      }
    });
    // Never let the weather backfill hold the page: whatever has landed in 6s
    // is what renders. Open-Meteo is a third party on the critical path of a
    // server-rendered roster, so this bound is load-bearing, not a nicety.
    await Promise.race([
      Promise.all(weatherPromises),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);

    // Cache even an empty map — during the playoffs most teams have no game,
    // and that is a valid answer, not a failed fetch.
    cache.data = oddsData;
    cache.fetchedAt = Date.now();
    cache.week = week;

    return oddsData;
  } catch (error) {
    console.warn('[live-odds] fetch failed', error);
    // During season, return empty object on failure (don't show stale data)
    return {};
  }
}

/**
 * Clear the live odds cache
 */
export function clearLiveOddsCache(): void {
  const cache = getCache();
  cache.data = null;
  cache.fetchedAt = 0;
  cache.week = null;
}

/**
 * `?demo=true` — 16 matchups covering all 32 teams, with random lines.
 *
 * Lives here rather than in the page so the demo payload and the real one are
 * built against the same `GameOdds` type and cannot drift in shape.
 */
export function generateDemoOddsData(): OddsMap {
  const matchups: [string, string][] = [
    ['KC', 'BUF'], ['PHI', 'DAL'], ['SF', 'SEA'], ['DET', 'GB'],
    ['BAL', 'CIN'], ['MIA', 'NYJ'], ['MIN', 'CHI'], ['HOU', 'JAX'],
    ['LAR', 'ARI'], ['DEN', 'LV'], ['PIT', 'CLE'], ['ATL', 'TB'],
    ['LAC', 'IND'], ['NO', 'CAR'], ['WAS', 'NYG'], ['TEN', 'NE'],
  ];

  const weatherOptions: GameWeather[] = [
    { temperature: 72, displayValue: 'Clear' },
    { temperature: 45, displayValue: 'Partly Cloudy' },
    { temperature: 28, displayValue: 'Snow' },
    { temperature: 62, displayValue: 'Rain' },
    { temperature: 55, displayValue: 'Overcast' },
    { temperature: 72, displayValue: 'Dome' },
    { temperature: 80, displayValue: 'Sunny' },
    { temperature: 38, displayValue: 'Windy' },
  ];

  const oddsData: OddsMap = {};

  matchups.forEach(([home, away], i) => {
    const favoredHome = Math.random() > 0.5;
    const spreadNum = (Math.floor(Math.random() * 14) + 1) + 0.5;
    const favored = favoredHome ? home : away;
    const spread = `${favored} -${spreadNum}`;
    const overUnder = String(Math.floor(Math.random() * 15) + 40 + 0.5);
    const weather = weatherOptions[i % weatherOptions.length];

    const gameRecord = {
      id: `demo-${i}`,
      date: new Date().toISOString(),
      homeTeam: home,
      awayTeam: away,
      status: 'Scheduled',
      spread,
      overUnder,
      homeScore: null,
      awayScore: null,
      weather,
    };

    oddsData[home] = { ...gameRecord, isHome: true, opponent: away };
    oddsData[away] = { ...gameRecord, isHome: false, opponent: home };
  });

  return oddsData;
}
