import { describe, it, expect } from 'vitest';
import { buildOddsInput, playoffOddsReport, seedSeason, simulateOdds } from '../src/utils/playoff-odds.mjs';
import { raceBoard, raceBoards, oddsGamesByPair, addPreviewExtras } from '../src/utils/matchup-preview-visuals.mjs';
import { buildGroupMePromo } from '../scripts/article-types/matchup-preview.mjs';

/**
 * A tiny 8-team league: two conferences (on the DIVISION, the way the AFL's
 * league export carries them), two divisions each, weeks 1-3 played, 4-5 left.
 */
function league() {
  const ids = ['01', '02', '03', '04', '05', '06', '07', '08'];
  const divOf = (id: string) => String(Math.floor((Number(id) - 1) / 2) + 1); // 01,02→1 … 07,08→4
  return {
    ids,
    league: {
      league: {
        lastRegularSeasonWeek: '5',
        conferences: { conference: [{ id: '00', name: 'American' }, { id: '01', name: 'National' }] },
        divisions: { division: ['1', '2', '3', '4'].map((d) => ({ id: d, conference: Number(d) <= 2 ? '00' : '01' })) },
        franchises: { franchise: ids.map((id) => ({ id, division: divOf(id) })) },
      },
    },
    standings: {
      leagueStandings: {
        franchise: ids.map((id, i) => ({ id, h2hwlt: i % 2 ? '1-2-0' : '2-1-0', pf: String(300 - i * 5) })),
      },
    },
    schedule: {
      schedule: {
        weeklySchedule: [1, 2, 3, 4, 5].map((wk) => ({
          week: String(wk),
          matchup: [['01', '02'], ['03', '04'], ['05', '06'], ['07', '08']].map(([a, b]) => ({
            franchise: [
              { id: a, ...(wk <= 3 ? { score: String(100 + Number(a)) } : {}) },
              { id: b, ...(wk <= 3 ? { score: String(95 + Number(b)) } : {}) },
            ],
          })),
        })),
      },
    },
  };
}

const AFL_LIKE = { groupBy: 'conference' as const, divisionPlaces: 1, wildCards: 1, byes: 0 };

