import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import navConfig from '../src/config/nav-config.json';
import type { NavLink } from '../src/types/nav';
import {
  FEATURE_SPOTLIGHTS,
  SPOTLIGHT_DAYS,
  isNewSince,
  isSpotlightActive,
  navLinkSpotlightId,
  spotlightExpiry,
  spotlightNow,
  spotlightStorageKey,
} from '../src/utils/feature-spotlight';

/**
 * Feature spotlights — the one-week "this is new" pulse.
 *
 * The whole point of the mechanism is that it turns itself off. Two ways it
 * could fail to, and both are pinned here:
 *
 * - **It never expires.** A pulse driven by a boolean flag someone has to
 *   remember to remove pulses forever. The window is date math instead, so an
 *   entry left in the registry is inert a week later.
 * - **It expires and nobody notices the CSS is gone.** The class name is the
 *   contract between the util, the stylesheet and the markup; a rename in one
 *   place silently stops the pulse everywhere.
 *
 * Also pinned: reduced motion keeps the ring and drops the animation. Removing
 * the affordance entirely would hide a new feature from exactly the people who
 * asked for less movement.
 */

const REPO_ROOT = process.cwd();
const NAV_FOOTER = readFileSync(path.join(REPO_ROOT, 'src/components/nav/NavFooter.astro'), 'utf8');
const NAV_LINKS = readFileSync(path.join(REPO_ROOT, 'src/components/nav/NavLinks.astro'), 'utf8');
const NAV_DRAWER = readFileSync(path.join(REPO_ROOT, 'src/components/nav/NavDrawer.astro'), 'utf8');
const SPOTLIGHT_CSS = readFileSync(path.join(REPO_ROOT, 'src/styles/feature-spotlight.css'), 'utf8');

const allNavLinks: NavLink[] = [
  ...((navConfig as { pinnedLinks?: NavLink[] }).pinnedLinks ?? []),
  ...(navConfig.sections as Array<{ links: NavLink[] }>).flatMap((section) => section.links),
];

