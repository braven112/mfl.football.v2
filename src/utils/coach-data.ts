/**
 * Coach Data Utilities
 *
 * Extracts live odds, weather, FPA (Fantasy Points Allowed), and game info
 * from ESPN + Open-Meteo APIs. Shared by the rosters page (coach mode)
 * and the lineup page.
 */

import { getCurrentLeagueYear, getCurrentSeasonYear } from './league-year';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeatherInfo {
  temperature: number;
  displayValue: string;
  conditionId?: string;
}

export interface GameOddsRecord {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  spread: string;
  overUnder: string;
  homeScore: string | null;
  awayScore: string | null;
  weather: WeatherInfo | null;
  isHome: boolean;
  opponent: string;
}

/** Per-position FPA stats: rank 1–32 and average points allowed */
export interface FPAPositionStats {
  rank: number;
  avg: string | number;
}

// ---------------------------------------------------------------------------
// Weather helpers
// ---------------------------------------------------------------------------

/** Map a weather description to an emoji icon */
export function getWeatherIcon(displayValue: string | undefined): string {
  if (!displayValue) return '🌡️';
  const c = displayValue.toLowerCase();
  if (c.includes('thunder') || c.includes('storm')) return '⛈️';
  if (c.includes('snow') || c.includes('flurr')) return '❄️';
  if (c.includes('rain') || c.includes('shower')) return '🌧️';
  if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return '🌫️';
  if (c.includes('wind')) return '💨';
  if (c.includes('overcast') || c === 'cloudy') return '☁️';
  if (c.includes('partly') || c.includes('mostly cloudy') || c.includes('intermittent')) return '⛅';
  if (c.includes('clear') || c.includes('sunny') || c.includes('fair')) return '☀️';
  return '🌡️';
}

/** NFL stadium coordinates for weather lookup */
export const NFL_STADIUMS: Record<string, { lat: number; lon: number; dome: boolean }> = {
  ARI: { lat: 33.5277, lon: -112.2626, dome: true },
  ATL: { lat: 33.7553, lon: -84.4006, dome: true },
  BAL: { lat: 39.2780, lon: -76.6227, dome: false },
  BUF: { lat: 42.7738, lon: -78.7870, dome: false },
  CAR: { lat: 35.2258, lon: -80.8528, dome: false },
  CHI: { lat: 41.8623, lon: -87.6167, dome: false },
  CIN: { lat: 39.0954, lon: -84.5160, dome: false },
  CLE: { lat: 41.5061, lon: -81.6995, dome: false },
  DAL: { lat: 32.7473, lon: -97.0945, dome: true },
  DEN: { lat: 39.7439, lon: -105.0201, dome: false },
  DET: { lat: 42.3400, lon: -83.0456, dome: true },
  GB:  { lat: 44.5013, lon: -88.0622, dome: false },
  HOU: { lat: 29.6847, lon: -95.4107, dome: true },
  IND: { lat: 39.7601, lon: -86.1639, dome: true },
  JAX: { lat: 30.3239, lon: -81.6373, dome: false },
  KC:  { lat: 39.0489, lon: -94.4839, dome: false },
  LV:  { lat: 36.0909, lon: -115.1833, dome: true },
  LAC: { lat: 33.9535, lon: -118.3392, dome: true },
  LAR: { lat: 33.9535, lon: -118.3392, dome: true },
  MIA: { lat: 25.9580, lon: -80.2389, dome: false },
  MIN: { lat: 44.9736, lon: -93.2575, dome: true },
  NE:  { lat: 42.0909, lon: -71.2643, dome: false },
  NO:  { lat: 29.9511, lon: -90.0812, dome: true },
  NYG: { lat: 40.8128, lon: -74.0742, dome: false },
  NYJ: { lat: 40.8128, lon: -74.0742, dome: false },
  PHI: { lat: 39.9008, lon: -75.1675, dome: false },
  PIT: { lat: 40.4468, lon: -80.0158, dome: false },
  SF:  { lat: 37.4033, lon: -121.9694, dome: false },
  SEA: { lat: 47.5952, lon: -122.3316, dome: false },
  TB:  { lat: 27.9759, lon: -82.5033, dome: false },
  TEN: { lat: 36.1665, lon: -86.7713, dome: false },
  WAS: { lat: 38.9076, lon: -76.8645, dome: false },
};

/** WMO weather code → description */
const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
  45: 'Fog', 48: 'Fog', 51: 'Light Rain', 53: 'Rain', 55: 'Heavy Rain',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow',
  80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Rain', 85: 'Snow Showers', 86: 'Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

