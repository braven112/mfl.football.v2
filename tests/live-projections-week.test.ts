/**
 * The live-scoring board's projections must be for the week the board shows.
 *
 * This pins a bug that was live on the league boards and was NOT the one fixed
 * on 2026-09-13. Both come from the same upstream fact and they fail in
 * opposite directions, which is why one was reported within the hour and the
 * other was not reported at all:
 *
 *   `scripts/fetch-mfl-feeds.mjs` syncs `projectedScores` with **W omitted**,
 *   and MFL answers that with the week IT considers current — which rolls to
 *   the NEXT week once the current week's games are under way. Verified live
 *   against TheLeague: W omitted -> `week: "2"`, `W=1` -> `week: "1"`.
 *
 * On the BROADCAST board, `projectionsForWeek` refused the mismatch, the map
 * came back empty, and every projected final collapsed onto the live score
 * with the win-probability bar pinned to 100/0. Obviously broken.
 *
 * On the LEAGUE boards, the old `loadProjections` (`live-scoring-data.ts`)
 * took every `playerScore` row with **no week check at all** — so during Week
 * 1's games it computed every projected final and every win-probability bar
 * from Week 2's numbers. Not flat: confidently wrong, and nothing on the page
 * says so. That is the failure this file exists to stop coming back.
 *
 * The second, quieter half is the two clocks. The committed feed lives in
 * `data/<league>/mfl-feeds/<LEAGUE year>/`, which rolls Feb 14 (June 1 for the
 * AFL); the live read is results-shaped and takes the SEASON year, which rolls
 * at Labor Day. Reading the disk feed on the season year misses the directory
 * entirely for half the offseason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const readLeagueFeed = vi.fn();
vi.mock('../src/utils/sunday-ticket-sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/sunday-ticket-sources')>();
  // `projectionsForWeek` stays REAL — its week-mismatch refusal is the rule
  // under test, not a stub.
  return { ...actual, readLeagueFeed: (...args: unknown[]) => readLeagueFeed(...args) };
});

import {
  loadLeagueWeekProjections,
  __clearProjectionCache,
} from '../src/utils/live/projections';
import { getLeagueBySlug } from '../src/config/leagues';
import { getLeagueYearForSlug } from '../src/utils/league-year';

const SEASON = 2026;
const theLeague = getLeagueBySlug('theleague')!;

/** An MFL `projectedScores` body for one week. */
const feed = (week: string, rows: Record<string, string>) => ({
  projectedScores: {
    week,
    playerScore: Object.entries(rows).map(([id, score]) => ({ id, score })),
  },
});

const fetchMock = vi.fn();

const respond = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

/** The URL the one live read was made with. */
const fetchedUrl = (call = 0) => String(fetchMock.mock.calls[call][0]);

