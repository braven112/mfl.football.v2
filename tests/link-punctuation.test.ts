/**
 * Link punctuation, both directions.
 *
 * Reported 2026-08-16: Roger's roster-cutdown touch ended
 * "Review your plan at <url>." and GroupMe autolinked the trailing period
 * into the href, so every owner who tapped it got a 404.
 *
 * These tests lock the outgoing sanitizer AND the inbound path trim, assert
 * that all three bot-post primitives actually call the sanitizer (a helper
 * existing is not the same as the send path using it), and pin the
 * open-redirect guard on the inbound side.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PUNCTUATION_REDIRECT_STATUS,
  resolvePunctuationRedirect,
  stripLinkAdjacentPunctuation,
  trimTrailingPunctuationFromPath,
} from '../src/utils/link-punctuation.mjs';
import { postToGroupMe } from '../scripts/lib/groupme.mjs';
import { buildSpeculationGroupMeText } from '../scripts/lib/speculation-groupme.mjs';
import { postAsBot } from '../src/utils/groupme-client';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('stripLinkAdjacentPunctuation', () => {
  it('drops the period that broke the roster-cutdown link', () => {
    const text =
      '🚨 Roster cutdown is in 2 days (8:45pm PT). 7 team(s) are over the 22-man limit. ' +
      'Review your plan at https://www.theleague.us/rosters.';
    expect(stripLinkAdjacentPunctuation(text)).toBe(
      '🚨 Roster cutdown is in 2 days (8:45pm PT). 7 team(s) are over the 22-man limit. ' +
        'Review your plan at https://www.theleague.us/rosters',
    );
  });

  it('handles every punctuation mark GroupMe would swallow', () => {
    for (const mark of ['.', ',', ';', ':', '!', '...', '.,']) {
      expect(stripLinkAdjacentPunctuation(`Go to https://www.theleague.us/rosters${mark}`)).toBe(
        'Go to https://www.theleague.us/rosters',
      );
    }
  });

  it('strips punctuation mid-message, not just at the end', () => {
    expect(
      stripLinkAdjacentPunctuation('Plan at https://www.theleague.us/rosters, then cut by 8:45.'),
    ).toBe('Plan at https://www.theleague.us/rosters then cut by 8:45.');
  });

  it('covers the bare www host GroupMe also autolinks', () => {
    expect(stripLinkAdjacentPunctuation('Log in once at www.theleague.us.')).toBe(
      'Log in once at www.theleague.us',
    );
  });

  it('leaves dots INSIDE a url alone', () => {
    for (const url of [
      'https://www.theleague.us/rosters',
      'https://www.theleague.us/api/og/schefter/abc.png',
      'https://www.theleague.us/news?post=x.y#post-x.y',
      'www.theleague.us',
      'https://www.theleague.us/rosters/',
    ]) {
      expect(stripLinkAdjacentPunctuation(`See ${url} now`)).toBe(`See ${url} now`);
      expect(stripLinkAdjacentPunctuation(url)).toBe(url);
    }
  });

  it('does not touch ordinary sentence punctuation', () => {
    const text = 'Roster cutdown is in 2 days (8:45pm PT). 7 team(s) are over the limit, act now!';
    expect(stripLinkAdjacentPunctuation(text)).toBe(text);
  });

  it('passes non-string and empty input through untouched', () => {
    expect(stripLinkAdjacentPunctuation('')).toBe('');
    expect(stripLinkAdjacentPunctuation(undefined as unknown as string)).toBeUndefined();
    expect(stripLinkAdjacentPunctuation(null as unknown as string)).toBeNull();
  });
});

describe('send-path wiring', () => {
  it('postToGroupMe sanitizes the text it POSTs', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));

    await postToGroupMe({
      botId: 'bot-123',
      text: 'Review your plan at https://www.theleague.us/rosters.',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
    expect(body.text).toBe('Review your plan at https://www.theleague.us/rosters');
  });

  it('buildSpeculationGroupMeText sanitizes links inside the LLM body', () => {
    const text = buildSpeculationGroupMeText({
      body: 'Sources say the deal is close. More at https://www.theleague.us/trade-block.',
      postId: 'spec-1',
      publicBaseUrl: 'https://www.theleague.us',
    });
    expect(text).toContain('More at https://www.theleague.us/trade-block\n');
    expect(text).not.toContain('trade-block.');
    // The CTA deep link still ends the message, unpunctuated.
    expect(text.endsWith('#post-spec-1')).toBe(true);
  });

  it('postAsBot sanitizes the text it POSTs', async () => {
    // Behavioral, not a grep: an earlier version of this test only checked
    // that the file MENTIONED the sanitizer, which the import line alone
    // satisfied — reverting postAsBot to post raw `text` still passed.
    const prev = process.env.GROUPME_BOT_ID;
    process.env.GROUPME_BOT_ID = 'bot-abc';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 202 }));

    try {
      await postAsBot('Review your plan at https://www.theleague.us/rosters.');
      const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body));
      expect(body.text).toBe('Review your plan at https://www.theleague.us/rosters');
    } finally {
      if (prev === undefined) delete process.env.GROUPME_BOT_ID;
      else process.env.GROUPME_BOT_ID = prev;
    }
  });

  it('hands the sanitized text to onDryRun so a rehearsal prints real bytes', async () => {
    let seen: string | undefined;
    await postToGroupMe({
      botId: 'bot-123',
      dryRun: true,
      text: 'Plan: https://www.theleague.us/rosters.',
      onDryRun: (t: string) => {
        seen = t;
      },
    });
    expect(seen).toBe('Plan: https://www.theleague.us/rosters');
  });

  it('leaves prose punctuation outside a closing delimiter alone', () => {
    // `)` and `]` end the link unambiguously — no autolinker takes what
    // follows, so stripping it was pure collateral damage on Schefter copy.
    expect(
      stripLinkAdjacentPunctuation('The plan (see https://www.theleague.us/rosters), then act.'),
    ).toBe('The plan (see https://www.theleague.us/rosters), then act.');
    expect(
      stripLinkAdjacentPunctuation('Docs [https://www.theleague.us/rules]: read them.'),
    ).toBe('Docs [https://www.theleague.us/rules]: read them.');
    // ...but a period INSIDE the parens is still the link-breaking case.
    expect(stripLinkAdjacentPunctuation('(https://www.theleague.us/rosters.)')).toBe(
      '(https://www.theleague.us/rosters)',
    );
  });

  it('strips a period followed by an emoji — Roger copy is emoji-dense', () => {
    expect(stripLinkAdjacentPunctuation('Plan: https://www.theleague.us/rosters. 🚨')).toBe(
      'Plan: https://www.theleague.us/rosters 🚨',
    );
  });

  it('keeps a question mark, which never broke the link', () => {
    const text = 'Have you checked https://www.theleague.us/rosters?';
    expect(stripLinkAdjacentPunctuation(text)).toBe(text);
  });

  it('bails on oversized input instead of backtracking', () => {
    // O(n^2) on adversarial input; the cap keeps it off the request path.
    const huge = `${'www.'.repeat(20_000)}X`;
    const started = performance.now();
    expect(stripLinkAdjacentPunctuation(huge)).toBe(huge);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('trimTrailingPunctuationFromPath — inbound rescue', () => {
  it('rescues the link that is already sitting in the chat', () => {
    // Both forms: the apex-host bare path and the prefixed path the older
    // build shipped (vercel.json 301s the prefixed one, then we trim).
    expect(trimTrailingPunctuationFromPath('/rosters.')).toBe('/rosters');
    expect(trimTrailingPunctuationFromPath('/theleague/rosters.')).toBe('/theleague/rosters');
  });

  it('trims every punctuation mark, including runs', () => {
    for (const mark of ['.', ',', ';', ':', '!', '...', '.,']) {
      expect(trimTrailingPunctuationFromPath(`/schefter/tip${mark}`)).toBe('/schefter/tip');
    }
  });

  it('returns null when there is nothing to trim, so it never loops', () => {
    for (const path of ['/rosters', '/', '/afl-fantasy/calendar', '/assets/nfl-logos/TBB.svg']) {
      expect(trimTrailingPunctuationFromPath(path)).toBeNull();
      // Idempotence: whatever a trim produces must itself be a no-op.
      expect(trimTrailingPunctuationFromPath(`${path}.`)).toBe(path === '/' ? '/' : path);
    }
  });

  it('refuses protocol-relative paths — open-redirect guard', () => {
    // `//evil.com` in a Location header leaves our origin entirely.
    expect(trimTrailingPunctuationFromPath('//evil.com.')).toBeNull();
    expect(trimTrailingPunctuationFromPath('//evil.com/theleague/rosters.')).toBeNull();
    expect(trimTrailingPunctuationFromPath('/\\evil.com.')).toBeNull();
  });

  it('refuses control characters that could split a Location header', () => {
    expect(trimTrailingPunctuationFromPath('/rosters\r\nX-Injected: 1.')).toBeNull();
    expect(trimTrailingPunctuationFromPath('/rosters\u0000.')).toBeNull();
  });

  it('degrades a punctuation-only path to the homepage', () => {
    expect(trimTrailingPunctuationFromPath('/.')).toBe('/');
    expect(trimTrailingPunctuationFromPath('/...')).toBe('/');
  });

  it('refuses input that is not a rooted path at all', () => {
    // Shape guards run before the trim, so this exported helper can never
    // hand back a redirect target for something a pathname could not be.
    expect(trimTrailingPunctuationFromPath('.')).toBeNull();
    expect(trimTrailingPunctuationFromPath('rosters.')).toBeNull();
    expect(trimTrailingPunctuationFromPath('https://evil.com/x.')).toBeNull();
  });

  it('leaves percent-encoded slashes same-origin', () => {
    // Encoded slashes stay a path segment; they never resolve cross-origin.
    expect(trimTrailingPunctuationFromPath('/%2f%2fevil.com.')).toBe('/%2f%2fevil.com');
  });

  it('passes non-string and empty input through as null', () => {
    expect(trimTrailingPunctuationFromPath('')).toBeNull();
    expect(trimTrailingPunctuationFromPath(undefined as unknown as string)).toBeNull();
  });

  it('middleware calls the resolver rather than re-deriving the decision', () => {
    expect(read('../src/middleware.ts')).toContain('resolvePunctuationRedirect');
  });
});

describe('resolvePunctuationRedirect — the whole inbound decision', () => {
  // These replace three string-greps against middleware.ts that passed even
  // when the method gate was removed, the status flipped to 308, and the
  // query string was dropped.
  const url = (pathname: string, search = '') => ({ pathname, search });

  it('redirects a navigation and forwards the query string', () => {
    expect(resolvePunctuationRedirect('GET', url('/theleague/rosters.'))).toBe(
      '/theleague/rosters',
    );
    expect(resolvePunctuationRedirect('HEAD', url('/rosters.'))).toBe('/rosters');
    expect(resolvePunctuationRedirect('GET', url('/theleague/news.', '?post=abc'))).toBe(
      '/theleague/news?post=abc',
    );
  });

  it('never redirects a write — a 3xx would drop the request body', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(resolvePunctuationRedirect(method, url('/api/rules-qa.'))).toBeNull();
    }
  });

  it('leaves a clean path alone', () => {
    expect(resolvePunctuationRedirect('GET', url('/theleague/rosters'))).toBeNull();
    expect(resolvePunctuationRedirect('GET', url('/', '?q=cat.'))).toBeNull();
  });

  it('does not touch a free-form search query', () => {
    // Trimming here would turn every search for `cat.` into `cat`.
    expect(
      resolvePunctuationRedirect('GET', url('/api/suggestions/gif-search', '?q=cat.')),
    ).toBeNull();
  });

  it('carries the open-redirect guard through', () => {
    expect(resolvePunctuationRedirect('GET', url('//evil.com.'))).toBeNull();
    expect(resolvePunctuationRedirect('GET', url('/\\evil.com.'))).toBeNull();
  });

  it('is idempotent — its own output never redirects again', () => {
    const once = resolvePunctuationRedirect('GET', url('/theleague/rosters...'));
    expect(once).toBe('/theleague/rosters');
    expect(resolvePunctuationRedirect('GET', url(once!))).toBeNull();
  });

  it('tolerates a malformed url object', () => {
    expect(resolvePunctuationRedirect('GET', undefined as never)).toBeNull();
    expect(resolvePunctuationRedirect('GET', {} as never)).toBeNull();
  });

  it('pins the status as a revocable 302, not a cached permanent redirect', () => {
    expect(PUNCTUATION_REDIRECT_STATUS).toBe(302);
    // And the middleware must send it with no-store — Cloudflare has stamped
    // its own max-age on responses regardless of status before.
    expect(read('../src/middleware.ts')).toContain("'Cache-Control': 'no-store'");
  });
});
