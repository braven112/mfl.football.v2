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
 * section instead. Notifications is that link — putting it back in a section
 * silently demotes it for half the calendar.
 *
 * Also pins the removal of the Add/Drop link: adds and drops go through the
 * site's own player pages, not a hand-off to MFL's add_drop screen.
 */

const REPO_ROOT = process.cwd();
const NAV_LINKS_COMPONENT = path.join(REPO_ROOT, 'src/components/nav/NavLinks.astro');

const pinnedLinks = (navConfig as { pinnedLinks?: NavLink[] }).pinnedLinks ?? [];
const sections = navConfig.sections as Array<{ id: string; links: NavLink[] }>;

describe('Nav pinned links', () => {
  it('pins Notifications as the first link in the drawer', () => {
    expect(pinnedLinks[0]?.id, 'Notifications must be the first pinned nav link').toBe(
      'notifications'
    );
    expect(pinnedLinks[0]?.path).toBe('/notifications');
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
