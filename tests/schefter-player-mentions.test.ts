/**
 * Player-mention matching for the player modal's "Schefter Report" section.
 * Locks in the matching contract: playerIds hit OR full-name hit (word
 * boundary), never last-name-only, feed order preserved.
 */
import { describe, it, expect } from 'vitest';
import {
  findPlayerMentions,
  normalizePlayerName,
  buildNameMatcher,
} from '../src/utils/schefter-player-mentions';
import type { SchefterPost } from '../src/types/schefter';

function post(overrides: Partial<SchefterPost>): SchefterPost {
  return {
    id: 'sf_test',
    timestamp: '2026-07-01T00:00:00Z',
    type: 'transaction',
    tier: 'standard',
    headline: 'Headline',
    body: 'Body',
    franchiseIds: [],
    ...overrides,
  } as SchefterPost;
}

describe('normalizePlayerName', () => {
  it('flips MFL "Last, First" to "First Last"', () => {
    expect(normalizePlayerName('Mahomes, Patrick')).toBe('Patrick Mahomes');
  });

  it('passes through "First Last" and collapses whitespace', () => {
    expect(normalizePlayerName('  Josh   Allen ')).toBe('Josh Allen');
  });
});

describe('buildNameMatcher', () => {
  it('matches the full name at word boundaries, case-insensitive', () => {
    const m = buildNameMatcher('Josh Allen')!;
    expect(m.test('BREAKING: josh allen traded')).toBe(true);
    expect(m.test('Josh Allen.')).toBe(true);
  });

  it('does not match name fragments inside longer words', () => {
    const m = buildNameMatcher('Josh Allen')!;
    expect(m.test('Joshua Allende signs')).toBe(false);
    expect(m.test('Allen goes deep')).toBe(false);
  });

  it('handles punctuated names literally', () => {
    const m = buildNameMatcher("Ja'Marr Chase")!;
    expect(m.test("Ja'Marr Chase scores")).toBe(true);
    expect(m.test('JaMarr Chase scores')).toBe(false);
  });

  it('refuses single-token names (last-name-only is too noisy)', () => {
    expect(buildNameMatcher('Allen')).toBeNull();
  });
});

describe('findPlayerMentions', () => {
  const posts: SchefterPost[] = [
    post({ id: 'p1', headline: 'Kenyon Sadiq hype', body: 'Kenyon Sadiq hype', type: 'external', link: 'https://espn.com/x' }),
    post({ id: 'p2', headline: 'Pigskins sign a WR', body: 'Big deal for the roster.', playerIds: ['15281'] }),
    post({ id: 'p3', headline: 'Unrelated rumor', body: 'Nothing here.' }),
    post({ id: 'p4', headline: 'Sadiq again', body: 'Kenyon Sadiq continues to impress in camp this July.' }),
  ];

  it('matches by tagged playerIds', () => {
    const hits = findPlayerMentions(posts, { playerId: '15281' }, 5);
    expect(hits.map((h) => h.id)).toEqual(['p2']);
  });

  it('matches by full name in headline or body', () => {
    const hits = findPlayerMentions(posts, { playerName: 'Kenyon Sadiq' }, 5);
    expect(hits.map((h) => h.id).sort()).toEqual(['p1', 'p4']);
  });

  it('ranks league-origin posts ahead of external wire posts', () => {
    // p1 is external (wire), p4 is a league post but older — p4 wins the sort
    const hits = findPlayerMentions(posts, { playerName: 'Kenyon Sadiq' }, 5);
    expect(hits.map((h) => h.id)).toEqual(['p4', 'p1']);
  });

  it('accepts MFL "Last, First" names', () => {
    const hits = findPlayerMentions(posts, { playerName: 'Sadiq, Kenyon' }, 5);
    expect(hits.map((h) => h.id)).toEqual(['p4', 'p1']);
  });

  it('respects the limit (league posts get the slots first)', () => {
    const hits = findPlayerMentions(posts, { playerName: 'Kenyon Sadiq' }, 1);
    expect(hits.map((h) => h.id)).toEqual(['p4']);
  });

  it('empties the excerpt when the body just repeats the headline', () => {
    const hits = findPlayerMentions(posts, { playerName: 'Kenyon Sadiq' }, 5);
    expect(hits[0].excerpt).toContain('camp'); // p4: real body
    expect(hits[1].excerpt).toBe(''); // p1: body === headline
  });

  it('carries external links through and defaults to null', () => {
    const hits = findPlayerMentions(posts, { playerName: 'Kenyon Sadiq' }, 5);
    expect(hits[0].link).toBeNull(); // p4: internal post
    expect(hits[1].link).toBe('https://espn.com/x'); // p1: wire link
  });

  it('returns nothing without id or usable name', () => {
    expect(findPlayerMentions(posts, {}, 5)).toEqual([]);
    expect(findPlayerMentions(posts, { playerName: 'Sadiq' }, 5)).toEqual([]);
  });
});
