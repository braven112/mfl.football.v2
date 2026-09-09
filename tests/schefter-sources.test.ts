/**
 * The feed's lane predicates, and the surfaces that must agree about them.
 *
 * /news?source=theleague and the homepage rail's My News tab are supposed to
 * carry the same league-desk posts. They did not: the rail filtered on
 * `postIsForViewer` (watched players + your own franchise), so a trade between
 * two other franchises showed on /news and not on the homepage. Both now read
 * SOURCE_PREDICATES, and this file is what keeps them reading it.
 */

import { describe, it, expect } from 'vitest';
import { SOURCE_PREDICATES, isGroupMePost, type FeedSource } from '../src/utils/schefter-sources';
import { resolveSchefterRail } from '../src/utils/schefter-rail-view';
import { resolveSchefterNewsView } from '../src/utils/schefter-news-view';
import { getLeagueBySlug } from '../src/config/leagues';
import type { SchefterPost, SchefterFeed } from '../src/types/schefter';

const league = getLeagueBySlug('theleague')!;
const owner = { id: 'u1', name: 'Owner', franchiseId: '0001', leagueId: league.id, role: 'owner' as const };
const IN_SEASON = new Date('2026-10-15T12:00:00-07:00');

let seq = 0;
function post(over: Partial<SchefterPost> = {}): SchefterPost {
  seq += 1;
  return {
    id: `p${seq}`,
    timestamp: new Date(Date.UTC(2026, 9, 15, 12, 0, 0) - seq * 60000).toISOString(),
    type: 'external',
    tier: 'standard',
    headline: 'h',
    body: 'b',
    franchiseIds: [],
    league: 'theleague',
    ...over,
  } as SchefterPost;
}

const LANES: FeedSource[] = ['theleague', 'nfl', 'draft', 'insider'];

describe('a post lands in at most one lane', () => {
  const samples: Array<[string, SchefterPost, FeedSource]> = [
    ['a Schefter transaction post', post({ type: 'transaction', authorId: 'claude' }), 'theleague'],
    ['an untagged legacy post', post({ type: 'transaction' }), 'theleague'],
    ['a Roger deadline', post({ type: 'ask-roger', authorId: 'roger' }), 'theleague'],
    ['an ESPN byline', post({ authorId: 'adam-schefter' }), 'nfl'],
    ['a wire_ item with no author', post({ id: 'wire_123' }), 'nfl'],
    ['the draft lane', post({ authorId: 'nfl-draft' }), 'draft'],
    ['the insider lane', post({ authorId: 'vegas-vic' }), 'insider'],
  ];

  for (const [label, p, lane] of samples) {
    it(`${label} is ${lane} and nothing else`, () => {
      for (const other of LANES) {
        expect([other, SOURCE_PREDICATES[other](p)]).toEqual([other, other === lane]);
      }
    });
  }

  /** The draft persona is external, so `nfl` has to exclude it explicitly. */
  it('keeps the draft lane out of NFL', () => {
    expect(SOURCE_PREDICATES.nfl(post({ authorId: 'nfl-draft' }))).toBe(false);
  });

  /**
   * The `wire_` prefix branch bypasses ESPN_AUTHOR_IDS, so the exclusion after
   * it has to cover the insider personas too — otherwise an insider post with
   * a wire id renders under NFL *and* NFL Insider. It cannot arise from
   * today's producers (schefter-scan gives them `inj_`/`odds_` ids), which is
   * exactly why only a partition assertion catches it.
   */
  it('keeps an insider post out of NFL even when it carries a wire id', () => {
    const p = post({ id: 'wire_9001', authorId: 'vegas-vic' });
    expect(SOURCE_PREDICATES.nfl(p)).toBe(false);
    expect(SOURCE_PREDICATES.insider(p)).toBe(true);
    expect(SOURCE_PREDICATES.theleague(p)).toBe(false);
    expect(SOURCE_PREDICATES.draft(p)).toBe(false);
  });

  it('keeps a draft post out of NFL even when it carries a wire id', () => {
    const p = post({ id: 'wire_9002', authorId: 'nfl-draft' });
    expect(SOURCE_PREDICATES.nfl(p)).toBe(false);
    expect(SOURCE_PREDICATES.draft(p)).toBe(true);
  });

  it('recognises a group chat message by type', () => {
    expect(isGroupMePost(post({ type: 'groupme', authorId: 'groupme-0007' }))).toBe(true);
    expect(isGroupMePost(post({ authorId: 'claude' }))).toBe(false);
  });
});

/**
 * The invariant the bug broke. Whatever /news?source=theleague shows an owner,
 * the homepage's My News tab shows too — same posts, same predicate.
 */
describe('the rail’s My News carries everything /news?source=theleague does', () => {
  it('agrees post for post', async () => {
    const posts: SchefterPost[] = [
      post({ type: 'transaction', authorId: 'claude', franchiseIds: ['0007', '0012'] }),
      post({ type: 'transaction' }),
      post({ type: 'ask-roger', authorId: 'roger' }),
      post({ authorId: 'nfl-wire' }),
      post({ authorId: 'nfl-draft' }),
      post({ authorId: 'vegas-vic' }),
    ];

    const news = await resolveSchefterNewsView({
      league,
      feed: { posts } as SchefterFeed,
      authUser: owner,
      url: new URL('https://www.theleague.us/theleague/news?source=theleague'),
      now: IN_SEASON,
    });
    const rail = await resolveSchefterRail({ league, posts, authUser: owner, now: IN_SEASON });

    expect(news.posts.length).toBeGreaterThan(0);
    const myNews = new Set(rail.forYouIds);
    for (const p of news.posts) expect(myNews.has(p.id)).toBe(true);
  });
});
