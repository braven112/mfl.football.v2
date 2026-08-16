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
  stripLinkAdjacentPunctuation,
  trimTrailingPunctuationFromPath,
} from '../src/utils/link-punctuation.mjs';
import { postToGroupMe } from '../scripts/lib/groupme.mjs';
import { buildSpeculationGroupMeText } from '../scripts/lib/speculation-groupme.mjs';

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
    for (const mark of ['.', ',', ';', ':', '!', '?', '...', '?!']) {
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

  it('every bot-post primitive routes through the sanitizer', () => {
    for (const file of [
      '../scripts/lib/groupme.mjs',
      '../scripts/lib/speculation-groupme.mjs',
      '../src/utils/groupme-client.ts',
    ]) {
      expect(read(file)).toContain('stripLinkAdjacentPunctuation');
    }
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
    expect(trimTrailingPunctuationFromPath('.')).toBe('/');
    expect(trimTrailingPunctuationFromPath('...')).toBe('/');
  });

  it('leaves percent-encoded slashes same-origin', () => {
    // Encoded slashes stay a path segment; they never resolve cross-origin.
    expect(trimTrailingPunctuationFromPath('/%2f%2fevil.com.')).toBe('/%2f%2fevil.com');
  });

  it('passes non-string and empty input through as null', () => {
    expect(trimTrailingPunctuationFromPath('')).toBeNull();
    expect(trimTrailingPunctuationFromPath(undefined as unknown as string)).toBeNull();
  });

  it('middleware wires it up for navigations only, as a revocable 302', () => {
    const middleware = read('../src/middleware.ts');
    expect(middleware).toContain('trimTrailingPunctuationFromPath');
    expect(middleware).toContain('302');
    // A 3xx on a write would drop the request body.
    expect(middleware).toContain("REDIRECTABLE_METHODS = new Set(['GET', 'HEAD'])");
    expect(middleware).not.toContain('context.redirect(trimmedPath + context.url.search, 301)');
  });
});
