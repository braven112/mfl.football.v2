import { describe, expect, it } from 'vitest';
import {
  earnsRosterList,
  foldRosterLists,
  injuryReason,
  irPost,
  irSides,
  leagueDay,
  oneLiner,
  placedOnIrEarlier,
  rosterList,
  rosterListId,
  shouldUseOneLiner,
  ONE_LINER_EVERY,
} from '../scripts/lib/schefter-wire-formats.mjs';
import { indexMoveStories } from '../src/utils/transaction-stories';
import type { SchefterPost } from '../src/types/schefter';
import type { TransactionRow } from '../src/utils/mfl-transactions';

const reed = { id: '1', name: 'Reed, Austin', position: 'QB', nflTeam: 'BAL' };
const tyson = { id: '2', name: 'Tyson, Jordyn', position: 'WR', nflTeam: 'NOS' };
const miller = { id: '3', name: 'Miller, Kendre', position: 'RB', nflTeam: 'NOS' };
const robinson = { id: '4', name: 'Robinson Jr., Brian', position: 'RB', nflTeam: 'SFO' };
const saints = { id: '5', name: 'Saints, New Orleans', position: 'Def', nflTeam: 'NOS' };
const players = new Map(Object.entries({ 1: reed, 2: tyson, 3: miller, 4: robinson, 5: saints }));
const teams = new Map([['0001', { name: 'Pacific Pigskins' }], ['0002', { name: 'The Mariachi Ninjas' }]]);
const ZONE = 'America/Los_Angeles';

describe('one-liners', () => {
  it('reads like a wire line: team, verb, position and name', () => {
    expect(oneLiner({ team: 'Pacific Pigskins', rawType: 'FREE_AGENT', dropped: [reed] })?.body)
      .toBe('Pacific Pigskins released QB Austin Reed.');
    expect(oneLiner({ team: 'Pacific Pigskins', rawType: 'BBID_WAIVER', added: [tyson], dropped: [miller] })?.body)
      .toBe('Pacific Pigskins claimed WR Jordyn Tyson off waivers and released RB Kendre Miller.');
    expect(oneLiner({ team: 'Pacific Pigskins', rawType: 'FREE_AGENT', added: [saints] })?.body)
      .toBe('Pacific Pigskins signed the New Orleans Saints defense.');
  });

  it('prints a price only when it is given, and never calls a move free', () => {
    const line = oneLiner({ team: 'Pacific Pigskins', rawType: 'FREE_AGENT', added: [tyson], price: '$1.20M' });
    expect(line?.body).toBe('Pacific Pigskins signed WR Jordyn Tyson for $1.20M.');
    expect(oneLiner({ team: 'X', rawType: 'FREE_AGENT', added: [tyson] })?.body).not.toMatch(/free|\$0/i);
  });

  it('refuses a player it cannot name rather than printing "Player 123"', () => {
    expect(oneLiner({ team: 'X', rawType: 'FREE_AGENT', added: [undefined as never] })).toBeNull();
  });

  it('picks about one move in three, the same way every time', () => {
    const picks = Array.from({ length: 900 }, (_, i) => shouldUseOneLiner(String(1790000000 + i * 37), '0001'));
    const share = picks.filter(Boolean).length / picks.length;
    expect(share).toBeGreaterThan(1 / ONE_LINER_EVERY - 0.08);
    expect(share).toBeLessThan(1 / ONE_LINER_EVERY + 0.08);
    expect(shouldUseOneLiner('1790000000', '0001')).toBe(shouldUseOneLiner('1790000000', '0001'));
  });
});

describe('IR posts', () => {
  it('names the injury only from MFL’s report for that player id', () => {
    const injuries = new Map([['4', { id: '4', status: 'IR', details: 'Knee' }]]);
    expect(irPost({ team: 'Pacific Pigskins', placed: [robinson], injuries })?.body)
      .toBe('Pacific Pigskins placed RB Brian Robinson Jr. on injured reserve. Robinson has a knee injury.');
    expect(irPost({ team: 'Pacific Pigskins', placed: [robinson], injuries: new Map() })?.body)
      .toBe('Pacific Pigskins placed RB Brian Robinson Jr. on injured reserve.');
  });

  it('says nothing for an undisclosed or personal reason', () => {
    expect(injuryReason(robinson, { details: 'Undisclosed' })).toBeNull();
    expect(injuryReason(robinson, { injuryBodyPart: 'Personal' })).toBeNull();
    expect(injuryReason(robinson, { details: 'Concussion' })).toBe('Robinson is in the concussion protocol.');
  });

  it('pairs a placement with an activation, Schefter-style', () => {
    expect(irPost({ team: 'Pacific Pigskins', placed: [robinson], activated: [tyson] })?.body)
      .toBe('Pacific Pigskins placed RB Brian Robinson Jr. on injured reserve and activated WR Jordyn Tyson from injured reserve.');
    expect(irPost({ team: 'Pacific Pigskins', activated: [tyson] })?.headline)
      .toBe('Pacific Pigskins activate Jordyn Tyson from IR');
  });

  it('leads a second placement of the day with "Another player added to IR"', () => {
    expect(irPost({ team: 'Pacific Pigskins', placed: [robinson], another: true })?.body)
      .toMatch(/^Another player added to IR: Pacific Pigskins placed/);
    const earlier = { franchiseIds: ['0001'], sourceTimestamp: '1793839783', transactionSubType: 'IR', placedIds: ['9'] };
    const day = leagueDay('1793839783', ZONE);
    expect(placedOnIrEarlier([earlier], '0001', day, ZONE)).toBe(true);
    expect(placedOnIrEarlier([earlier], '0002', day, ZONE)).toBe(false);
  });

  it('reads both sides of MFL’s IR row', () => {
    expect(irSides({ deactivated: '13418,', activated: '' })).toEqual({ placedIds: ['13418'], activatedIds: [] });
  });
});

