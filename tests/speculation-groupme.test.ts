import { describe, it, expect, vi } from 'vitest';
import {
  buildSpeculationDeepLink,
  buildSpeculationGroupMeText,
  postSpeculationToGroupMe,
  __testing__,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/speculation-groupme.mjs';

describe('buildSpeculationDeepLink', () => {
  it('builds an absolute URL anchored on the post id', () => {
    const url = buildSpeculationDeepLink({
      postId: 'sf_speculation_123_abcd',
      publicBaseUrl: 'https://theleague.us',
    });
    expect(url).toBe('https://theleague.us/news#post-sf_speculation_123_abcd');
  });

  it('strips trailing slashes from the base url', () => {
    const url = buildSpeculationDeepLink({
      postId: 'sf_speculation_x',
      publicBaseUrl: 'https://theleague.us//',
    });
    expect(url).toBe('https://theleague.us/news#post-sf_speculation_x');
  });

  it('falls back to theleague.us when no base url is provided', () => {
    const url = buildSpeculationDeepLink({ postId: 'sf_speculation_x' });
    expect(url).toBe('https://theleague.us/news#post-sf_speculation_x');
  });

  it('throws when postId is missing', () => {
    expect(() => buildSpeculationDeepLink({ postId: '' as any })).toThrow();
    expect(() => buildSpeculationDeepLink({ postId: undefined as any })).toThrow();
  });
});

describe('buildSpeculationGroupMeText', () => {
  it('appends the CTA + deep link to the body, separated by a blank line', () => {
    const text = buildSpeculationGroupMeText({
      body: '🟡 Local fan boards are floating Bowers…',
      postId: 'sf_speculation_42',
      publicBaseUrl: 'https://example.com',
    });
    expect(text).toBe(
      '🟡 Local fan boards are floating Bowers…\n\nRead the speculation → https://example.com/news#post-sf_speculation_42',
    );
  });

  it('preserves the tier emoji prefix verbatim', () => {
    const text = buildSpeculationGroupMeText({
      body: '🟡 …',
      postId: 'sf_speculation_x',
      publicBaseUrl: 'https://theleague.us',
    });
    // Tier emoji must NOT be stripped — it's the visual spine of the post.
    expect(text.startsWith('🟡 ')).toBe(true);
  });

  it('throws when body is missing', () => {
    expect(() =>
      buildSpeculationGroupMeText({
        body: '',
        postId: 'x',
        publicBaseUrl: 'https://theleague.us',
      }),
    ).toThrow();
  });
});

describe('postSpeculationToGroupMe — dry run', () => {
  it('logs the prepared text and never calls fetch', async () => {
    const fetcher = vi.fn();
    const log = vi.fn();
    const result = await postSpeculationToGroupMe({
      post: { id: 'sf_speculation_dry', body: '🟡 dry run body' },
      publicBaseUrl: 'https://theleague.us',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT' },
      fetcher,
      dryRun: true,
      log,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('dry-run');
    expect(result.text).toContain('https://theleague.us/news#post-sf_speculation_dry');
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('still composes a preview when GROUPME_SCHEFTER_BOT_ID is unset', async () => {
    const fetcher = vi.fn();
    const log = vi.fn();
    const result = await postSpeculationToGroupMe({
      post: { id: 'sf_speculation_noenv', body: '🟡 no env' },
      publicBaseUrl: 'https://theleague.us',
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
      post: { id: 'sf_speculation_live', body: '🟡 live body' },
      publicBaseUrl: 'https://theleague.us',
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
    expect(payload.text).toContain('https://theleague.us/news#post-sf_speculation_live');
  });

  it('skips the network call when GROUPME_SCHEFTER_BOT_ID is unset', async () => {
    const fetcher = vi.fn();
    const warn = vi.fn();
    const result = await postSpeculationToGroupMe({
      post: { id: 'sf_speculation_x', body: '🟡 …' },
      publicBaseUrl: 'https://theleague.us',
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
      post: { id: 'sf_speculation_500', body: '🟡 …' },
      publicBaseUrl: 'https://theleague.us',
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
      post: { id: 'sf_speculation_err', body: '🟡 …' },
      publicBaseUrl: 'https://theleague.us',
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
      post: { id: 'x' } as any,
      publicBaseUrl: 'https://theleague.us',
      env: { GROUPME_SCHEFTER_BOT_ID: 'BOT' },
      fetcher,
    });
    expect(result.posted).toBe(false);
    expect(result.reason).toBe('invalid-post');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
