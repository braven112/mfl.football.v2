import { describe, it, expect, vi } from 'vitest';

// Records the reference date the rail asks for while delegating to the real
// implementation — the assertion is about the ARGUMENT, nothing else.
const leagueYearCalls: Array<Date | undefined> = [];
vi.mock('../src/utils/league-year', async (importActual) => {
  const actual = await importActual<typeof import('../src/utils/league-year')>();
  return {
    ...actual,
    getLeagueYearForSlug: (slug: string, referenceDate?: Date) => {
      leagueYearCalls.push(referenceDate);
      return actual.getLeagueYearForSlug(slug, referenceDate);
    },
  };
});

import { resolveSchefterRail } from '../src/utils/schefter-rail-view';
import { getLeagueBySlug } from '../src/config/leagues';
import type { SchefterPost } from '../src/types/schefter';

const league = getLeagueBySlug('theleague')!;
const owner = { id: 'u1', name: 'Owner', franchiseId: '0001', leagueId: league.id, role: 'owner' as const };

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

// Fixed instant inside the 2026 season window (opens on the NL draft, Aug 30).
const IN_SEASON = new Date('2026-10-15T12:00:00-07:00');
const OFFSEASON = new Date('2026-06-15T12:00:00-07:00');

const rail = (posts: SchefterPost[], authUser: typeof owner | null, limit = 30, now = IN_SEASON) =>
  resolveSchefterRail({ league, posts, authUser, limit, now });

describe('the rail is the owner’s Watching feed', () => {
  /**
   * The whole point. An earlier version gated this on the season and hid it
   * behind a tab, so on any day before kickoff the rail looked untouched —
   * which is exactly how it was reported. There is no date condition now.
   */
  it('marks only the owner’s posts as For You', async () => {
    const mine = post({ franchiseIds: ['0001'] });
    const v = await rail([post(), mine, post()], owner);
    expect(v.personalized).toBe(true);
    expect(v.forYouIds).toEqual([mine.id]);
  });

  it('leaves wire news that names nobody out of For You', async () => {
    const noise = post();
    const v = await rail([noise, post({ franchiseIds: ['0001'] })], owner);
    expect(v.forYouIds).not.toContain(noise.id);
    // …but the All tab still has it, so the rail reads as the league feed.
    expect(v.posts.map((p) => p.id)).toContain(noise.id);
  });

  it('keeps league-wide deadline reminders in For You', async () => {
    const deadline = post({ type: 'ask-roger', authorId: 'roger' });
    const v = await rail([post(), deadline], owner);
    expect(v.forYouIds).toEqual([deadline.id]);
  });

  it('offers no tabs out of season', async () => {
    const v = await rail([post({ franchiseIds: ['0001'] })], owner, 30, OFFSEASON);
    expect(v.personalized).toBe(false);
    expect(v.forYouIds).toEqual([]);
  });

  it('offers no tabs when nothing of yours has moved', async () => {
    const v = await rail([post(), post()], owner);
    expect(v.personalized).toBe(false);
  });

  /**
   * The regression this guards: the homepages used to hand the rail
   * feed.posts.slice(0, 30). Filtering THAT to one roster leaves almost
   * nothing, because the newest posts are overwhelmingly wire.
   */
  it('surfaces a personal post buried far below the newest league news', async () => {
    const mine = post({ franchiseIds: ['0001'] });
    const v = await rail([...Array.from({ length: 40 }, () => post()), mine], owner, 10);
    expect(v.forYouIds).toContain(mine.id);
    expect(v.posts.map((p) => p.id)).toContain(mine.id);
  });

  it('never lists a For You id it did not render', async () => {
    const mine = Array.from({ length: 3 }, () => post({ franchiseIds: ['0001'] }));
    const v = await rail([...mine, ...Array.from({ length: 20 }, () => post())], owner, 10);
    const rendered = new Set(v.posts.map((p) => p.id));
    for (const id of v.forYouIds) expect(rendered.has(id)).toBe(true);
  });

  it('carries empty-state copy for the For You tab', async () => {
    const v = await rail([post({ franchiseIds: ['0001'] })], owner);
    expect(v.emptyText).toBeTruthy();
  });
});

describe('assistant posts are private to the franchise they address', () => {
  it('keeps another franchise’s nudge out of the rail entirely', async () => {
    const theirs = post({ id: 'assist_other', type: 'assistant', franchiseIds: ['0007'] });
    const v = await rail([theirs, post({ franchiseIds: ['0001'] })], owner);
    expect(v.posts.map((p) => p.id)).not.toContain('assist_other');
  });

  it('keeps the owner’s own', async () => {
    const mine = post({ id: 'assist_mine', type: 'assistant', franchiseIds: ['0001'] });
    const v = await rail([mine, post()], owner);
    expect(v.forYouIds).toContain('assist_mine');
  });

  it('hides them from a signed-out visitor', async () => {
    const v = await rail([post({ id: 'a', type: 'assistant', franchiseIds: ['0001'] })], null);
    expect(v.posts).toHaveLength(0);
  });
});

describe('a visitor with no franchise here gets the league feed', () => {
  it('falls back for a signed-out visitor', async () => {
    const v = await rail([post(), post()], null);
    expect(v.personalized).toBe(false);
    expect(v.posts).toHaveLength(2);
    expect(v.forYouIds).toEqual([]);
  });

  /** Both leagues have a franchise 0001 — the AFL's must not match here. */
  it('falls back for a session from the other league', async () => {
    const afl = { ...owner, leagueId: getLeagueBySlug('afl-fantasy')!.id };
    const v = await rail([post({ franchiseIds: ['0001'] })], afl);
    expect(v.personalized).toBe(false);
  });
});

/**
 * The rail carries the same date-switch as /news, so it carries the same trap:
 * a watch year off the system clock pairs the requested date's season mode
 * with the current year's roster. Copilot caught this in schefter-news-view
 * only — the rail is a second copy of the same read.
 */
describe('every date-dependent read uses the same clock', () => {
  it('resolves the watch year from `now`, not the system clock', async () => {
    leagueYearCalls.length = 0;
    // Feb 16 2027 is deliberate: still in season (the window closes Feb 18) AND
    // past the Feb 14 league-year rollover, so the reference date genuinely
    // changes the answer rather than merely being passed along.
    const now = new Date('2027-02-16T12:00:00-08:00');
    await resolveSchefterRail({ league, posts: [], authUser: owner, now });
    expect(leagueYearCalls.length).toBeGreaterThan(0);
    expect(leagueYearCalls).toContainEqual(now);
  });
});
