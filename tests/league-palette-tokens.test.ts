/**
 * Guard: a package league's theme is PALETTE → SEMANTIC tokens.
 *
 * Package leagues (registry `optInNav` with their own `logo`, e.g. archies)
 * get a colour scheme from their theme file (src/themes/<theme>.json). The
 * owner's rule: the scheme must be changeable to any colour by editing its
 * palette alone. So wherever the league's theme departs from the default
 * theme, in light and in dark:
 *   - raw colour literals may appear ONLY on `--league-palette-*` tokens;
 *   - every other token must reach its colour through var().
 * Tokens equal to the default theme's value are the shared defaults, not the
 * league's scheme, and are not checked. White on the dark header's resting
 * nav icons is the one allowed literal: it is a surface contrast choice, not a
 * brand colour.
 */
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { loadThemes, DEFAULT_THEME_ID } from '../scripts/generate-league-themes.mjs';

type Theme = Record<'light' | 'dark', Record<string, string | null>>;
const themes = loadThemes() as Record<string, Theme>;

const PACKAGE_LEAGUES = Object.values(LEAGUES as Record<string, { navSlug?: string; slug: string; theme: string; optInNav?: boolean; logo?: unknown }>)
  .filter((l) => l.optInNav && l.logo);

const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
const ALLOWED = new Set(['--header-nav-icon-color: #ffffff']);

describe('package-league themes are palette → semantic tokens', () => {
  it('has at least one package league to check', () => {
    expect(PACKAGE_LEAGUES.length).toBeGreaterThan(0);
  });

  for (const league of PACKAGE_LEAGUES) {
    it(`${league.slug}: wears its own theme, not the default`, () => {
      expect(themes).toHaveProperty(league.theme);
      expect(league.theme).not.toBe(DEFAULT_THEME_ID);
    });

    for (const mode of ['light', 'dark'] as const) {
      it(`${league.slug}: only --league-palette-* tokens hold colour literals in ${mode}`, () => {
        const theme = themes[league.theme]![mode];
        const base = themes[DEFAULT_THEME_ID]![mode];
        const offenders: string[] = [];
        for (const [token, value] of Object.entries(theme)) {
          if (value == null || value === base[token] || token.startsWith('--league-palette-')) continue;
          if (ALLOWED.has(`${token}: ${value}`)) continue;
          if (LITERAL.test(value)) offenders.push(`${token}: ${value}`);
        }
        expect(offenders, 'route these through a --league-palette-* token').toEqual([]);
      });
    }
  }
});
