import { describe, it, expect } from 'vitest';
import { getTierLogo } from '../src/utils/afl-tier';

describe('afl-tier', () => {
  it('resolves the Premier League logo', () => {
    expect(getTierLogo('Premier League')).toBe('/assets/afl/premier.svg');
  });

  it('resolves the D-League logo', () => {
    expect(getTierLogo('D-League')).toBe('/assets/afl/dleague.svg');
  });

  it('falls back to the D-League mark for any non-Premier tier', () => {
    expect(getTierLogo('')).toBe('/assets/afl/dleague.svg');
    expect(getTierLogo('Whatever')).toBe('/assets/afl/dleague.svg');
  });
});
