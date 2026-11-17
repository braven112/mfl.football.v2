/**
 * Ask the History's roster-path layer: player stints (stints.mjs), pick
 * lineage (pick-chains.mjs) and the three query units over them
 * (ask-stints.mjs). Synthetic cases pin the rules; the committed data pins
 * that every title-team starter has a path, and counts the ones the record
 * cannot explain rather than letting them be guessed.
 */
import { describe, expect, it } from 'vitest';
import theleague from '../data/theleague/derived/league-history.json';
import afl from '../data/afl-fantasy/derived/league-history.json';
import theleaguePlayers from '../data/theleague/derived/league-history-players.json';
import aflPlayers from '../data/afl-fantasy/derived/league-history-players.json';
import theleagueMoves from '../data/theleague/derived/league-history-moves.json';
import aflMoves from '../data/afl-fantasy/derived/league-history-moves.json';
import aflKeepers from '../data/afl-fantasy/derived/keeper-history.json';
import aflPickTrades from '../data/afl-fantasy/derived/pick-trades.json';
import { ENDED, HOW, buildStints, tradeIds } from '../src/utils/league-history/stints.mjs';
import { buildPickChains } from '../src/utils/league-history/pick-chains.mjs';
import { runQuery } from '../src/utils/league-history/ask-query.mjs';

const TL = { players: theleaguePlayers, moves: theleagueMoves, league: 'theleague' };
const AFL = { players: aflPlayers, moves: aflMoves, keepers: aflKeepers, pickTrades: aflPickTrades, league: 'afl-fantasy' };

const week = (year: number, w: number, franchiseId: string, pid: string, score = 10, started = true) => ({
  year,
  week: w,
  franchiseId,
  pid,
  started,
  counted: true,
  playoff: false,
  score,
});

describe('buildStints', () => {
  const moves = {
    drafts: [[2019, 'LEAGUE', 1, 2, 2, '0001', '100', '2019-05-01', 0, null]],
    trades: [[2020, '2020-10-01', 4, '0001', '0002', '100', '200']],
    drops: [[2021, '2021-11-01', 8, '0002', '100']],
  };
  const presence = [
    week(2019, 1, '0001', '100'),
    week(2019, 2, '0001', '100', 20),
    week(2020, 1, '0001', '100'),
    week(2020, 4, '0001', '100', 5), // scored for them the week he was traded
    week(2020, 5, '0002', '100', 7),
    week(2021, 1, '0002', '100', 3),
  ];
  const stints = buildStints({ presence, moves });
  const of = (f: string) => stints.filter((s: any) => s.franchiseId === f && s.pid === '100');

  it('opens on the draft, carries across the offseason, and closes on the trade', () => {
    const [s] = of('0001');
    expect(of('0001')).toHaveLength(1);
    expect(s.how).toBe(HOW.draft);
    expect(s.ref).toMatchObject({ year: 2019, round: 1, pick: 2 });
    expect(s.ended).toBe(ENDED.traded);
    expect(s.endRef).toMatchObject({ tradeId: '2020-10-01:0001-0002', to: '0002' });
    expect([...s.seasons.keys()]).toEqual([2019, 2020]);
    expect(s.seasons.get(2019)).toMatchObject({ starts: 2, points: 30, carriedOver: false });
    // The week of the trade counts for the team he left.
    expect(s.seasons.get(2020)).toMatchObject({ starts: 2, points: 15, carriedOver: true });
  });

  it('opens the receiving stint on the same trade id and ends it on the drop', () => {
    const [s] = of('0002');
    expect(s.how).toBe(HOW.trade);
    expect(s.ref.tradeId).toBe(tradeIds(moves.trades)[0]);
    expect(s.ended).toBe(ENDED.dropped);
    expect(s.end).toMatchObject({ year: 2021, date: '2021-11-01' });
    expect([...s.seasons.keys()]).toEqual([2020, 2021]);
  });

  it('says unknown, never a guess, for a player seen with no move on record', () => {
    const [s] = buildStints({ presence: [week(2010, 3, '0005', '900')], moves: {} });
    expect(s.how).toBe(HOW.unknown);
    expect(s.ended).toBe(ENDED.left);
  });

  it('marks a stint seen in the latest week still rostered', () => {
    const [s] = buildStints({ presence: [week(2026, 6, '0005', '900')], moves: {}, latest: { year: 2026, week: 6 } });
    expect(s.ended).toBe(ENDED.current);
  });

  it('splits a stint when the franchise changes hands (credit follows the owner)', () => {
    const holderOf = (y: number) => (y < 2021 ? 'own-a' : 'own-b');
    const list = buildStints({ presence: [week(2020, 1, '0007', '700'), week(2021, 1, '0007', '700')], moves: {}, holderOf });
    expect(list.map((s: any) => [s.holder, s.how, s.ended])).toEqual([
      ['own-a', HOW.unknown, ENDED.handsChanged],
      ['own-b', HOW.inherited, ENDED.left],
    ]);
    expect(list[1].seasons.get(2021).carriedOver).toBe(true);
  });

  it('orders a same-day drop and re-claim by what follows', () => {
    const same = {
      pickups: [[2017, '2017-08-30', 0, '0003', '400', 'waiver', 100]],
      drops: [[2017, '2017-08-30', 0, '0003', '400']],
    };
    const list = buildStints({ presence: [week(2017, 1, '0003', '400')], moves: same });
    const seen = list.find((s: any) => s.seasons.size);
    expect(seen.how).toBe(HOW.waiver);
  });
});

