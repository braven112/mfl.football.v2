import { describe, it, expect, vi, afterEach } from 'vitest';
import fixture from './fixtures/espn-athlete-news.json';
import {
  isValidEspnId,
  buildAthleteNewsUrl,
  safeExternalUrl,
  parseEspnAthleteNews,
  clampLimit,
  fetchAthleteNews,
  ESPN_ATHLETE_NEWS_BASE,
  PLAYER_NEWS_MAX_LIMIT,
  PLAYER_NEWS_DEFAULT_LIMIT,
  describePayloadShape,
  extractOverviewArticles,
  filterRecentNews,
  playerNewsWindowDays,
  PLAYER_NEWS_WINDOW_DAYS_IN_SEASON,
  PLAYER_NEWS_WINDOW_DAYS_OFFSEASON,
} from '../src/utils/player-news';

/**
 * ESPN is unreachable from CI and from the dev sandbox (egress policy 403s every
 * espn.com host), so these fixture-driven tests are the ONLY local verification
 * this feature gets. They assert real return values, not source text — the
 * middleware post-mortem in CLAUDE.md is the reason: grep-shaped tests there
 * stayed green through a deleted method gate and a dropped header.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Pinned clock for every fetch test.
 *
 * News is now filtered to a recency window, so a fixture article's publish date
 * is only "recent" relative to some `now`. Left on the wall clock, every one of
 * these assertions would silently flip from the parse path to the empty path on
 * a future calendar date — a test that expires is not a test.
 */
const NOW = new Date('2026-08-22T00:00:00Z');

describe('isValidEspnId', () => {
  it('accepts the plain digit ids the MFL feed actually carries', () => {
    // Real values: 100% of espn_id in the players feed match /^\d+$/, 4-7 chars.
    for (const id of ['1257', '3139477', '4362628']) {
      expect(isValidEspnId(id)).toBe(true);
    }
  });

  it('rejects anything that could reshape the upstream URL path', () => {
    for (const bad of ['../../etc', '3139477/../9', 'https://evil.test', '12a', '', ' 123', '123 ', '1\n2']) {
      expect(isValidEspnId(bad)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    for (const bad of [null, undefined, 3139477, {}, []]) {
      expect(isValidEspnId(bad)).toBe(false);
    }
  });
});

describe('buildAthleteNewsUrl', () => {
  it('builds the athlete-scoped endpoint', () => {
    expect(buildAthleteNewsUrl('3139477')).toBe(
      `${ESPN_ATHLETE_NEWS_BASE}/3139477/news`,
    );
  });

  it('returns null rather than a malformed URL for a bad id', () => {
    for (const bad of ['../x', '', '12a', null, undefined]) {
      expect(buildAthleteNewsUrl(bad)).toBeNull();
    }
  });
});

describe('safeExternalUrl', () => {
  it('accepts http and https', () => {
    expect(safeExternalUrl('https://www.espn.com/nfl/story')).toBe('https://www.espn.com/nfl/story');
    expect(safeExternalUrl('http://www.espn.com/nfl/story')).toBe('http://www.espn.com/nfl/story');
  });

  it('rejects script-bearing and non-web schemes', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });

  it('rejects junk without throwing', () => {
    for (const bad of ['', '   ', 'not a url', null, undefined, 42, {}]) {
      expect(safeExternalUrl(bad)).toBeNull();
    }
  });
});

describe('clampLimit', () => {
  it('clamps into [1, max]', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(999)).toBe(PLAYER_NEWS_MAX_LIMIT);
    expect(clampLimit('3')).toBe(3);
  });

  it('falls back to the default for junk', () => {
    expect(clampLimit('abc')).toBe(PLAYER_NEWS_DEFAULT_LIMIT);
    expect(clampLimit(undefined)).toBe(PLAYER_NEWS_DEFAULT_LIMIT);
  });
});

