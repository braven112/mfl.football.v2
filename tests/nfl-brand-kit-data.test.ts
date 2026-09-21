import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAllNFLTeamCodes } from '../src/utils/nfl-logo';
import { KEEP_COMMITTED } from '../scripts/lib/nfl-logo-sources.mjs';

/**
 * NFL brand-kit catalog guardrail (src/data/nfl-brand-kit.json, written by
 * scripts/fetch-nfl-brand-kit.mjs).
 *
 * The catalog records WHERE every reachable NFL mark lives — the primary SVG
 * on NFL.com, ESPN's six-treatment primary AND secondary (alternate) cuts, and
 * nflverse's wordmark/squared logo/colors. It mirrors no binaries: ESPN's
 * brand-kit cuts are 4096px PNGs and nothing renders them yet, so a surface
 * that wants one mirrors that treatment and reads its URL from here.
 *
 * What this pins:
 *
 * 1. Coverage — every canonical code from getAllNFLTeamCodes() is present. A
 *    team missing here is a team a future surface would silently render
 *    without an alternate.
 * 2. The SECONDARY mark exists for every team. It is the reason the catalog
 *    exists (it is generally the alternate/uniform mark, and the only free
 *    source of alternates available — SportsLogos.net and club brand pages
 *    have no API). All 32 teams carried one when this landed; a regeneration
 *    that quietly drops them turns the catalog back into a primary-only list.
 * 3. Hosts are the three known upstreams over https. A URL pointing somewhere
 *    unexpected means the upstream shape moved and the generator guessed.
 * 4. NO run-clock field. Every commit to main is a production build
 *    (CLAUDE.md § cron cadence), so a `generatedAt` stamp would make each
 *    regeneration a deploy even when no team changed anything.
 * 5. Team keys stay sorted, so an unchanged upstream re-serializes
 *    byte-identically instead of churning .git.
 */

const ROOT = process.cwd();
const CATALOG = join(ROOT, 'src', 'data', 'nfl-brand-kit.json');

interface LogoCut {
  url: string;
  width?: number;
  lastUpdated?: string;
}

interface BrandKitTeam {
  name: string;
  espnId: string;
  primarySvg: string;
  colors: string[];
  nflDotComVariant: 'light' | 'dark';
  wordmark: string | null;
  squaredLogo: string | null;
  espn: Record<string, LogoCut>;
}

interface BrandKit {
  sources: Record<string, string>;
  teams: Record<string, BrandKitTeam>;
}

const raw = readFileSync(CATALOG, 'utf-8');
const kit: BrandKit = JSON.parse(raw);

const ALLOWED_HOSTS = new Set([
  'static.www.nfl.com',
  'a.espncdn.com',
  'raw.githubusercontent.com',
  'upload.wikimedia.org',
  'sports.core.api.espn.com',
]);

describe('nfl-brand-kit.json', () => {
  it('covers every canonical NFL team code', () => {
    const codes = getAllNFLTeamCodes();
    for (const code of codes) {
      expect(kit.teams[code], `brand kit is missing ${code}`).toBeDefined();
    }
    expect(Object.keys(kit.teams).sort()).toEqual([...codes].sort());
  });

  it('carries a secondary (alternate) mark for every team', () => {
    for (const [code, team] of Object.entries(kit.teams)) {
      expect(
        team.espn.secondaryOnWhite?.url,
        `${code}: no secondary mark — the alternate-logo catalog is the point of this file`,
      ).toMatch(/^https:\/\//);
      expect(
        team.espn.secondaryOnBlack?.url,
        `${code}: secondary mark has no on-black treatment (needed for dark surfaces)`,
      ).toMatch(/^https:\/\//);
    }
  });

  it('carries the primary SVG and a wordmark for every team', () => {
    for (const [code, team] of Object.entries(kit.teams)) {
      expect(team.primarySvg, `${code}: primarySvg`).toMatch(
        /^https:\/\/static\.www\.nfl\.com\/league\/api\/clubs\/logos\/[A-Z]+\.svg$/,
      );
      expect(team.wordmark, `${code}: wordmark`).toMatch(/^https:\/\//);
      expect(team.colors.length, `${code}: expected team colors`).toBeGreaterThan(0);
      for (const color of team.colors) {
        expect(color, `${code}: color "${color}" is not a hex value`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('only references the known upstream hosts, over https', () => {
    const urls: string[] = [];
    for (const team of Object.values(kit.teams)) {
      urls.push(team.primarySvg);
      if (team.wordmark) urls.push(team.wordmark);
      if (team.squaredLogo) urls.push(team.squaredLogo);
      for (const cut of Object.values(team.espn)) urls.push(cut.url);
    }
    urls.push(...Object.values(kit.sources).filter((s) => s.startsWith('http')));

    for (const url of urls) {
      const { protocol, hostname } = new URL(url);
      expect(protocol, `${url}: must be https`).toBe('https:');
      expect(ALLOWED_HOSTS.has(hostname), `${url}: unexpected host ${hostname}`).toBe(true);
    }
  });

  it('records no run clock (a timestamp would make every regeneration a deploy)', () => {
    expect(Object.keys(kit)).toEqual(['sources', 'teams']);
    expect(raw).not.toMatch(/"generatedAt"|"fetchedAt"|"updatedAt"/);
  });

  it('flags exactly the clubs whose NFL.com cut is the for-dark variant', () => {
    // NFL.com publishes ONE cut per club. For these three it is the reversed,
    // for-dark mark (NYG white-bodied `ny`, NYJ white-filled oval, CHI the
    // bear head), which is why download-nfl-logos.mjs holds their committed
    // light art instead. The catalog and that script must name the same
    // clubs: if they drift, either the catalog claims a light mark we do not
    // ship, or a surface picks a white-bodied mark for a white cell.
    const flaggedInCatalog = Object.entries(kit.teams)
      .filter(([, team]) => team.nflDotComVariant === 'dark')
      .map(([code]) => code)
      .sort();
    expect(flaggedInCatalog).toEqual(Object.keys(KEEP_COMMITTED).sort());

    for (const team of Object.values(kit.teams)) {
      expect(['light', 'dark']).toContain(team.nflDotComVariant);
    }
  });

  it('keeps team keys sorted so an unchanged upstream is a no-op diff', () => {
    const keys = Object.keys(kit.teams);
    expect(keys).toEqual([...keys].sort());
  });
});
