/**
 * The roster page's live game context (src/utils/rosters/live-odds.ts).
 *
 * Phase 7 of docs/plans/rosters-page-split.md moved this out of
 * `rosters.astro`'s frontmatter, where it had no test at all — it was inside a
 * 2,200-line block that only ran as part of rendering a 10k-line page.
 *
 * Every case below is a property the page depends on, not a restatement of
 * the implementation:
 *
 * - ESPN's payload becomes one entry PER TEAM. Both clubs carry the same
 *   record with `isHome`/`opponent` flipped, because the roster row looks up
 *   a player's own club and needs the game from that club's side.
 * - Three clubs are spelled differently by ESPN than by MFL. An unmapped code
 *   is not an error — it is a team whose game silently never renders.
 * - A dome short-circuits the weather fetch. Retractable roofs count, because
 *   the question is "can weather affect this game", and the roof closes when
 *   it would.
 */
import { describe, it, expect } from 'vitest';
import {
  buildOddsMap,
  fetchLiveWeather,
  generateDemoOddsData,
  getWeatherIcon,
  normalizeEspnTeamCode,
  NFL_STADIUMS,
} from '../src/utils/rosters/live-odds';

/** One ESPN scoreboard event, trimmed to the fields buildOddsMap reads. */
const espnEvent = (over: Record<string, any> = {}) => ({
  id: 'e1',
  date: '2026-09-21T17:00:00Z',
  competitions: [
    {
      competitors: [
        { homeAway: 'home', team: { abbreviation: 'SEA' }, score: '24' },
        { homeAway: 'away', team: { abbreviation: 'SF' }, score: '17' },
      ],
      odds: [{ details: 'SEA -3.5', overUnder: 44.5 }],
      status: { type: { shortDetail: 'Final' } },
      ...over,
    },
  ],
});

describe('buildOddsMap — one entry per TEAM, not per game', () => {
  it('stores the same game for both clubs, from each one’s own side', () => {
    const map = buildOddsMap({ events: [espnEvent()] });

    expect(Object.keys(map).sort()).toEqual(['SEA', 'SF']);
    expect(map.SEA.isHome).toBe(true);
    expect(map.SEA.opponent).toBe('SF');
    expect(map.SF.isHome).toBe(false);
    expect(map.SF.opponent).toBe('SEA');
    // The game itself is identical from both sides.
    expect(map.SEA.spread).toBe('SEA -3.5');
    expect(map.SF.spread).toBe('SEA -3.5');
    expect(map.SEA.homeScore).toBe('24');
    expect(map.SF.homeScore).toBe('24');
  });

  it('translates the codes ESPN spells differently from MFL', () => {
    const map = buildOddsMap({
      events: [
        espnEvent({
          competitors: [
            { homeAway: 'home', team: { abbreviation: 'WSH' }, score: '0' },
            { homeAway: 'away', team: { abbreviation: 'JAC' }, score: '0' },
          ],
        }),
      ],
    });
    // WSH/JAC are ESPN's spellings; the roster rows key on WAS/JAX. An
    // unmapped code is not loud — that club's game just never renders.
    expect(Object.keys(map).sort()).toEqual(['JAX', 'WAS']);
    expect(normalizeEspnTeamCode('WSH')).toBe('WAS');
    expect(normalizeEspnTeamCode('JAC')).toBe('JAX');
    expect(normalizeEspnTeamCode('SEA')).toBe('SEA');
  });

  it('survives the shapes ESPN serves when a game has no odds yet', () => {
    const map = buildOddsMap({ events: [espnEvent({ odds: undefined, status: undefined })] });
    expect(map.SEA.spread).toBe('N/A');
    expect(map.SEA.overUnder).toBe('N/A');
    expect(map.SEA.status).toBe('Scheduled');
  });

  it('skips an event with no competition or a missing side, rather than throwing', () => {
    expect(buildOddsMap({ events: [{ id: 'x', competitions: [] }] })).toEqual({});
    expect(
      buildOddsMap({
        events: [espnEvent({ competitors: [{ homeAway: 'home', team: { abbreviation: 'SEA' } }] })],
      }),
    ).toEqual({});
  });

  it('returns an empty map for an empty or absent payload', () => {
    expect(buildOddsMap(null)).toEqual({});
    expect(buildOddsMap({})).toEqual({});
    expect(buildOddsMap({ events: [] })).toEqual({});
  });
});

describe('weather', () => {
  it('reports a dome without reaching the network', async () => {
    // No fetch stub here on purpose: if this ever hits the network the test
    // fails on the undefined response rather than passing slowly.
    await expect(fetchLiveWeather('MIN')).resolves.toEqual({
      temperature: 72,
      displayValue: 'Dome',
    });
    expect(NFL_STADIUMS.MIN.dome).toBe(true);
  });

  it('counts a retractable roof as a dome', () => {
    // ARI, ATL, DAL, HOU and NO all close over the field; the question this
    // answers is whether weather can affect the game.
    for (const code of ['ARI', 'ATL', 'DAL', 'HOU', 'NO']) {
      expect(NFL_STADIUMS[code].dome, `${code} plays under a roof`).toBe(true);
    }
  });

  it('has a stadium for every club an odds map can name', async () => {
    // 32 clubs, and the two MetLife pairs share coordinates.
    expect(Object.keys(NFL_STADIUMS)).toHaveLength(32);
    expect(NFL_STADIUMS.NYG).toEqual(NFL_STADIUMS.NYJ);
    expect(NFL_STADIUMS.LAR).toEqual(NFL_STADIUMS.LAC);
    await expect(fetchLiveWeather('XXX')).resolves.toBeNull();
  });

  it('maps a condition to an icon, and an unknown one to the thermometer', () => {
    expect(getWeatherIcon('Thunderstorm')).toBe('⛈️');
    expect(getWeatherIcon('Heavy Snow')).toBe('❄️');
    expect(getWeatherIcon('Rain Showers')).toBe('🌧️');
    expect(getWeatherIcon('Partly Cloudy')).toBe('⛅');
    expect(getWeatherIcon('Sunny')).toBe('☀️');
    expect(getWeatherIcon('Dome')).toBe('🌡️');
    expect(getWeatherIcon(undefined)).toBe('🌡️');
    expect(getWeatherIcon('')).toBe('🌡️');
  });
});

describe('demo mode', () => {
  it('covers all 32 clubs, each paired with a real opponent', () => {
    const demo = generateDemoOddsData();
    expect(Object.keys(demo)).toHaveLength(32);
    for (const [code, game] of Object.entries(demo)) {
      expect(game.opponent, `${code} needs an opponent`).not.toBe(code);
      // Both sides agree about the game they are in.
      expect(demo[game.opponent].id).toBe(game.id);
      expect(demo[game.opponent].isHome).toBe(!game.isHome);
    }
  });

  it('gives every club the same shape a real game has', () => {
    const demo = generateDemoOddsData();
    const real = buildOddsMap({ events: [espnEvent()] }).SEA;
    for (const game of Object.values(demo)) {
      expect(Object.keys(game).sort()).toEqual(Object.keys(real).sort());
    }
  });
});
