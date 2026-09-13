/**
 * The broadcast board's projections must be for the week the board is showing.
 *
 * The bug this pins shipped to production on Sunday 2026-09-13, mid-afternoon
 * of week 1: every matchup's "projected" number was identical to the live
 * score, and every win-probability bar was pinned to 100/0.
 *
 * The cause is a week mismatch, not a missing feed. `scripts/fetch-mfl-feeds.mjs`
 * syncs `projectedScores` with **W omitted**, and MFL answers that with the
 * week IT considers current — which rolls forward to the NEXT week once the
 * current week's games are under way. Verified live against TheLeague that
 * afternoon: W omitted answered `week: "2"`, `W=1` answered `week: "1"`.
 * `projectionsForWeek` then refuses the mismatch (correctly — next week's
 * numbers are not this week's), so the map is empty, every player's remaining
 * expectation is 0, and `projectedFinal` collapses onto `live`.
 *
 * Which means: on gameday the committed feed is reliably the WRONG week, and a
 * read path that stops there is flat exactly when the board is being watched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mflFetch(...args),
}));

const readLeagueFeed = vi.fn();
vi.mock('../src/utils/sunday-ticket-sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/sunday-ticket-sources')>();
  // `projectionsForWeek` stays REAL — it is the rule under test, not a stub.
  return { ...actual, readLeagueFeed: (...args: unknown[]) => readLeagueFeed(...args) };
});

import {
  buildBoardLeagues,
  clearProjectionCache,
  loadLeagueProjections,
} from '../src/utils/broadcast-live-source';
import { computeTeamTotals } from '../src/utils/live-scoring-view';
import { getLeagueBySlug } from '../src/config/leagues';
import type { PlayerMeta } from '../src/types/live-scoring';

const theLeague = getLeagueBySlug('theleague')!;

const registered = () =>
  buildBoardLeagues([], { leagueId: theLeague.id, franchiseId: '0001' })[0];

const outside = () =>
  buildBoardLeagues(
    [{ id: '99999', name: 'Outside', franchiseId: '0004', host: 'https://www49.myfantasyleague.com' } as any],
    null,
  )[0];

/** An MFL `projectedScores` body for one week. */
const feed = (week: string, rows: Record<string, string>) => ({
  projectedScores: {
    week,
    playerScore: Object.entries(rows).map(([id, score]) => ({ id, score })),
  },
});

const respond = (body: unknown, status = 200) =>
  mflFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  mflFetch.mockReset();
  readLeagueFeed.mockReset();
  clearProjectionCache();
});

describe('loadLeagueProjections — the committed feed is only right when its week matches', () => {
  it('uses the committed feed, and asks MFL for nothing, when the weeks agree', async () => {
    readLeagueFeed.mockReturnValue(feed('1', { '100': '18.4', '200': '9.1' }));

    const map = await loadLeagueProjections(registered(), 1, 'cookie', 2026);

    expect([...map]).toEqual([['100', 18.4], ['200', 9.1]]);
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it('falls back to a live read FOR THIS WEEK when the committed feed is another week', async () => {
    // The exact production shape: the sync ran with W omitted on the Saturday
    // and MFL had already rolled to week 2; the board is showing week 1.
    readLeagueFeed.mockReturnValue(feed('2', { '100': '31.0' }));
    respond(feed('1', { '100': '18.4', '200': '9.1' }));

    const map = await loadLeagueProjections(registered(), 1, 'cookie', 2026);

    expect([...map]).toEqual([['100', 18.4], ['200', 9.1]]);
    expect(mflFetch).toHaveBeenCalledTimes(1);
    const url = String(mflFetch.mock.calls[0][0].url);
    // The week must be ASKED FOR. Omitting W is what produced the wrong week
    // in the first place, so a fallback that also omits it fixes nothing.
    expect(url).toContain('W=1');
    expect(url).toContain('TYPE=projectedScores');
    expect(url).toContain(`L=${theLeague.id}`);
    // The host is the registry's, never a hint: `L` and the host are one
    // composite key and MFL answers a mismatch with its OWN league.
    expect(url).toContain(theLeague.mflHost);
  });

  it('falls back when the sync has written no feed at all', async () => {
    readLeagueFeed.mockReturnValue(null);
    respond(feed('1', { '100': '18.4' }));

    expect([...(await loadLeagueProjections(registered(), 1, 'cookie', 2026))]).toEqual([['100', 18.4]]);
  });

  it('still refuses the wrong week when the LIVE read answers for another one', async () => {
    readLeagueFeed.mockReturnValue(feed('2', { '100': '31.0' }));
    respond(feed('3', { '100': '27.0' }));

    expect((await loadLeagueProjections(registered(), 1, 'cookie', 2026)).size).toBe(0);
  });

  it('survives a throttled or unparseable fallback rather than throwing', async () => {
    readLeagueFeed.mockReturnValue(feed('2', { '100': '31.0' }));
    // MFL answers a throttled request with an HTML page under a 200.
    mflFetch.mockResolvedValueOnce(new Response('<html>slow down</html>', { status: 200 }));

    expect((await loadLeagueProjections(registered(), 1, 'cookie', 2026)).size).toBe(0);
  });

  it('does not re-fetch the same week on every poll, and never caches an empty answer', async () => {
    readLeagueFeed.mockReturnValue(feed('2', { '100': '31.0' }));
    respond(feed('1', { '100': '18.4' }));

    await loadLeagueProjections(registered(), 1, 'cookie', 2026);
    await loadLeagueProjections(registered(), 1, 'cookie', 2026);
    expect(mflFetch).toHaveBeenCalledTimes(1);

    // A different week is a different answer, and a failed read must not be
    // remembered — a board pinned flat for ten minutes off one bad poll is the
    // bug wearing a cache.
    mflFetch.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    respond(feed('3', { '100': '27.0' }));
    expect((await loadLeagueProjections(registered(), 3, 'cookie', 2026)).size).toBe(0);
    expect((await loadLeagueProjections(registered(), 3, 'cookie', 2026)).size).toBe(1);
  });

  it('leaves the outside-league path asking for the week by number, as it already did', async () => {
    respond(feed('1', { '100': '18.4' }));

    const map = await loadLeagueProjections(outside(), 1, 'cookie', 2026);

    expect([...map]).toEqual([['100', 18.4]]);
    expect(readLeagueFeed).not.toHaveBeenCalled();
    expect(String(mflFetch.mock.calls[0][0].url)).toContain('W=1');
  });
});

describe('the symptom itself', () => {
  const meta: Record<string, PlayerMeta> = {};
  const rows = [
    // Kicked off, half a game left.
    { id: '100', live: 8, secondsRemaining: 1800, status: 'starter' },
    // Has not kicked off at all.
    { id: '200', live: 0, secondsRemaining: 3600, status: 'starter' },
  ];

  it('an empty projections map IS "projected == actual"', () => {
    const totals = computeTeamTotals(rows, meta, { score: 8, projections: new Map() });
    expect(totals.projectedFinal).toBe(totals.live);
    expect(totals.remainingPoints).toBe(0);
  });

  it('a populated one separates them again', () => {
    const totals = computeTeamTotals(rows, meta, {
      score: 8,
      projections: new Map([['100', 18.4], ['200', 9.1]]),
    });
    expect(totals.projectedFinal).toBeGreaterThan(totals.live);
  });
});
