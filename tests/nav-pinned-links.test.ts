import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import navConfig from '../src/config/nav-config.json';
import type { NavLink } from '../src/types/nav';

/**
 * Pinned nav links — the top of the drawer
 *
 * Section order flips between phases (`phaseOrder`: This Week leads in-season,
 * News & Updates leads off-season), so a link that must always be FIRST cannot
 * live inside a section. `nav-config.json#pinnedLinks` renders flat above every
 * section for exactly that case.
 *
 * Since Oct 2026 the pins are the pages owners actually use. Owner Activity
 * showed ~85% of traffic on six pages, yet Rosters sat in "Offseason War Room"
 * — fifth of seven sections in season — and Trade Builder was not in the nav
 * at all. The core pages now sit flat at the top in both phases.
 *
 * Notifications and Preferences were pinned before that and moved into the nav
 * FOOTER's account menu (`NavFooter.astro`, under the team name) in Sep 2026:
 * a viewer's own settings belong with their identity, not competing with
 * league navigation.
 *
 * What this suite guards:
 * - the core pages stay pinned, in this order, with Rosters first
 * - a link is never pinned AND in a section (it would render twice)
 * - the pinned list renders before the sections, so pinning still means first
 * - the two moved links keep a home in the footer instead
 * - the Add/Drop link stays gone: adds and drops go through the site's own
 *   player pages, not a hand-off to MFL's add_drop screen
 */

const REPO_ROOT = process.cwd();
const NAV_LINKS_COMPONENT = path.join(REPO_ROOT, 'src/components/nav/NavLinks.astro');
const NAV_FOOTER_COMPONENT = path.join(REPO_ROOT, 'src/components/nav/NavFooter.astro');

const pinnedLinks = (navConfig as { pinnedLinks?: NavLink[] }).pinnedLinks ?? [];
const sections = navConfig.sections as Array<{ id: string; links: NavLink[] }>;

describe('Nav pinned links', () => {
  it('keeps Notifications and Preferences reachable from the footer account menu', () => {
    const pinnedIds = pinnedLinks.map((link) => link.id);
    expect(
      pinnedIds,
      'Notifications and Preferences live in the footer account menu now — pinning them again duplicates them'
    ).not.toContain('notifications');
    expect(pinnedIds).not.toContain('preferences');

    // Removing the pinned pair only works because the footer carries them.
    const footer = readFileSync(NAV_FOOTER_COMPONENT, 'utf8');
    expect(footer, 'NavFooter must link /preferences').toMatch(/\/preferences`/);
    expect(footer, 'NavFooter must link /notifications').toMatch(/\/notifications`/);
    // /preferences has no auth gate, so it must survive being signed out —
    // /notifications bounces to login and deliberately does not.
    expect(
      footer,
      'A signed-out visitor has no account menu; /preferences still needs a row'
    ).toMatch(/nav-footer__account--signed-out/);
  });

  it('pins the core pages, Rosters first', () => {
    // Live Scoring and Free Agents carry one link per league (leagueOnly), so
    // both ids appear; each league's drawer shows one of each.
    expect(pinnedLinks.map((link) => link.id)).toEqual([
      'rosters',
      'submit-lineup',
      'live-scoring',
      'afl-live-scoring',
      'players',
      'afl-players',
      'standings',
      'trade-builder',
      'tip-schefter',
    ]);
  });

  it('keeps pinned links out of the sections that reorder by phase', () => {
    const pinnedIds = new Set(pinnedLinks.map((link) => link.id));
    for (const section of sections) {
      for (const link of section.links) {
        expect(
          pinnedIds.has(link.id),
          `Nav link "${link.id}" is pinned AND inside section "${section.id}" — it would render twice`
        ).toBe(false);
      }
    }
  });

  it('renders the pinned list before the section list in NavLinks.astro', () => {
    const source = readFileSync(NAV_LINKS_COMPONENT, 'utf8');
    const pinnedAt = source.indexOf('nav-links__pinned');
    const sectionsAt = source.indexOf('class="nav-links__list"');
    expect(pinnedAt, 'NavLinks.astro must render a nav-links__pinned list').toBeGreaterThan(-1);
    expect(sectionsAt).toBeGreaterThan(-1);
    expect(
      pinnedAt,
      'The pinned list must be rendered before the sections, or pinned links are not first'
    ).toBeLessThan(sectionsAt);
  });

  it('no longer hands adds and drops off to MFL', () => {
    const allLinks: NavLink[] = [...pinnedLinks, ...sections.flatMap((section) => section.links)];
    for (const link of allLinks) {
      const target = link.urlTemplate ?? link.url ?? link.path ?? '';
      expect(
        target.includes('add_drop'),
        `Nav link "${link.id}" points at MFL's add_drop page; that link was removed from the drawer`
      ).toBe(false);
    }
  });
});
