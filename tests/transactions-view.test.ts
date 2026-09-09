/**
 * Guards for the transactions filter/group layer.
 *
 * The theme: every one of these filters arrives as a URL param, so the tests
 * care as much about what a BAD value does as a good one — a hand-edited query
 * string should narrow nothing, never 500.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFilters,
  applyFilters,
  groupByDay,
  filterHref,
  isDefaultView,
  weekOf,
  DEFAULT_KINDS,
  ALL_KINDS,
} from '../src/utils/transactions-view';
import type { TransactionRow, TransactionKind } from '../src/utils/mfl-transactions';

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: over.id ?? 'r1',
  at: over.at ?? Date.parse('2026-09-07T18:30:00Z'),
  kind: over.kind ?? 'free-agent',
  rawType: over.rawType ?? 'FREE_AGENT',
  franchiseId: over.franchiseId ?? '0001',
  added: over.added ?? ['100'],
  dropped: over.dropped ?? [],
  trade: over.trade ?? null,
  amount: over.amount ?? null,
  byCommish: over.byCommish ?? false,
});

const names: Record<string, string> = { '100': 'Jalen McMillan', '200': 'Tyler Boyd', '300': 'Breece Hall' };
const nameOf = (id: string) => names[id];
const filters = (qs: string, myFranchiseId: string | null = null, year = 2026) =>
  parseFilters({ params: new URLSearchParams(qs), year, myFranchiseId });

describe('default view', () => {
  it('shows signings and hides trades until asked', () => {
    expect([...filters('').kinds].sort()).toEqual([...DEFAULT_KINDS].sort());
    expect(filters('').kinds.has('trade')).toBe(false);
  });

  it('turns trades on when requested', () => {
    expect(filters('types=trade').kinds.has('trade')).toBe(true);
  });

  it('ignores unknown kinds rather than emptying the ledger', () => {
    // `?types=nonsense` would otherwise yield an empty kind set and a blank page.
    expect([...filters('types=nonsense').kinds].sort()).toEqual([...DEFAULT_KINDS].sort());
  });

  it('keeps the valid half of a partly bogus list', () => {
    expect([...filters('types=trade,nonsense').kinds]).toEqual(['trade']);
  });

  it('recognises the untouched view', () => {
    expect(isDefaultView(filters(''))).toBe(true);
    expect(isDefaultView(filters('team=0007'))).toBe(false);
    expect(isDefaultView(filters('types=trade'))).toBe(false);
  });
});

describe('the mine filter', () => {
  it('resolves to the signed-in owner’s franchise', () => {
    expect(filters('mine=1', '0007')).toMatchObject({ mine: true, team: '0007' });
  });

  it('is inert when nobody is signed in', () => {
    // A logged-out visitor hitting a shared ?mine=1 link must see the league,
    // not an empty page filtered by a franchise that was never resolved.
    expect(filters('mine=1', null)).toMatchObject({ mine: false, team: null });
  });

  it('wins over an explicit team param', () => {
    expect(filters('mine=1&team=0002', '0007').team).toBe('0007');
  });
});

describe('bad params degrade rather than throw', () => {
  it.each([
    ['week=0', 'week'],
    ['week=99', 'week'],
    ['week=abc', 'week'],
    ['from=nonsense', 'from'],
    ['to=2026-13-45x', 'to'],
  ])('%s leaves %s unset', (qs, key) => {
    expect(filters(qs)[key as 'week' | 'from' | 'to']).toBeNull();
  });

  it('accepts a real date range', () => {
    const f = filters('from=2026-09-01&to=2026-09-07');
    expect(f.from).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
    // `to` is inclusive of the whole day, or a same-day range matches nothing.
    expect(f.to).toBe(Date.parse('2026-09-07T23:59:59.999Z'));
  });
});

describe('applying filters', () => {
  const rows = [
    row({ id: 'a', franchiseId: '0001', added: ['100'], kind: 'free-agent' }),
    row({ id: 'b', franchiseId: '0002', added: ['200'], kind: 'blind-bid' }),
    row({
      id: 'c',
      franchiseId: '0003',
      kind: 'trade',
      added: [],
      trade: {
        sides: [
          { franchiseId: '0003', players: ['300'], picks: [] },
          { franchiseId: '0009', players: [], picks: [] },
        ],
        comments: '',
      },
    }),
  ];
  const run = (qs: string, myFranchiseId: string | null = null) =>
    applyFilters({ rows, filters: filters(qs, myFranchiseId), nameOf }).map((r) => r.id);

  it('filters by team', () => {
    expect(run('team=0002')).toEqual(['b']);
  });

  it('matches a trade on EITHER side, not just the initiator', () => {
    // franchise2 never appears in `franchiseId`; filtering on it must still hit.
    expect(run('team=0009&types=trade')).toEqual(['c']);
  });

  it('searches player names case-insensitively', () => {
    expect(run('q=mcmillan')).toEqual(['a']);
    expect(run('q=MCMILLAN')).toEqual(['a']);
  });

  it('searches players inside a trade', () => {
    expect(run('q=breece&types=trade')).toEqual(['c']);
  });

  it('returns nothing for a search that matches nobody', () => {
    expect(run('q=zzzz')).toEqual([]);
  });

  it('filters by date range', () => {
    expect(run('from=2026-09-07&to=2026-09-07')).toEqual(['a', 'b']);
    expect(run('from=2026-09-08')).toEqual([]);
  });

  it('excludes a kind that is filtered out', () => {
    expect(run('types=blind-bid')).toEqual(['b']);
  });
});

describe('week bucketing', () => {
  it('places an in-season move in its NFL week', () => {
    // 2026 week 1 kicks off Sep 10; Sep 14 is still week 1.
    expect(weekOf(row({ at: Date.parse('2026-09-14T18:00:00Z') }), 2026)).toBe(1);
    expect(weekOf(row({ at: Date.parse('2026-09-20T18:00:00Z') }), 2026)).toBe(2);
  });

  it('returns null for an offseason move', () => {
    expect(weekOf(row({ at: Date.parse('2026-06-01T18:00:00Z') }), 2026)).toBeNull();
  });
});

describe('day grouping', () => {
  it('groups by the viewer’s day, not UTC’s', () => {
    // 02:30 UTC Mon 14 Sep 2026 is 19:30 Sun 13 Sep in Los Angeles. A
    // Sunday-evening waiver claim grouped under Monday sits on the wrong side
    // of the week for the person reading it.
    const late = row({ id: 'sun', at: Date.parse('2026-09-14T02:30:00Z') });
    const [la] = groupByDay([late], 'America/Los_Angeles');
    const [utc] = groupByDay([late], 'UTC');
    expect(la.key).toBe('2026-09-13');
    expect(la.label).toBe('Sunday, September 13');
    expect(utc.key).toBe('2026-09-14');
    expect(utc.label).toBe('Monday, September 14');
  });

  it('keeps rows in order and starts a new group per day', () => {
    const groups = groupByDay(
      [
        row({ id: '1', at: Date.parse('2026-09-08T20:00:00Z') }),
        row({ id: '2', at: Date.parse('2026-09-08T10:00:00Z') }),
        row({ id: '3', at: Date.parse('2026-09-07T10:00:00Z') }),
      ],
      'UTC'
    );
    expect(groups.map((g) => g.key)).toEqual(['2026-09-08', '2026-09-07']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('returns no groups for no rows', () => {
    expect(groupByDay([], 'UTC')).toEqual([]);
  });
});

describe('filter links', () => {
  it('sets, replaces and removes params', () => {
    const base = new URLSearchParams('year=2026&team=0001');
    expect(filterHref('/transactions', base, { team: '0002' })).toBe('/transactions?year=2026&team=0002');
    expect(filterHref('/transactions', base, { team: null })).toBe('/transactions?year=2026');
    expect(filterHref('/transactions', base, { week: '3' })).toBe('/transactions?year=2026&team=0001&week=3');
  });

  it('drops the question mark when nothing is left', () => {
    expect(filterHref('/transactions', new URLSearchParams('team=0001'), { team: null })).toBe('/transactions');
  });

  it('does not mutate the caller’s params', () => {
    const base = new URLSearchParams('team=0001');
    filterHref('/transactions', base, { team: '0002' });
    expect(base.get('team')).toBe('0001');
  });
});

describe('kind coverage', () => {
  it('lists every kind the normalizer can emit', () => {
    // If a new kind is added to the normalizer without being added here, it
    // becomes unfilterable and silently invisible.
    const kinds: TransactionKind[] = ['free-agent', 'waiver', 'blind-bid', 'auction', 'trade'];
    expect([...ALL_KINDS].sort()).toEqual([...kinds].sort());
  });
});
