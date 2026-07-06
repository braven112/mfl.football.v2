import { describe, it, expect } from 'vitest';
import {
  categoryFromAccent,
  castStrategyForCategory,
  castStrategyForAccent,
} from '../src/utils/hero-data/league-event-cast';
import { CATEGORY_ACCENT } from '../src/utils/league-event-hero-view';

/**
 * league-event-cast reverse-maps a LeagueEventView's accent color back to its
 * calendar category and returns the composite-hero casting strategy. Tests
 * pin the mapping against the shared CATEGORY_ACCENT palette so a palette
 * change can't silently mis-cast a hero.
 */
describe('categoryFromAccent', () => {
  it('maps each palette accent back to its category', () => {
    for (const [category, hex] of Object.entries(CATEGORY_ACCENT)) {
      expect(categoryFromAccent(hex)).toBe(category);
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(categoryFromAccent(CATEGORY_ACCENT['free-agency'].toUpperCase())).toBe('free-agency');
    expect(categoryFromAccent(`  ${CATEGORY_ACCENT.draft}  `)).toBe('draft');
  });

  it('returns null for missing or unknown accents', () => {
    expect(categoryFromAccent(undefined)).toBeNull();
    expect(categoryFromAccent('')).toBeNull();
    expect(categoryFromAccent('#123456')).toBeNull();
  });
});

describe('castStrategyForCategory', () => {
  it('free-agency casts the top free agent', () => {
    expect(castStrategyForCategory('free-agency')).toBe('free-agent');
  });

  it('draft casts a rookie', () => {
    expect(castStrategyForCategory('draft')).toBe('rookie');
  });

  it('preseason casts the marquee-game best player', () => {
    expect(castStrategyForCategory('preseason')).toBe('marquee');
  });

  it('regular-season maps to no player (falls back to branded)', () => {
    expect(castStrategyForCategory('regular-season')).toBe('none');
  });

  it('null (unknown category) maps to no player', () => {
    expect(castStrategyForCategory(null)).toBe('none');
  });
});

describe('castStrategyForAccent', () => {
  it('resolves strategy straight from a view accent', () => {
    expect(castStrategyForAccent(CATEGORY_ACCENT['free-agency'])).toBe('free-agent');
    expect(castStrategyForAccent(CATEGORY_ACCENT.draft)).toBe('rookie');
    expect(castStrategyForAccent(CATEGORY_ACCENT.preseason)).toBe('marquee');
    expect(castStrategyForAccent(CATEGORY_ACCENT['regular-season'])).toBe('none');
  });

  it('falls back to none for a bespoke feature/default accent', () => {
    // buildFeatureView uses CATEGORY_ACCENT['free-agency'] (a real category), but
    // an arbitrary/custom accent must not force a player.
    expect(castStrategyForAccent('var(--color-primary, #1c497c)')).toBe('none');
    expect(castStrategyForAccent(undefined)).toBe('none');
  });
});
