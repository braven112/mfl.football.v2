/**
 * The MFL Football app's draft room (package R): `buildMflLiveDraft` and
 * `buildMflLiveDraftPool`, which turn MFL's payloads into what the phone shows.
 *
 * The traps pinned here are the ones the site's own draft room already hit
 * (docs/plans/draft-hub-and-results.md): rounds of different sizes, a league
 * with two boards, `----` for a skipped pick, and a failed read that must not
 * look like an empty list.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMflLiveDraft,
  buildMflLiveDraftPool,
  chooseDraftUnit,
  draftKindOf,
  freeAgentIdsOf,
  pickClockText,
  pollAfterMs,
  type DraftIdentity,
} from '../src/utils/live/mfl-live-draft';

const league = {
  leagueId: '55555',
  leagueName: 'Work league',
  franchiseId: '0002',
  franchiseName: 'Desk Jockeys',
  year: 2026,
};
const NOW = new Date('2026-05-02T20:00:00Z');

const people: Record<string, DraftIdentity> = {
  '100': { name: 'Rookie Runner', position: 'RB', nflTeam: 'KC', draftYear: '2026' },
  '101': { name: 'Vet Receiver', position: 'WR', nflTeam: 'BUF', draftYear: '2019' },
  '102': { name: 'Young Quarterback', position: 'QB', nflTeam: 'CHI', draftYear: '2026' },
  '103': { name: 'Old Kicker', position: 'PK', nflTeam: 'BAL', draftYear: '2012' },
  '104': { name: 'Tight End', position: 'TE', nflTeam: 'DET', draftYear: '2026' },
};
const identity = (id: string) => people[id];

const settings = (extra: Record<string, unknown> = {}) => ({
  league: {
    name: 'Work league',
    draft_kind: 'email',
    draftLimitHours: '12:00',
    draftPlayerPool: 'Rookie',
    franchises: {
      franchise: [
        { id: '0001', name: 'Alpha' },
        { id: '0002', name: 'Desk Jockeys' },
        { id: '0003', name: 'Gamma' },
      ],
    },
    ...extra,
  },
});

const pick = (round: number, p: number, franchise: string, player = '', timestamp = '', comments = '') => ({
  round: String(round).padStart(2, '0'),
  pick: String(p).padStart(2, '0'),
  franchise,
  player,
  timestamp,
  comments,
});

const room = (picks: ReturnType<typeof pick>[], extra: Partial<Parameters<typeof buildMflLiveDraft>[0]> = {}) =>
  buildMflLiveDraft({
    league,
    board: { unit: 'LEAGUE', picks },
    leagueSettings: settings(),
    queueIds: [],
    identity,
    now: NOW,
    ...extra,
  });

describe('buildMflLiveDraft — the board', () => {
  it('numbers picks through rounds of DIFFERENT sizes, never by a fixed stride', () => {
    // Round 1 has an extra (compensatory) pick, like TheLeague's 1.17.
    const r = room([
      pick(1, 1, '0001', '100', '1777756190'),
      pick(1, 2, '0002', '101', '1777756200'),
      pick(1, 3, '0003', '102', '1777756300'),
      pick(1, 4, '0001'),
      pick(2, 1, '0003'),
      pick(2, 2, '0002'),
    ]);
    expect(r.slots.map((s) => [s.label, s.overall])).toEqual([
      ['1.01', 1],
      ['1.02', 2],
      ['1.03', 3],
      ['1.04', 4],
      ['2.01', 5],
      ['2.02', 6],
    ]);
    expect(r.rounds).toBe(2);
  });

  it('sorts MFL rows that arrive out of order', () => {
    const r = room([pick(2, 1, '0003'), pick(1, 2, '0002'), pick(1, 1, '0001')]);
    expect(r.slots.map((s) => s.label)).toEqual(['1.01', '1.02', '2.01']);
  });

  it('names who was picked, and when', () => {
    const r = room([pick(1, 1, '0001', '100', '1777756190'), pick(1, 2, '0002')]);
    expect(r.slots[0].player).toEqual({ id: '100', name: 'Rookie Runner', position: 'RB', nflTeam: 'KC', rookie: true });
    expect(r.slots[0].madeAt).toBe(new Date(1777756190 * 1000).toISOString());
    expect(r.slots[1].player).toBeUndefined();
  });

  it('reads ---- as a skipped pick, not a player', () => {
    const r = room([pick(1, 1, '0001', '----', '1777756190', 'Pick Skipped By Commissioner'), pick(1, 2, '0002')]);
    expect(r.slots[0].skipped).toBe(true);
    expect(r.slots[0].player).toBeUndefined();
    // …and the clock has moved past it.
    expect(r.onClock?.label).toBe('1.02');
  });

  it('records a traded pick', () => {
    const r = room([pick(1, 1, '0002', '', '', '[Pick traded from Alpha.]')]);
    expect(r.slots[0].fromTeam).toBe('Alpha');
  });

  it('keeps an unknown player as an id rather than dropping the pick', () => {
    const r = room([pick(1, 1, '0001', '99999', '1777756190')]);
    expect(r.slots[0].player).toMatchObject({ id: '99999', name: 'Player 99999' });
  });
});

describe('buildMflLiveDraft — status, the clock and your next pick', () => {
  it('is not-set when MFL has no order yet', () => {
    const r = room([]);
    expect(r.status).toBe('not-set');
    expect(r.onClock).toBeUndefined();
    expect(r.pollAfterMs).toBe(600_000);
  });

  it('is upcoming before the first pick, with 1.01 on the clock and no start time', () => {
    const r = room([pick(1, 1, '0001'), pick(1, 2, '0002')]);
    expect(r.status).toBe('upcoming');
    expect(r.onClock).toEqual({ overall: 1, label: '1.01', franchiseId: '0001', mine: false });
    expect(r.myNextPick).toEqual({ overall: 2, label: '1.02', picksAway: 1 });
  });

  it('is live in the middle, and the clock started when the last pick was made', () => {
    const r = room([pick(1, 1, '0001', '100', '1777756190'), pick(1, 2, '0002'), pick(1, 3, '0003')]);
    expect(r.status).toBe('live');
    expect(r.onClock).toMatchObject({ label: '1.02', franchiseId: '0002', mine: true });
    expect(r.onClock?.since).toBe(new Date(1777756190 * 1000).toISOString());
    expect(r.myNextPick).toEqual({ overall: 2, label: '1.02', picksAway: 0 });
  });

  it('is complete when every pick is made, with nobody on the clock', () => {
    const r = room([pick(1, 1, '0001', '100', '1777756190'), pick(1, 2, '0002', '101', '1777756200')]);
    expect(r.status).toBe('complete');
    expect(r.onClock).toBeUndefined();
    expect(r.myNextPick).toBeUndefined();
  });

  it('polls fast only while a draft is running', () => {
    expect(pollAfterMs('live', 'live', false)).toBeLessThan(10_000);
    expect(pollAfterMs('email', 'live', true)).toBeLessThan(pollAfterMs('email', 'live', false));
    expect(pollAfterMs('email', 'upcoming', false)).toBe(120_000);
    expect(pollAfterMs('email', 'complete', false)).toBe(600_000);
  });
});

describe('buildMflLiveDraft — the queue', () => {
  it('keeps your MFL pre-draft list in order, without players already taken', () => {
    const r = room([pick(1, 1, '0001', '101', '1777756190'), pick(1, 2, '0002')], { queueIds: ['102', '101', '100'] });
    expect(r.queue?.map((p) => p.id)).toEqual(['102', '100']);
  });

  it('says null — not an empty list — when MFL would not give us the list', () => {
    expect(room([pick(1, 1, '0001')], { queueIds: null }).queue).toBeNull();
    expect(room([pick(1, 1, '0001')], { queueIds: [] }).queue).toEqual([]);
  });
});

describe('buildMflLiveDraft — the league', () => {
  it('reads MFL’s settings into words', () => {
    const r = room([pick(1, 1, '0001')]);
    expect(r.kind).toBe('email');
    expect(r.pool).toBe('Rookies only');
    expect(r.pickClock).toBe('12 hours a pick');
    expect(r.unit).toBe('LEAGUE');
    expect(r.teams.map((t) => t.name)).toEqual(['Alpha', 'Desk Jockeys', 'Gamma']);
  });

  it('classifies draft kinds, auctions included', () => {
    expect(draftKindOf('live')).toBe('live');
    expect(draftKindOf('email')).toBe('email');
    expect(draftKindOf('auction')).toBe('auction');
    expect(draftKindOf('eauction')).toBe('auction');
    expect(draftKindOf('')).toBe('unknown');
  });

  it('writes the pick clock in words', () => {
    expect(pickClockText('12:00')).toBe('12 hours a pick');
    expect(pickClockText('0:02')).toBe('2 minutes a pick');
    expect(pickClockText('1:30')).toBe('1 hour 30 minutes a pick');
    expect(pickClockText('0:00')).toBeUndefined();
    expect(pickClockText('')).toBeUndefined();
  });
});

describe('chooseDraftUnit — a league with two boards', () => {
  const twoBoards = {
    draftResults: {
      draftUnit: [
        { unit: 'CONFERENCE00', draftPick: [pick(1, 1, '0001'), pick(1, 2, '0003')] },
        { unit: 'CONFERENCE01', draftPick: [pick(1, 1, '0002'), pick(1, 2, '0004')] },
      ],
    },
  };

  it('shows the board YOUR team picks on, not the first one', () => {
    expect(chooseDraftUnit(twoBoards, '0002')?.unit).toBe('CONFERENCE01');
    expect(chooseDraftUnit(twoBoards, '0001')?.unit).toBe('CONFERENCE00');
  });

  it('reads a single board whether MFL sends one pick or many', () => {
    const one = { draftResults: { draftUnit: { unit: 'LEAGUE', draftPick: pick(1, 1, '0001') } } };
    expect(chooseDraftUnit(one, '0001')?.picks).toHaveLength(1);
  });

  it('refuses one of MFL’s 200-status errors rather than calling it an empty draft', () => {
    expect(chooseDraftUnit({ error: { $t: 'Invalid league' } }, '0001')).toBeNull();
  });

  it('reads the real 2026 TheLeague board: rounds of different sizes, numbered straight through', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '../data/theleague/mfl-feeds/2026/draftResults.json'), 'utf8'));
    const board = chooseDraftUnit(raw, '0001');
    const r = buildMflLiveDraft({ league: { ...league, franchiseId: '0001' }, board, leagueSettings: null, queueIds: null, identity, now: NOW });
    const perRound = [1, 2, 3].map((n) => r.slots.filter((s) => s.round === n).length);
    expect(perRound.reduce((a, b) => a + b, 0)).toBe(r.slots.length);
    expect(r.slots[r.slots.length - 1].overall).toBe(r.slots.length);
    expect(new Set(r.slots.map((s) => s.overall)).size).toBe(r.slots.length);
    expect(r.status).toBe('complete');
  });
});

describe('buildMflLiveDraftPool', () => {
  const pool = (extra: Partial<Parameters<typeof buildMflLiveDraftPool>[0]> = {}) =>
    buildMflLiveDraftPool({
      leagueId: '55555',
      year: 2026,
      freeAgentIds: ['100', '101', '102', '103', '104', '777'],
      takenIds: new Set(),
      draftPlayerPool: 'Both',
      adpRanks: new Map([
        ['102', 3],
        ['100', 9],
      ]),
      identity,
      now: NOW,
      ...extra,
    });

  it('puts the best ADP first, then the rest by position', () => {
    expect(pool().players.map((p) => p.id)).toEqual(['102', '100', '101', '104', '103']);
    expect(pool().players[0].adpRank).toBe(3);
  });

  it('leaves out players already picked on the board, whatever MFL’s rosters say yet', () => {
    expect(pool({ takenIds: new Set(['102']) }).players.map((p) => p.id)).not.toContain('102');
  });

  it('narrows to rookies in a rookies-only draft', () => {
    const r = pool({ draftPlayerPool: 'Rookie' });
    expect(r.rookiesOnly).toBe(true);
    expect(r.players.map((p) => p.id)).toEqual(['102', '100', '104']);
  });

  it('leaves out a player nothing can name', () => {
    expect(pool().players.map((p) => p.id)).not.toContain('777');
  });
});

describe('freeAgentIdsOf', () => {
  it('reads the owner’s unit in a two-board league', () => {
    const fa = {
      freeAgents: {
        leagueUnit: [
          { unit: 'CONFERENCE00', player: [{ id: '1' }] },
          { unit: 'CONFERENCE01', player: { id: '2' } },
        ],
      },
    };
    expect(freeAgentIdsOf(fa, 'CONFERENCE01')).toEqual(['2']);
    expect(freeAgentIdsOf(fa, undefined)).toEqual(['1']);
  });

  it('is null for a failed read, so it is never shown as "nobody left"', () => {
    expect(freeAgentIdsOf({ error: 'nope' }, undefined)).toBeNull();
    expect(freeAgentIdsOf(null, undefined)).toBeNull();
  });
});
