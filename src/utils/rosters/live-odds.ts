/**
 * The roster pages' live game context: a week's odds and stadium weather.
 *
 * NOT a second implementation. Every league reads odds and weather through
 * ONE system, `loadLiveOdds` in `src/utils/coach-data.ts` (see the note
 * there); this module is the roster pages' door into it, so TheLeague's and
 * the AFL's roster pages make the exact same call. Until Sept 2026 it held a
 * copy of that code, and the AFL roster page used a third copy that never
 * backfilled weather. `tests/nfl-odds-weather-guard.test.ts` keeps it a door.
 *
 * What it adds is the roster pages' off-season rule: between the league
 * rollover and Labor Day there is no live slate, so the rows show the
 * committed `live-odds.json` snapshot (coach mode's test data). In season a
 * failed fetch shows nothing rather than that snapshot — stale lines on a live
 * page are worse than none.
 */
import liveOddsFallbackData from '../../data/nfl/live-odds.json';
import {
  loadLiveOdds,
  type GameOddsRecord,
  type WeatherInfo,
} from '../coach-data';

export {
  buildOddsMap,
  fetchLiveWeather,
  getWeatherIcon,
  normalizeEspnTeamCode,
  NFL_STADIUMS,
  oddsForTeam,
} from '../coach-data';

export type GameWeather = WeatherInfo;
/** One club's view of its game — the same record is stored for both sides. */
export type GameOdds = GameOddsRecord;
/** Keyed by NFL team code, every team playing that week, both sides of each game. */
export type OddsByTeam = Record<string, GameOdds>;

/** This week's odds and weather for a roster page, cached across requests. */
export const loadLiveOddsData = (week: number): Promise<OddsByTeam> =>
  loadLiveOdds(week, liveOddsFallbackData as unknown as OddsByTeam);

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
      broadcast: '',
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
      broadcast: '',
      isHome: false,
      opponent: home,
    };
  });

  return oddsData;
};
