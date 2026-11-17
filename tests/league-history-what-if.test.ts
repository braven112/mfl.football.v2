/**
 * Ask the History what-ifs (src/utils/league-history/what-if.mjs): the lineup
 * optimizer, the season replay, undoing a trade, and the rule that a replay
 * never presents itself as the real standings.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../data/theleague/derived/league-history-players.json';
import aflPlayers from '../data/afl-fantasy/derived/league-history-players.json';
import theleagueMoves from '../data/theleague/derived/league-history-moves.json';
import aflMoves from '../data/afl-fantasy/derived/league-history-moves.json';
import {
  REPLAY_LABEL,
  WhatIfError,
  bestLineup,
  parseStarterRules,
  replayLineups,
  runWhatIf,
  seasonPositions,
  standardBracket,
} from '../src/utils/league-history/what-if.mjs';
import { compareChart } from '../src/utils/league-history/record-charts.mjs';
import { answerCharts } from '../src/utils/league-history/ask-format.mjs';
import { askHistory } from '../src/utils/league-history/ask';

const ROOT = join(__dirname, '..');
const LEAGUES = {
  theleague: { ds: theleague as any, pds: theleaguePlayers as any, moves: theleagueMoves as any, dir: 'data/theleague' },
  'afl-fantasy': { ds: afl as any, pds: aflPlayers as any, moves: aflMoves as any, dir: 'data/afl-fantasy' },
} as const;
type Slug = keyof typeof LEAGUES;

const feedCache = new Map<string, any>();
function readFeed(slug: Slug, year: number, file: string) {
  const key = `${slug}|${year}|${file}`;
  if (!feedCache.has(key)) {
    let value = null;
    try {
      value = JSON.parse(readFileSync(join(ROOT, LEAGUES[slug].dir, 'mfl-feeds', String(year), file), 'utf8'));
    } catch {
      value = null;
    }
    feedCache.set(key, value);
  }
  return feedCache.get(key);
}
const feedsFor = (slug: Slug) => (year: number) => ({
  league: readFeed(slug, year, 'league.json'),
  brackets: readFeed(slug, year, 'playoff-brackets.json'),
  players: readFeed(slug, year, 'players.json'),
});
// Engine results are read as `any`: the .mjs is not type-checked (checkJs is off), so its inferred shapes are partial.
const whatIf = (slug: Slug, input: Record<string, unknown>): any =>
  runWhatIf(LEAGUES[slug].ds, LEAGUES[slug].pds, LEAGUES[slug].moves, input, { leagueSlug: slug, feeds: feedsFor(slug) });

const cell = (out: any, franchiseId: string, key: string) => {
  const row = out.rows.find((r: any) => r.franchiseId === franchiseId);
  return row.cells[out.columns.findIndex((c: any) => c.key === key)];
};

describe('starter rules', () => {
  it("reads a season's range rules from league.json", () => {
    const rules: any = parseStarterRules(readFeed('theleague', 2019, 'league.json'));
    expect(rules.count).toBe(9);
    expect(rules.slots).toEqual(
      expect.arrayContaining([
        { pos: 'QB', min: 1, max: 1 },
        { pos: 'RB', min: 1, max: 3 },
        { pos: 'WR', min: 1, max: 4 },
        { pos: 'TE', min: 1, max: 3 },
      ]),
    );
    expect(rules.flex).toEqual([]);
  });

  it('reads a combined flex slot (the AFL in 2003)', () => {
    const rules: any = parseStarterRules(readFeed('afl-fantasy', 2003, 'league.json'));
    expect(rules.count).toBe(8);
    expect(rules.flex).toEqual([{ positions: ['RB', 'WR', 'TE'], n: 1 }]);
  });

  it('has starter rules for every season of both leagues', () => {
    for (const slug of Object.keys(LEAGUES) as Slug[]) {
      for (const s of LEAGUES[slug].ds.seasons) expect(parseStarterRules(readFeed(slug, s.y, 'league.json')), `${slug} ${s.y}`).not.toBeNull();
    }
  });
});

describe('bestLineup', () => {
  const ranged = { count: 9, slots: [{ pos: 'QB', min: 1, max: 1 }, { pos: 'RB', min: 1, max: 3 }, { pos: 'WR', min: 1, max: 4 }, { pos: 'TE', min: 1, max: 3 }, { pos: 'PK', min: 1, max: 1 }, { pos: 'Def', min: 1, max: 1 }], flex: [] };
  const p = (id: string, pos: string, score: number) => ({ id, pos, score });

  it('fills the flex spots with the best players left, inside each position max', () => {
    const roster = [
      p('qb1', 'QB', 20), p('qb2', 'QB', 30),
      p('rb1', 'RB', 25), p('rb2', 'RB', 24), p('rb3', 'RB', 23), p('rb4', 'RB', 22),
      p('wr1', 'WR', 10), p('wr2', 'WR', 9),
      p('te1', 'TE', 2), p('te2', 'TE', 21),
      p('pk', 'PK', 5), p('def', 'Def', -2),
    ];
    const best: any = bestLineup(roster, ranged);
    // QB 30, RB max 3 (25+24+23), the 4th RB (22) cannot start, so TE 21 and both WRs fill the rest.
    expect(best.ids.sort()).toEqual(['def', 'pk', 'qb2', 'rb1', 'rb2', 'rb3', 'te2', 'wr1', 'wr2'].sort());
    expect(best.points).toBe(30 + 25 + 24 + 23 + 21 + 10 + 9 + 5 - 2);
  });

  it('starts a full lineup even when a slot can only go negative, and leaves an unfillable slot empty', () => {
    const roster = [p('qb', 'QB', 10), p('rb', 'RB', 10), p('wr1', 'WR', 10), p('wr2', 'WR', 9), p('wr3', 'WR', 8), p('wr4', 'WR', 7), p('wr5', 'WR', 6), p('pk', 'PK', 1), p('def', 'Def', -5)];
    const best: any = bestLineup(roster, ranged);
    // No TE on the roster: its slot stays empty, so 8 start, and the fifth WR never takes it.
    expect(best.ids).toHaveLength(8);
    expect(best.ids).toContain('def');
    expect(best.ids).not.toContain('wr5');
  });

  it('seats a combined RB/WR/TE flex slot', () => {
    const rules = {
      count: 9,
      slots: [{ pos: 'QB', min: 1, max: 1 }, { pos: 'RB', min: 2, max: 2 }, { pos: 'WR', min: 2, max: 2 }, { pos: 'TE', min: 1, max: 1 }, { pos: 'PK', min: 1, max: 1 }, { pos: 'Def', min: 1, max: 1 }],
      flex: [{ positions: ['RB', 'WR', 'TE'], n: 1 }],
    };
    const roster = [
      p('qb', 'QB', 10), p('rb1', 'RB', 20), p('rb2', 'RB', 19), p('rb3', 'RB', 18),
      p('wr1', 'WR', 15), p('wr2', 'WR', 14), p('wr3', 'WR', 17), p('te1', 'TE', 5), p('te2', 'TE', 4), p('pk', 'PK', 3), p('def', 'Def', 2),
    ];
    const best: any = bestLineup(roster, rules);
    // RB 2 + WR 2 + TE 1, and the one flex goes to the best of what is left: rb3 (18) over wr2 (14) and te2 (4).
    expect(best.ids.sort()).toEqual(['def', 'pk', 'qb', 'rb1', 'rb2', 'rb3', 'te1', 'wr1', 'wr3'].sort());
    expect(best.points).toBe(10 + 20 + 19 + 18 + 17 + 15 + 5 + 3 + 2);
  });

  it("matches MFL's own optimal lineup on real weeks, and never beats it", () => {
    for (const slug of Object.keys(LEAGUES) as Slug[]) {
      const { pds } = LEAGUES[slug];
      const year = slug === 'theleague' ? 2022 : 2024;
      const rules: any = parseStarterRules(readFeed(slug, year, 'league.json'));
      const positions = seasonPositions(readFeed(slug, year, 'players.json'));
      const weeks = new Map<string, any[]>();
      for (const [y, wk, f, pid, score, flags] of pds.weeks) {
        if (y !== year) continue;
        const k = `${wk}|${f}`;
        if (!weeks.has(k)) weeks.set(k, []);
        weeks.get(k)!.push({ id: pid, pos: positions.get(pid) ?? pds.players[pid]?.[1], score, optimal: (flags & 2) === 2 });
      }
      let same = 0;
      for (const roster of weeks.values()) {
        const mfl = Math.round(roster.filter((x) => x.optimal).reduce((a, x) => a + x.score, 0) * 100) / 100;
        const mine = bestLineup(roster, rules).points;
        expect(mine).toBeLessThanOrEqual(mfl + 0.01);
        if (Math.abs(mine - mfl) < 0.011) same++;
      }
      expect(same / weeks.size, `${slug} ${year}`).toBeGreaterThan(0.95);
    }
  });
});

describe('standardBracket', () => {
  it("builds TheLeague's 7-team bracket the way MFL's 2019 export has it", () => {
    const rounds: any[] = standardBracket(7, 15);
    expect(rounds.map((r) => r.week)).toEqual([15, 16, 17]);
    const pairs = rounds[0].games.map((g: any) => [g.home.seed, g.away.seed].map(Number).sort((a, b) => a - b));
    expect(pairs.sort()).toEqual([[2, 7], [3, 6], [4, 5]]);
    // The 1 seed waits for the 4-5 winner.
    const oneSeed = rounds[1].games.find((g: any) => g.home.seed === '1' || g.away.seed === '1');
    const fourFive = rounds[0].games.find((g: any) => [g.home.seed, g.away.seed].includes('4'));
    expect([oneSeed.home.winner_of_game, oneSeed.away.winner_of_game]).toContain(fourFive.game_id);
  });
});

describe('replay with the real lineups', () => {
  const realStarters = (_f: string, _wk: number, roster: any[]) => roster.filter((p) => p.started).map((p) => p.id);

  it.each(['theleague', 'afl-fantasy'] as Slug[])('gives back every real record and points total (%s)', (slug) => {
    const { ds, pds } = LEAGUES[slug];
    for (const s of ds.seasons) {
      if (!s.done || !pds.weeks.some((w: any[]) => w[0] === s.y)) continue;
      const run: any = replayLineups(ds, pds, s.y, { leagueSlug: slug, feeds: feedsFor(slug), lineup: realStarters });
      expect(run.flipped, `${slug} ${s.y}`).toEqual([]);
      for (const r of run.rows) {
        expect([r.replay.w, r.replay.l, r.replay.t, r.replay.pf], `${slug} ${s.y} ${r.f}`).toEqual([r.real.w, r.real.l, r.real.t, r.real.pf]);
        // MFL's order is kept, never re-sorted, when nothing changed (standings rule 1).
        expect(r.replay.rank, `${slug} ${s.y} ${r.f} rank`).toBe(r.real.rank);
      }
    }
  });

  it('gives back the real champion wherever the bracket can be replayed', () => {
    let reproduced = 0;
    for (const slug of Object.keys(LEAGUES) as Slug[]) {
      const { ds, pds } = LEAGUES[slug];
      for (const s of ds.seasons) {
        if (!s.done || !pds.weeks.some((w: any[]) => w[0] === s.y)) continue;
        const run: any = replayLineups(ds, pds, s.y, { leagueSlug: slug, feeds: feedsFor(slug), lineup: realStarters });
        if (run.controlCheck !== 'reproduces') continue;
        reproduced++;
        const champ = Object.entries(s.teams).find(([, t]: any) => t.r === 'C')![0];
        expect(run.playoffs.title.winner, `${slug} ${s.y}`).toBe(champ);
      }
    }
    // TheLeague 2007-2025 less 2009, 2018 (seeding the record cannot settle) and 2019 (its bracket on file does
    // not match its games); the AFL 2018-2025 (one bracket per conference). Fewer means the replay regressed.
    expect(reproduced).toBeGreaterThanOrEqual(24);
  });
});

describe('what_if best_lineup', () => {
  it("replays one team's season and leaves everyone else's scores alone", () => {
    const out = whatIf('theleague', { kind: 'best_lineup', year: 2021, team: 'Pacific Pigskins' });
    const s = out.whatIf.subjects[0];
    expect(s.team).toBe('Pacific Pigskins');
    expect(s.real.record).toBe('13-5');
    expect(Number(String(s.replay.record).split('-')[0])).toBeGreaterThanOrEqual(13);
    expect(cell(out, '0001', 'replayPf')).toBeGreaterThanOrEqual(cell(out, '0001', 'realPf'));
    // A team that never played the Pigskins keeps its record exactly.
    const untouched = out.rows.filter((r: any) => r.franchiseId !== '0001' && !out.whatIf.subjects[0].flippedGames.some((g: any) => g.opponent === r.cells[0]));
    for (const r of untouched) expect(r.cells[3]).toBe(r.cells[2]);
    expect(out.whatIf.playoffs.replayed).toBe(true);
  });

  it('says why when a season cannot be replayed', () => {
    expect(() => whatIf('afl-fantasy', { kind: 'best_lineup', year: 2003 })).toThrow(WhatIfError);
    const old = whatIf('afl-fantasy', { kind: 'best_lineup', year: 2010, team: 'Chatmaster' });
    expect(old.whatIf.playoffs).toEqual({ replayed: false, reason: expect.stringMatching(/one bracket/) });
    expect(old.columns.some((c: any) => c.key === 'replayFinish')).toBe(false);
  });
});

describe('what_if undo_trade', () => {
  it('undoes a real TheLeague trade: each side keeps what it gave, and the lineup effect is reported apart', () => {
    const out = whatIf('theleague', { kind: 'undo_trade', year: 2021, team: 'Wascawy Wabbits', partner: 'Fire Ready Aim' });
    expect(out.whatIf.scenario).toMatch(/Julio Jones/);
    expect(out.whatIf.scenario).toMatch(/D\.J\. Moore/);
    const [wabbits, fra] = out.whatIf.subjects;
    expect(wabbits.real.record).toBe('15-3');
    expect(fra.real.record).toBe('7-11');
    expect(out.whatIf.lineupOnly).toHaveLength(2);
    // Undone vs kept, both on best lineups: the trade itself moved the Wabbits' points.
    expect(wabbits.replay.pf).not.toBe(out.whatIf.lineupOnly[0].replay.pf);
    expect(out.whatIf.assumptions.join(' ')).toMatch(/keeps the players it gave up/);
    expect(out.whatIf.assumptions.join(' ')).toMatch(/picks/i);
  });

  it('undoes a real AFL trade and names the games it flips', () => {
    const out = whatIf('afl-fantasy', { kind: 'undo_trade', year: 2024, team: 'Muck Juggling Micks', partner: 'Jewpacabra' });
    const [micks, jew] = out.whatIf.subjects;
    expect(micks.real.record).toBe('9-8');
    expect(micks.replay.record).toBe('10-7');
    expect(micks.flippedGames).toEqual([expect.objectContaining({ week: 9, opponent: 'Badd Boys' })]);
    expect(jew.real.record).toBe('6-11');
    // Nothing before the trade's week changes.
    expect([...micks.flippedGames, ...jew.flippedGames].every((g: any) => g.week >= 4)).toBe(true);
  });

  it('lists the candidates when a pair traded more than once', () => {
    expect(() => whatIf('theleague', { kind: 'undo_trade', year: 2021, team: 'Wascawy Wabbits' })).toThrow(/trades match/);
  });
});

describe('a replay never claims to be the real standings', () => {
  const outs = [
    whatIf('theleague', { kind: 'best_lineup', year: 2023 }),
    whatIf('theleague', { kind: 'undo_trade', year: 2021, team: 'Wascawy Wabbits', partner: 'Fire Ready Aim' }),
    whatIf('afl-fantasy', { kind: 'best_lineup', year: 2025, team: 'Balls Deep' }),
  ];

  it.each(outs.map((o, i) => [i, o]))('labels every number as real or replay (%i)', (_i, out: any) => {
    expect(out.description.startsWith(REPLAY_LABEL)).toBe(true);
    expect(REPLAY_LABEL).toMatch(/not the real standings/);
    expect(out.whatIf.label).toBe(REPLAY_LABEL);
    for (const c of out.columns) if (!['team', 'owner'].includes(c.key)) expect(c.label).toMatch(/^(Real|Replay) /);
    // Every replay column is paired with its real one.
    const keys = out.columns.map((c: any) => c.key);
    for (const k of keys.filter((k: string) => k.startsWith('replay'))) expect(keys).toContain(k.replace('replay', 'real'));
    expect(out.chart.kind).toBe('compare');
    expect(out.chart.compare.replayLabel).toBe('Replay');
    expect(out.whatIf.assumptions.some((a: string) => /not the real standings/.test(a))).toBe(true);
  });

  it('draws real against replay with a legend and a take that say "Replay"', () => {
    const out: any = outs[1];
    const chart: any = compareChart(out.chart.compare, 400);
    expect(chart.svg).toContain('>Replay<');
    expect(chart.svg).toContain('>Real<');
    expect(chart.take.startsWith('Replay:')).toBe(true);
    const drawn: any[] = answerCharts(out.chart, '/theleague');
    expect(drawn).toHaveLength(1);
    expect(drawn[0].title).toMatch(/Real vs\. replay/);
  });
});

describe('askHistory routes what-ifs', () => {
  it('runs what_if, shows its table and chart, and hands the model the assumptions', async () => {
    const seen: any[] = [];
    const turns = [
      [{ type: 'tool_use', id: 't1', name: 'what_if', input: { kind: 'best_lineup', year: 2021, team: 'Pacific Pigskins' } }],
      [{ type: 'tool_use', id: 't2', name: 'answer', input: { answer: 'In the replay, yes.', show: 0 } }],
    ];
    let i = 0;
    const client = { messages: { create: async (body: any) => (seen.push(body), { content: turns[i++] ?? [] }) } };
    const data = {
      history: theleague,
      players: theleaguePlayers,
      moves: theleagueMoves,
      loadSeasonFeeds: async (y: number) => feedsFor('theleague')(y),
    };
    const res: any = await askHistory('theleague', data, 'what if the Pigskins had started their best lineup in 2021?', { client: client as any });
    expect(seen[0].tools.map((t: any) => t.name)).toContain('what_if');
    expect(seen[0].system[0].text).toMatch(/never the real standings/);
    const reply = JSON.parse(seen[1].messages.at(-1).content[0].content);
    expect(reply.label).toBe(REPLAY_LABEL);
    expect(reply.assumptions.length).toBeGreaterThan(0);
    expect(res.table?.description.startsWith(REPLAY_LABEL)).toBe(true);
    expect(res.table?.chart?.kind).toBe('compare');
    expect(res.steps[0]).toMatch(/not the real standings/);
  });

  it('hands a bad what-if back to the model as an error', async () => {
    const seen: any[] = [];
    const turns = [
      [{ type: 'tool_use', id: 't1', name: 'what_if', input: { kind: 'best_lineup', year: 2021, team: 'No Such Team' } }],
      [{ type: 'tool_use', id: 't2', name: 'answer', input: { answer: 'No such team.', show: -1 } }],
    ];
    let i = 0;
    const client = { messages: { create: async (body: any) => (seen.push(body), { content: turns[i++] ?? [] }) } };
    await askHistory('theleague', { history: theleague, players: theleaguePlayers, moves: theleagueMoves, loadSeasonFeeds: async (y: number) => feedsFor('theleague')(y) }, 'q', { client: client as any });
    const result = seen[1].messages.at(-1).content[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toMatch(/No 2021 team matches/);
  });
});
