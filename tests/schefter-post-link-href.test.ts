/**
 * A post's internal link renders with its league's prefix, so it resolves on
 * the shared host as well as the league's own domain. Older Owners' Poll posts
 * were stored bare (`/pecking-order/2026/3`) and 404'd on mfl.football/theleague.
 */
import { describe, expect, it } from 'vitest';
import { postLinkHref } from '../src/utils/schefter-feed';

describe('postLinkHref', () => {
  it('prefixes a bare internal link with the post league', () => {
    expect(postLinkHref({ link: '/pecking-order/2026/3', league: 'theleague' })).toBe('/theleague/pecking-order/2026/3');
    expect(postLinkHref({ link: '/standings', league: 'afl' })).toBe('/afl-fantasy/standings');
    expect(postLinkHref({ link: '/news', league: 'archies' })).toBe('/archies/news');
  });

  it('leaves prefixed, absolute and missing links alone', () => {
    expect(postLinkHref({ link: '/theleague/owners-poll', league: 'theleague' })).toBe('/theleague/owners-poll');
    expect(postLinkHref({ link: 'https://www.espn.com/x', league: 'theleague' })).toBe('https://www.espn.com/x');
    expect(postLinkHref({ link: '//cdn.example/x', league: 'theleague' })).toBe('//cdn.example/x');
    expect(postLinkHref({ league: 'theleague' })).toBeUndefined();
  });
});
