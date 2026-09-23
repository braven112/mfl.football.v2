/**
 * The roster page's live game context: ESPN odds, and the weather at the
 * stadium each game is actually played in.
 *
 * Extracted from `src/pages/theleague/rosters.astro` frontmatter (Phase 7 of
 * docs/plans/rosters-page-split.md). Same functions, same inputs, same
 * outputs — the parity harness proves it. What changes is that they now have
 * signatures, which is how the implicit-`any` debt in this block comes out.
 *
 * Two behaviours here are load-bearing rather than incidental, and both were
 * in the original:
 *
 * - **The cache lives on `globalThis`, versioned.** A module-scope `let` would
 *   be per-module-instance, and this page is SSR — the cache exists to stop
 *   every request paying an ESPN round trip. The version key is how a shape
 *   change invalidates the old entry rather than reading a stale field off it.
 * - **A failed fetch in season returns `{}`, not the fallback file.** Stale
 *   odds on a live page are worse than none: the fallback is off-season test
 *   data, and showing last February's lines during a game would be wrong in a
 *   way an empty panel is not.
 */
import liveOddsFallbackData from '../../data/nfl/live-odds.json';
import { getCurrentLeagueYear, getCurrentSeasonYear } from '../league-year';

export interface GameWeather {
  temperature: number;
  displayValue: string;
  conditionId?: string | number;
}

/** One club's view of its game — the same record is stored for both sides. */
export interface GameOdds {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  spread: string;
  overUnder: string;
  homeScore: string | null;
  awayScore: string | null;
  weather: GameWeather | null;
  isHome: boolean;
  opponent: string;
}

/** Keyed by NFL team code, every team playing that week, both sides of each game. */
export type OddsByTeam = Record<string, GameOdds>;

interface LiveOddsCache {
  data: OddsByTeam | null;
  fetchedAt: number;
  week: number | null;
  version: number;
}

const LIVE_ODDS_TTL_MS = 5 * 60 * 1000;
/** Bump to invalidate every warm instance's cached entry after a shape change. */
const CACHE_VERSION = 2;

const globalCacheHost = globalThis as typeof globalThis & {
  __liveOddsCache?: LiveOddsCache;
};

const liveOddsCache: LiveOddsCache =
  globalCacheHost.__liveOddsCache?.version === CACHE_VERSION
    ? globalCacheHost.__liveOddsCache
    : (globalCacheHost.__liveOddsCache = {
        data: null,
        fetchedAt: 0,
        week: null,
        version: CACHE_VERSION,
      });

/** An emoji for a weather description, for the roster row's game cell. */
export const getWeatherIcon = (displayValue: string | undefined): string => {
  if (!displayValue) return '🌡️';

  const condition = displayValue.toLowerCase();

  if (condition.includes('thunder') || condition.includes('storm')) return '⛈️';
  if (condition.includes('snow') || condition.includes('flurr')) return '❄️';
  if (condition.includes('rain') || condition.includes('shower')) return '🌧️';
  if (condition.includes('fog') || condition.includes('mist') || condition.includes('haze')) return '🌫️';
  if (condition.includes('wind')) return '💨';
  if (condition.includes('overcast') || condition === 'cloudy') return '☁️';
  if (condition.includes('partly') || condition.includes('mostly cloudy') || condition.includes('intermittent')) return '⛅';
  if (condition.includes('clear') || condition.includes('sunny') || condition.includes('fair')) return '☀️';

  return '🌡️'; // Default fallback
};

/**
 * Stadium coordinates, for the weather lookup ESPN does not always supply.
 *
 * `dome` short-circuits the fetch — a retractable roof counts as one here,
 * because the question this answers is "can weather affect the game", and the
 * roof closes when it would.
 */
