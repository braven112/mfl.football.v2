/**
 * Site-wide franchise accent tokens.
 *
 * Emits one custom property per franchise — `--team-accent-<franchiseId>` —
 * with a light value and an `html.dark` override, so ANY surface that tints by
 * franchise gets a color that is readable on the theme actually being rendered.
 * Use the token instead of a raw config color wherever a team color is used as
 * a FOREGROUND: text, a numeral, a border, a chart line, a legend swatch.
 *
 *   <span style={`color: ${teamAccentVar(fid)}`}>          // Astro / TSX
 *   polyline.style.stroke = teamAccentVar(fid);            // client-side draws
 *   .thing { border-color: var(--team-accent-0001); }      // static CSS
 *
 * Why a CSS layer and not a server-side pick: with theme preference 'auto' the
 * server cannot know the resolved theme at render time, so a color chosen in
 * the frontmatter is wrong for half our users. A custom property keyed on the
 * `html.dark` class always follows the theme the client script resolves — and
 * client-drawn charts inherit the swap for free, with no redraw on toggle.
 * Same reasoning as the NFL logo and league icon dark swaps; see
 * `src/utils/nfl-logo-dark-css.ts`.
 *
 * The values come from `getTeamAccentPair` (src/utils/team-colors.ts), which
 * enforces a 3:1 floor against each theme's card surface — the WCAG AA
 * threshold for large text and non-text UI. Raw brand colors cannot do this
 * job: a third of the franchises wear a near-black or navy primary that lands
 * around 1.1:1 on a dark card, and the yellows/golds do the same on a white
 * one. Anything using an accent as small body text should apply its own
 * darkening/lightening on top, or take `AA_BODY_TEXT_RATIO` from
 * `getTeamAccentPair` directly.
 *
 * Franchise ids collide across leagues (both TheLeague and the AFL have an
 * 0001), so every block is scoped by the `data-league` attribute the layout
 * puts on <html>.
 *
 * Consumed by `src/components/TeamAccentStyles.astro`, included once in the
 * shared layout <head>.
 */

import theleagueConfig from '../data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import bb1Config from '../../data/best-ball-1/bb1.config.json';
import type { LeagueSlug } from '../types/nav';
import { getTeamAccentPair } from './team-colors';

const CONFIGS: Record<LeagueSlug, { teams: any[] }> = {
  theleague: theleagueConfig as any,
  afl: aflConfig as any,
  bb1: bb1Config as any,
};

/** The custom property holding a franchise's theme-aware accent. */
export function teamAccentProperty(franchiseId: string): string {
  return `--team-accent-${franchiseId}`;
}

/** Ready-to-use `var()` reference, with an optional fallback color. */
export function teamAccentVar(franchiseId: string, fallback?: string): string {
  const prop = teamAccentProperty(franchiseId);
  return fallback ? `var(${prop}, ${fallback})` : `var(${prop})`;
}

/** Franchise ids are MFL's zero-padded digits — refuse anything else into CSS. */
const isSafeFranchiseId = (id: unknown): id is string =>
  typeof id === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(id);

/**
 * Build the accent stylesheet for one league (or every league when omitted).
 * Returns '' when a league has no usable teams, so the caller can skip the
 * <style> element entirely.
 */
export function buildTeamAccentCss(league?: LeagueSlug): string {
  const leagues = league ? [league] : (Object.keys(CONFIGS) as LeagueSlug[]);
  const blocks: string[] = [];

  for (const slug of leagues) {
    const teams = (CONFIGS[slug]?.teams ?? []).filter((t) => isSafeFranchiseId(t?.franchiseId));
    if (teams.length === 0) continue;

    const light: string[] = [];
    const dark: string[] = [];
    for (const t of teams) {
      const pair = getTeamAccentPair(t.franchiseId, slug);
      light.push(`${teamAccentProperty(t.franchiseId)}:${pair.light}`);
      dark.push(`${teamAccentProperty(t.franchiseId)}:${pair.dark}`);
    }

    // html.dark[data-league] (0,2,1) outranks html[data-league] (0,1,1), so the
    // dark block wins wherever the theme class is set.
    blocks.push(`html[data-league="${slug}"]{${light.join(';')}}`);
    blocks.push(`html.dark[data-league="${slug}"]{${dark.join(';')}}`);
  }

  return blocks.join('');
}