describe('AFL keeper carry-over', () => {
  const keepers = { estimated: { seasons: [2005] }, seasons: { 2021: { '0003': ['300'] }, 2022: { '0003': ['999'] } } };
  const moves = { drafts: [[2020, 'CONFERENCE00', 2, 4, 16, '0003', '300', '2020-08-20', 0, null]] };
  const presence = [week(2020, 1, '0003', '300'), week(2021, 1, '0003', '300'), week(2022, 1, '0003', '300')];
  const list = buildStints({ presence, moves, keepers });

  it('carries a kept player into the next season as the same stint', () => {
    const [first] = list;
    expect(first.how).toBe(HOW.draft);
    expect([...first.seasons.keys()]).toEqual([2020, 2021]);
    expect(first.seasons.get(2021)).toMatchObject({ carriedOver: true, keeper: true });
  });

  it('ends the stint when he is left out of the keeper set, and does not invent how he came back', () => {
    expect(list[0].ended).toBe(ENDED.notKept);
    expect(list[1].how).toBe(HOW.unknown);
    expect(list[1].seasons.get(2022).keeper).toBe(false);
  });

  it('does not use an estimated keeper set as evidence', () => {
    const est = buildStints({ presence: [week(2004, 1, '0003', '300'), week(2005, 1, '0003', '300')], moves: {}, keepers: { ...keepers, seasons: { 2005: { '0003': [] } } } });
    expect(est).toHaveLength(1);
  });
});

describe('buildPickChains', () => {
  it('follows a future pick through every trade into the draft slot it became', () => {
    const moves = {
      trades: [
        [2018, '2018-01-10', 22, '0001', '0002', 'FP_0001_2019_1', '50'],
        [2018, '2018-02-10', 22, '0002', '0003', 'FP_0001_2019_1', '60'],
        [2019, '2019-04-01', 0, '0003', '0004', 'DP_0_4', '70'],
      ],
      drafts: [
        [2019, 'LEAGUE', 1, 5, 5, '0004', '500', '2019-05-01', 0, '0003'],
        [2019, 'LEAGUE', 1, 6, 6, '0003', '501', '2019-05-01', 0, null],
      ],
    };
    const [chain] = buildPickChains(moves);
    expect(chain.original).toBe('0001');
    expect(chain.hops.map((h: any) => [h.from, h.to])).toEqual([
      ['0001', '0002'],
      ['0002', '0003'],
      ['0003', '0004'],
    ]);
    expect(chain.hops.map((h: any) => h.tradeId)).toEqual(tradeIds(moves.trades));
    expect(chain.used).toMatchObject({ by: '0004', round: 1, pick: 5, pid: '500' });
    expect(chain.confidence).toBe('exact');
  });

  it('matches a future pick by the draft comment naming its last trade', () => {
    const moves = {
      trades: [[2020, '2020-03-01', 0, '0008', '0009', 'FP_0008_2021_2', '1']],
      drafts: [
        [2021, 'LEAGUE', 2, 3, 19, '0009', '610', '2021-05-01', 0, '0008'],
        [2021, 'LEAGUE', 2, 9, 25, '0009', '611', '2021-05-01', 0, null],
      ],
    };
    const [chain] = buildPickChains(moves);
    expect(chain.used?.pid).toBe('610');
    expect(chain.confidence).toBe('exact');
  });

  it('leaves a pick unknown when its holder made more than one pick in that round, listing the candidates', () => {
    const moves = {
      trades: [[2015, '2015-03-01', 0, '0001', '0002', 'FP_0001_2016_1', '1']],
      drafts: [
        [2016, 'LEAGUE', 1, 3, 3, '0002', '700', '2016-05-01', 0, null],
        [2016, 'LEAGUE', 1, 9, 9, '0002', '701', '2016-05-01', 0, null],
      ],
    };
    const [chain] = buildPickChains(moves);
    expect(chain.status).toBe('unknown');
    expect(chain.used).toBeNull();
    expect(chain.candidates).toEqual(['700', '701']);
  });

  it("reads the AFL's traced pick file, one chain per traced pick", () => {
    const chains = buildPickChains(aflMoves, aflPickTrades);
    expect(chains).toHaveLength(aflPickTrades.picks.length);
    // Every hop maps back to a trade in the moves file.
    const ids = new Set(tradeIds(aflMoves.trades));
    for (const c of chains) for (const h of c.hops) expect(ids.has(h.tradeId)).toBe(true);
  });
});

