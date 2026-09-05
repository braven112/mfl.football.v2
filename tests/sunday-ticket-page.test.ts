import { describe, it, expect } from 'vitest';
import {
  formatKickoff,
  leagueSelectionHref,
  parseLeagueSelection,
  resolveBoardLeagues,
  toggleLeagueSelection,
} from '../src/utils/sunday-ticket-page';
import { LEAGUES, DEFAULT_LEAGUE } from '../src/config/leagues';
import type { MyLeague } from '../src/utils/my-leagues';

const AFL = LEAGUES['afl-fantasy'];
const BOARD = [DEFAULT_LEAGUE.id, AFL.id, '55555'];

describe('parseLeagueSelection — URL param and cookie share one parser', () => {
  it('returns null (all) for empty, "all", or nothing-but-garbage', () => {
    expect(parseLeagueSelection(null, BOARD)).toBeNull();
    expect(parseLeagueSelection('', BOARD)).toBeNull();
    expect(parseLeagueSelection('all', BOARD)).toBeNull();
    expect(parseLeagueSelection('default', BOARD)).toBeNull();
    expect(parseLeagueSelection('99999,nope', BOARD)).toBeNull();
  });

  it('keeps known ids in order, deduplicated, and drops unknown ones', () => {
    expect(parseLeagueSelection(`${AFL.id}, ${DEFAULT_LEAGUE.id},${AFL.id},404`, BOARD)).toEqual([AFL.id, DEFAULT_LEAGUE.id]);
  });
});

describe('toggleLeagueSelection', () => {
  it('turns a league off and normalizes to board order', () => {
    expect(toggleLeagueSelection(BOARD, BOARD, AFL.id)).toEqual([DEFAULT_LEAGUE.id, '55555']);
  });

  it('turns a league back on, and a set equal to the DEFAULT collapses to null', () => {
    const defaults = [DEFAULT_LEAGUE.id, AFL.id]; // the leagues this site runs
    expect(toggleLeagueSelection([DEFAULT_LEAGUE.id], BOARD, AFL.id, defaults)).toBeNull();
    expect(toggleLeagueSelection([DEFAULT_LEAGUE.id, AFL.id], BOARD, '55555', defaults)).toEqual(BOARD);
    // With no defaults given the full board is the default (the old behavior).
    expect(toggleLeagueSelection([DEFAULT_LEAGUE.id, '55555'], BOARD, AFL.id)).toBeNull();
  });

  it('never leaves the board empty — turning off the last league falls back to the default', () => {
    expect(toggleLeagueSelection([AFL.id], BOARD, AFL.id, [DEFAULT_LEAGUE.id, AFL.id])).toBeNull();
  });

  it('defaultLeagueSelection is the home leagues only — registered and not best-ball', async () => {
    const { defaultLeagueSelection } = await import('../src/utils/sunday-ticket-selection');
    expect(defaultLeagueSelection([
      { id: DEFAULT_LEAGUE.id, registered: DEFAULT_LEAGUE }, { id: '55555', registered: null }, { id: AFL.id, registered: AFL },
      // Best Ball is registered but draft-only: it folds in with the outside leagues.
      { id: LEAGUES['best-ball-1'].id, registered: LEAGUES['best-ball-1'] },
    ])).toEqual([DEFAULT_LEAGUE.id, AFL.id]);
  });
});

describe('leagueSelectionHref', () => {
  it('carries the explicit week and serializes the set or "all"', () => {
    expect(leagueSelectionHref('/theleague/sunday-ticket', [AFL.id], 7)).toBe(`/theleague/sunday-ticket?week=7&leagues=${AFL.id}`);
    expect(leagueSelectionHref('/sunday-ticket', null, null)).toBe('/sunday-ticket?leagues=default');
  });
});

describe('resolveBoardLeagues — session first, then myleagues, registered before outside', () => {
  const my: MyLeague[] = [
    { id: '55555', name: 'Dynasty Bros', franchiseId: '0004', franchiseName: 'Bros', host: 'https://www45.myfantasyleague.com' },
    { id: AFL.id, name: 'AFL (per MFL)', franchiseId: '0012', franchiseName: 'CSKA Sofia', host: 'https://www44.myfantasyleague.com' },
    { id: DEFAULT_LEAGUE.id, name: 'TheLeague', franchiseId: '0009', franchiseName: 'Someone Else', host: null },
    { id: '66666', name: 'No Team', franchiseId: '', franchiseName: '', host: null },
  ];

  it('uses the verified session franchise for its own league and orders the rest', () => {
    const board = resolveBoardLeagues(
      { league: DEFAULT_LEAGUE, franchiseId: '0001', franchiseName: 'Pacific Pigskins' },
      my,
    );
    expect(board.map((l) => [l.id, l.franchiseId, l.isSession, !!l.registered])).toEqual([
      [DEFAULT_LEAGUE.id, '0001', true, true],
      [AFL.id, '0012', false, true],
      ['55555', '0004', false, false],
    ]);
    // Registered leagues take the registry's name; outside ones keep MFL's; hosts only matter outside.
    expect(board[1].name).toBe(AFL.name);
    expect(board[1].host).toBeNull();
    expect(board[2].host).toBe('https://www45.myfantasyleague.com');
  });

  it('works with no session (dead cookie / signed out) and skips franchise-less rows', () => {
    const board = resolveBoardLeagues(null, my);
    expect(board.map((l) => l.id)).toEqual([DEFAULT_LEAGUE.id, AFL.id, '55555']);
    expect(board.every((l) => !l.isSession)).toBe(true);
  });
});

describe('formatKickoff', () => {
  it('renders the same instant in both league clocks', () => {
    // Sun Sep 20 2026 1:00 PM EDT = 17:00Z
    const k = formatKickoff(Math.floor(Date.UTC(2026, 8, 20, 17) / 1000));
    expect(k).toEqual({ day: 'Sun', et: '1:00 PM', pt: '10:00 AM' });
  });
});

describe('rememberSundayTicketChoices — the route writes, the component reads', () => {
  const jar = () => {
    const writes: Array<[string, string]> = [];
    return { writes, set: (name: string, value: string) => { writes.push([name, value]); } };
  };

  it('writes only the params that are present, raw, with "all" for an empty leagues value', async () => {
    const { rememberSundayTicketChoices, LEAGUE_SELECTION_COOKIE, COUNTRY_COOKIE } = await import('../src/utils/sunday-ticket-selection');
    const j = jar();
    rememberSundayTicketChoices(new URL('https://x.test/theleague/sunday-ticket?country=ca&leagues='), j);
    expect(j.writes).toEqual([[LEAGUE_SELECTION_COOKIE, 'default'], [COUNTRY_COOKIE, 'CA']]);
    const none = jar();
    rememberSundayTicketChoices(new URL('https://x.test/theleague/sunday-ticket?week=3'), none);
    expect(none.writes).toEqual([]);
  });
});
