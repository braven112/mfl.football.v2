import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import navConfig from '../src/config/nav-config.json';
import type { LeagueSlug, NavLink } from '../src/types/nav';

const REPO_ROOT = process.cwd();
const PRERENDER_TRUE_EXPORT = /^\s*export const prerender\s*=\s*true\b/m;
const LEAGUE_PAGE_DIRS: Record<LeagueSlug, string> = {
  theleague: path.join(REPO_ROOT, 'src/pages/theleague'),
  afl: path.join(REPO_ROOT, 'src/pages/afl-fantasy'),
};

function getTargetLeagues(link: NavLink, sectionLeagueOnly?: LeagueSlug): LeagueSlug[] {
  const sectionLeagues: LeagueSlug[] = sectionLeagueOnly ? [sectionLeagueOnly] : ['theleague', 'afl'];
  if (!link.leagueOnly) return sectionLeagues;
  return sectionLeagues.filter((league) => league === link.leagueOnly);
}

function getPageSourceFile(league: LeagueSlug, navPath: string): string | null {
  const cleanPath = navPath.split('?')[0].replace(/^\/+/, '');
  const leagueDir = LEAGUE_PAGE_DIRS[league];
  const pageFile = path.join(leagueDir, `${cleanPath}.astro`);
  const pageIndex = path.join(leagueDir, cleanPath, 'index.astro');

  if (existsSync(pageFile)) return pageFile;
  if (existsSync(pageIndex)) return pageIndex;
  return null;
}

describe('Nav drawer link integrity', () => {
  it('maps every internal nav link to an existing page', () => {
    for (const section of navConfig.sections) {
      for (const link of section.links) {
        if (!link.path) continue;

        for (const league of getTargetLeagues(link, section.leagueOnly as LeagueSlug | undefined)) {
          const sourceFile = getPageSourceFile(league, link.path);
          expect(
            sourceFile,
            `Missing page for nav link "${link.id}" (${link.path}) in ${league}`
          ).not.toBeNull();
        }
      }
    }
  });

  it('keeps TheLeague internal drawer links server-rendered for clean URL rewrites', () => {
    for (const section of navConfig.sections) {
      for (const link of section.links) {
        if (!link.path) continue;
        if (link.leagueOnly === 'afl') continue;

        const sourceFile = getPageSourceFile('theleague', link.path);
        expect(sourceFile, `Expected TheLeague page for nav link "${link.id}"`).not.toBeNull();

        const source = readFileSync(sourceFile as string, 'utf8');
        expect(
          source,
          `${link.id} (${link.path}) must not be prerendered; clean URL rewriting relies on runtime routing`
        ).not.toMatch(PRERENDER_TRUE_EXPORT);
      }
    }
  });
});