describe('roster lists', () => {
  it('lists each kind of move under its own football header', () => {
    const list = rosterList({
      team: 'Pacific Pigskins',
      moves: [{ added: [tyson], released: [miller] }, { released: [reed] }, { placedOnIr: [robinson] }],
    });
    expect(list?.body).toBe(
      'Notable Pacific Pigskins roster moves today:\n\n'
      + '🏈 Added:\nWR Jordyn Tyson\n\n'
      + '🏈 Released:\nRB Kendre Miller\nQB Austin Reed\n\n'
      + '🏈 Placed on IR:\nRB Brian Robinson Jr.',
    );
    expect(list?.headline).toBe('Pacific Pigskins roster moves: 1 added, 2 released, 1 to IR');
  });

  it('does not trip over a team name that starts with "The"', () => {
    expect(rosterList({ team: 'The Mariachi Ninjas', moves: [{ added: [tyson] }] })?.body)
      .toMatch(/^Notable roster moves today for The Mariachi Ninjas:/);
  });

  it('takes several moves, not one add/drop with two names', () => {
    expect(earnsRosterList([{ added: [tyson], released: [miller] }])).toBe(false);
    expect(earnsRosterList([{ added: [tyson], released: [miller] }, { released: [reed] }])).toBe(true);
  });
});

describe('folding a scan into roster lists', () => {
  const ts = (n: number) => String(1793839000 + n);
  const fa = (n: number, str: string, fid = '0001') => ({
    post: { id: `p${n}`, tier: 'minor', transactionSubType: 'FREE_AGENT', sourceTimestamp: ts(n), franchiseIds: [fid] },
    txn: { type: 'FREE_AGENT', franchise: fid, timestamp: ts(n), transaction: str },
  });
  const ctx = { players, teams, leagueSlug: 'theleague', clockZone: ZONE, hasSalaries: true };

  it('folds a busy day into one list and keeps a one-liner per pickup for the Transactions page', () => {
    const feed = { posts: [] as SchefterPost[] };
    const out = foldRosterLists([fa(1, '2,|3,'), fa(2, '|1,')], feed, ctx);
    expect(out).toHaveLength(1);
    const list = out[0].post as SchefterPost;
    expect(list.id).toBe(rosterListId('0001', leagueDay(ts(2), ZONE)));
    expect(list.format).toBe('roster-list');
    expect(list.moves?.map((m) => m.body)).toEqual([
      'Pacific Pigskins signed WR Jordyn Tyson and released RB Kendre Miller.',
      'Pacific Pigskins released QB Austin Reed.',
    ]);

    // The page spreads the list back into per-row stories.
    const row = (over: Partial<TransactionRow>): TransactionRow => ({
      id: 'r', at: Number(ts(2)) * 1000, kind: 'free-agent', rawType: 'FREE_AGENT', franchiseId: '0001',
      added: [], dropped: ['1'], trade: null, amount: null, byCommish: false, ...over,
    });
    const story = indexMoveStories([{ ...list, timestamp: '', league: 'theleague' } as SchefterPost]).get(row({}));
    expect(story?.body).toBe('Pacific Pigskins released QB Austin Reed.');
  });

  it('leaves a quiet day, and every standard or big-drop move, as its own post', () => {
    expect(foldRosterLists([fa(1, '2,|3,')], { posts: [] }, ctx).map((d) => d.post.id)).toEqual(['p1']);
    const big = fa(2, '|1,');
    (big.post as Record<string, unknown>).bigDrop = { playerId: '1', salary: 2_000_000 };
    const standard = fa(3, '2,|');
    standard.post.tier = 'standard';
    const out = foldRosterLists([fa(1, '2,|3,'), big, standard], { posts: [] }, ctx);
    expect(out.map((d) => d.post.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('extends the list a team already has today instead of starting another', () => {
    const feed = { posts: [] as SchefterPost[] };
    const first = foldRosterLists([fa(1, '2,|3,'), fa(2, '|1,')], feed, ctx)[0].post as SchefterPost;
    feed.posts = [first];
    const out = foldRosterLists([fa(3, '5,|')], feed, ctx);
    expect(out).toHaveLength(1);
    expect(out[0].post.id).toBe(first.id);
    expect((out[0].post as SchefterPost).moves).toHaveLength(3);
    expect((out[0].post as SchefterPost).body).toContain('New Orleans Saints defense');
    expect(feed.posts).toHaveLength(0); // the old copy is replaced, not duplicated
  });
});