describe('playoff odds engine', () => {
  it('reads a conference off the division when the franchise has none', () => {
    const l = league();
    const input = buildOddsInput({ ...l, format: AFL_LIKE });
    const conf = Object.fromEntries(input.teams.map((t: any) => [t.id, t.conference]));
    expect(conf['01']).toBe('00');
    expect(conf['08']).toBe('01');
    expect(input.completedWeek).toBe(3);
    expect(input.remaining).toHaveLength(8);
  });

  it('seeds each conference on its own: three spots per conference, eight teams', () => {
    const input = buildOddsInput({ ...league(), format: AFL_LIKE });
    const seeds = seedSeason(input.teams, input.format);
    expect(seeds.size).toBe(6);
    // Expected qualifiers sum to the spots in every simulated season.
    const odds = simulateOdds(input, { iterations: 400 });
    const total = [...odds.values()].reduce((s: number, x: any) => s + x.playoff, 0);
    expect(total).toBeCloseTo(6, 6);
  });

  it('is deterministic for a seed, so an unchanged feed writes an unchanged file', () => {
    const input = buildOddsInput({ ...league(), format: AFL_LIKE });
    const a = playoffOddsReport(input, { iterations: 500 });
    const b = playoffOddsReport(input, { iterations: 500 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("prices this week's games from the same draw: a win is never worth less than a loss", () => {
    const input = buildOddsInput({ ...league(), format: AFL_LIKE });
    const r = playoffOddsReport(input, { iterations: 2000 });
    expect(r.week).toBe(4);
    expect(r.games).toHaveLength(4);
    for (const g of r.games) {
      for (const s of [g.a, g.b]) {
        expect(s.win.playoff).toBeGreaterThanOrEqual(s.loss.playoff);
        expect(s.playoff).toBeGreaterThanOrEqual(s.loss.playoff - 1e-9);
        expect(s.playoff).toBeLessThanOrEqual(s.win.playoff + 1e-9);
      }
      expect(g.a.winChance + g.b.winChance).toBeCloseTo(1, 3);
    }
    // Ranked by swing, biggest first.
    const swings = r.games.map((g: any) => g.stakes.swing);
    expect([...swings].sort((x, y) => y - x)).toEqual(swings);
  });
});

describe('race board', () => {
  const report = () => playoffOddsReport(buildOddsInput({ ...league(), format: AFL_LIKE }), { iterations: 1000 });

  it('draws one board per conference, each with its own playoff line', () => {
    const r = report();
    const { race, raceGroups } = raceBoards(r, oddsGamesByPair(r)) as any;
    expect(race).toBeNull();
    expect(raceGroups.map((g: any) => g.label)).toEqual(['American', 'National']);
    for (const g of raceGroups) expect(g.race.spots).toBe(3);
  });

  it('gives every team in a game a loss-to-win range around today', () => {
    const r = report();
    const board = raceBoard(r, oddsGamesByPair(r), new Map(), { full: true });
    for (const t of board.teams) {
      expect(t.low).not.toBeNull();
      expect(t.low!).toBeLessThanOrEqual(t.playoff + 1e-9);
      expect(t.high!).toBeGreaterThanOrEqual(t.playoff - 1e-9);
    }
  });

  it('shows only the bubble for a league too big to list', () => {
    const teams = Array.from({ length: 99 }, (_, i) => ({
      franchiseId: String(i).padStart(4, '0'), wins: 0, losses: 0, ties: 0, pf: 0,
      playoff: i < 30 ? 1 - i / 100 : 0.2 - i / 1000, bye: 0,
    }));
    const odds = { week: 10, lastWeek: 14, format: { byes: 0 }, teams, games: [] };
    const board = raceBoard(odds, new Map());
    expect(board.teamCount).toBe(99);
    expect(board.teams.length).toBeLessThanOrEqual(20);
    expect(board.aboveCount + board.teams.length + board.outIds.length).toBe(99);
    expect(board.lineAt).toBe(board.spots - board.aboveCount);
  });
});

describe('preview extras and the chat promo', () => {
  const r = playoffOddsReport(buildOddsInput({ ...league(), format: AFL_LIKE }), { iterations: 1000 });
  const visuals = {
    week: 4,
    gameOfWeek: null,
    matchups: r.games.map((g: any) => ({
      a: { franchiseId: g.a.franchiseId, wins: 0, losses: 0, ties: 0 },
      b: { franchiseId: g.b.franchiseId, wins: 0, losses: 0, ties: 0 },
    })),
  };

  it("turns the odds file's sides to the card's order and ranks cards by stakes", () => {
    const flipped = { ...visuals, matchups: visuals.matchups.map((m: any) => ({ ...m, a: m.b, b: m.a })) };
    const out = addPreviewExtras(flipped, { weeklyResultsRaw: [], history: undefined, odds: r, gauntlet: null }) as any;
    for (const m of out.matchups) {
      expect(m.stakes.a.franchiseId).toBe(m.a.franchiseId);
      expect(m.stakes.b.franchiseId).toBe(m.b.franchiseId);
    }
    const swings = out.matchups.map((m: any) => m.stakes.swing);
    expect([...swings].sort((x, y) => y - x)).toEqual(swings);
    expect(out.moreGames).toBe(0);
  });

  it('ends the GroupMe promo on the bare article URL', () => {
    const out = addPreviewExtras(visuals, { weeklyResultsRaw: [], history: undefined, odds: r, gauntlet: null });
    const text = buildGroupMePromo({ link: '/news/matchup-preview-2026-w04' }, { visuals: out, names: {} }, { league: 'theleague' });
    expect(text).toMatch(/^🔭 Week 4 Matchup Preview: /);
    // GroupMe autolinks a trailing period into the URL and 404s it.
    expect(text).toMatch(/▸ https:\/\/\S+\/news\/matchup-preview-2026-w04$/);
  });
});