export const NFL_STADIUMS: Record<string, { lat: number; lon: number; dome: boolean }> = {
  ARI: { lat: 33.5277, lon: -112.2626, dome: true },  // State Farm Stadium (retractable)
  ATL: { lat: 33.7553, lon: -84.4006, dome: true },   // Mercedes-Benz Stadium
  BAL: { lat: 39.2780, lon: -76.6227, dome: false },  // M&T Bank Stadium
  BUF: { lat: 42.7738, lon: -78.7870, dome: false },  // Highmark Stadium
  CAR: { lat: 35.2258, lon: -80.8528, dome: false },  // Bank of America Stadium
  CHI: { lat: 41.8623, lon: -87.6167, dome: false },  // Soldier Field
  CIN: { lat: 39.0954, lon: -84.5160, dome: false },  // Paycor Stadium
  CLE: { lat: 41.5061, lon: -81.6995, dome: false },  // Cleveland Browns Stadium
  DAL: { lat: 32.7473, lon: -97.0945, dome: true },   // AT&T Stadium
  DEN: { lat: 39.7439, lon: -105.0201, dome: false }, // Empower Field
  DET: { lat: 42.3400, lon: -83.0456, dome: true },   // Ford Field
  GB: { lat: 44.5013, lon: -88.0622, dome: false },   // Lambeau Field
  HOU: { lat: 29.6847, lon: -95.4107, dome: true },   // NRG Stadium (retractable)
  IND: { lat: 39.7601, lon: -86.1639, dome: true },   // Lucas Oil Stadium
  JAX: { lat: 30.3239, lon: -81.6373, dome: false },  // TIAA Bank Field
  KC: { lat: 39.0489, lon: -94.4839, dome: false },   // Arrowhead Stadium
  LV: { lat: 36.0909, lon: -115.1833, dome: true },   // Allegiant Stadium
  LAC: { lat: 33.9535, lon: -118.3392, dome: true },  // SoFi Stadium
  LAR: { lat: 33.9535, lon: -118.3392, dome: true },  // SoFi Stadium
  MIA: { lat: 25.9580, lon: -80.2389, dome: false },  // Hard Rock Stadium
  MIN: { lat: 44.9736, lon: -93.2575, dome: true },   // U.S. Bank Stadium
  NE: { lat: 42.0909, lon: -71.2643, dome: false },   // Gillette Stadium
  NO: { lat: 29.9511, lon: -90.0812, dome: true },    // Caesars Superdome
  NYG: { lat: 40.8128, lon: -74.0742, dome: false },  // MetLife Stadium
  NYJ: { lat: 40.8128, lon: -74.0742, dome: false },  // MetLife Stadium
  PHI: { lat: 39.9008, lon: -75.1675, dome: false },  // Lincoln Financial Field
  PIT: { lat: 40.4468, lon: -80.0158, dome: false },  // Acrisure Stadium
  SF: { lat: 37.4033, lon: -121.9694, dome: false },  // Levi's Stadium
  SEA: { lat: 47.5952, lon: -122.3316, dome: false }, // Lumen Field
  TB: { lat: 27.9759, lon: -82.5033, dome: false },   // Raymond James Stadium
  TEN: { lat: 36.1665, lon: -86.7713, dome: false },  // Nissan Stadium
  WAS: { lat: 38.9076, lon: -76.8645, dome: false },  // FedExField
};

/** Live conditions at one club's stadium, or null if it has none to report. */
export const fetchLiveWeather = async (
  teamCode: string,
): Promise<{ temperature: number; displayValue: string } | null> => {
  const stadium = NFL_STADIUMS[teamCode];
  if (!stadium) return null;

  // Dome stadiums don't need weather
  if (stadium.dome) {
    return { temperature: 72, displayValue: 'Dome' };
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const data = await response.json();
    const temp = Math.round(data.current?.temperature_2m || 0);
    const weatherCode = data.current?.weather_code || 0;

    // Map WMO weather codes to descriptions
    const weatherDescriptions: Record<number, string> = {
      0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Cloudy',
      45: 'Fog', 48: 'Fog', 51: 'Light Rain', 53: 'Rain', 55: 'Heavy Rain',
      61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain',
      71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow',
      80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Rain', 85: 'Snow Showers', 86: 'Snow Showers',
      95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm'
    };

    return {
      temperature: temp,
      displayValue: weatherDescriptions[weatherCode] || 'Unknown'
    };
  } catch (error) {
    console.warn(`[rosters] Failed to fetch weather for ${teamCode}:`, error);
    return null;
  }
};

