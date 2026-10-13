import { describe, expect, it } from 'vitest';
import { indexMoveStories } from '../src/utils/transaction-stories';
import type { SchefterPost } from '../src/types/schefter';
import type { TransactionRow } from '../src/utils/mfl-transactions';

const post = (over: Partial<SchefterPost>): SchefterPost =>
  ({
    id: 'p', timestamp: '', type: 'transaction', transactionSubType: 'FREE_AGENT', tier: 'minor',
    headline: 'h', body: 'b', franchiseIds: ['0007'], sourceTimestamp: '1790000000', league: 'afl',
    storyVersion: 2, addedIds: ['1'], ...over,
  }) as SchefterPost;
const row = (over: Partial<TransactionRow>): TransactionRow => ({
  id: 'r', at: 1790000000 * 1000, kind: 'free-agent', rawType: 'FREE_AGENT', franchiseId: '0007',
  added: ['1'], dropped: [], trade: null, amount: null, byCommish: false, ...over,
});

describe('joining a Schefter story to its MFL row', () => {
  it('joins on timestamp and franchise', () => {
    expect(indexMoveStories([post({ id: 'a' })]).get(row({}))?.id).toBe('a');
    expect(indexMoveStories([post({ id: 'a' })]).get(row({ franchiseId: '0008' }))).toBeNull();
  });

  it('never leads with a bare template', () => {
    expect(indexMoveStories([post({ storyVersion: undefined })]).get(row({}))).toBeNull();
  });

  it('joins a trade on either side, and never a trade post to a pickup', () => {
    const trade = post({ id: 't', transactionSubType: 'TRADE', storyVersion: undefined, franchiseIds: ['0007', '0009'] });
    const idx = indexMoveStories([trade]);
    expect(idx.get(row({ kind: 'trade', franchiseId: '0007' }))?.id).toBe('t');
    expect(idx.get(row({ kind: 'trade', franchiseId: '0009' }))?.id).toBe('t');
    expect(idx.get(row({}))).toBeNull();
  });

  it('narrows a shared timestamp by player, and shows the record when it cannot', () => {
    const idx = indexMoveStories([post({ id: 'a', addedIds: ['1'] }), post({ id: 'b', addedIds: ['2'] })]);
    expect(idx.get(row({ added: ['2'] }))?.id).toBe('b');
    expect(idx.get(row({ added: ['3'] }))).toBeNull();
  });

  it('never hands the one surviving story to a same-second claim it is not about', () => {
    const idx = indexMoveStories([post({ id: 'a', addedIds: ['1'] })]);
    expect(idx.get(row({ added: ['2'] }))).toBeNull();
  });
});
