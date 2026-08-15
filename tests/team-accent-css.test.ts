import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildTeamAccentCss,
  teamAccentProperty,
  teamAccentVar,
} from '../src/utils/team-accent-css';
import { getTeamAccentPair } from '../src/utils/team-colors';
import { contrastRatio, AA_LARGE_TEXT_RATIO } from '../src/utils/team-color-contrast';
import theleagueConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import bb1Config from '../data/best-ball-1/bb1.config.json';

/**
 * The franchise accent layer is what makes team colors readable site-wide: any
 * surface tinting by franchise reads `--team-accent-<id>` and gets a value
 * that clears 3:1 on the theme being rendered. These tests lock down the three
 * things that would silently break that — a league missing from the sheet, a
 * theme block that never wins the cascade, and the layout dropping the styles.
 */

/** Each league's `--card-bg` surface per theme (tokens.css / tokens-dark.css). */
const SURFACES = {
  theleague: { light: '#ffffff', dark: '#262626' },
  afl: { light: '#ffffff', dark: '#16283c' },
  bb1: { light: '#ffffff', dark: '#262626' },
} as const;

const CONFIGS = {
  theleague: theleagueConfig as any,
  afl: aflConfig as any,
  bb1: bb1Config as any,
} as const;

describe('teamAccentProperty / teamAccentVar', () => {
  it('builds the property and var reference for a franchise', () => {
    expect(teamAccentProperty('0001')).toBe('--team-accent-0001');
    expect(teamAccentVar('0001')).toBe('var(--team-accent-0001)');
    expect(teamAccentVar('0001', '#123456')).toBe('var(--team-accent-0001, #123456)');
  });
});

describe('buildTeamAccentCss', () => {
  const css = buildTeamAccentCss();

  it('covers every franchise in every league', () => {
    for (const [slug, config] of Object.entries(CONFIGS)) {
      for (const team of config.teams ?? []) {
        const pair = getTeamAccentPair(team.franchiseId, slug as any);
        expect(css, `${slug} ${team.franchiseId} light`).toContain(
          `${teamAccentProperty(team.franchiseId)}:${pair.light}`,
        );
        expect(css, `${slug} ${team.franchiseId} dark`).toContain(
          `${teamAccentProperty(team.franchiseId)}:${pair.dark}`,
        );
      }
    }
  });

  it('scopes every block by league — franchise ids collide across leagues', () => {
    for (const slug of Object.keys(CONFIGS)) {
      expect(css).toContain(`html[data-league="${slug}"]{`);
      expect(css).toContain(`html.dark[data-league="${slug}"]{`);
    }
    // TheLeague's 0001 (Pigskins red) and the AFL's 0001 are different teams.
    const tl = getTeamAccentPair('0001', 'theleague');
    const afl = getTeamAccentPair('0001', 'afl');
    expect(tl.light).not.toBe(afl.light);
  });

  it('orders the dark block after the light one so it wins the cascade', () => {
    for (const slug of Object.keys(CONFIGS)) {
      const light = css.indexOf(`html[data-league="${slug}"]{`);
      const dark = css.indexOf(`html.dark[data-league="${slug}"]{`);
      expect(light).toBeGreaterThanOrEqual(0);
      expect(dark).toBeGreaterThan(light);
    }
  });

  it('emits a single league when asked', () => {
    const one = buildTeamAccentCss('theleague');
    expect(one).toContain('html[data-league="theleague"]{');
    expect(one).not.toContain('data-league="afl"');
  });

  it('emits only hex values — nothing that could break out of the <style>', () => {
    const declarations = css.match(/--team-accent-[^:]+:([^;}]+)/g) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    for (const d of declarations) {
      expect(d.split(':')[1]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('every franchise accent is readable on its own league card', () => {
  for (const [slug, config] of Object.entries(CONFIGS)) {
    const surface = SURFACES[slug as keyof typeof SURFACES];
    it(`${slug}: all ${config.teams?.length ?? 0} franchises clear 3:1 in both themes`, () => {
      const failures: string[] = [];
      for (const team of config.teams ?? []) {
        const pair = getTeamAccentPair(team.franchiseId, slug as any);
        const lightRatio = contrastRatio(pair.light, surface.light);
        const darkRatio = contrastRatio(pair.dark, surface.dark);
        if (lightRatio < AA_LARGE_TEXT_RATIO) {
          failures.push(`${slug}/${team.franchiseId} light ${pair.light} = ${lightRatio.toFixed(2)}:1`);
        }
        if (darkRatio < AA_LARGE_TEXT_RATIO) {
          failures.push(`${slug}/${team.franchiseId} dark ${pair.dark} = ${darkRatio.toFixed(2)}:1`);
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('the accent layer actually ships', () => {
  it('is included in the shared layout head', () => {
    const layout = readFileSync(resolve(__dirname, '../src/layouts/TheLeagueLayout.astro'), 'utf-8');
    expect(layout).toContain('TeamAccentStyles');
  });
});
