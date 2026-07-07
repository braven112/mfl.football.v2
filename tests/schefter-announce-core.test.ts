/**
 * Shared compose core for the Schefter announcement feature. This is the single
 * source of truth the CLI script AND the admin endpoint both call, so locking
 * its behavior here guarantees the in-page preview matches what actually ships.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs imported via allowJs
import {
  resolveLeagues,
  announcePostId,
  buildDeepLink,
  buildAnnouncePost,
  buildGroupMeText,
  validateAnnounceInput,
  DEFAULT_HEADLINE,
  DEFAULT_BODY,
  GROUPME_MAX_CHARS,
  HEADLINE_MAX_CHARS,
  CTA_PREFIX,
} from '../src/utils/schefter-announce-core.mjs';

describe('resolveLeagues', () => {
  it('maps known values', () => {
    expect(resolveLeagues('theleague')).toEqual(['theleague']);
    expect(resolveLeagues('afl')).toEqual(['afl']);
    expect(resolveLeagues('afl-fantasy')).toEqual(['afl']);
    expect(resolveLeagues('both')).toEqual(['theleague', 'afl']);
  });
  it('defaults empty/absent to theleague', () => {
    expect(resolveLeagues('')).toEqual(['theleague']);
    expect(resolveLeagues(undefined)).toEqual(['theleague']);
  });
  it('throws on an unrecognized value (no silent wrong-league fallback)', () => {
    expect(() => resolveLeagues('theleage')).toThrow(/Unknown leagues value/);
    expect(() => resolveLeagues('nfl')).toThrow();
  });
});

describe('announcePostId + buildDeepLink', () => {
  it('derives a deterministic id', () => {
    expect(announcePostId('dark-mode-2026-07')).toBe('sf_announce_dark-mode-2026-07');
  });
  it('builds an unfurl-friendly deep link', () => {
    const link = buildDeepLink({
      baseUrl: 'https://theleague.us',
      newsPath: '/news',
      postId: 'sf_announce_x',
    });
    expect(link).toBe('https://theleague.us/news?post=sf_announce_x#post-sf_announce_x');
  });
  it('does not double up slashes on a trailing-slash base', () => {
    const link = buildDeepLink({ baseUrl: 'https://theleague.us/', newsPath: '/news', postId: 'p' });
    expect(link).toBe('https://theleague.us/news?post=p#post-p');
  });
});

describe('buildAnnouncePost', () => {
  it('satisfies the SchefterPost required-field contract', () => {
    const post = buildAnnouncePost({
      slug: 'x',
      headline: 'H',
      body: 'B',
      navSlug: 'theleague',
      timestamp: '2026-07-07T00:00:00.000Z',
    });
    expect(post).toMatchObject({
      id: 'sf_announce_x',
      timestamp: '2026-07-07T00:00:00.000Z',
      type: 'article',
      category: 'articles',
      tier: 'standard',
      headline: 'H',
      body: 'B',
      franchiseIds: [],
      league: 'theleague',
      authorId: 'claude',
    });
  });
});

describe('buildGroupMeText', () => {
  it('appends the CTA and deep link to the body', () => {
    const text = buildGroupMeText({
      body: 'Hello',
      baseUrl: 'https://theleague.us',
      newsPath: '/news',
      postId: 'sf_announce_x',
    });
    expect(text).toContain('Hello');
    expect(text).toContain(CTA_PREFIX);
    expect(text).toContain('https://theleague.us/news?post=sf_announce_x#post-sf_announce_x');
  });
});

describe('validateAnnounceInput', () => {
  it('accepts a valid input and normalizes it', () => {
    const { errors, resolved } = validateAnnounceInput({
      slug: 'dark-mode-2026-07',
      leagues: 'both',
      headline: 'Fresh look',
      body: 'Short body',
      sendGroupMe: true,
    });
    expect(errors).toEqual([]);
    expect(resolved).toMatchObject({
      slug: 'dark-mode-2026-07',
      headline: 'Fresh look',
      body: 'Short body',
      leagues: ['theleague', 'afl'],
      sendGroupMe: true,
    });
  });

  it('applies default headline/body when blank', () => {
    const { errors, resolved } = validateAnnounceInput({ slug: 'x' });
    expect(errors).toEqual([]);
    expect(resolved.headline).toBe(DEFAULT_HEADLINE);
    expect(resolved.body).toBe(DEFAULT_BODY);
    expect(resolved.sendGroupMe).toBe(true); // default on
  });

  it('requires a kebab-case slug', () => {
    expect(validateAnnounceInput({ slug: '' }).errors.join(' ')).toMatch(/slug is required/);
    expect(validateAnnounceInput({ slug: 'Bad Slug' }).errors.join(' ')).toMatch(/slug is required/);
  });

  it('rejects an unknown leagues value', () => {
    expect(validateAnnounceInput({ slug: 'x', leagues: 'theleage' }).errors.join(' ')).toMatch(
      /Unknown leagues value/,
    );
  });

  it('caps the headline length', () => {
    const long = 'z'.repeat(HEADLINE_MAX_CHARS + 1);
    expect(validateAnnounceInput({ slug: 'x', headline: long }).errors.join(' ')).toMatch(
      /headline is \d+ chars/,
    );
  });

  it('flags an over-long GroupMe message only when sending GroupMe', () => {
    const huge = 'y'.repeat(GROUPME_MAX_CHARS + 50);
    const withGm = validateAnnounceInput({ slug: 'x', body: huge, sendGroupMe: true });
    expect(withGm.errors.join(' ')).toMatch(/GroupMe message for theleague is \d+ chars/);

    const noGm = validateAnnounceInput({ slug: 'x', body: huge, sendGroupMe: false });
    expect(noGm.errors).toEqual([]); // feed-only: length cap does not apply
  });
});