describe('Feature spotlight', () => {
  it('expires on its own, a week after the feature shipped', () => {
    const id = 'nav-account-menu';
    const shipped = FEATURE_SPOTLIGHTS[id];
    expect(shipped, 'the account menu spotlight must carry a ship date').toBeTruthy();

    const dayAfter = new Date(`${shipped}T12:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    expect(isSpotlightActive(id, dayAfter), 'still new the next day').toBe(true);

    const wellAfter = new Date(`${shipped}T12:00:00Z`);
    wellAfter.setUTCDate(wellAfter.getUTCDate() + SPOTLIGHT_DAYS + 1);
    expect(
      isSpotlightActive(id, wellAfter),
      `a spotlight must stop pulsing ${SPOTLIGHT_DAYS} days after it shipped, with no cleanup commit`
    ).toBe(false);
  });

  it('never pulses for an id it does not know', () => {
    expect(spotlightExpiry('not-a-feature')).toBeNull();
    expect(isSpotlightActive('not-a-feature')).toBe(false);
  });

  it('honors ?testDate= so the expiry can be seen without the system clock', () => {
    const url = new URL('https://theleague.us/standings?testDate=2027-01-15');
    expect(spotlightNow(url).getUTCFullYear()).toBe(2027);
    expect(isSpotlightActive('nav-account-menu', spotlightNow(url))).toBe(false);
    // A junk value falls back to now rather than rendering an epoch date.
    const junk = new URL('https://theleague.us/standings?testDate=nonsense');
    expect(Number.isNaN(spotlightNow(junk).getTime())).toBe(false);
  });

  it('keeps one class name across the util, the stylesheet and the markup', () => {
    expect(SPOTLIGHT_CSS).toMatch(/\.spotlight-pulse\b/);
    expect(NAV_FOOTER).toMatch(/'spotlight-pulse':\s*spotlightAccountMenu/);
    expect(NAV_FOOTER).toMatch(/data-spotlight=/);
  });

  it('agrees with the client script on the localStorage key', () => {
    expect(spotlightStorageKey('nav-account-menu')).toBe('spotlight.nav-account-menu.seen');
    // The script builds the key inline (it cannot import a module), so the
    // shape has to be pinned on both sides or a dismissal stops sticking.
    expect(NAV_DRAWER).toMatch(/`spotlight\.\$\{id\}\.seen`/);
  });

  it('dismisses every pulsing control from ONE delegated handler', () => {
    // A per-control copy is how the drawer would end up with two localStorage
    // conventions and a link that pulses forever because nobody wired it up.
    expect(NAV_DRAWER).toMatch(/document\.addEventListener\(\s*'click'/);
    expect(NAV_DRAWER).toMatch(/closest\?\.\('\[data-spotlight\]'\)/);
    expect(NAV_DRAWER).toMatch(/classList\.remove\('spotlight-pulse'\)/);
    // The class can sit on the control (the chevron) or on a child (a link's
    // icon), so the handler has to clear descendants too.
    expect(NAV_DRAWER).toMatch(/querySelectorAll\('\.spotlight-pulse'\)/);
    expect(
      /dismissSpotlight/.test(NAV_FOOTER),
      'NavFooter must not keep a private copy of the dismissal'
    ).toBe(false);
  });

  it('registers the delegated listener once per DOCUMENT, not per navigation', () => {
    // The ClientRouter keeps one document across navigations; re-adding on
    // every astro:page-load stacks a duplicate listener per page visited.
    expect(NAV_DRAWER).toMatch(/__spotlightDismissBound/);
    expect(NAV_DRAWER).toMatch(/document\.addEventListener\('astro:page-load', initSpotlightDismissal\)/);
  });

  it('survives localStorage throwing, because the nav must bind regardless', () => {
    // Private windows and blocked site data make the accessor itself throw;
    // an unguarded read would take the whole drawer's scripts down with it.
    expect(NAV_DRAWER).toMatch(/try \{\s*return localStorage\.getItem/);
    expect(NAV_DRAWER).toMatch(/try \{\s*localStorage\.setItem/);
  });

  it('marks a nav link as new from its own newSince date, and only for a week', () => {
    const shipped = '2026-10-01';
    const dayAfter = new Date('2026-10-02T12:00:00Z');
    const nextWeek = new Date('2026-10-09T12:00:00Z');
    expect(isNewSince(shipped, dayAfter)).toBe(true);
    expect(isNewSince(shipped, nextWeek)).toBe(false);

    // No date, a typo'd date, or junk never pulses — a spotlight that cannot
    // expire is worse than one that never starts.
    expect(isNewSince(undefined, dayAfter)).toBe(false);
    expect(isNewSince('', dayAfter)).toBe(false);
    expect(isNewSince('not-a-date', dayAfter)).toBe(false);
  });

  it('wires newSince through NavLinks for both pinned and section links', () => {
    const applications = NAV_LINKS.match(/'spotlight-pulse': isLinkNew\(link\)/g) ?? [];
    expect(
      applications.length,
      'both the pinned list and the section list must mark a new link'
    ).toBe(2);
    expect(NAV_LINKS).toMatch(/data-spotlight=\{isLinkNew\(link\) \? navLinkSpotlightId\(link\.id\)/);
    // The pulse is visual; a screen reader needs the word.
    expect(NAV_LINKS).toMatch(/visually-hidden">New</);
  });

  it('namespaces link ids so they cannot collide with registry ids', () => {
    expect(navLinkSpotlightId('owners')).toBe('nav-link:owners');
    expect(Object.keys(FEATURE_SPOTLIGHTS).every((id) => !id.startsWith('nav-link:'))).toBe(true);
  });

  it('keeps every newSince in nav-config parseable', () => {
    // A typo'd date is silent — the link just never pulses — so it is checked
    // here rather than discovered by nobody noticing a launch.
    for (const link of allNavLinks) {
      if (!link.newSince) continue;
      expect(
        link.newSince,
        `nav link "${link.id}" has an unparseable newSince`
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${link.newSince}T12:00:00Z`))).toBe(false);
    }
  });

  it('never lets the ring reach zero — it breathes, it does not blink', () => {
    // The first cut expanded a halo to fully transparent and back, so the mark
    // vanished off the control on the return leg. Reported as "it disappears
    // from the button briefly and then comes back", which is the whole reason
    // this assertion exists: every keyframe must still paint a ring.
    const keyframes = SPOTLIGHT_CSS.slice(
      SPOTLIGHT_CSS.indexOf('@keyframes spotlight-ring'),
      SPOTLIGHT_CSS.indexOf('prefers-reduced-motion')
    );
    const shadows = [...keyframes.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(shadows.length).toBeGreaterThan(1);
    for (const shadow of shadows) {
      expect(
        /\btransparent\b/.test(shadow),
        `keyframe shadow "${shadow}" fades the ring to nothing — it must stay visible at every frame`
      ).toBe(false);
      expect(shadow).toMatch(/var\(--spotlight-ring(-peak)?\)/);
    }
  });

  it('keeps a visible ring under prefers-reduced-motion', () => {
    const reduced = SPOTLIGHT_CSS.slice(SPOTLIGHT_CSS.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/animation:\s*none/);
    expect(
      reduced,
      'reduced motion drops the movement, not the signal — keep a static ring'
    ).toMatch(/box-shadow:\s*0 0 0 2px/);
  });

  it('derives both colours from a token that exists in both themes', () => {
    // A literal here would render the same in dark mode, which is the trap
    // docs/claude/rules/theming-and-assets.md exists to stop. Comments may
    // name hexes (the token's own values are worth writing down); the
    // declarations may not.
    const declarations = SPOTLIGHT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).toMatch(/var\(--color-primary\)/);
    expect(
      /#[0-9a-f]{3,8}\b/i.test(declarations),
      'no hex literals in declarations — --color-primary already flips between themes'
    ).toBe(false);
  });
});
