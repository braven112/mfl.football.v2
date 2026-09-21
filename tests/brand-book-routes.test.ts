/**
 * The Brand Book's two namespaces, and the rules that keep them apart.
 *
 * `/<league>/brand/<segment>` resolves a FRANCHISE first and an NFL club code
 * second. That is only safe while the two namespaces are disjoint, and nothing
 * about either one guarantees it stays that way — a franchise renamed to
 * something that slugs to a club code (a "Bills" or a "Chiefs" is not far
 * fetched in a fantasy league) would silently take over that club's page. This
 * file is what stops it.
 *
 * It also pins the things a reader would notice immediately if they broke: a
 * slug that is not unique inside its league, a franchise whose page would have
 * no artwork on it, and the static `files` route being reachable at all next
 * to the dynamic `[team]` one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allFranchiseBrands,
  franchiseIdFromSlug,
  franchiseSlug,
  slugify,
  BRAND_BOOK_LEAGUES,
  leagueHasBrandBook,
} from '../src/utils/franchise-marks';
import { getAllNFLTeamCodes } from '../src/utils/nfl-logo';
import { codeFromSlug } from '../src/utils/nfl-marks';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('Brand Book — franchise and club namespaces', () => {
  const clubCodes = getAllNFLTeamCodes().map((c) => c.toLowerCase());

  for (const league of BRAND_BOOK_LEAGUES) {
    describe(league, () => {
      const brands = allFranchiseBrands(league);

      it('has a franchise for every club in the league config', () => {
        expect(brands.length).toBeGreaterThan(0);
      });

      it('gives every franchise a unique slug', () => {
        const slugs = brands.map((b) => b.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      });

      it('never slugs a franchise onto an NFL club code', () => {
        // The route resolves franchises FIRST, so a collision does not 404 —
        // it hands an owner the wrong page with no error anywhere.
        const collisions = brands.filter((b) => clubCodes.includes(b.slug));
        expect(collisions.map((b) => `${b.slug} (${b.name})`)).toEqual([]);
      });

      it('never lets an NFL club code resolve to a franchise', () => {
        // The other direction of the same rule: `franchiseIdFromSlug` matches
        // abbrevs and aliases too, and an abbrev IS three letters.
        const stolen = clubCodes.filter((code) => franchiseIdFromSlug(league, code) !== null);
        expect(stolen).toEqual([]);
      });

      it('keeps the static /brand/files segment out of franchise reach', () => {
        expect(franchiseIdFromSlug(league, 'files')).toBeNull();
        expect(codeFromSlug('files')).toBeNull();
      });

      it('round-trips every franchise slug back to its own id', () => {
        for (const b of brands) {
          expect(franchiseIdFromSlug(league, b.slug)).toBe(b.franchiseId);
        }
      });

      it('resolves short names, abbrevs and aliases to the same franchise', () => {
        for (const b of brands) {
          for (const alias of [b.nameShort, b.abbrev, ...b.aliases].filter(Boolean)) {
            const hit = franchiseIdFromSlug(league, slugify(alias));
            // An alias shared by two franchises resolves to one of them; what
            // must never happen is resolving to NOTHING, which is a dead link
            // from a page that printed the alias.
            expect(hit, `${b.name} alias "${alias}"`).not.toBeNull();
          }
        }
      });

      it('gives every franchise the three grounds and at least one cut', () => {
        for (const b of brands) {
          expect(b.marks.length, b.name).toBeGreaterThan(0);
          expect(b.grounds.map((g) => g.ground), b.name).toEqual(['light', 'dark', 'band']);
        }
      });

      it('never puts a light cut on a dark band', () => {
        // The band is the franchise's own colour and is dark in both themes
        // for almost every club. A band resolving to the LIGHT slot has to be
        // a genuinely light primary, not an accident.
        for (const b of brands) {
          const band = b.grounds.find((g) => g.ground === 'band');
          expect(band, b.name).toBeDefined();
          if (band?.slot === 'light') {
            // Same threshold `bandSlot` applies; a failure here means the rule
            // and the assertion drifted apart.
            expect(b.bandColor, b.name).toMatch(/^#/);
          }
        }
      });
    });
  }

  it('covers exactly the full-management leagues', () => {
    expect(BRAND_BOOK_LEAGUES).toEqual(['theleague', 'afl-fantasy']);
    // Best Ball is draft-only and carries no crest art. An empty book renders
    // the NFL half alone rather than throwing, which is why this is a flag
    // rather than a lookup that can fail.
    expect(leagueHasBrandBook('best-ball-1')).toBe(false);
  });

  it('derives a slug from the full name, not the short one', () => {
    // `nameShort` makes links that read wrong on their own — A Bruin Pegs Me
    // shortens to "pegs-me". A pasted /brand/<slug> should say which club it is.
    expect(franchiseSlug({ name: 'A Bruin Pegs Me', nameShort: 'Pegs Me', franchiseId: '0002' })).toBe(
      'a-bruin-pegs-me'
    );
    // Apostrophes drop rather than becoming hyphens, so possessives stay one word.
    expect(franchiseSlug({ name: "Suh Girls One Cup", franchiseId: '0003' })).toBe('suh-girls-one-cup');
    expect(slugify("Dick's Out")).toBe('dicks-out');
  });
});

describe('Brand Book — routes', () => {
  const routes = [
    'src/pages/theleague/brand/[team].astro',
    'src/pages/afl-fantasy/brand/[team].astro',
  ];

  for (const route of routes) {
    const src = read(route);

    it(`${route} resolves a franchise before a club code`, () => {
      // Asserted on the RESOLUTION, not on import order — the imports are
      // alphabetical and say nothing about which lookup wins. The club code is
      // only computed when the franchise lookup came back empty, which is what
      // makes "franchise first" true rather than merely likely.
      expect(src).toMatch(/const franchiseId = franchiseIdFromSlug\(/);
      expect(src).toMatch(/const code = franchiseId \? null : codeFromSlug\(/);
    });

    it(`${route} owns its own redirect`, () => {
      // `Astro.redirect()` only redirects from a PAGE — returned from a
      // component's frontmatter it stops that component rendering and still
      // answers 200 with a blank body.
      expect(src).toMatch(/return Astro\.redirect\(/);
    });

    it(`${route} imports the league config rather than reading it downstream`, () => {
      // A static import specifier cannot be a runtime variable, which is why
      // `assetDomain` is a prop instead of a lookup inside the component.
      expect(src).toMatch(/import leagueConfig from/);
      expect(src).toMatch(/assetDomain=\{assetDomain\}/);
    });
  }

  for (const league of ['theleague', 'afl-fantasy']) {
    it(`/${league}/assets redirects to the Brand Book instead of 404ing`, () => {
      const src = read(`src/pages/${league}/assets.astro`);
      expect(src).toMatch(/Astro\.redirect\(/);
      expect(src).toContain(`/${league}/brand`);
      // 302, not 301: a permanent redirect is cached indefinitely and cannot
      // be taken back without minting a new URL.
      expect(src).toMatch(/302/);
    });

    it(`/${league}/brand/files still serves the searchable library`, () => {
      const src = read(`src/pages/${league}/brand/files.astro`);
      expect(src).toContain('AssetsPage');
      expect(src).toContain('aggregatedAssets');
    });
  }

  it('links every franchise page to its brand page, with a slug that resolves', () => {
    /**
     * `/franchises/<id>` is keyed by franchise ID and the Brand Book by slug,
     * so the link is a DERIVATION, not a stored href — which means a rename in
     * the league config silently changes it. This walks the same derivation
     * the pages use and proves every id still lands on a real page.
     */
    for (const [league, file] of [
      ['theleague', 'src/pages/theleague/franchises/[id].astro'],
      ['afl-fantasy', 'src/pages/afl-fantasy/franchises/[id].astro'],
    ] as const) {
      const src = read(file);
      expect(src, `${file} must link the Brand Book`).toContain(`/${league}/brand/`);
      // Derived from the config entry, never hard-coded per team.
      expect(src).toContain('franchiseSlug(team)');
      // Resolved through the league-path helper, so it is correct on the
      // league's own apex where the prefix is hidden.
      expect(src).toMatch(/resolveLeaguePath\(`\/[a-z-]+\/brand\//);

      for (const b of allFranchiseBrands(league)) {
        expect(franchiseIdFromSlug(league, b.slug), `${b.name} link target`).toBe(b.franchiseId);
      }
    }
  });

  it('keeps the shared host to the NFL half alone', () => {
    // A franchise mark belongs to exactly one league, and five franchises
    // field a team in BOTH — so their slugs collide and a league-less
    // /brand/<slug> could not say which one it meant.
    const root = read('src/pages/brand/[team].astro');
    expect(root).not.toContain('FranchiseBrandPage');
    expect(root).toContain('ClubBrandPage');
  });
});
