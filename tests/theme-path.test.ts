/**
 * The theme review pages' hrefs drop the league prefix only on THAT league's
 * own apex. `hideLeaguePrefix` says the host belongs to SOME league; on
 * another league's apex a cross-league page keeps its prefix, or
 * `/theme/light` would open the host league's theme instead.
 */
import { describe, it, expect } from 'vitest';
import { themePath } from '../src/components/shared/theme/theme-mode';
import { HOST_TO_SLUG } from '../src/utils/league-host-map';

const hostOf = (slug: string) => Object.entries(HOST_TO_SLUG).find(([, s]) => s === slug)?.[0];

describe('themePath', () => {
  const tl = hostOf('theleague');
  const afl = hostOf('afl-fantasy');

  it('the registry gives both leagues an apex to test against', () => {
    expect(tl).toBeTruthy();
    expect(afl).toBeTruthy();
  });

  it('strips the prefix on the league\'s own apex', () => {
    expect(themePath('theleague', 'dark', new URL(`https://${tl}/theme/light`), true)).toBe('/theme/dark');
  });

  it('keeps a cross-league prefix on another league\'s apex', () => {
    expect(themePath('afl-fantasy', 'dark', new URL(`https://${tl}/afl-fantasy/theme/light`), true)).toBe('/afl-fantasy/theme/dark');
  });

  it('keeps the prefix on a shared host', () => {
    expect(themePath('archies', 'light', new URL('https://v2.mfl.football/archies/theme'), false)).toBe('/archies/theme/light');
  });
});
