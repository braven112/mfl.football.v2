/**
 * The Brand Book shows every mark the league has — the guarantee that let the
 * Brand Files library (`/brand/files`) be retired.
 *
 * Two inventories are held against `allBrandFiles`, the list the Brand Book's
 * pages render from:
 *  - the league's aggregated asset file, which scripts/sync-<league>-assets.mjs
 *    rebuilds from public/assets on every prebuild — every club (active and
 *    retired), league, championship, conference and division file;
 *  - every file in each seasonal mark folder (public/assets/<navSlug>/<marks>/),
 *    so a new set, or a new drawing in one, cannot ship without a page.
 *
 * A failure here names a file no Brand Book page shows. Give it a home in
 * src/utils/brand-book-subjects.ts rather than allowlisting it.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../src/config/leagues';
import { SEASONAL_THEMES } from '../src/config/seasonal-themes.mjs';
import {
  allBrandFiles,
  brandSubjects,
  retiredClubs,
  type BrandBookAssets,
  type BrandBookConfig,
} from '../src/utils/brand-book-subjects';
import { franchiseIdFromSlug } from '../src/utils/franchise-marks';
import { codeFromSlug } from '../src/utils/nfl-marks';
import theleagueAssets from '../src/data/theleague.assets.json';
import theleagueConfig from '../src/data/theleague.config.json';
import aflAssets from '../data/afl-fantasy/afl.assets.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';

const ROOT = join(__dirname, '..');

const LEAGUES: Array<[CanonicalLeagueSlug, BrandBookAssets, BrandBookConfig]> = [
  ['theleague', theleagueAssets as BrandBookAssets, theleagueConfig as BrandBookConfig],
  ['afl-fantasy', aflAssets as BrandBookAssets, aflConfig as BrandBookConfig],
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

for (const [slug, assets, config] of LEAGUES) {
  describe(`Brand Book coverage — ${slug}`, () => {
    const shown = new Set(allBrandFiles(slug, assets, config).map((f) => f.url));

    it('shows every file in the aggregated asset list', () => {
      const listed = [
        ...Object.values(assets.extras ?? {}).flatMap((e) => e ?? []),
        ...(assets.teams ?? []).flatMap((t) => Object.values(t.assets ?? {}).flatMap((e) => e ?? [])),
        ...(config.masterAssets ?? []),
      ].map((e) => e.relativePath);
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.filter((p) => !shown.has(p))).toEqual([]);
    });

    it('shows every file in every seasonal mark folder', () => {
      const league = getLeagueBySlug(slug)!;
      const sets = league.seasonalThemes ?? [];
      for (const id of sets) {
        const folder = SEASONAL_THEMES[id]?.marks;
        if (!folder) continue;
        const dir = join(ROOT, 'public/assets', league.navSlug, folder);
        expect(existsSync(dir), `${dir} is missing`).toBe(true);
        const files = walk(dir).map((f) => f.slice(join(ROOT, 'public').length).split('\\').join('/'));
        expect(files.length).toBeGreaterThan(0);
        expect(files.filter((p) => !shown.has(p)), `${id} files with no Brand Book page`).toEqual([]);
      }
    });

    it('links every file to a page that exists', () => {
      const subjects = new Set(brandSubjects(slug, assets, config).map((s) => (s.kind === 'league' ? 'league' : `${s.kind}/${s.slug}`)));
      for (const f of allBrandFiles(slug, assets, config)) {
        const ok = subjects.has(f.page) || f.page === 'archive' || franchiseIdFromSlug(slug, f.page) !== null;
        expect(ok, `${f.url} → ${f.page}`).toBe(true);
      }
    });

    it('gives the league page its logo and every division a badge', () => {
      const subjects = brandSubjects(slug, assets, config);
      expect(subjects[0].kind).toBe('league');
      expect(subjects[0].groups[0].files.length).toBeGreaterThan(0);
      const divisions = subjects.filter((s) => s.kind === 'division');
      expect(divisions.length).toBeGreaterThan(0);
      for (const d of divisions) expect(d.groups[0].files.length, d.name).toBeGreaterThan(0);
      // Every current franchise sits in exactly one current division.
      const placed = divisions.filter((d) => d.current).flatMap((d) => d.franchises.map((f) => f.franchiseId));
      expect(new Set(placed).size).toBe(placed.length);
    });

    it('puts the Halloween set on the league page, named as in code', () => {
      const league = brandSubjects(slug, assets, config)[0];
      const set = league.seasonal.find((s) => s.id === 'halloween');
      expect(set?.name).toBe('Halloween');
      expect(set?.folder).toBe(SEASONAL_THEMES.halloween.marks);
    });

    it('archives every retired club', () => {
      const former = (assets.teams ?? []).filter((t) => t.category === 'former').length;
      expect(retiredClubs(slug, assets)).toHaveLength(former);
    });

    it('keeps the static segments out of franchise and club reach', () => {
      for (const segment of ['league', 'archive', 'conference', 'division', 'files']) {
        expect(franchiseIdFromSlug(slug, segment), segment).toBeNull();
        expect(codeFromSlug(segment), segment).toBeNull();
      }
    });
  });
}
