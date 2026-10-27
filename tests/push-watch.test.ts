/**
 * The one-minute MFL checker (src/utils/push-watch.ts): what counts as news,
 * who hears it, and that a league's first run only records.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransactionRow } from '../src/utils/mfl-transactions';

const store = new Map<string, unknown>();
const hashes = new Map<string, Record<string, string>>();
const sets = new Map<string, Set<string>>();

vi.mock('../src/utils/redis-client', () => ({
  getRedis: async () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown) => {
      store.set(k, v);
      return 'OK';
    },
    hgetall: async (k: string) => hashes.get(k) ?? null,
    sadd: async (k: string, ...m: string[]) => {
      const s = sets.get(k) ?? new Set();
      m.forEach((x) => s.add(x));
      sets.set(k, s);
      return m.length;
    },
    srem: async (k: string, ...m: string[]) => {
      m.forEach((x) => sets.get(k)?.delete(x));
      return m.length;
    },
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
  }),
}));

const notified: any[] = [];
vi.mock('../src/utils/push-events', () => ({
  notifyLeagueEvent: async (e: unknown) => {
    notified.push(e);
    return 1;
  },
}));
vi.mock('../src/utils/push-credentials', () => ({
  readCredential: async (account: string) => (account.startsWith('dead') ? null : `cookie-${account}`),
}));

const tx = { rows: [] as TransactionRow[], franchises: { '0001': 'Pigskins', '0002': 'Hawks' }, players: { p1: { name: 'Ja Chase' } } };
vi.mock('../src/utils/live/mfl-live-transactions', () => ({
  readLeagueTransactions: async () => ({ ...tx, fetchedAt: 0 }),
}));
const chat = { messages: [] as any[] };
vi.mock('../src/utils/mfl-chat', () => ({
  readMflChat: async () => ({ ok: true, messages: chat.messages }),
}));
const pending: Record<string, any[]> = {};
vi.mock('../src/utils/mfl-trade-ops', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchPendingTradeRows: async (o: { franchiseId: string }) => ({ trades: pending[o.franchiseId] ?? [] }),
}));
const rooms: Record<string, any> = {};
vi.mock('../src/utils/live/mfl-live-draft', () => ({
  readMflLiveDraft: async (league: { franchiseId: string }) => rooms[league.franchiseId] ?? null,
}));

import {
  newRows,
  waiverEvents,
  acceptedEvents,
  chatEvents,
  splitOffers,
  mergeOutgoing,
  draftDue,
  checkLeague,
  watchLeagues,
  watchStateKey,
  WATCH_LEAGUES_KEY,
} from '../src/utils/push-watch';
import { leagueIndexKey } from '../src/utils/push-expo';

const NOW = Date.UTC(2026, 9, 27, 18);
const LEAGUE = '54321';

function row(id: string, over: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id, at: NOW - 60_000, kind: 'waiver', rawType: 'WAIVER', franchiseId: '0001',
    added: ['p1'], dropped: [], trade: null, amount: null, byCommish: false, ...over,
  };
}

beforeEach(() => {
  store.clear();
  hashes.clear();
  sets.clear();
  notified.length = 0;
  tx.rows = [];
  chat.messages = [];
  for (const k of Object.keys(pending)) delete pending[k];
  for (const k of Object.keys(rooms)) delete rooms[k];
});

describe('detection', () => {
  it('treats only unseen, recent rows as news', () => {
    const rows = [row('a'), row('b'), row('old', { at: NOW - 2 * 24 * 3600_000 })];
    expect(newRows(rows, ['a'], NOW).map((r) => r.id)).toEqual(['b']);
  });

  it('groups waiver wins per team and ignores free-agent pickups', () => {
    const events = waiverEvents(LEAGUE, [row('a'), row('b', { added: ['p2'] }), row('c', { kind: 'free-agent' })], (id) => id);
    expect(events).toEqual([{ kind: 'waiver-result', leagueId: LEAGUE, key: '0001:a', franchiseId: '0001', added: ['p1', 'p2'] }]);
  });

  it('credits an acceptance only to the side that proposed it', () => {
    const trade = row('t', {
      kind: 'trade',
      trade: { sides: [{ franchiseId: '0001', players: [], picks: [] }, { franchiseId: '0002', players: [], picks: [] }], comments: '' },
    });
    const out = { '0002': { x: { to: '0001', seenAt: NOW } } };
    expect(acceptedEvents(LEAGUE, [trade], out, (f) => `T${f}`)).toEqual([
      { kind: 'trade-accepted', leagueId: LEAGUE, key: 't', toFranchiseId: '0002', fromName: 'T0001' },
    ]);
    expect(acceptedEvents(LEAGUE, [trade], {}, (f) => f)).toEqual([]);
  });

  it('never broadcasts a private chat message', () => {
    const msgs = [
      { id: 'm1', franchiseId: '0001', text: 'hi', postedLabel: '', postedAt: null },
      { id: 'm2', franchiseId: '0002', text: 'psst', postedLabel: '', postedAt: null, toFranchiseId: '0001' },
    ];
    expect(chatEvents(LEAGUE, msgs, [], ['0001', '0002'], (f) => f, NOW).map((e: any) => e.key)).toEqual(['m1']);
  });

  it('splits an owner-view pendingTrades into offers in and out', () => {
    const names = new Map([['pigskins', '0001'], ['hawks', '0002']]);
    const rows = [
      { trade_id: '7', offeredto: '0002' },
      { trade_id: '8', offeredto: '0001', description: 'Hawks proposed a trade to Pigskins' },
    ];
    expect(splitOffers(rows, '0001', names)).toEqual({
      incoming: [{ id: '8', from: '0002' }],
      outgoing: [{ id: '7', to: '0002' }],
    });
  });

  it('remembers a vanished offer for a day', () => {
    const kept = mergeOutgoing({ old: { to: '0002', seenAt: NOW - 3600_000 }, stale: { to: '0003', seenAt: NOW - 2 * 86400_000 } }, [], NOW);
    expect(Object.keys(kept)).toEqual(['old']);
  });

  it('looks at a quiet draft every half hour, a live one every run', () => {
    expect(draftDue({}, NOW)).toBe(true);
    expect(draftDue({ '': { status: 'live', overall: 3, checkedAt: NOW } }, NOW)).toBe(true);
    expect(draftDue({ '': { status: 'complete', overall: null, checkedAt: NOW - 60_000 } }, NOW)).toBe(false);
  });
});

describe('checkLeague', () => {
  async function register() {
    await watchLeagues([{ leagueId: LEAGUE, leagueName: 'Outside', year: 2026, host: null }]);
    hashes.set(leagueIndexKey(LEAGUE), { '0001:acctA': 'acctA', '0002:acctB': 'acctB' });
  }

  it('records on first sight and alerts nothing', async () => {
    await register();
    tx.rows = [row('a')];
    chat.messages = [{ id: 'm1', franchiseId: '0001', text: 'hi', postedLabel: '', postedAt: null }];
    const r = await checkLeague(LEAGUE, NOW);
    expect(r).toMatchObject({ seeded: true, sent: 0 });
    expect(notified).toEqual([]);
    expect(store.get(watchStateKey(LEAGUE))).toMatchObject({ tx: ['a'], chat: ['m1'] });
  });

  it('alerts what appears after that, offers included in a league this site does not run', async () => {
    await register();
    await checkLeague(LEAGUE, NOW);
    tx.rows = [row('w1', { franchiseId: '0002' })];
    chat.messages = [{ id: 'm2', franchiseId: '0001', text: 'yo', postedLabel: '', postedAt: null }];
    pending['0002'] = [{ trade_id: '9', offeredto: '0002', description: 'Pigskins proposed a trade to Hawks' }];
    await checkLeague(LEAGUE, NOW + 60_000);
    expect(notified.map((e) => e.kind).sort()).toEqual(['chat', 'trade-offer', 'waiver-result']);
    expect(notified.find((e) => e.kind === 'trade-offer')).toMatchObject({ toFranchiseId: '0002', fromFranchiseId: '0001', fromName: 'Pigskins' });
  });

  it('tells each conference board its own on-the-clock alert', async () => {
    await register();
    rooms['0001'] = { ok: true, unit: 'CONFERENCE00', status: 'live', onClock: { overall: 5, franchiseId: '0001' }, slots: [{ overall: 5, round: 1, pick: 5 }] };
    rooms['0002'] = { ok: true, unit: 'CONFERENCE01', status: 'live', onClock: { overall: 5, franchiseId: '0002' }, slots: [{ overall: 5, round: 1, pick: 5 }] };
    await checkLeague(LEAGUE, NOW);
    rooms['0001'].onClock = { overall: 6, franchiseId: '0001' };
    rooms['0001'].slots = [{ overall: 6, round: 1, pick: 6 }];
    rooms['0002'].onClock = { overall: 6, franchiseId: '0002' };
    rooms['0002'].slots = [{ overall: 6, round: 1, pick: 6 }];
    await checkLeague(LEAGUE, NOW + 60_000);
    expect(notified.filter((e) => e.kind === 'draft-on-clock').map((e) => [e.unit, e.franchiseId])).toEqual([
      ['CONFERENCE00', '0001'],
      ['CONFERENCE01', '0002'],
    ]);
  });

  it('drops a league nobody can be read for', async () => {
    await watchLeagues([{ leagueId: LEAGUE, leagueName: 'Outside', year: 2026, host: null }]);
    hashes.set(leagueIndexKey(LEAGUE), { '0001:deadA': 'deadA' });
    expect(await checkLeague(LEAGUE, NOW)).toMatchObject({ skipped: 'no-phones' });
    expect([...(sets.get(WATCH_LEAGUES_KEY) ?? [])]).toEqual([]);
  });
});
