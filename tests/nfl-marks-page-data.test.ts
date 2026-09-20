import { describe, it, expect } from 'vitest';
import {
  MARK_IDS as PAGE_MARK_IDS,
  allClubs,
  assignedMark as pageAssignedMark,
  bandSlot,
  clubBrand,
  codeFromSlug,
  inkOn,
  luminance,
  markOptions,
  markUrl,
} from '../src/utils/nfl-marks';
import {
  MARK_IDS as NODE_MARK_IDS,
  MARK_SOURCES,
  assignedMark as nodeAssignedMark,
} from '../scripts/lib/nfl-mark-sources.mjs';
import { getAllNFLTeamCodes } from '../src/utils/nfl-logo';
import { buildNflLogoDarkCss } from '../src/utils/nfl-logo-dark-css';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Brand Book pages' data layer (`src/utils/nfl-marks.ts`).
 *
 * The page's whole claim is that it shows what the SITE ships, not a
 * look-alike. That claim only holds while the browser-side table agrees with
 * the node-side one the dark mirror actually fetches from — two tables in two
 * languages, which is exactly the shape that drifts silently: a mark id added
 * to the mirror and not to the page shows a club one cut short, and one added
 * to the page and not to the mirror renders a URL nothing ever downloads.
 *
 * It also pins the derived band slot. That rule — a club-colour band follows
 * the club colour's luminance, never a stored value — is the thesis of
 * docs/plans/nfl-mark-assignments.md, and a threshold nudge would silently
 * flip which cut a dozen hero bands draw.
 */

