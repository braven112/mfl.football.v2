import { describe, it, expect } from 'vitest';
import { resolveSchefterRail } from '../src/utils/schefter-rail-view';
import { getLeagueBySlug } from '../src/config/leagues';
import type { SchefterPost } from '../src/types/schefter';

const league = getLeagueBySlug('theleague')!;
const owner = { id: 'u1', name: 'Owner', franchiseId: '0001', leagueId: league.id, role: 'owner' as const };
const IN_SEASON = new Date('2026-10-15T12:00:00-07:00');
const OFFSEASON = new Date('2026-06-15T12:00:00-07:00');

let seq = 0;
function post(over: Partial<SchefterPost> = {}): SchefterPost {
  seq += 1;
  return {
    id: `p${seq}`,
    // Descending timestamps so the array is newest-first like a real feed.
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

const rail = (posts: SchefterPost[], authUser: typeof owner | null, now: Date, limit = 30) =>
  resolveSchefterRail({ league, posts, authUser, now, limit });

describe('the rail only personalizes in season, for an owner', () => {
  it('offers no tabs to a signed-out visitor', async () => {
    const v = await rail([post({ franchiseIds: ['0001'] })], null, IN_SEASON);
    expect(v.personalized).toBe(false);
    expect(v.forYouIds).toEqual([]);
  });

  it('offers no tabs out of season', async () => {
    const v = await rail([post({ franchiseIds: ['0001'] })], owner, OFFSEASON);
    expect(v.personalized).toBe(false);
  });

  it('offers tabs to an owner in season', async () => {
    const v = await rail([post({ franchiseIds: ['0001'] }), post()], owner, IN_SEASON);
    expect(v.personalized).toBe(true);
    expect(v.forYouIds).toHaveLength(1);
  });

  /**
   * A For You tab that opens empty is worse than not offering one — unlike the
   * full news page there is no obvious way back to the league feed.
   */
  it('offers no tabs when nothing of yours has moved', async () => {
    const v = await rail([post(), post()], owner, IN_SEASON);
    expect(v.personalized).toBe(false);
    expect(v.posts).toHaveLength(2);
  });
});

describe('the rail keeps every personal post', () => {
  /**
   * The regression this guards: the homepages used to hand the rail
   * feed.posts.slice(0, 30). Filtering THAT to one roster leaves almost
   * nothing, because the newest posts are overwhelmingly wire.
   */
  it('surfaces a personal post buried far below the newest league news', async () => {
    const noise = Array.from({ length: 40 }, () => post());
    const mine = post({ franchiseIds: ['0001'] });
    const v = await rail([...noise, mine], owner, IN_SEASON, 10);

    expect(v.personalized).toBe(true);
    expect(v.forYouIds).toContain(mine.id);
    expect(v.posts.map((p) => p.id)).toContain(mine.id);
  });

  it('tops the rail up with league news so the All tab still reads as the league', async () => {
    const mine = post({ franchiseIds: ['0001'] });
    const v = await rail([mine, ...Array.from({ length: 20 }, () => post())], owner, IN_SEASON, 10);
    expect(v.posts).toHaveLength(10);
    expect(v.forYouIds).toEqual([mine.id]);
  });

  it('never lists a post in forYouIds that it did not render', async () => {
    const mine = Array.from({ length: 3 }, () => post({ franchiseIds: ['0001'] }));
    const v = await rail([...mine, ...Array.from({ length: 20 }, () => post())], owner, IN_SEASON, 10);
    const rendered = new Set(v.posts.map((p) => p.id));
    for (const id of v.forYouIds) expect(rendered.has(id)).toBe(true);
  });

  it('renders newest-first after the personal-then-filler merge', async () => {
    const v = await rail(
      [post(), post({ franchiseIds: ['0001'] }), post(), post({ franchiseIds: ['0001'] })],
      owner,
      IN_SEASON,
      10,
    );
    const times = v.posts.map((p) => new Date(p.timestamp).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  /** Both leagues have a franchise 0001 — the AFL's must not match here. */
  it('ignores a session from the other league', async () => {
    const aflSession = { ...owner, leagueId: getLeagueBySlug('afl-fantasy')!.id };
    const v = await rail([post({ franchiseIds: ['0001'] })], aflSession, IN_SEASON);
    expect(v.personalized).toBe(false);
  });
});