/** ESPN spells three clubs differently from MFL; everything else passes through. */
export const normalizeEspnTeamCode = (espnAbbrev: string): string => {
  const map: Record<string, string> = {
    WSH: 'WAS',
    JAX: 'JAX',
    JAC: 'JAX',
  };
  return map[espnAbbrev] || espnAbbrev;
};

/**
 * ESPN's scoreboard payload → one entry per TEAM, not per game.
 *
 * Both clubs get the same record with `isHome` and `opponent` flipped, because
 * every consumer here looks a player's own club up by code and needs the game
 * from that club's side.
 */
export const buildOddsMap = (espnData: any): OddsByTeam => {
  if (!espnData?.events?.length) return {};

  const oddsData: OddsByTeam = {};
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

    const weather: GameWeather | null = competition.weather
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
};

/**
 * This week's odds, cached for five minutes across requests.
 *
 * ESPN numbers the playoffs from 1 under a different `seasontype`, so weeks
 * 19-22 have to be translated rather than passed through — asking for
 * `week=19` of the regular season returns nothing at all.
 */
export const loadLiveOddsData = async (week: number): Promise<OddsByTeam> => {
  // Use league calendar to detect off-season
  // Off-season = Feb 14 through Labor Day (when currentLeagueYear > currentSeasonYear)
  // During off-season, use fallback data for testing
  // During season (regular + playoffs), fetch live ESPN data
  const leagueYear = getCurrentLeagueYear();
  const seasonYear = getCurrentSeasonYear();
  const isOffSeason = leagueYear > seasonYear;

  if (isOffSeason) {
    return liveOddsFallbackData as unknown as OddsByTeam;
  }

  if (
    liveOddsCache.data &&
    liveOddsCache.week === week &&
    Date.now() - liveOddsCache.fetchedAt < LIVE_ODDS_TTL_MS
  ) {
    return liveOddsCache.data;
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
    await Promise.race([
      Promise.all(weatherPromises),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);

    // Cache the result even if empty (valid during playoffs when only some teams play)
    liveOddsCache.data = oddsData;
    liveOddsCache.fetchedAt = Date.now();
    liveOddsCache.week = week;
    return oddsData;
  } catch (error) {
    console.warn('[rosters] live odds fetch failed', error);
    // During season, return empty object on failure (don't show stale data)
    // Only use fallback during off-season for testing
    return {};
  }
};

/** `?demo=true` — 16 invented matchups covering all 32 clubs, for coach mode. */
export const generateDemoOddsData = (): OddsByTeam => {
  // 16 matchups covering all 32 teams
  const matchups: [string, string][] = [
    ['KC', 'BUF'], ['PHI', 'DAL'], ['SF', 'SEA'], ['DET', 'GB'],
    ['BAL', 'CIN'], ['MIA', 'NYJ'], ['MIN', 'CHI'], ['HOU', 'JAX'],
    ['LAR', 'ARI'], ['DEN', 'LV'], ['PIT', 'CLE'], ['ATL', 'TB'],
    ['LAC', 'IND'], ['NO', 'CAR'], ['WAS', 'NYG'], ['TEN', 'NE'],
  ];

  const weatherOptions = [
    { temperature: 72, displayValue: 'Clear' },
    { temperature: 45, displayValue: 'Partly Cloudy' },
    { temperature: 28, displayValue: 'Snow' },
    { temperature: 62, displayValue: 'Rain' },
    { temperature: 55, displayValue: 'Overcast' },
    { temperature: 72, displayValue: 'Dome' },
    { temperature: 80, displayValue: 'Sunny' },
    { temperature: 38, displayValue: 'Windy' },
  ];

  const oddsData: OddsByTeam = {};

  matchups.forEach(([home, away], i) => {
    const favoredHome = Math.random() > 0.5;
    const spreadNum = (Math.floor(Math.random() * 14) + 1) + 0.5;
    const favored = favoredHome ? home : away;
    const spread = `${favored} -${spreadNum}`;
    const overUnder = String(Math.floor(Math.random() * 15) + 40 + 0.5);
    const weather = weatherOptions[i % weatherOptions.length];

    oddsData[home] = {
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
      isHome: true,
      opponent: away,
    };

    oddsData[away] = {
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
      isHome: false,
      opponent: home,
    };
  });

  return oddsData;
};
