import { describe, it, expect } from 'vitest';
import {
  computeStarPlayerIds,
  consensusRanks,
  isBreakingPostForViewer,
} from '../src/utils/breaking-injury-relevance';

const POS: Record<string, string> = {
  wr1: 'WR', wr2: 'WR', wr3: 'WR', wr4: 'WR', wr5: 'WR', wr6: 'WR', wr7: 'WR',
  k1: 'PK',
};
const positionOf = (id: string) => POS[id];
const ranked = (id: string, ids: string[]) => ({ id, players: ids.map((pid, i) => ({ id: pid, rank: i + 1 })) });

describe('consensusRanks', () => {
  it('averages only the public redraft/ADP sources', () => {
    const r = consensusRanks([
      ranked('mfl-adp', ['a', 'b']),
      ranked('espn', ['b', 'a']),
      ranked('fantasycalc', ['z']), // dynasty values: not consensus
    ]);
    expect(r.get('a')).toBe(1.5);
    expect(r.get('b')).toBe(1.5);
    expect(r.has('z')).toBe(false);
  });

  it('ranks a player a source omits just past that source', () => {
    const r = consensusRanks([ranked('mfl-adp', ['a', 'b']), ranked('espn', ['b'])]);
    // a: (1 + (1 + 1)) / 2
    expect(r.get('a')).toBe(1.5);
  });
});

describe('computeStarPlayerIds', () => {
  const order = ['wr1', 'wr2', 'wr3', 'wr4', 'wr5', 'wr6', 'wr7', 'k1'];

  it('takes the top 5 per position by consensus', () => {
    const stars = computeStarPlayerIds({ positionOf, rankingSources: [ranked('mfl-adp', order)] });
    expect([...stars].sort()).toEqual(['wr1', 'wr2', 'wr3', 'wr4', 'wr5']);
  });

  it('adds this season\'s top 5 scorers, so a breakout counts', () => {
    const stars = computeStarPlayerIds({
      positionOf,
      rankingSources: [ranked('mfl-adp', order)],
      ytdScores: [{ id: 'wr7', score: '300.5' }, { id: 'wr1', score: '10' }],
    });
    expect(stars.has('wr7')).toBe(true);
    expect(stars.has('wr6')).toBe(false);
  });

  it('never makes a kicker or defense a star', () => {
    const stars = computeStarPlayerIds({ positionOf, rankingSources: [ranked('mfl-adp', ['k1'])] });
    expect(stars.has('k1')).toBe(false);
  });

  it('is empty, not a throw, with no data', () => {
    expect(computeStarPlayerIds({ positionOf, rankingSources: null, ytdScores: null }).size).toBe(0);
  });
});

describe('isBreakingPostForViewer', () => {
  const stars = new Set(['star']);
  const injury = (playerId: string, franchiseId: string) => ({
    type: 'injury', tier: 'breaking', playerIds: [playerId], franchiseIds: [franchiseId],
  });

  it('shows a star injury to everyone, signed out included', () => {
    expect(isBreakingPostForViewer(injury('star', '0003'), { franchiseId: null, starIds: stars })).toBe(true);
    expect(isBreakingPostForViewer(injury('star', '0003'), { franchiseId: '0001', starIds: stars })).toBe(true);
  });

  it('shows a non-star injury only to the owner who rosters him', () => {
    const post = injury('depth', '0003');
    expect(isBreakingPostForViewer(post, { franchiseId: '0003', starIds: stars })).toBe(true);
    expect(isBreakingPostForViewer(post, { franchiseId: '0001', starIds: stars })).toBe(false);
    expect(isBreakingPostForViewer(post, { franchiseId: null, starIds: stars })).toBe(false);
  });

  it('leaves non-injury breaking news league-wide', () => {
    const trade = { type: 'transaction', tier: 'breaking', playerIds: ['depth'], franchiseIds: ['0003'] };
    expect(isBreakingPostForViewer(trade, { franchiseId: null, starIds: stars })).toBe(true);
  });
});

describe('isBreakingPostForViewer — current ownership', () => {
  it('reaches every owner who rosters the player now (AFL: both conferences)', () => {
    const post = { type: 'injury', playerIds: ['p'], franchiseIds: ['0003'] };
    const ownersOf = (id: string) => (id === 'p' ? ['0003', '0015'] : []);
    expect(isBreakingPostForViewer(post, { franchiseId: '0015', starIds: new Set(), ownersOf })).toBe(true);
    expect(isBreakingPostForViewer(post, { franchiseId: '0020', starIds: new Set(), ownersOf })).toBe(false);
  });
});