/** Fetch live weather from Open-Meteo for a team's home stadium */
export async function fetchLiveWeather(teamCode: string): Promise<WeatherInfo | null> {
  const stadium = NFL_STADIUMS[teamCode];
  if (!stadium) return null;
  if (stadium.dome) return { temperature: 72, displayValue: 'Dome' };

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const data = await response.json();
    const temp = Math.round(data.current?.temperature_2m || 0);
    const weatherCode: number = data.current?.weather_code || 0;

    return {
      temperature: temp,
      displayValue: WMO_DESCRIPTIONS[weatherCode] || 'Unknown',
    };
  } catch (error) {
    console.warn(`[coach-data] Failed to fetch weather for ${teamCode}:`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// ESPN odds helpers
// ---------------------------------------------------------------------------

function normalizeEspnTeamCode(espnAbbrev: string): string {
  const map: Record<string, string> = { WSH: 'WAS', JAC: 'JAX' };
  return map[espnAbbrev] || espnAbbrev;
}

/** Parse ESPN scoreboard response into a map of team code → game odds */
export function buildOddsMap(espnData: any): Record<string, GameOddsRecord> {
  if (!espnData?.events?.length) return {};

  const oddsData: Record<string, GameOddsRecord> = {};

  espnData.events.forEach((event: any) => {
    const competition = event.competitions?.[0];
    if (!competition) return;

    const homeTeam = competition.competitors?.find((t: any) => t.homeAway === 'home');
    const awayTeam = competition.competitors?.find((t: any) => t.homeAway === 'away');
    if (!homeTeam || !awayTeam) return;

    const homeCode = normalizeEspnTeamCode(homeTeam.team?.abbreviation);
    const awayCode = normalizeEspnTeamCode(awayTeam.team?.abbreviation);
    if (!homeCode || !awayCode) return;

    const odds = competition.odds?.[0] || {};
    const spread = odds.details || 'N/A';
    const overUnder = odds.overUnder || 'N/A';

    const weather: WeatherInfo | null = competition.weather
      ? {
          temperature: competition.weather.temperature,
          displayValue: competition.weather.displayValue,
          conditionId: competition.weather.conditionId,
        }
      : null;

    const status =
      competition.status?.type?.shortDetail ||
      competition.status?.type?.description ||
      'Scheduled';

    const base = {
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

    oddsData[homeCode] = { ...base, isHome: true, opponent: awayCode };
    oddsData[awayCode] = { ...base, isHome: false, opponent: homeCode };
  });

  return oddsData;
}

// ---------------------------------------------------------------------------
// Live odds cache (server-side singleton)
// ---------------------------------------------------------------------------

const LIVE_ODDS_TTL_MS = 5 * 60 * 1000;
const CACHE_VERSION = 2;

declare global {
  // eslint-disable-next-line no-var
  var __coachOddsCache: { data: Record<string, GameOddsRecord> | null; fetchedAt: number; week: number | null; version: number } | undefined;
}

function getOddsCache() {
  if (globalThis.__coachOddsCache?.version === CACHE_VERSION) return globalThis.__coachOddsCache;
  globalThis.__coachOddsCache = { data: null, fetchedAt: 0, week: null, version: CACHE_VERSION };
  return globalThis.__coachOddsCache;
}

/**
 * Fetch live odds & weather for a given NFL week.
 * Caches for 5 minutes. During the off-season, returns `fallbackData` if provided.
 */
export async function loadLiveOdds(
  week: number,
  fallbackData?: Record<string, GameOddsRecord>,
): Promise<Record<string, GameOddsRecord>> {
  const leagueYear = getCurrentLeagueYear();
  const seasonYear = getCurrentSeasonYear();
  const isOffSeason = leagueYear > seasonYear;

  if (isOffSeason && fallbackData) return fallbackData;

  const cache = getOddsCache();
  if (cache.data && cache.week === week && Date.now() - cache.fetchedAt < LIVE_ODDS_TTL_MS) {
    return cache.data;
  }

  const isPlayoffs = week > 18;
  const seasonType = isPlayoffs ? 3 : 2;
  const espnWeek = isPlayoffs ? week - 18 : week;
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${espnWeek}&seasontype=${seasonType}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`ESPN API returned ${response.status}`);

    const data = await response.json();
    const oddsData = buildOddsMap(data);

    // Backfill weather for home stadiums that ESPN didn't cover
    const homeTeams = new Set<string>();
    for (const teamCode of Object.keys(oddsData)) {
      if (oddsData[teamCode].isHome) homeTeams.add(teamCode);
    }

    const weatherPromises = Array.from(homeTeams).map(async (homeTeam) => {
      if (!oddsData[homeTeam].weather) {
        const w = await fetchLiveWeather(homeTeam);
        if (w) {
          oddsData[homeTeam].weather = w;
          const awayTeam = oddsData[homeTeam].opponent;
          if (oddsData[awayTeam]) oddsData[awayTeam].weather = w;
        }
      }
    });
    await Promise.race([Promise.all(weatherPromises), new Promise((r) => setTimeout(r, 6000))]);

    cache.data = oddsData;
    cache.fetchedAt = Date.now();
    cache.week = week;
    return oddsData;
  } catch (error) {
    console.warn('[coach-data] live odds fetch failed', error);
    return {};
  }
}

// ---------------------------------------------------------------------------
// FPA helpers
// ---------------------------------------------------------------------------

/**
 * Look up the FPA (Fantasy Points Allowed) rank for a given opponent + position.
 * Returns { rank, avg } or null.
 */
export function getFPAStats(
  fpaData: any,
  opponentCode: string,
  position: string,
): FPAPositionStats | null {
  if (!fpaData?.fantasyPointsAllowed) return null;

  // MFL uses JAC/WSH codes, ESPN uses JAX/WAS
  const mflCode = opponentCode === 'JAX' ? 'JAC' : opponentCode === 'WAS' ? 'WSH' : opponentCode;
  const teamStats = fpaData.fantasyPointsAllowed[mflCode] || fpaData.fantasyPointsAllowed[opponentCode];
  if (!teamStats) return null;

  return teamStats[position] ?? null;
}

/**
 * Parse a spread string like "KC -3.5" into { favoredTeam, spreadAmount }.
 */
export function parseSpread(spreadStr: string | undefined): { favoredTeam: string | null; spreadAmount: string | null } {
  if (!spreadStr || spreadStr === 'N/A') return { favoredTeam: null, spreadAmount: null };
  const parts = spreadStr.split(' ');
  if (parts.length < 2) return { favoredTeam: null, spreadAmount: null };
  return {
    favoredTeam: parts[0],
    spreadAmount: parts[1].replace(/[^0-9.]/g, ''),
  };
}

// ---------------------------------------------------------------------------
// Weekly scores processing
// ---------------------------------------------------------------------------

/**
 * Process MFL weekly results raw data into a Map of playerId → { week: score }.
 * Used for recent-score trends and season averages.
 */
export function processWeeklyScores(
  rawData: any,
  _currentWeek: number,
): Map<string, Record<number, number>> {
  const scoresByPlayer = new Map<string, Record<number, number>>();

  const weeks = Array.isArray(rawData) ? rawData : rawData?.weeklyResults ? [rawData] : [];

  weeks.forEach((weekItem: any) => {
    const weekResults = weekItem.weeklyResults;
    if (!weekResults) return;

    const week = parseInt(weekResults.week, 10);
    const matchups = Array.isArray(weekResults.matchup) ? weekResults.matchup : [weekResults.matchup];

    matchups.forEach((matchup: any) => {
      if (!matchup) return;
      const franchises = Array.isArray(matchup.franchise) ? matchup.franchise : [matchup.franchise];
      franchises.forEach((franchise: any) => {
        if (!franchise) return;
        const players = Array.isArray(franchise.player) ? franchise.player : franchise.player ? [franchise.player] : [];
        players.forEach((p: any) => {
          if (!scoresByPlayer.has(p.id)) scoresByPlayer.set(p.id, {});
          const score = parseFloat(p.score);
          if (!isNaN(score)) scoresByPlayer.get(p.id)![week] = score;
        });
      });
    });
  });

  return scoresByPlayer;
}

/**
 * Compute hot-streak length for a player: consecutive most-recent weeks
 * where the player scored above their season average.
 * Returns null if streak < 3.
 */
export function computeStreak(
  weeklyScores: Record<number, number>,
  currentWeek: number,
): number | null {
  const seasonScores = Object.values(weeklyScores);
  if (seasonScores.length < 3) return null;

  const avg = seasonScores.reduce((a, b) => a + b, 0) / seasonScores.length;
  let streak = 0;

  // Walk backwards from the most recently played week
  for (let w = currentWeek - 1; w >= 1; w--) {
    const score = weeklyScores[w];
    if (score === undefined) continue; // BYE/not played — skip
    if (score > avg) {
      streak++;
    } else {
      break;
    }
  }

  return streak >= 3 ? streak : null;
}
