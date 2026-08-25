/**
 * Guard tests for the ESPN odds fold in `src/utils/live-odds.ts`.
 *
 * That module sat fully typed and completely unimported while rosters.astro
 * carried an untyped copy of it inline; the rosters.astro split merged the two.
 * These are the tests neither copy had. The behavior worth pinning is the shape
 * handling, not the arithmetic: ESPN omits fields freely, so every bug this
 * function can have is "silently dropped a game".
 */
import { describe, it, expect } from 'vitest';
import { buildOddsMap, generateDemoOddsData } from '../src/utils/live-odds';

function espnEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    date: '2026-09-10T00:20Z',
    competitions: [
      {
        competitors: [
          { homeAway: 'home', score: '21', team: { abbreviation: 'SEA' } },
          { homeAway: 'away', score: '17', team: { abbreviation: 'WSH' } },
        ],
        odds: [{ details: 'SEA -3.5', overUnder: 44.5 }],
        status: { type: { shortDetail: 'Final', description: 'Final' } },
        ...overrides,
      },
    ],
  };
}

describe('buildOddsMap', () => {
  it('writes one entry per team, mirrored around isHome', () => {
    const map = buildOddsMap({ events: [espnEvent()] });

    expect(Object.keys(map).sort()).toEqual(['SEA', 'WAS']);
    expect(map.SEA).toMatchObject({
      isHome: true,
      opponent: 'WAS',
      homeScore: '21',
      awayScore: '17',
      spread: 'SEA -3.5',
      overUnder: 44.5,
      status: 'Final',
    });
    expect(map.WAS).toMatchObject({ isHome: false, opponent: 'SEA' });
    // Both sides describe the SAME game, so the scores do not swap.
    expect(map.WAS.homeScore).toBe('21');
  });

  it('normalizes ESPN spellings to the codes MFL uses', () => {
    // ESPN says WSH, MFL says WAS. A missed mapping means a Commanders roster
    // row silently shows no game at all.
    const map = buildOddsMap({ events: [espnEvent()] });
    expect(map.WAS).toBeDefined();
    expect(map.WSH).toBeUndefined();
  });

  it('returns an empty map for empty, missing, or null input', () => {
    expect(buildOddsMap({ events: [] })).toEqual({});
    expect(buildOddsMap({})).toEqual({});
    expect(buildOddsMap(null)).toEqual({});
    expect(buildOddsMap(undefined)).toEqual({});
  });

  it('falls back rather than throwing when ESPN omits odds or status', () => {
    const map = buildOddsMap({ events: [espnEvent({ odds: undefined, status: undefined })] });
    expect(map.SEA.spread).toBe('N/A');
    expect(map.SEA.overUnder).toBe('N/A');
    expect(map.SEA.status).toBe('Scheduled');
  });

  it('carries ESPN weather through, and leaves it null when absent', () => {
    const withWeather = buildOddsMap({
      events: [espnEvent({ weather: { temperature: 54, displayValue: 'Rain', conditionId: '12' } })],
    });
    expect(withWeather.SEA.weather).toEqual({
      temperature: 54,
      displayValue: 'Rain',
      conditionId: '12',
    });
    // null, not undefined — the backfill in loadLiveOddsData tests for falsy
    // and the template tests for presence.
    expect(buildOddsMap({ events: [espnEvent()] }).SEA.weather).toBeNull();
  });

  it('skips a competition missing a side instead of emitting a half-game', () => {
    const oneSided = espnEvent();
    oneSided.competitions[0].competitors = [
      { homeAway: 'home', score: '0', team: { abbreviation: 'SEA' } },
    ];
    expect(buildOddsMap({ events: [oneSided] })).toEqual({});
  });
});

describe('generateDemoOddsData', () => {
  it('covers all 32 teams across 16 matchups', () => {
    const map = generateDemoOddsData();
    expect(Object.keys(map)).toHaveLength(32);
    expect(Object.values(map).filter((g) => g.isHome)).toHaveLength(16);
  });

  it('pairs every team with an opponent that points back at it', () => {
    const map = generateDemoOddsData();
    for (const [code, game] of Object.entries(map)) {
      expect(map[game.opponent].opponent).toBe(code);
      expect(map[game.opponent].isHome).toBe(!game.isHome);
    }
  });

  it('leaves scores null — a demo game has not been played', () => {
    const map = generateDemoOddsData();
    expect(Object.values(map).every((g) => g.homeScore === null && g.awayScore === null)).toBe(true);
  });
});
