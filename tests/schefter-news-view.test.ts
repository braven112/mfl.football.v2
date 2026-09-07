import { describe, it, expect } from 'vitest';
import { resolveSchefterNewsView } from '../src/utils/schefter-news-view';
import { postIsForViewer, postConcernsFranchise } from '../src/utils/schefter-watching';
import { getLeagueBySlug } from '../src/config/leagues';
import type { SchefterPost, SchefterFeed } from '../src/types/schefter';

const league = getLeagueBySlug('theleague')!;

function post(over: Partial<SchefterPost>): SchefterPost {
  return {
    id: 'p1',
    timestamp: '2026-10-15T12:00:00.000Z',
    type: 'external',
    tier: 'standard',
    headline: 'h',
    body: 'b',
    franchiseIds: [],
    league: 'theleague',
    ...over,
  } as SchefterPost;
}

const feed = (posts: SchefterPost[]): SchefterFeed =>
  ({ lastScanTimestamp: '', lastProcessedMflTimestamp: '0', posts }) as SchefterFeed;

const owner = { id: 'u1', name: 'Owner', franchiseId: '0001', leagueId: league.id, role: 'owner' as const };

const IN_SEASON = new Date('2026-10-15T12:00:00-07:00');
const OFFSEASON = new Date('2026-06-15T12:00:00-07:00');

const view = (url: string, authUser: typeof owner | null, now: Date, posts: SchefterPost[] = []) =>
  resolveSchefterNewsView({ league, feed: feed(posts), authUser, url: new URL(url, 'https://x.test'), now });

describe('For You is the in-season default, and only there', () => {
  it('opens a signed-in owner on their own players in season', async () => {
    expect((await view('/theleague/news', owner, IN_SEASON)).activeSource).toBe('watching');
  });

  it('opens on the full feed out of season', async () => {
    expect((await view('/theleague/news', owner, OFFSEASON)).activeSource).toBeNull();
  });

  /**
   * The whole promise to logged-out readers: nothing about their page changes.
   */
  it('never redirects a visitor with no team, in either mode', async () => {
    expect((await view('/theleague/news', null, IN_SEASON)).activeSource).toBeNull();
    expect((await view('/theleague/news', null, OFFSEASON)).activeSource).toBeNull();
  });

  it('lets an explicit ?source= beat the season default', async () => {
    const v = await view('/theleague/news?source=nfl', owner, IN_SEASON);
    expect(v.activeSource).toBe('nfl');
  });

  /**
   * Clicking "All" from the For You tab produces ?source= with an empty value.
   * If that fell through to the default the tab would be unclickable.
   */
  it('treats an empty ?source= as All rather than re-defaulting', async () => {
    expect((await view('/theleague/news?source=', owner, IN_SEASON)).activeSource).toBeNull();
  });

  it('accepts ?source=foryou as an alias for the watching feed', async () => {
    expect((await view('/theleague/news?source=foryou', owner, IN_SEASON)).activeSource).toBe('watching');
  });

  it('honours ?testDate= so the switch is renderable at any date', async () => {
    const v = await resolveSchefterNewsView({
      league,
      feed: feed([]),
      authUser: owner,
      url: new URL('/theleague/news?testDate=2026-10-15', 'https://x.test'),
    });
    expect(v.feedMode).toBe('in-season');
  });
});

describe('tab list', () => {
  it('leads with For You in season and with All out of season', async () => {
    const inSeason = await view('/theleague/news', owner, IN_SEASON);
    expect(inSeason.tabs.map((t) => t.label).slice(0, 2)).toEqual(['For You', 'All']);

    const off = await view('/theleague/news', owner, OFFSEASON);
    expect(off.tabs.map((t) => t.label).slice(0, 2)).toEqual(['All', 'Watching']);
  });

  it('offers no personal tab to a visitor with no team', async () => {
    const v = await view('/theleague/news', null, IN_SEASON);
    expect(v.tabs.some((t) => t.watching)).toBe(false);
  });

  /**
   * Both leagues shipped an always-empty "NFL Insider" tab for months because
   * the tab list was hand-written beside the filter instead of derived from it.
   */
  it('hides a source tab the feed has no posts for', async () => {
    const v = await view('/theleague/news', owner, IN_SEASON, [post({ authorId: 'nfl-draft' })]);
    const labels = v.tabs.map((t) => t.label);
    expect(labels).toContain('NFL Draft');
    expect(labels).not.toContain('NFL Insider');
  });

  it('shows a source tab as soon as that lane writes its first post', async () => {
    const v = await view('/theleague/news', owner, IN_SEASON, [post({ authorId: 'doc-rivers' })]);
    expect(v.tabs.map((t) => t.label)).toContain('NFL Insider');
  });
});

describe('what lands in For You', () => {
  /**
   * The noise-removal guarantee, pinned. 68 of TheLeague's 351 wire posts name
   * nobody and carry no franchise; they are the bulk of what made the in-season
   * feed unreadable.
   */
  it('drops wire news that names nobody on your roster or watch list', async () => {
    const v = await view('/theleague/news?source=watching', owner, IN_SEASON, [
      post({ id: 'untagged', type: 'external' }),
      post({ id: 'mine', type: 'transaction', franchiseIds: ['0001'] }),
    ]);
    expect(v.posts.map((p) => p.id)).toEqual(['mine']);
  });

  it('keeps a post about your franchise that names no player at all', () => {
    expect(postConcernsFranchise(post({ franchiseIds: ['0001'] }), '0001')).toBe(true);
    expect(
      postIsForViewer(
        post({ franchiseIds: ['0001'] }),
        { watched: new Set(), roster: new Set(), all: new Set() },
        '0001',
      ),
    ).toBe(true);
  });

  it('does not hand you another franchise’s post', () => {
    expect(postConcernsFranchise(post({ franchiseIds: ['0007'] }), '0001')).toBe(false);
  });

  /**
   * Deadlines are league-wide (franchiseIds: []) but are the single most
   * actionable thing in the feed — "TODAY: Declare Contracts / Cut to 22".
   */
  it('keeps league-wide deadline reminders', async () => {
    const v = await view('/theleague/news?source=watching', owner, IN_SEASON, [
      post({ id: 'deadline', type: 'ask-roger', authorId: 'roger' }),
      post({ id: 'noise', type: 'external' }),
    ]);
    expect(v.posts.map((p) => p.id)).toEqual(['deadline']);
  });

  it('matches a player named only in prose (namedPlayerIds), not just structurally', () => {
    const sets = { watched: new Set(['16613']), roster: new Set<string>(), all: new Set(['16613']) };
    expect(postIsForViewer(post({ namedPlayerIds: ['16613'] }), sets, '0001')).toBe(true);
  });
});
