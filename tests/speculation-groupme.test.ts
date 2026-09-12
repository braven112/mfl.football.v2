import { describe, it, expect, vi } from 'vitest';
import {
  buildSpeculationDeepLink,
  buildSpeculationGroupMeText,
  postSpeculationToGroupMe,
  __testing__,
} from '../scripts/lib/speculation-groupme.mjs';

describe('buildSpeculationDeepLink', () => {
  it('builds an absolute URL anchored on the post id', () => {
    const url = buildSpeculationDeepLink({
      postId: 'sf_speculation_123_abcd',
      publicBaseUrl: 'https://theleague.us',
    });
    expect(url).toBe('https://theleague.us/news?post=sf_speculation_123_abcd#post-sf_speculation_123_abcd');
  });

  it('strips trailing slashes from the base url', () => {
    const url = buildSpeculationDeepLink({
      postId: 'sf_speculation_x',
      publicBaseUrl: 'https://theleague.us//',
    });
    expect(url).toBe('https://theleague.us/news?post=sf_speculation_x#post-sf_speculation_x');
  });

  it('falls back to theleague.us when no base url is provided', () => {
    const url = buildSpeculationDeepLink({ postId: 'sf_speculation_x' });
    expect(url).toBe('https://theleague.us/news?post=sf_speculation_x#post-sf_speculation_x');
  });

  it('throws when postId is missing', () => {
    expect(() => buildSpeculationDeepLink({ postId: '' as any })).toThrow();
    expect(() => buildSpeculationDeepLink({ postId: undefined as any })).toThrow();
  });
});

describe('buildSpeculationGroupMeText', () => {
  /**
   * The CTA sends readers to the TRADE BUILDER, not back to the feed entry
   * they just read in the chat. The post is a hypothetical trade, so the one
   * useful next click is the place an owner can actually build it — and that
   * is where every other trade-flavored Schefter post already points. This
   * lane was the odd one out (owner report, 2026-09-11).
   *
   * It takes the URL rather than composing one: the destination is a PREFIXED
   * internal route, and whether the prefix is kept or stripped depends on the
   * base. Concatenating here is how `theleague.us/theleague/trade-builder`
   * ships — see docs/claude/rules/league-urls.md.
   */
  it('appends the CTA + Trade Builder link to the body, separated by a blank line', () => {
    const text = buildSpeculationGroupMeText({
      body: '🟡 Local fan boards are floating Bowers…',
      ctaUrl: 'https://example.com/trade-builder?b=0004',
    });
    expect(text).toBe(
      '🟡 Local fan boards are floating Bowers…\n\nBuild it yourself → https://example.com/trade-builder?b=0004',
    );
  });

  it('does not send readers back to the post they just read', () => {
    const text = buildSpeculationGroupMeText({
      body: '🟡 …',
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
    });
    expect(text).not.toContain('/news?post=');
    expect(text).toContain('/trade-builder');
  });

  it('preserves the tier emoji prefix verbatim', () => {
    const text = buildSpeculationGroupMeText({
      body: '🟡 …',
      ctaUrl: 'https://www.theleague.us/trade-builder',
    });
    // Tier emoji must NOT be stripped — it's the visual spine of the post.
    expect(text.startsWith('🟡 ')).toBe(true);
  });

  it('throws when body or ctaUrl is missing', () => {
    expect(() =>
      buildSpeculationGroupMeText({ body: '', ctaUrl: 'https://x/trade-builder' }),
    ).toThrow();
    // A missing CTA would silently ship a message ending in a dangling arrow.
    expect(() =>
      buildSpeculationGroupMeText({ body: '🟡 …', ctaUrl: '' }),
    ).toThrow();
  });
});

describe('postSpeculationToGroupMe — dry run', () => {
  it('logs the prepared text and never calls fetch', async () => {
    const fetcher = vi.fn();
    const log = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'sf_speculation_dry', body: '🟡 dry run body' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT' },
      fetcher,
      dryRun: true,
      log,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('dry-run');
    expect(result.text).toContain('https://www.theleague.us/trade-builder?b=0004');
    expect(result.text).not.toContain('/news?post=');
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('still composes a preview when GROUPME_SCHEFTER_BOT_ID is unset', async () => {
    const fetcher = vi.fn();
    const log = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'sf_speculation_noenv', body: '🟡 no env' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: {},
      fetcher,
      dryRun: true,
      log,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('dry-run');
    expect(result.text).toBeTypeOf('string');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('postSpeculationToGroupMe — live', () => {
  it('POSTs the bot_id + composed text to /v3/bots/post and reports success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 202 });
    const log = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'sf_speculation_live', body: '🟡 live body' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT_LIVE' },
      fetcher,
      log,
    });
    expect(result.posted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(__testing__.GROUPME_POST_URL);
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body);
    expect(payload.bot_id).toBe('BOT_LIVE');
    expect(payload.text).toContain('🟡 live body');
    expect(payload.text).toContain('https://www.theleague.us/trade-builder?b=0004');
    expect(payload.text).not.toContain('/news?post=');
  });

  it('skips the network call when GROUPME_SCHEFTER_BOT_ID is unset', async () => {
    const fetcher = vi.fn();
    const warn = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'sf_speculation_x', body: '🟡 …' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: {},
      fetcher,
      warn,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('no-bot-id');
    expect(fetcher).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('reports failure on non-2xx response without throwing', async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 500 });
    const warn = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'sf_speculation_500', body: '🟡 …' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT' },
      fetcher,
      warn,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('http-500');
    expect(warn).toHaveBeenCalled();
  });

  it('reports failure on fetch error without throwing', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'));
    const warn = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'sf_speculation_err', body: '🟡 …' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT' },
      fetcher,
      warn,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('fetch-error');
    expect(warn).toHaveBeenCalled();
  });

  it('rejects malformed posts up-front rather than calling fetch', async () => {
    const fetcher = vi.fn();
    const result = await postSpeculationToGroupMe({
      allowPost: () => true,
      post: { id: 'x' } as any,
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT' },
      fetcher,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('invalid-post');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('the day-plan gate', () => {
  it('is allowed by the calendar, because a trade lane skips it', async () => {
    // trade-speculation is in OWN_BUDGET_KINDS, so isPlannedToday says yes on
    // any weekday. The 3/day + 4h budget is NOT checked here: the calling
    // script gates on it at step 3 and CONSUMES the slot at step 9, both
    // before this runs. A second look at those keys from here sees a
    // millisecond-old last_post_ts and refuses on spacing every single time.
    const result = await postSpeculationToGroupMe({
      post: { id: 'sp_1', body: 'Sources say something is brewing.' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'bot' },
      fetcher: vi.fn().mockResolvedValue({ status: 202 }),
    });
    expect(result.posted).toBe(true);
  });

  it('holds when the day plan refuses', async () => {
    const result = await postSpeculationToGroupMe({
      post: { id: 'sp_2', body: 'Nothing doing.' },
      ctaUrl: 'https://www.theleague.us/trade-builder?b=0004',
      env: { GROUPME_SCHEFTER_BOT_ID: 'bot' },
      allowPost: () => false,
      fetcher: () => {
        throw new Error('must not reach GroupMe');
      },
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('daily-cap');
  });
});
