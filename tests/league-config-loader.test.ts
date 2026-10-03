import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import {
  EMPTY_LEAGUE_CONFIG,
  getLeagueConfig,
  getLeagueTeams,
  hasLeagueConfig,
} from '../src/utils/league-config';

describe('registry logos', () => {
  it('every league names both a light and a dark logo', () => {
    for (const league of ALL_LEAGUES) {
      const logo = (league as { logo?: { light?: unknown; dark?: unknown } }).logo;
      expect(typeof logo?.light === 'string' && logo.light.length > 0, `${league.slug} logo.light`).toBe(true);
      expect(typeof logo?.dark === 'string' && logo.dark.length > 0, `${league.slug} logo.dark`).toBe(true);
    }
  });
});

describe('league-config loader', () => {
  it('resolves every registry league through its configPath', () => {
    for (const league of ALL_LEAGUES) {
      const onDisk = JSON.parse(readFileSync(league.configPath, 'utf8'));
      expect(getLeagueConfig(league.slug), league.slug).toEqual(onDisk);
      // The nav slug resolves to the same file.
      expect(getLeagueConfig(league.navSlug), league.navSlug).toBe(getLeagueConfig(league.slug));
    }
  });

  it('never hands one league another league\'s teams', () => {
    expect(getLeagueConfig('no-such-league')).toBe(EMPTY_LEAGUE_CONFIG);
    expect(getLeagueTeams(null)).toEqual([]);
    expect(hasLeagueConfig('no-such-league')).toBe(false);
  });
});

/**
 * The point of the loader: shared code reads a league's config through the
 * registry, so a new league needs no edit there. A shared file that imports a
 * league's `*.config.json` by name is the hand-kept map this replaced.
 *
 * Files in a league's OWN folder (components/theleague, components/afl,
 * src/data/afl-fantasy, …) may still import their own league's config; those
 * are not on a new league's path. The allowlist below is the shared files that
 * still do, each with the reason; it may only shrink.
 */
const SHARED_DIRS = ['src/utils', 'src/components/shared', 'src/layouts', 'src/components/nav'];
const ALLOWED: Record<string, string> = {
  // Emits crest CSS for TheLeague + AFL icon dirs only; generalising it adds
  // rules for other leagues, a visual change to make on purpose.
  'src/utils/team-icon-dark-styles.ts': 'per-league icon dirs',
  // Single-league helpers that live in utils/ but serve one league's pages.
  'src/utils/afl-draft-slot.ts': 'AFL only',
  'src/utils/afl-awards.ts': 'AFL only',
  'src/utils/afl-conference.ts': 'AFL only',
  'src/utils/afl-mock-draft.ts': 'AFL only',
  'src/utils/franchise-brand.ts': 'TheLeague only',
  'src/utils/owner-trade-reports.ts': 'TheLeague only',
  // Layout/nav still read TheLeague's config for its own chrome.
  'src/layouts/TheLeagueLayout.astro': 'TheLeague chrome',
  'src/components/nav/NavFooter.astro': 'TheLeague chrome',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('shared code reads league configs through the loader', () => {
  it('has no new by-name config imports', () => {
    const offenders: string[] = [];
    for (const dir of SHARED_DIRS) {
      for (const file of walk(dir)) {
        if (!/\.(ts|tsx|astro|mjs)$/.test(file)) continue;
        const rel = file.split(path.sep).join('/');
        if (ALLOWED[rel]) continue;
        const src = readFileSync(file, 'utf8');
        if (/import\s+\w+\s+from\s+['"][^'"]*\.config\.json['"]/.test(src)) offenders.push(rel);
      }
    }
    expect(offenders, 'use getLeagueConfig()/getLeagueTeams() from src/utils/league-config.ts').toEqual([]);
  });

  it('allowlist entries still exist and still import a config', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const src = readFileSync(rel, 'utf8');
      expect(/\.config\.json['"]/.test(src), `${rel} no longer imports a config — drop it from ALLOWED`).toBe(true);
    }
  });
});
