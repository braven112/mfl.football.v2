import { describe, it, expect } from 'vitest';
import { buildSchefterPostOg, isRumorLikePost, schefterPostOgText } from '../src/utils/schefter-feed';

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

describe('schefterPostOgText', () => {
  it('uses the headline for regular transaction posts', () => {
    const { title } = schefterPostOgText({
      type: 'transaction',
      transactionSubType: 'AUCTION_WON',
      headline: 'Music City Mafia open the vault',
      body: '$6.53M for WR Smith, DeVonta.',
    });
    expect(title).toBe('Music City Mafia open the vault');
  });

  it('strips HTML tags and entities from the body', () => {
    const { description } = schefterPostOgText({
      type: 'transaction',
      headline: 'x',
      body: '<strong>Big</strong> move &amp; more',
    });
    expect(description).toBe('Big move & more');
  });

  it('leads with the body for rumor-like posts (headline is boilerplate)', () => {
    const { title } = schefterPostOgText({
      type: 'transaction',
      transactionSubType: 'trade_speculation',
      headline: 'Schefter speculating…',
      body: '🟡 Local fan boards are floating Bowers to the Jocks.',
    });
    expect(title).toBe('Local fan boards are floating Bowers to the Jocks.');
  });

  it('truncates long bodies used as titles', () => {
    const { title } = schefterPostOgText({
      type: 'transaction',
      transactionSubType: 'rumor_mill',
      headline: '',
      body: 'a'.repeat(200),
    });
    expect(title.length).toBeLessThanOrEqual(110);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to a brand title when the post has no text', () => {
    const { title } = schefterPostOgText({ type: 'transaction', headline: '', body: '' });
    expect(title).toBe('The Schefter Report');
  });
});

describe('buildSchefterPostOg', () => {
  const post = {
    id: 'sf_123_ab',
    type: 'transaction',
    transactionSubType: 'TRADE',
    headline: 'Blockbuster in the works',
    body: 'Sources say a deal is close.',
  } as never;

  it('points the image at the per-post OG endpoint on the page origin', () => {
    const og = buildSchefterPostOg(post, new URL('https://theleague.us/news?post=sf_123_ab'));
    expect(og.image).toBe('https://theleague.us/api/og/schefter/sf_123_ab.png');
    expect(og.url).toBe('https://theleague.us/news?post=sf_123_ab');
    expect(og.title).toBe('Blockbuster in the works');
    expect(og.description).toBe('Sources say a deal is close.');
  });

  it('URL-encodes the post id', () => {
    const weird = { ...(post as object), id: 'sf a&b' } as never;
    const og = buildSchefterPostOg(weird, new URL('https://theleague.us/news'));
    expect(og.image).toBe('https://theleague.us/api/og/schefter/sf%20a%26b.png');
  });
});