describe('parseEspnAthleteNews', () => {
  it('maps ESPN fields onto the normalized item', () => {
    const [first] = parseEspnAthleteNews(fixture, 1);
    expect(first).toEqual({
      id: '47251841',
      headline: 'Chase posts 9-141-2 in divisional win',
      description: 'A season high in yards, and his second multi-touchdown game in three weeks.',
      published: '2025-12-15T04:12:00Z',
      type: 'Recap',
      link: 'https://www.espn.com/nfl/recap/_/id/47251841',
    });
  });

  it('orders newest first', () => {
    const items = parseEspnAthleteNews(fixture, 3);
    expect(items.map((i) => i.published)).toEqual([
      '2025-12-15T04:12:00Z',
      '2025-12-13T01:41:50Z',
      '2025-12-10T13:37:32Z',
    ]);
  });

  it('respects the limit', () => {
    expect(parseEspnAthleteNews(fixture, 2)).toHaveLength(2);
    expect(parseEspnAthleteNews(fixture, 1)).toHaveLength(1);
  });

  it('drops an article with no headline (nothing to render)', () => {
    const all = parseEspnAthleteNews(fixture, PLAYER_NEWS_MAX_LIMIT);
    expect(all.some((i) => i.description.includes('must be dropped'))).toBe(false);
  });

  it('KEEPS an article whose link is hostile, but nulls the link', () => {
    // Losing the click is better than losing the story - and the javascript:
    // href must never reach an anchor.
    const all = parseEspnAthleteNews(fixture, PLAYER_NEWS_MAX_LIMIT);
    const hostile = all.find((i) => i.headline === 'Article with a hostile link');
    expect(hostile).toBeDefined();
    expect(hostile!.link).toBeNull();
  });

  it('handles a missing links object', () => {
    const all = parseEspnAthleteNews(fixture, PLAYER_NEWS_MAX_LIMIT);
    const noLink = all.find((i) => i.headline === 'Article with no link at all');
    expect(noLink!.link).toBeNull();
  });

  it('defaults a missing type and description', () => {
    const all = parseEspnAthleteNews(fixture, PLAYER_NEWS_MAX_LIMIT);
    const bare = all.find((i) => i.headline === 'Article with no type and no description');
    expect(bare!.type).toBe('Story');
    expect(bare!.description).toBe('');
  });

  it('nulls an unparseable date and sorts it last instead of poisoning the compare', () => {
    // Asserted on a purpose-built payload rather than the fixture: the fixture
    // has 7 renderable articles and the undated one legitimately sorts past the
    // 6-item cap, so it would be sliced off before the ordering could be seen.
    const items = parseEspnAthleteNews({
      articles: [
        { id: 1, headline: 'undated', published: 'not-a-date' },
        { id: 2, headline: 'older', published: '2025-12-01T00:00:00Z' },
        { id: 3, headline: 'newer', published: '2025-12-20T00:00:00Z' },
      ],
    }, PLAYER_NEWS_MAX_LIMIT);

    expect(items.map((i) => i.headline)).toEqual(['newer', 'older', 'undated']);
    expect(items[2].published).toBeNull();
  });

  it('never throws on a hostile or absent envelope', () => {
    for (const junk of [null, undefined, {}, [], 'string', 42, { articles: null }, { articles: 'nope' }]) {
      expect(parseEspnAthleteNews(junk)).toEqual([]);
    }
    expect(parseEspnAthleteNews({ articles: [null, 3, 'x', {}] })).toEqual([]);
  });
});