describe('roster-path units over the committed data', () => {
  const champion = (ds: any, year: number) => Object.entries(ds.seasons.find((s: any) => s.y === year).teams).find(([, t]: any) => t.r === 'C')!;

  it.each([
    ['theleague', theleague, TL],
    ['afl-fantasy', afl, AFL],
  ])('gives every starter on the 2019 champion (%s) an acquisition path', (_slug, ds, extra) => {
    const [, team]: any = champion(ds, 2019);
    const r = runQuery(ds, { unit: 'titleRosters', years: { from: 2019, to: 2019 }, limit: 25, columns: ['team', 'player', 'acquired', 'starts'] }, extra);
    expect(r.total).toBeGreaterThan(10);
    const known = new Set(Object.values(HOW));
    for (const row of r.rows) {
      expect(row.cells[0]).toBe(team.n);
      expect(known.has(row.cells[2] as string)).toBe(true);
      expect(row.cells[3]).toBeGreaterThan(0);
    }
    // The record explains every one of them: none is unknown.
    const unknown = runQuery(ds, { unit: 'titleRosters', years: { from: 2019, to: 2019 }, where: [{ field: 'acquired', op: 'eq', value: 'unknown' }] }, extra);
    expect(unknown.total).toBe(0);
  });

  it("matches the champion's starters to its own player-season rows", () => {
    const tr = runQuery(theleague, { unit: 'titleRosters', years: { from: 2019, to: 2019 }, summarize: ['starts'] }, TL);
    const ps = runQuery(theleague, { unit: 'playerSeasons', years: { from: 2019, to: 2019 }, where: [{ field: 'champion', op: 'eq', value: true }, { field: 'starts', op: 'gt', value: 0 }], summarize: ['starts', 'playoffStarts'] }, TL);
    expect(tr.summary.starts!.sum).toBe(ps.summary.starts!.sum + ps.summary.playoffStarts!.sum);
  });

  it('names the trade that brought a title-team player, and the trades unit carries the same id', () => {
    const tr = runQuery(theleague, { unit: 'titleRosters', where: [{ field: 'acquired', op: 'eq', value: 'trade' }], columns: ['tradeId', 'tradePartner'], limit: 25 }, TL);
    expect(tr.total).toBeGreaterThan(0);
    const ids = new Set(runQuery(theleague, { unit: 'trades', columns: ['tradeId'], limit: 25 }, TL).rows.map((r) => r.cells[0]));
    expect(ids.size).toBeGreaterThan(0);
    const all = new Set(tradeIds(theleagueMoves.trades));
    for (const row of tr.rows) {
      expect(all.has(row.cells[0] as string)).toBe(true);
      expect(row.cells[1]).toBeTruthy();
    }
  });

  it("derives TheLeague's pick lineage from its trades and drafts", () => {
    const used = runQuery(theleague, { unit: 'pickChains', where: [{ field: 'status', op: 'eq', value: 'used' }], sort: [{ field: 'trades', dir: 'desc' }], columns: ['trades', 'player', 'team', 'confidence', 'afterDraft'] }, TL);
    expect(used.total).toBeGreaterThan(250);
    expect(used.rows[0].cells[0]).toBeGreaterThanOrEqual(3);
    for (const row of used.rows) {
      expect(row.cells[1]).toBeTruthy();
      expect(['exact', 'traced']).toContain(row.cells[3]);
    }
  });

  it('follows a drafted player through the trades after the draft', () => {
    const r = runQuery(afl, { unit: 'pickChains', where: [{ field: 'afterDraft', op: 'contains', value: 'traded to' }], columns: ['afterDraft', 'pointsForTeam', 'pointsAfter'], limit: 25 }, AFL);
    expect(r.total).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.cells[2] as number).toBeGreaterThanOrEqual(row.cells[1] as number);
  });

  it('keeps a stint in a years window when it overlaps it', () => {
    const r = runQuery(theleague, { unit: 'stints', years: { from: 2019, to: 2019 }, where: [{ field: 'year', op: 'lt', value: 2019 }], columns: ['year', 'lastYear'], limit: 25 }, TL);
    expect(r.total).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.cells[1] as number).toBeGreaterThanOrEqual(2019);
  });
});
