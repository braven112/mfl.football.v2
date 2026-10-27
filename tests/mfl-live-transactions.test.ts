/**
 * The MFL Football app's transactions feed (package O).
 *
 * What these pin: the app gets NAMES and worded picks, never MFL ids or pipe
 * strings; paging walks a real season once, with no row skipped or repeated
 * (a blind-bid run stamps every claim with one timestamp, which is what a
 * time-only cursor gets wrong); the filters narrow what they say; and an MFL
 * failure answers 502 instead of an empty feed that reads as "nothing
 * happened".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLeagueBySlug } from '../src/config/leagues';
import {
  buildTransactionsFeed,
  parseFeedQuery,
  pickLabel,
  readLeagueTransactions,
  transactionsResponse,
  type LeagueTransactionsSnapshot,
  type OwnerLeagueRef,
} from '../src/utils/live/mfl-live-transactions';
import { normalizeTransactions, playerIdsInRow, type TransactionRow } from '../src/utils/mfl-transactions';

const league: OwnerLeagueRef = {
  leagueId: '55555',
  leagueName: 'Outside League',
  year: 2026,
  host: 'https://www44.myfantasyleague.com',
  franchiseId: '0003',
  franchiseName: 'My Team',
};

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: over.id ?? 'r1',
  at: over.at ?? Date.parse('2026-10-20T18:30:00Z'),
  kind: over.kind ?? 'free-agent',
  rawType: over.rawType ?? 'FREE_AGENT',
  franchiseId: over.franchiseId ?? '0001',
  added: over.added ?? ['100'],
  dropped: over.dropped ?? [],
  trade: over.trade ?? null,
  amount: over.amount ?? null,
  byCommish: over.byCommish ?? false,
});

const snap = (rows: TransactionRow[]): LeagueTransactionsSnapshot => ({
  rows,
  franchises: { '0001': 'Bring The Pain', '0003': 'My Team', '0005': 'Dark Side' },
  players: {
    '100': { name: 'Breece Hall', position: 'RB', nflTeam: 'NYJ' },
    '200': { name: 'Tyler Boyd', position: 'WR', nflTeam: 'FA' },
  },
  fetchedAt: 1_000,
});

describe('the app view', () => {
  it('names players and teams, and marks my own team', () => {
    const feed = buildTransactionsFeed(
      league,
      snap([row({ franchiseId: '0003', added: ['100'], dropped: ['200', '999'] })]),
      parseFeedQuery(new URLSearchParams()),
    );
    const [tx] = feed.transactions;
    expect(tx.team).toEqual({ franchiseId: '0003', name: 'My Team', mine: true });
    expect(tx.added).toEqual([{ id: '100', name: 'Breece Hall', position: 'RB', nflTeam: 'NYJ' }]);
    // A player MFL could not name keeps his id rather than vanishing from the move.
    expect(tx.dropped.map((p) => p.name)).toEqual(['Tyler Boyd', 'Player 999']);
    expect(feed.myFranchiseId).toBe('0003');
    expect(feed.leagueName).toBe('Outside League');
  });

  it('words both sides of a trade, picks included', () => {
    const trade = row({
      kind: 'trade',
      rawType: 'TRADE',
      franchiseId: '0001',
      added: [],
      trade: {
        sides: [
          {
            franchiseId: '0001',
            players: ['100'],
            picks: [{ raw: 'FP_0005_2027_1', scope: 'future', franchiseId: '0005', year: 2027, round: 1, pick: null }],
          },
          {
            franchiseId: '0003',
            players: [],
            picks: [{ raw: 'DP_1_3', scope: 'current', franchiseId: null, year: null, round: 2, pick: 4 }],
          },
        ],
        comments: 'fleeced',
      },
    });
    const [tx] = buildTransactionsFeed(league, snap([trade]), parseFeedQuery(new URLSearchParams())).transactions;
    expect(tx.trade?.sides[0].team.name).toBe('Bring The Pain');
    expect(tx.trade?.sides[0].players[0].name).toBe('Breece Hall');
    expect(tx.trade?.sides[0].picks).toEqual(['2027 Round 1 (Dark Side)']);
    expect(tx.trade?.sides[1].team.mine).toBe(true);
    expect(tx.trade?.sides[1].picks).toEqual(['Round 2, Pick 4']);
    expect(tx.trade?.comments).toBe('fleeced');
  });

  it('labels a future pick from an unknown team without an empty bracket', () => {
    expect(
      pickLabel({ raw: 'FP_0099_2027_3', scope: 'future', franchiseId: '0099', year: 2027, round: 3, pick: null }, {}),
    ).toBe('2027 Round 3');
  });

  it('filters: adds, trades, and mine (which counts the other side of a trade)', () => {
    const rows = [
      row({ id: 'a', franchiseId: '0001' }),
      row({ id: 'b', kind: 'blind-bid', rawType: 'BBID_WAIVER', franchiseId: '0003', amount: 12 }),
      row({
        id: 'c',
        kind: 'trade',
        rawType: 'TRADE',
        added: [],
        trade: {
          sides: [
            { franchiseId: '0001', players: ['100'], picks: [] },
            { franchiseId: '0003', players: ['200'], picks: [] },
          ],
          comments: '',
        },
      }),
    ];
    const ids = (qs: string) =>
      buildTransactionsFeed(league, snap(rows), parseFeedQuery(new URLSearchParams(qs))).transactions.map((t) => t.id);
    expect(ids('')).toEqual(['a', 'b', 'c']);
    expect(ids('filter=adds')).toEqual(['a', 'b']);
    expect(ids('filter=trades')).toEqual(['c']);
    expect(ids('filter=mine')).toEqual(['b', 'c']);
    // A hand-edited filter narrows nothing rather than failing.
    expect(ids('filter=nonsense')).toEqual(['a', 'b', 'c']);
  });

  it('clamps the page size', () => {
    expect(parseFeedQuery(new URLSearchParams('limit=5000')).limit).toBe(100);
    expect(parseFeedQuery(new URLSearchParams('limit=-3')).limit).toBe(50);
    expect(parseFeedQuery(new URLSearchParams('before=junk')).before).toBeNull();
  });
});

describe('paging a real season', () => {
  // TheLeague's committed 2026 feed, through the same normalizer the route uses.
  const feed = JSON.parse(
    readFileSync(join(__dirname, '..', getLeagueBySlug('theleague')!.dataPath, 'mfl-feeds', '2026', 'transactions.json'), 'utf8'),
  );
  const rows = normalizeTransactions(feed);
  const snapshot: LeagueTransactionsSnapshot = { rows, franchises: {}, players: {}, fetchedAt: 0 };

  it('has rows sharing a timestamp, so the cursor test means something', () => {
    const times = rows.map((r) => r.at);
    expect(new Set(times).size).toBeLessThan(times.length);
  });

  it('visits every row exactly once, newest first, at any page size', () => {
    for (const limit of [1, 7, 50]) {
      const seen: string[] = [];
      let before: string | null = null;
      for (let guard = 0; guard < rows.length + 2; guard += 1) {
        const qs = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
        const page = buildTransactionsFeed(league, snapshot, parseFeedQuery(qs));
        seen.push(...page.transactions.map((t) => t.id));
        before = page.nextBefore;
        if (!before) break;
      }
      expect(seen).toEqual(rows.map((r) => r.id));
    }
  });

  it('every player id the rows touch is a bare MFL id (no pipe or comma residue)', () => {
    for (const id of rows.flatMap(playerIdsInRow)) expect(id).toMatch(/^\d+$/);
  });
});

describe('reading and failing', () => {
  it('answers 502 when MFL cannot be read, never an empty feed', async () => {
    const res = await transactionsResponse(league, 'cookie', new URLSearchParams(), async () => {
      throw new Error('MFL down');
    });
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reads with the owner cookie it was given', async () => {
    let cookieSeen = '';
    const res = await transactionsResponse(league, 'owner-cookie', new URLSearchParams(), async (_l, cookie) => {
      cookieSeen = cookie;
      return snap([row()]);
    });
    expect(res.status).toBe(200);
    expect(cookieSeen).toBe('owner-cookie');
    expect((await res.json()).transactions).toHaveLength(1);
  });

  it('with no cache, a failed MFL read propagates', async () => {
    await expect(
      readLeagueTransactions(league, 'c', {
        fetch: async () => {
          throw new Error('down');
        },
      }),
    ).rejects.toThrow('down');
  });
});