describe('fetchAthleteNews', () => {
  const stubFetch = (impl: () => unknown) => {
    // Typed with the arg list so `spy.mock.calls[0][0]` (the requested URL) is
    // indexable — a bare vi.fn(() => …) infers an empty tuple for calls.
    const spy = vi.fn((..._args: unknown[]) => impl());
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  // The fixture's articles are dated mid-December 2025, so every call that
  // expects them to SURVIVE has to run its clock next to them — the recency
  // window would age them out under the wall clock, and these tests would
  // quietly start asserting the empty path instead of the parse path.
  const FIXTURE_NOW = new Date('2025-12-16T00:00:00Z');

  it('returns ok with parsed items', async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) }));
    const result = await fetchAthleteNews('3139477', 2, FIXTURE_NOW);
    expect(result.status).toBe('ok');
    expect(result.items).toHaveLength(2);
    expect(result.espnId).toBe('3139477');
  });

  it('distinguishes empty from error when BOTH sources answer with no articles', async () => {
    // Both sources must answer cleanly: `empty` now means "everyone we asked
    // said there is nothing", not "the first one did".
    vi.stubGlobal('fetch', vi.fn((url: unknown) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(
          String(url).includes('/overview') ? { news: { articles: [] } } : { articles: [] },
        ),
      }),
    ));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
    expect(result.items).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  it('reports a non-200 as error, not as empty', async () => {
    // These two states must never collapse: both yield zero items, and calling
    // an outage "no recent news" is a confident lie to the owner.
    for (const status of [404, 429, 500]) {
      stubFetch(() => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) }));
      const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
      expect(result.status).toBe('error');
      expect(result.reason).toBe('upstream-status');
    }
  });

  it('reports a network rejection as error', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNRESET')));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('upstream-network');
  });

  it('distinguishes a timeout from a generic network failure', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    stubFetch(() => Promise.reject(timeout));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.reason).toBe('upstream-timeout');
  });

  it('reports unparseable JSON as error', async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('upstream-shape');
  });

  it('never calls fetch for an invalid id', async () => {
    const spy = stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) }));
    const result = await fetchAthleteNews('../../etc');
    expect(spy).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.reason).toBe('upstream-shape');
  });

  it('calls the athlete-scoped URL, never a team-scoped one', async () => {
    const spy = stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) }));
    await fetchAthleteNews('4362628');
    expect(spy.mock.calls[0][0]).toBe(`${ESPN_ATHLETE_NEWS_BASE}/4362628/news`);
    expect(String(spy.mock.calls[0][0])).not.toContain('news?team=');
  });
});

describe('shape mismatch is never reported as "no news"', () => {
  // Every player on the preview deploy came back `empty` — Mahomes, Kelce,
  // Budda Baker. That is not a league-wide news drought; it is the parser
  // returning [] for an envelope it did not recognize. Both cases produce zero
  // articles, which is exactly why they have to be separated here.
  const stub = (payload: unknown) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })));
  };

  it('treats a missing articles array as error, not empty', async () => {
    for (const payload of [{}, { news: [] }, { items: [] }, { articles: null }, { articles: 'nope' }, []]) {
      stub(payload);
      const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
      expect(result.status).toBe('error');
      expect(result.reason).toBe('upstream-shape');
    }
  });

  it('still reports a genuinely empty articles array as empty', async () => {
    // Both sources clean and empty — see the two-source ladder block.
    vi.stubGlobal('fetch', vi.fn((url: unknown) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(
          String(url).includes('/overview') ? { news: { articles: [] } } : { articles: [] },
        ),
      }),
    ));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
    expect(result.reason).toBeUndefined();
  });

  it('describePayloadShape names the keys so an upstream change is diagnosable', () => {
    expect(describePayloadShape({ header: 1, athlete: 2 })).toBe('header,athlete');
    expect(describePayloadShape(null)).toBe('object');
    expect(describePayloadShape('x')).toBe('string');
  });
});