beforeEach(() => {
  readLeagueFeed.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  __clearProjectionCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the committed feed is only usable when its week matches', () => {
  it('uses it, and asks MFL for nothing, when the weeks agree', async () => {
    readLeagueFeed.mockReturnValue(feed('1', { '100': '18.4', '200': '9.1' }));

    const map = await loadLeagueWeekProjections('theleague', 1, SEASON);

    expect(map.get('100')).toBe(18.4);
    expect(map.get('200')).toBe(9.1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('THE BUG: next week’s feed contributes NOTHING to this week', async () => {
    // Exactly the gameday shape: the feed says week 2, the board shows week 1.
    readLeagueFeed.mockReturnValue(feed('2', { '100': '18.4', '200': '9.1' }));
    respond(feed('1', { '100': '12.2' }));

    const map = await loadLeagueWeekProjections('theleague', 1, SEASON);

    // Not one row of week 2 survives...
    expect(map.get('200')).toBeUndefined();
    // ...and the number we DO have came from the week-numbered live read.
    expect(map.get('100')).toBe(12.2);
  });

  it('names the week BY NUMBER on the live read, against the registry host', async () => {
    readLeagueFeed.mockReturnValue(feed('2', { '100': '18.4' }));
    respond(feed('5', { '100': '12.2' }));

    await loadLeagueWeekProjections('theleague', 5, SEASON);

    const url = fetchedUrl();
    expect(url).toContain('W=5');
    expect(url).toContain('TYPE=projectedScores');
    expect(url).toContain(`L=${theLeague.id}`);
    // Registry-resolved. A caller-supplied `host=` on a public URL from a
    // datacenter IP reads as SSRF to a WAF and 403s at the edge with nothing
    // in our logs.
    expect(url).toContain(theLeague.mflHost);
    expect(url).not.toContain('host=');
  });

  it('still refuses a mismatch the LIVE read answers with', async () => {
    readLeagueFeed.mockReturnValue(null);
    // MFL ignoring our W and answering its own week must not be trusted
    // either — that is the same bug one hop further out.
    respond(feed('2', { '100': '12.2' }));

    const map = await loadLeagueWeekProjections('theleague', 1, SEASON);

    expect(map.size).toBe(0);
  });
});

describe('two clocks, and they are not interchangeable', () => {
  it('reads the disk feed on the LEAGUE year, not the season year', async () => {
    readLeagueFeed.mockReturnValue(feed('1', { '100': '18.4' }));

    await loadLeagueWeekProjections('theleague', 1, SEASON);

    const [league, year, file] = readLeagueFeed.mock.calls[0];
    expect(league.slug).toBe('theleague');
    expect(year).toBe(getLeagueYearForSlug('theleague'));
    expect(file).toBe('projectedScores.json');
  });

  it('reads MFL on the SEASON year it was handed', async () => {
    readLeagueFeed.mockReturnValue(null);
    respond(feed('1', { '100': '12.2' }));

    await loadLeagueWeekProjections('theleague', 1, SEASON);

    expect(fetchedUrl()).toContain(`/${SEASON}/export`);
  });
});

describe('a read that failed is not a week with no projections', () => {
  it('`res.ok` is not “the data is good” — an HTML body under a 200 is empty', async () => {
    readLeagueFeed.mockReturnValue(null);
    // What a throttled MFL actually answers with.
    fetchMock.mockResolvedValueOnce(
      new Response('<html><body>Too many requests</body></html>', { status: 200 }),
    );

    const map = await loadLeagueWeekProjections('theleague', 1, SEASON);
    expect(map.size).toBe(0);
  });

  it('a non-200 yields an empty map rather than throwing', async () => {
    readLeagueFeed.mockReturnValue(null);
    respond({}, 503);

    await expect(loadLeagueWeekProjections('theleague', 1, SEASON)).resolves.toEqual(new Map());
  });

  it('a network error yields an empty map rather than throwing', async () => {
    readLeagueFeed.mockReturnValue(null);
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(loadLeagueWeekProjections('theleague', 1, SEASON)).resolves.toEqual(new Map());
  });

  it('bounds the read — this runs inside a page render', async () => {
    readLeagueFeed.mockReturnValue(null);
    respond(feed('1', { '100': '12.2' }));

    await loadLeagueWeekProjections('theleague', 1, SEASON);

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('week 0 is the pre-kickoff window, not week 1', () => {
  // MFL serves no live scoring before the Week 1 Thursday and
  // `getCurrentNFLWeek` returns 0 until then. Clamping that up to 1 is what
  // hides the gap, so a falsy week must cost nothing at all.
  it.each([0, -1, NaN])('reads neither disk nor network for week %s', async (week) => {
    const map = await loadLeagueWeekProjections('theleague', week, SEASON);

    expect(map.size).toBe(0);
    expect(readLeagueFeed).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('caching — a projection is a number for the whole week', () => {
  it('does not re-ask MFL for a week it already has', async () => {
    readLeagueFeed.mockReturnValue(null);
    respond(feed('1', { '100': '12.2' }));

    await loadLeagueWeekProjections('theleague', 1, SEASON);
    const again = await loadLeagueWeekProjections('theleague', 1, SEASON);

    expect(again.get('100')).toBe(12.2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches an EMPTY answer only briefly, so a late feed still lands', async () => {
    vi.useFakeTimers();
    readLeagueFeed.mockReturnValue(null);
    respond({}, 503);

    expect((await loadLeagueWeekProjections('theleague', 1, SEASON)).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Inside the negative TTL: no second ask. Re-asking every poll for
    // something MFL just said it has none of is how a board gets throttled.
    vi.advanceTimersByTime(30_000);
    await loadLeagueWeekProjections('theleague', 1, SEASON);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past it: ask again. The sync landing mid-afternoon must be picked up in
    // a minute, not held out for the full ten.
    vi.advanceTimersByTime(45_000);
    respond(feed('1', { '100': '12.2' }));
    expect((await loadLeagueWeekProjections('theleague', 1, SEASON)).get('100')).toBe(12.2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keys the cache per league AND per week — a projection belongs to a player IN A LEAGUE', async () => {
    readLeagueFeed.mockReturnValue(null);
    respond(feed('1', { '100': '12.2' }));
    respond(feed('2', { '100': '31.0' }));
    respond(feed('1', { '100': '5.5' }));

    const w1 = await loadLeagueWeekProjections('theleague', 1, SEASON);
    const w2 = await loadLeagueWeekProjections('theleague', 2, SEASON);
    const afl = await loadLeagueWeekProjections('afl-fantasy', 1, SEASON);

    expect(w1.get('100')).toBe(12.2);
    expect(w2.get('100')).toBe(31.0);
    // The same player, the same week, a different rule set — a different number.
    expect(afl.get('100')).toBe(5.5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('an unknown league is not the default league', () => {
  it('returns empty rather than quietly serving TheLeague’s numbers', async () => {
    const map = await loadLeagueWeekProjections('not-a-league' as never, 1, SEASON);

    expect(map.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
