import { describe, it, expect } from 'vitest';
import { selectBreakingStory } from '../src/utils/offseason-hero-data';
import { castStoryModel } from '../src/utils/hero-casting';
import { resolveHeroState } from '../src/utils/hero-resolver';

const REF = new Date('2026-07-15T12:00:00-07:00'); // deep offseason, no game

function post(over: Record<string, any> = {}) {
  return {
    id: 'sf_1',
    tier: 'breaking',
    playerIds: ['13593'],
    headline: 'Blockbuster trade',
    hotTake: 'A stunner.',
    timestamp: '2026-07-15T09:00:00-07:00', // 3h before REF
    ...over,
  };
}

describe('selectBreakingStory', () => {
  it('picks the freshest qualifying breaking post', () => {
    const posts = [
      post({ id: 'old', timestamp: '2026-07-14T20:00:00-07:00' }),
      post({ id: 'fresh', timestamp: '2026-07-15T10:00:00-07:00' }),
    ];
    expect(selectBreakingStory(posts, REF)?.id).toBe('fresh');
  });

  it('ignores non-breaking tiers, empty playerIds, future, and stale posts', () => {
    expect(selectBreakingStory([post({ tier: 'notable' })], REF)).toBeNull();
    expect(selectBreakingStory([post({ playerIds: [] })], REF)).toBeNull();
    expect(selectBreakingStory([post({ timestamp: '2026-07-15T18:00:00-07:00' })], REF)).toBeNull(); // future
    expect(selectBreakingStory([post({ timestamp: '2026-07-10T09:00:00-07:00' })], REF)).toBeNull(); // >48h
  });

  it('maps hotTake→summary and stringifies playerIds', () => {
    const s = selectBreakingStory([post({ playerIds: [13593], hotTake: 'Wow.' })], REF);
    expect(s?.playerIds).toEqual(['13593']);
    expect(s?.summary).toBe('Wow.');
  });

  it('returns null for non-array input', () => {
    expect(selectBreakingStory(undefined, REF)).toBeNull();
    expect(selectBreakingStory('', REF)).toBeNull();
  });
});

describe('castStoryModel', () => {
  const P = (o: Record<string, any> = {}): any => ({
    name: 'X', position: 'QB', nflTeam: 'BAL', espnId: '1',
    headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/1.png', ...o,
  });

  it('returns null when no id composites (DEF or non-ESPN headshot)', () => {
    const players = new Map<string, any>([
      ['1', P({ position: 'DEF' })],
      ['2', P({ headshot: 'https://mfl.com/photos/2_thumb.jpg' })],
    ]);
    expect(castStoryModel(['1', '2'], players)).toBeNull();
    expect(castStoryModel([], players)).toBeNull();
  });

  it('casts the first compositable id, skipping non-compositable ones', () => {
    const players = new Map<string, any>([
      ['1', P({ position: 'DEF' })],
      ['2', P({ name: 'Lamar Jackson' })],
    ]);
    expect(castStoryModel(['1', '2'], players)?.name).toBe('Lamar Jackson');
  });
});

describe('resolveHeroState — breaking-story placement', () => {
  it('leads the offseason when a breaking story exists', () => {
    const state = resolveHeroState(REF, true, [], undefined, false, true);
    expect(state.phase).toBe('breaking-story');
    expect(state.priority).toBe('P0');
  });

  it('does not fire without a breaking story', () => {
    const state = resolveHeroState(REF, true, [], undefined, false, false);
    expect(state.phase).not.toBe('breaking-story');
  });
});
