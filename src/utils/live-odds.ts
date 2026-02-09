/**
 * Live Odds Utilities
 *
 * Functions for fetching and processing NFL game odds and scores
 * from the ESPN API. Used in roster pages and matchup previews.
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

export interface GameOdds {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  spread: string;
  overUnder: string | number;
  homeScore: string;
  awayScore: string;
  weather: WeatherData | null;
  isHome: boolean;
  opponent: string;
}

/**
 * Normalize ESPN team abbreviations to standard format
 */
export function normalizeEspnTeamCode(espnAbbrev: string): string {
  const map: Record<string, string> = {
    WSH: 'WAS',
    JAX: 'JAX',
    JAC: 'JAX',
  };
  return map[espnAbbrev] || espnAbbrev;
}

/**
 * Build a map of team codes to game odds from ESPN data
 */
export function buildOddsMap(espnData: any): Record<string, GameOdds> {
  if (!espnData?.events?.length) return {};

  const oddsData: Record<string, GameOdds> = {};

  espnData.events.forEach((event: any) => {
    const competition = event.competitions?.[0];
    if (!competition) return;

    const homeTeam = competition.competitors?.find((team: any) => team.homeAway === 'home');
    const awayTeam = competition.competitors?.find((team: any) => team.homeAway === 'away');
    if (!homeTeam || !awayTeam) return;

    const homeCode = normalizeEspnTeamCode(homeTeam.team?.abbreviation);
    const awayCode = normalizeEspnTeamCode(awayTeam.team?.abbreviation);
    if (!homeCode || !awayCode) return;

    const odds = competition.odds?.[0] || {};
    const spread = odds.details || 'N/A';
    const overUnder = odds.overUnder || 'N/A';

    const weather: WeatherData | null = competition.weather
      ? {
          temperature: competition.weather.temperature,
          displayValue: competition.weather.displayValue,
        }
      : null;

    const status =
      competition.status?.type?.shortDetail ||
      competition.status?.type?.description ||
      'Scheduled';

    const gameRecord = {
      id: event.id,
      date: event.date,
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
  fallbackData: Record<string, GameOdds> = {}
): Promise<Record<string, GameOdds>> {
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}`);
    }

    const data = await response.json();
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
    await Promise.all(weatherPromises);

    // Cache the result
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
