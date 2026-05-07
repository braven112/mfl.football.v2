import { describe, it, expect } from 'vitest';
import { isRumorLikePost } from '../src/utils/schefter-feed';

describe('isRumorLikePost', () => {
  it('flags rumor-mill anonymous-tip rumors', () => {
    expect(
      isRumorLikePost({ type: 'transaction', transactionSubType: 'rumor_mill' }),
    ).toBe(true);
  });

  it('flags trade-speculation algorithmic posts', () => {
    expect(
      isRumorLikePost({ type: 'transaction', transactionSubType: 'trade_speculation' }),
    ).toBe(true);
  });

  it('does NOT flag real MFL transaction posts', () => {
    expect(isRumorLikePost({ type: 'transaction', transactionSubType: 'TRADE' })).toBe(false);
    expect(isRumorLikePost({ type: 'transaction', transactionSubType: 'FREE_AGENT' })).toBe(false);
  });

  it('does NOT flag external / article / groupme posts', () => {
    expect(isRumorLikePost({ type: 'external' })).toBe(false);
    expect(isRumorLikePost({ type: 'article' })).toBe(false);
    expect(isRumorLikePost({ type: 'groupme' })).toBe(false);
  });

  it('does NOT flag a transaction post with no subType', () => {
    expect(isRumorLikePost({ type: 'transaction' })).toBe(false);
  });
});
