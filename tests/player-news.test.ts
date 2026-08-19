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

  it('returns ok with parsed items', async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(fixture) }));
    const result = await fetchAthleteNews('3139477', 2);
    expect(result.status).toBe('ok');
    expect(result.items).toHaveLength(2);
    expect(result.espnId).toBe('3139477');
  });

  it('distinguishes empty from error when ESPN answers with no articles', async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ articles: [] }) }));
    const result = await fetchAthleteNews('3139477');
    expect(result.status).toBe('empty');
    expect(result.items).toEqual([]);
    expect(result.reason).toBeUndefined();
  });

  it('reports a non-200 as error, not as empty', async () => {
    // These two states must never collapse: both yield zero items, and calling
    // an outage "no recent news" is a confident lie to the owner.
    for (const status of [404, 429, 500]) {
      stubFetch(() => Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) }));
      const result = await fetchAthleteNews('3139477');
      expect(result.status).toBe('error');
      expect(result.reason).toBe('upstream-status');
    }
  });

  it('reports a network rejection as error', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNRESET')));
    const result = await fetchAthleteNews('3139477');
    expect(result.status).toBe('error');
    expect(result.reason).toBe('upstream-network');
  });

  it('distinguishes a timeout from a generic network failure', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    stubFetch(() => Promise.reject(timeout));
    const result = await fetchAthleteNews('3139477');
    expect(result.reason).toBe('upstream-timeout');
  });

  it('reports unparseable JSON as error', async () => {
    stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }));
    const result = await fetchAthleteNews('3139477');
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
      const result = await fetchAthleteNews('3139477');
      expect(result.status).toBe('error');
      expect(result.reason).toBe('upstream-shape');
    }
  });

  it('still reports a genuinely empty articles array as empty', async () => {
    stub({ articles: [] });
    const result = await fetchAthleteNews('3139477');
    expect(result.status).toBe('empty');
    expect(result.reason).toBeUndefined();
  });

  it('describePayloadShape names the keys so an upstream change is diagnosable', () => {
    expect(describePayloadShape({ header: 1, athlete: 2 })).toBe('header,athlete');
    expect(describePayloadShape(null)).toBe('object');
    expect(describePayloadShape('x')).toBe('string');
  });
});
