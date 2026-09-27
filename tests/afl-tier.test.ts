import { describe, it, expect } from 'vitest';
import { getTierLogo } from '../src/utils/afl-tier';

describe('afl-tier', () => {
  it('resolves the Premier League logo', () => {
    expect(getTierLogo('Premier League')).toBe('/assets/afl/premier.svg');
  });

  it('resolves the D-League logo', () => {
    expect(getTierLogo('D-League')).toBe('/assets/afl/dleague.svg');
  });

  it('falls back to the D-League mark for a missing tier', () => {
    expect(getTierLogo('')).toBe('/assets/afl/dleague.svg');
  });

  it('reads any other declared tier from /assets/afl/tiers/<slug>', () => {
    // A league config may declare its own tiers (the demo's big league has an
    // "A League"); the league that declares one supplies its mark.
    expect(getTierLogo('A League')).toBe('/assets/afl/tiers/a-league.svg');
  });
});
