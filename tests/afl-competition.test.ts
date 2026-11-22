import { describe, it, expect } from 'vitest';
import { getCompetitionLogo } from '../src/utils/afl-competition';

describe('afl-competition', () => {
  it('resolves the Premier League logo', () => {
    expect(getCompetitionLogo('Premier League')).toBe('/assets/afl/premier.svg');
  });

  it('resolves the D-League logo', () => {
    expect(getCompetitionLogo('D-League')).toBe('/assets/afl/dleague.svg');
  });

  it('falls back to the D-League mark for a missing tier', () => {
    expect(getCompetitionLogo('')).toBe('/assets/afl/dleague.svg');
  });

  it('reads any other declared tier from /assets/afl/tiers/<slug>', () => {
    // A league config may declare its own tiers (the demo's big league has an
    // "A League"); the league that declares one supplies its mark.
    expect(getCompetitionLogo('A League')).toBe('/assets/afl/tiers/a-league.svg');
  });
});
