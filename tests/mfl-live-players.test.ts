/**
 * The app's Players tab (package K): the parsers and the list/card builders
 * in src/utils/live/mfl-players.ts, on payloads in MFL's own shapes.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPlayerCard,
  buildPlayerList,
  displayName,
  parseFreeAgents,
  parseLeague,
  parsePlayerListQuery,
  parsePlayers,
  parseRosters,
  parseScores,
  parseTopList,
  positionsFor,
  type LeaguePlayersData,
} from '../src/utils/live/mfl-players';

const leaguePayload = (playerLimitUnit = 'LEAGUE') => ({
  league: {
    playerLimitUnit,
    endWeek: '17',
    franchises: {
      franchise: [
        { id: '0001', name: 'Mine', division: '00' },
        { id: '0002', name: 'Rival', division: '00' },
        { id: '0003', name: 'Other Conf', division: '01' },
      ],
    },
    divisions: {
      division: [
        { id: '00', conference: '00' },
        { id: '01', conference: '01' },
      ],
    },
    starters: { position: [{ name: 'QB' }, { name: 'RB' }, { name: 'WR' }, { name: 'DL' }, { name: 'Def' }] },
  },
});

const playersPayload = {
  players: {
    player: [
      { id: '100', name: 'Mahomes, Patrick', position: 'QB', team: 'KC' },
      { id: '200', name: 'Robinson, Bijan', position: 'RB', team: 'ATL' },
      { id: '300', name: 'Nobody, Backup', position: 'RB', team: 'NYJ' },
      { id: '400', name: 'Watt, T.J.', position: 'DE', team: 'PIT' },
      { id: '500', name: 'Punter, Pat', position: 'PN', team: '' },
      { id: '0501', name: 'Bills, Buffalo', position: 'Def', team: 'BUF' },
      { id: '600', name: "Chase, Ja'Marr", position: 'WR', team: 'CIN' },
    ],
  },
};

function data(overrides: Partial<LeaguePlayersData> = {}): LeaguePlayersData {
  const league = parseLeague(leaguePayload())!;
  return {
    leagueId: '55555',
    franchiseId: '0001',
    week: 8,
    identities: parsePlayers(playersPayload)!,
    league,
    rosters: new Map([
      ['100', ['0001']],
      ['600', ['0002']],
    ]),
    freeAgents: new Set(['200', '300', '400', '500', '0501']),
    projections: new Map([
      ['200', 18.5],
      ['400', 9],
      ['0501', 7],
    ]),
    seasonPoints: new Map([
      ['200', 120],
      ['300', 4],
      ['400', 60],
    ]),
    ownedPct: new Map([
      ['200', 99],
      ['0501', 40],
    ]),
    addedPct: new Map([
      ['300', 12],
      ['400', 3],
    ]),
    injuries: new Map([['200', { status: 'Questionable', bodyPart: 'Ankle', expectedReturn: null }]]),
    byes: { ATL: 5, KC: 10 },
    ...overrides,
  };
}

const query = (q: Partial<ReturnType<typeof parsePlayerListQuery>> = {}) => ({
  ...parsePlayerListQuery(new URLSearchParams()),
  ...q,
});

describe('parsers', () => {
  it('reads "Last, First" as "First Last", team defenses included', () => {
    expect(displayName('Mahomes, Patrick')).toBe('Patrick Mahomes');
    expect(displayName('Bills, Buffalo')).toBe('Buffalo Bills');
    expect(displayName('Cher')).toBe('Cher');
  });

  it('skips the blank row MFL sends for an unscored week', () => {
    const scores = parseScores(
      { playerScores: { playerScore: [{ id: '', score: '', week: '9' }, { id: '1', score: '4.5' }] } },
      'playerScores',
    );
    expect([...scores]).toEqual([['1', 4.5]]);
  });

  it('accepts a one-row list as a bare object', () => {
    expect([...parseTopList({ topAdds: { player: { id: '9', percent: '7.5' } } }, 'topAdds')]).toEqual([['9', 7.5]]);
    expect(parsePlayers({ players: { player: { id: '1', name: 'A, B', position: 'QB', team: 'KC' } } })!.size).toBe(1);
  });

  it('treats a payload of the wrong shape as unread, not empty', () => {
    expect(parsePlayers({ error: 'nope' })).toBeNull();
    expect(parseRosters({})).toBeNull();
    expect(parseFreeAgents({ freeAgents: {} })).toBeNull();
    expect(parseLeague(null)).toBeNull();
  });

  it('expands combination and IDP group slots to player positions', () => {
    expect(positionsFor('RB+WR+TE')).toEqual(['RB', 'WR', 'TE']);
    expect(positionsFor('DL')).toEqual(['DE', 'DT']);
    expect(positionsFor('DB')).toEqual(['CB', 'S']);
  });

  it('keys free agency by unit, as the franchise’s conference decides it', () => {
    const conf = parseLeague(leaguePayload('CONFERENCE'))!;
    expect(conf.unitOf.get('0001')).toBe('00');
    expect(conf.unitOf.get('0003')).toBe('01');
    expect(parseLeague(leaguePayload())!.unitOf.get('0003')).toBe('');
    const fa = parseFreeAgents({
      freeAgents: { leagueUnit: [{ unit: 'CONFERENCE00', player: [{ id: '1' }] }, { unit: 'CONFERENCE01', player: { id: '2' } }] },
    })!;
    expect([...fa.get('00')!]).toEqual(['1']);
    expect([...fa.get('01')!]).toEqual(['2']);
  });
});

describe('buildPlayerList', () => {
  it('lists free agents at the league’s positions, best projection first, missing numbers last', () => {
    const list = buildPlayerList(data(), query());
    // The punter is a free agent but the league starts no punters.
    expect(list.players.map((p) => p.id)).toEqual(['200', '400', '0501', '300']);
    expect(list.positions).toEqual(['QB', 'RB', 'WR', 'DL', 'Def']);
    expect(list.players[0]).toMatchObject({ name: 'Bijan Robinson', bye: 5, injury: 'Questionable', ownedPct: 99, isFreeAgent: true, owners: [] });
  });

  it('sorts by season points or owned % when asked', () => {
    expect(buildPlayerList(data(), query({ sort: 'pts' })).players.map((p) => p.id)).toEqual(['200', '400', '300', '0501']);
    expect(buildPlayerList(data(), query({ sort: 'owned' })).players.map((p) => p.id).slice(0, 2)).toEqual(['200', '0501']);
  });

  it('filters by a position label, IDP groups included', () => {
    expect(buildPlayerList(data(), query({ pos: 'DL' })).players.map((p) => p.id)).toEqual(['400']);
    // A label the league does not use is ignored rather than emptying the list.
    expect(buildPlayerList(data(), query({ pos: 'XX' })).total).toBe(4);
  });

  it('searches every player by name, ignoring case and punctuation, and names the owner', () => {
    const list = buildPlayerList(data(), query({ status: 'all', q: 'jamarr' }));
    expect(list.players).toHaveLength(1);
    expect(list.players[0]).toMatchObject({ id: '600', isFreeAgent: false, owners: [{ franchiseId: '0002', name: 'Rival' }] });
  });

  it('orders trending by MFL-wide adds', () => {
    expect(buildPlayerList(data(), query({ status: 'trending' })).players.map((p) => p.id)).toEqual(['300', '400']);
  });

  it('caps the list at the limit but reports the full count', () => {
    const list = buildPlayerList(data(), query({ limit: 2 }));
    expect(list.players).toHaveLength(2);
    expect(list.total).toBe(4);
  });

  it('without MFL’s free-agent list, falls back to "nobody here rosters him"', () => {
    const list = buildPlayerList(data({ freeAgents: null }), query({ status: 'all' }));
    expect(list.players.find((p) => p.id === '100')!.isFreeAgent).toBe(false);
    expect(list.players.find((p) => p.id === '200')!.isFreeAgent).toBe(true);
  });

  it('names only owners in the account’s own unit', () => {
    const league = parseLeague(leaguePayload('CONFERENCE'))!;
    const list = buildPlayerList(
      data({ league, rosters: new Map([['600', ['0003']]]), freeAgents: new Set(['600']) }),
      query({ q: 'chase' }),
    );
    expect(list.players[0]).toMatchObject({ isFreeAgent: true, owners: [] });
  });
});

describe('parsePlayerListQuery', () => {
  it('defaults to free agents by projection, and clamps the limit', () => {
    expect(parsePlayerListQuery(new URLSearchParams('status=bogus&sort=bogus&limit=99999'))).toMatchObject({
      status: 'fa',
      sort: 'proj',
      limit: 300,
    });
  });
});

describe('buildPlayerCard', () => {
  it('lists every scored week, newest first, and the injury detail', () => {
    const weekly = new Map([
      [1, new Map([['200', 10]])],
      [2, new Map([['999', 3]])],
      [3, new Map([['200', 22.5]])],
    ]);
    const card = buildPlayerCard(data(), '200', weekly)!;
    expect(card.weeks).toEqual([
      { week: 3, points: 22.5 },
      { week: 1, points: 10 },
    ]);
    expect(card.injuryDetail).toEqual({ status: 'Questionable', bodyPart: 'Ankle', expectedReturn: null });
    expect(buildPlayerCard(data(), 'nope', weekly)).toBeNull();
  });
});