describe('two-source ladder', () => {
  // Source 1 (athletes/{id}/news) answers 200 with an empty articles array for
  // every athlete tried on a live deploy. It is reachable and honest, just
  // empty — so an empty first source must not be treated as proof of absence.
  const routeFetch = (byUrl: Record<string, { ok: boolean; body: unknown }>) => {
    const spy = vi.fn((url: unknown) => {
      const key = Object.keys(byUrl).find((k) => String(url).includes(k));
      const hit = key ? byUrl[key] : { ok: false, body: {} };
      return Promise.resolve({ ok: hit.ok, json: () => Promise.resolve(hit.body) });
    });
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  const article = (headline: string) => ({
    id: 1, headline, description: 'd', published: '2026-08-19T00:00:00Z',
    type: 'Story', links: { web: { href: 'https://espn.com/x' } },
  });

  it('prefers source 1 and does not call the overview when it has articles', async () => {
    const spy = routeFetch({ '/news': { ok: true, body: { articles: [article('from news')] } } });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('athlete-news');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falls through to the overview when source 1 is empty', async () => {
    routeFetch({
      '/news': { ok: true, body: { articles: [] } },
      '/overview': { ok: true, body: { news: { articles: [article('from overview')] } } },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('athlete-overview');
    expect(result.items[0].headline).toBe('from overview');
  });

  it('reports empty only when BOTH sources are empty', async () => {
    routeFetch({
      '/news': { ok: true, body: { articles: [] } },
      '/overview': { ok: true, body: { news: { articles: [] } } },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
    expect(result.source).toBeUndefined();
  });

  it('a failing source 1 does NOT veto a clean overview that has nothing recent', async () => {
    // Observed live 2026-08-22: source 1 403s from the sandbox while the
    // overview answers fine. With source 1 allowed to veto, a player whose
    // overview articles all fell outside the recency window rendered as
    // "Couldn't reach ESPN" behind a Retry that could never change the answer
    // — which made the empty state unreachable the whole time source 1 was
    // down. The overview is the real provider; if it answered, we believe it.
    routeFetch({
      '/news': { ok: false, body: {} },
      '/overview': {
        ok: true,
        body: { news: { articles: [{ ...article('ancient'), published: '2024-01-01T00:00:00Z' }] } },
      },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
    expect(result.reason).toBeUndefined();
  });

  it('a failing source 1 does not veto a clean, genuinely empty overview either', async () => {
    routeFetch({
      '/news': { ok: false, body: {} },
      '/overview': { ok: true, body: { news: { articles: [] } } },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
  });

  it('a source-1 TIMEOUT does not short-circuit the overview either', async () => {
    // The status check and the fetch rejection are two different failure paths
    // and only the first one had been de-vetoed. A slow or unroutable
    // site.api.espn.com would return before the overview was ever asked,
    // blanking news for every player while the real provider sat there healthy.
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn((url: unknown) => {
      if (String(url).includes('/overview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ news: { articles: [article('survived the timeout')] } }),
        });
      }
      return Promise.reject(timeout);
    }));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('athlete-overview');
    expect(result.items[0].headline).toBe('survived the timeout');
  });

  it('a source-1 network rejection leaves a clean, empty overview as empty', async () => {
    vi.stubGlobal('fetch', vi.fn((url: unknown) =>
      String(url).includes('/overview')
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ news: { articles: [] } }) })
        : Promise.reject(new Error('ECONNREFUSED')),
    ));
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
    expect(result.reason).toBeUndefined();
  });

  it('a failing overview is an ERROR even though source 1 read cleanly', async () => {
    // Deliberate reversal of the original rule. Source 1 is vestigial — it
    // answers empty for every athlete in production — so its clean read carries
    // no information about whether news exists. If the overview (the actual
    // provider) fails, we do not know, and saying "No recent ESPN stories"
    // would be a confident claim resting on the uninformative source.
    routeFetch({
      '/news': { ok: true, body: { articles: [] } },
      '/overview': { ok: false, body: {} },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('upstream-status');
  });

  it('a failing source 1 still falls through to the overview', async () => {
    // The fix for the short-circuit: source 1 is the vestigial endpoint, so a
    // 404/5xx there must not blank the feature behind an unusable Retry.
    routeFetch({
      '/news': { ok: false, body: {} },
      '/overview': { ok: true, body: { news: { articles: [article('recovered')] } } },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('ok');
    expect(result.source).toBe('athlete-overview');
    expect(result.items[0].headline).toBe('recovered');
  });

  it('an envelope with articles that all fail to parse is a shape error, not empty', async () => {
    // Validating only the container would let an item-level rename render as a
    // confident, CDN-cached "no news" on every player.
    routeFetch({
      '/news': { ok: true, body: { articles: [{ title: 'renamed field' }, { title: 'another' }] } },
      '/overview': { ok: true, body: { news: { articles: [] } } },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('error');
    expect(result.reason).toBe('upstream-shape');
  });

  it('extractOverviewArticles separates a missing envelope from an empty list', () => {
    expect(extractOverviewArticles({ news: { articles: [] } })).toEqual([]);
    expect(extractOverviewArticles({ news: {} })).toBeNull();
    expect(extractOverviewArticles({})).toBeNull();
    expect(extractOverviewArticles(null)).toBeNull();
  });
});

describe('extractOverviewArticles tolerates ESPN inconsistency', () => {
  // Observed live: the overview's top-level keys are
  // statistics,news,nextGame,gameLog,rotowire,awards,fantasy — so `news` exists,
  // but its inner shape is undocumented even in the community reference.
  it('accepts the shapes news plausibly takes', () => {
    const a = [{ headline: 'x' }];
    expect(extractOverviewArticles({ news: a })).toEqual(a);
    expect(extractOverviewArticles({ news: { articles: a } })).toEqual(a);
    expect(extractOverviewArticles({ news: { items: a } })).toEqual(a);
    expect(extractOverviewArticles({ news: { article: a } })).toEqual(a);
    expect(extractOverviewArticles({ news: { feed: a } })).toEqual(a);
  });

  it('returns null (unrecognized), never [], for a shape it does not know', () => {
    expect(extractOverviewArticles({ news: { something: 1 } })).toBeNull();
    expect(extractOverviewArticles({ news: 'text' })).toBeNull();
    expect(extractOverviewArticles({})).toBeNull();
    expect(extractOverviewArticles(null)).toBeNull();
  });

  it('an empty list is empty, not unrecognized', () => {
    expect(extractOverviewArticles({ news: [] })).toEqual([]);
    expect(extractOverviewArticles({ news: { articles: [] } })).toEqual([]);
  });
});

/**
 * The recency window. Two clocks matter here and they are easy to conflate:
 * `getCurrentSeasonYear()` rolls at LABOR DAY, so it names a season that may be
 * over (Feb-Aug) or not yet started (Labor Day-kickoff). Only
 * `isSeasonWindowOpen` says whether that season is actually being PLAYED, which
 * is the question the window depends on.
 */
describe('playerNewsWindowDays', () => {
  it('uses the short window while the season is being played', () => {
    // 2026 kickoff is the Thursday after Labor Day (Sep 7) = Sep 10.
    for (const date of ['2026-09-11', '2026-10-15', '2026-12-25', '2027-01-15']) {
      expect(playerNewsWindowDays(new Date(`${date}T12:00:00Z`)))
        .toBe(PLAYER_NEWS_WINDOW_DAYS_IN_SEASON);
    }
  });

  it('opens to the long window in the offseason', () => {
    // March and July are obvious. Aug 22 is the one that matters: the feeds of
    // the 2025 season are complete, which is exactly why "the feeds have a
    // completed week" is not an offseason guard.
    for (const date of ['2026-03-01', '2026-06-15', '2026-07-04', '2026-08-22']) {
      expect(playerNewsWindowDays(new Date(`${date}T12:00:00Z`)))
        .toBe(PLAYER_NEWS_WINDOW_DAYS_OFFSEASON);
    }
  });

  it('treats the Labor Day-to-kickoff gap as offseason, not as in-season', () => {
    // getCurrentSeasonYear() has already rolled to 2026 here, but 2026 has not
    // kicked off. Reading the year roll as "the season is on" would cut the
    // window to 30 days for a week when nothing has been played yet.
    expect(playerNewsWindowDays(new Date('2026-09-08T12:00:00Z')))
      .toBe(PLAYER_NEWS_WINDOW_DAYS_OFFSEASON);
  });

  it('is one of the two windows, never something in between', () => {
    expect(PLAYER_NEWS_WINDOW_DAYS_IN_SEASON).toBe(30);
    expect(PLAYER_NEWS_WINDOW_DAYS_OFFSEASON).toBe(90);
  });
});

describe('filterRecentNews', () => {
  const item = (id: string, published: string | null) => ({
    id, headline: `h${id}`, description: '', published, type: 'Story', link: null,
  });
  const now = new Date('2026-10-01T00:00:00Z');

  it('keeps articles inside the window and drops the ones outside it', () => {
    const kept = filterRecentNews(
      [
        item('fresh', '2026-09-29T00:00:00Z'),
        item('edge', '2026-09-01T00:00:00Z'),   // exactly 30 days — inclusive
        item('stale', '2026-08-25T00:00:00Z'),
      ],
      30,
      now,
    );
    expect(kept.map((i) => i.id)).toEqual(['fresh', 'edge']);
  });

  it('the wider offseason window keeps what the in-season one drops', () => {
    const items = [item('summer', '2026-07-20T00:00:00Z')];
    expect(filterRecentNews(items, 30, now)).toHaveLength(0);
    expect(filterRecentNews(items, 90, now)).toHaveLength(1);
  });

  it('drops an undated article — it cannot be shown to be inside the window', () => {
    // These sort LAST, so they only ever surface once the dated articles run
    // out: precisely the player whose real news is two years old.
    expect(filterRecentNews([item('nodate', null)], 90, now)).toEqual([]);
  });

  it('keeps a future-dated article — clock skew is not staleness', () => {
    expect(filterRecentNews([item('ahead', '2026-10-02T00:00:00Z')], 30, now)).toHaveLength(1);
  });

  it('never throws on an unparseable date', () => {
    expect(filterRecentNews([item('junk', 'not-a-date')], 30, now)).toEqual([]);
  });
});

describe('stale-only results are empty, never an error', () => {
  const stale = {
    id: 1, headline: 'last December', description: 'd', published: '2025-12-01T00:00:00Z',
    type: 'Story', links: { web: { href: 'https://espn.com/x' } },
  };

  const routeFetch = (byUrl: Record<string, { ok: boolean; body: unknown }>) => {
    const spy = vi.fn((url: unknown) => {
      const key = Object.keys(byUrl).find((k) => String(url).includes(k));
      const hit = key ? byUrl[key] : { ok: false, body: {} };
      return Promise.resolve({ ok: hit.ok, json: () => Promise.resolve(hit.body) });
    });
    vi.stubGlobal('fetch', spy);
    return spy;
  };

  it('reads a perfectly-formed but aged-out envelope as empty', async () => {
    // The regression this guards: filtering BEFORE the "articles but none
    // renderable" check would make three readable-but-old stories look like an
    // item-shape change, and paint a retryable "Couldn't reach ESPN" over what
    // is really just a quiet player.
    routeFetch({
      '/news': { ok: true, body: { articles: [stale] } },
      '/overview': { ok: true, body: { news: { articles: [stale] } } },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('empty');
    expect(result.reason).toBeUndefined();
    expect(result.items).toEqual([]);
  });

  it('falls through to the overview when source 1 has only stale articles', async () => {
    routeFetch({
      '/news': { ok: true, body: { articles: [stale] } },
      '/overview': {
        ok: true,
        body: { news: { articles: [{ ...stale, headline: 'this week', published: '2026-08-20T00:00:00Z' }] } },
      },
    });
    const result = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(result.status).toBe('ok');
    expect(result.items.map((i) => i.headline)).toEqual(['this week']);
  });

  it('reports the window it applied so the UI can name it', async () => {
    routeFetch({
      '/news': { ok: true, body: { articles: [] } },
      '/overview': { ok: true, body: { news: { articles: [] } } },
    });
    const offseason = await fetchAthleteNews('3139477', PLAYER_NEWS_DEFAULT_LIMIT, NOW);
    expect(offseason.windowDays).toBe(PLAYER_NEWS_WINDOW_DAYS_OFFSEASON);

    const inSeason = await fetchAthleteNews(
      '3139477', PLAYER_NEWS_DEFAULT_LIMIT, new Date('2026-11-01T00:00:00Z'),
    );
    expect(inSeason.windowDays).toBe(PLAYER_NEWS_WINDOW_DAYS_IN_SEASON);
  });
});