describe('nfl-marks page data', () => {
  it('has the same mark ids as the node-side source table', () => {
    expect([...PAGE_MARK_IDS].sort()).toEqual([...NODE_MARK_IDS].sort());
  });

  it('agrees with the node table on every mark format', () => {
    for (const code of ['CHI', 'NYG', 'NYJ', 'KC']) {
      for (const mark of markOptions(code)) {
        expect(mark.format, `${code}/${mark.id}`).toBe(MARK_SOURCES[mark.id].format);
      }
    }
  });

  it('resolves the same assignment as the build for every club and ground', () => {
    for (const code of getAllNFLTeamCodes()) {
      for (const slot of ['light', 'dark'] as const) {
        expect(pageAssignedMark(code, slot), `${code}/${slot}`).toBe(nodeAssignedMark(code, slot));
      }
      // A band is not a stored slot — it resolves through the one it derives.
      expect(pageAssignedMark(code, 'band')).toBe(nodeAssignedMark(code, bandSlot(code)));
    }
  });

  it('derives the band slot from club-colour luminance, not from a table', () => {
    for (const club of allClubs()) {
      const expected = luminance(club.colors[0] ?? '#000000') > 0.42 ? 'light' : 'dark';
      expect(bandSlot(club.code), club.code).toBe(expected);
    }
    // Most club primaries are dark, which is why a band is a third ground
    // rather than a light one.
    const darkBands = allClubs().filter((c) => bandSlot(c.code) === 'dark');
    expect(darkBands.length).toBeGreaterThan(24);
  });

  it('gives every club an entry, a primary colour and all three grounds', () => {
    const clubs = allClubs();
    expect(clubs).toHaveLength(getAllNFLTeamCodes().length);
    for (const club of clubs) {
      expect(club.colors[0], club.code).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(club.marks.length, club.code).toBeGreaterThan(0);
      expect(
        club.grounds.map((g) => g.ground),
        club.code,
      ).toEqual(['light', 'dark', 'band']);
      expect(club.city.length, club.code).toBeGreaterThan(0);
      expect(club.nick.length, club.code).toBeGreaterThan(0);
    }
  });

  it('points `primary` at the committed file, never at a CDN', () => {
    for (const code of getAllNFLTeamCodes()) {
      expect(markUrl(code, 'primary')).toBe(`/assets/nfl-logos/${code}.svg`);
    }
  });

  it('returns null for an unknown mark id rather than guessing', () => {
    expect(markUrl('CHI', 'nope')).toBeNull();
    expect(markUrl('XXX', 'primary')).toBeNull();
    expect(clubBrand('XXX')).toBeNull();
  });

  it('resolves a club code from either case of URL segment, and nothing else', () => {
    expect(codeFromSlug('chi')).toBe('CHI');
    expect(codeFromSlug('CHI')).toBe('CHI');
    expect(codeFromSlug('')).toBeNull();
    expect(codeFromSlug('bears')).toBeNull();
    expect(codeFromSlug('../secrets')).toBeNull();
  });

  it('picks ink that reads on the ground', () => {
    expect(inkOn('#ffffff')).toBe('#10141a');
    expect(inkOn('#000000')).toBe('#ffffff');
  });

  it('renders the mirrored file for a ground, not the catalog CDN url', () => {
    // The catalog says where a cut came FROM; a ground says what the site
    // SERVES. With a populated mirror manifest that is a same-origin path, and
    // the two must not be confused — the page's claim is about this site.
    for (const club of allClubs()) {
      const light = club.grounds.find((g) => g.ground === 'light');
      expect(light?.url, club.code).toBe(`/assets/nfl-logos/${club.code}.svg`);
    }
    // With an EMPTY manifest — the committed default, before prebuild mirrors
    // anything — a ground degrades to the catalog url rather than to a local
    // path that 404s. `content: url()` has no error fallback, so a path that is
    // not there renders a broken-image icon.
    for (const club of allClubs()) {
      const dark = club.grounds.find((g) => g.ground === 'dark');
      expect(dark?.url, club.code).toBeTruthy();
      expect(dark?.url.startsWith('/') || dark?.url.startsWith('https://'), club.code).toBe(true);
    }
  });

  it('opts both Brand Book pages out of the global dark logo swap', () => {
    /**
     * `buildNflLogoDarkCss` rewrites every light NFL src to its dark cut under
     * `html.dark`. On every other page that is the point. Here it would render
     * the DARK cut inside the LIGHT pane for a dark-mode reader, so the
     * side-by-side comparison — the entire page — would show one mark twice.
     *
     * The swap rule and the opt-out have the SAME specificity, so the opt-out
     * must carry `!important`: load order between the layout head and a scoped
     * component style is not something to rely on.
     */
    const css = buildNflLogoDarkCss();
    expect(css).toContain('html.dark img[src="/assets/nfl-logos/CHI.svg"]');

    for (const [file, cls] of [
      ['src/components/shared/brand/BrandPage.astro', 'brand'],
      ['src/components/shared/brand/ClubBrandPage.astro', 'cb'],
    ] as const) {
      const src = readFileSync(join(process.cwd(), file), 'utf-8');
      expect(src, file).toMatch(
        new RegExp(`html\\.dark\\s+:global\\(\\.${cls} img\\)\\s*\\{[^}]*content:\\s*normal\\s*!important`),
      );
    }
  });

  it('lists each club colour once, whatever case the brand kit spells it in', () => {
    // The kit carries the same hex twice in different case for most clubs, and
    // the swatch row printed four chips for a two-colour club. Case-folded
    // dedupe, first spelling kept — order matters, `colors[0]` is the ground.
    for (const club of allClubs()) {
      const keys = club.colors.map((c) => c.toLowerCase());
      expect(new Set(keys).size, club.code).toBe(keys.length);
      expect(club.colors.length, club.code).toBeGreaterThan(0);
    }
    expect(clubBrand('CHI')?.colors.map((c) => c.toLowerCase())).toEqual(['#0b162a', '#e64100']);
  });

  it('lets the hero ink beat the site\'s themed h1 colour', () => {
    // The hero paints the CLUB's ground, so its ink is computed rather than
    // themed — without this the nickname rendered near-black on navy in light
    // mode and accent blue in dark, both illegible.
    const src = readFileSync(
      join(process.cwd(), 'src/components/shared/brand/ClubBrandPage.astro'),
      'utf-8',
    );
    expect(src).toMatch(/\.cb__nick\s*\{[^}]*color:\s*inherit/);
  });
});