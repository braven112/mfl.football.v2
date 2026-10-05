/**
 * Every registry league's team/branding config, read from its `configPath`.
 *
 * Shared code used to import each league's `*.config.json` by name and key a
 * hand-kept map by slug. A new league then needed an edit in every one of those
 * files, and any it missed fell back to TheLeague's teams or to none at all.
 * This module globs the config files once and resolves them through the
 * registry, so a league is wired here by setting `configPath` and nothing else.
 *
 * A league whose file is absent from this checkout gets EMPTY_LEAGUE_CONFIG,
 * never another league's teams. The demo-only keeper slot is that case
 * outside a demo build. The glob is eager and limited to the config-file
 * pattern, so a missing file never fails a build the way a static import of
 * it would.
 */
import { ALL_LEAGUES } from '../config/leagues-data.mjs';

export interface LeagueConfigFile {
  teams: any[];
  conferences?: any[];
  divisions?: any[];
  structure?: string;
  [key: string]: any;
}

const FILES = import.meta.glob<LeagueConfigFile>(
  ['../../data/*/*.config.json', '../data/*.config.json'],
  { eager: true, import: 'default' },
);

/** Glob key (relative to this file) → repo-relative path, as `configPath` spells it. */
function repoPath(globKey: string): string {
  if (globKey.startsWith('../../')) return globKey.slice('../../'.length);
  if (globKey.startsWith('../')) return `src/${globKey.slice('../'.length)}`;
  return globKey;
}

const BY_PATH = new Map(Object.entries(FILES).map(([k, v]) => [repoPath(k), v]));

export const EMPTY_LEAGUE_CONFIG: LeagueConfigFile = Object.freeze({
  teams: [],
  conferences: [],
  divisions: [],
}) as LeagueConfigFile;

/**
 * The config for a league, looked up by its canonical slug (`afl-fantasy`)
 * or its nav slug (`afl`). Unknown league or missing file → EMPTY_LEAGUE_CONFIG.
 */
export function getLeagueConfig(slugOrNavSlug: string | null | undefined): LeagueConfigFile {
  if (!slugOrNavSlug) return EMPTY_LEAGUE_CONFIG;
  const league = ALL_LEAGUES.find((l) => l.slug === slugOrNavSlug || l.navSlug === slugOrNavSlug) as
    | { configPath?: string }
    | undefined;
  const path = league?.configPath;
  return (path && BY_PATH.get(path)) || EMPTY_LEAGUE_CONFIG;
}

/** The league's `teams` array (never undefined). */
export function getLeagueTeams(slugOrNavSlug: string | null | undefined): any[] {
  return getLeagueConfig(slugOrNavSlug).teams ?? [];
}

/** True when the league's config file is present in this checkout. */
export function hasLeagueConfig(slugOrNavSlug: string | null | undefined): boolean {
  return getLeagueConfig(slugOrNavSlug) !== EMPTY_LEAGUE_CONFIG;
}
