/**
 * Assemble the season data the payout planner needs, from committed feeds.
 *
 * The planner itself is pure and takes everything injected (see
 * accounting-payouts.mjs). This module is the one place that goes and gets it,
 * so the API route stays thin and a test can plan a season without touching
 * the filesystem.
 *
 * File access is INJECTED (`read`), because this module has two kinds of
 * caller: the site (pages and API routes), which reads league data through the
 * loader in src/utils/league-data.ts — Blob in production — via
 * `accounting-season-loader.ts`, and node scripts run under tsx
 * (scripts/accounting-carry-over.ts), which read the committed files off disk
 * and cannot load the Vite-only loader. Each caller first fetches the paths the
 * `…Paths` helpers name, then hands in a sync reader over them.
 */

import type { LeagueDefinition } from '../config/leagues';
import { calculateAllPlayFromWeekly, getTierAllPlayStandings } from './standings';
import { getTierMembership } from './afl-tier';
// .mjs shared with node scripts (see its header). No ts-expect-error: its
// types resolve under the project config, so the directive would be unused.
import { resolveTierCutoffWeek } from './all-play.mjs';
import { resolveConfigForYear } from './team-names';
import { extractSeasonStructure, applySeasonStructure } from './afl-structure';

/** Shape the planner consumes. Every field may be absent for an unplayed season. */
export interface PayoutSeasonData {
  bracketMeta?: unknown[];
  brackets?: Record<string, unknown>;
  awards?: Record<string, { franchiseId?: string | null } | string>;
  weeklyScores?: unknown[];
  tierTable?: Record<string, string[]>;
}

/** Sync read of a repo-relative league data path (`data/theleague/…json`): parsed JSON, or null when missing. */
export type SeasonDataReader = (repoPath: string) => unknown;

const readJson = <T,>(read: SeasonDataReader, repoPath: string): T | null => {
  try {
    return (read(repoPath) ?? null) as T | null;
  } catch {
    return null;
  }
};

const dataDir = (league: LeagueDefinition) => league.dataPath.replace(/^\.?\//, '').replace(/\/+$/, '');

const feedPath = (league: LeagueDefinition, year: number, feed: string) =>
  `${dataDir(league)}/mfl-feeds/${year}/${feed}.json`;

const tierConfigPath = (league: LeagueDefinition) => `${dataDir(league)}/afl.config.json`;
const awardsPath = (league: LeagueDefinition) => `${dataDir(league)}/awards-history.json`;

/** Every path `loadPayoutSeasonData(league, year, read)` reads. */
export function payoutSeasonPaths(league: LeagueDefinition, year: number): string[] {
  return [
    feedPath(league, year, 'playoff-brackets'),
    feedPath(league, year, 'weekly-results'),
    feedPath(league, year, 'standings'),
    feedPath(league, year, 'league'),
    tierConfigPath(league),
    awardsPath(league),
  ];
}

/** League years `loadFranchises` falls back through. */
const franchiseYears = (year: number) => [year, year - 1, year - 2];

/** Every path `loadFranchises(league, year, read)` reads. */
export function franchisePaths(league: LeagueDefinition, year: number): string[] {
  return franchiseYears(year).map((candidate) => feedPath(league, candidate, 'league'));
}

/**
 * The AFL's all-play tier table, ranked, as franchise ids per tier.
 *
 * Rebuilt here from the same helpers the standings page uses rather than read
 * off a stored ranking, because there ISN'T one: MFL's all-play export is a
 * single 24-team list with no tier markers, and the ranking that decides the
 * Premier League prizes is computed from weekly results against that season's
 * recorded membership. Reusing the page's helpers is what keeps the money and
 * the standings table agreeing — a second implementation would be free to
 * disagree with the table an owner is looking at.
 *
 * Returns an empty table (not a throw) for a league or season with no tier
 * competition; the planner then reports those prizes unresolved.
 */
function buildTierTable(read: SeasonDataReader, league: LeagueDefinition, year: number): Record<string, string[]> {
  const standings = readJson<any>(read, feedPath(league, year, 'standings'));
  const franchises = standings?.leagueStandings?.franchise;
  if (!Array.isArray(franchises) || franchises.length === 0) return {};

  const tierMembership = getTierMembership(year);
  if (!tierMembership) return {};

  const baseConfig = readJson<any>(read, tierConfigPath(league));
  if (!baseConfig) return {};

  const weeklyResults = readJson<any>(read, feedPath(league, year, 'weekly-results'));
  const cutoffWeek = resolveTierCutoffWeek(baseConfig?.tierCompetition, year);
  const calculatedAllPlay = weeklyResults
    ? calculateAllPlayFromWeekly(weeklyResults, cutoffWeek)
    : undefined;

  const yearResolved = resolveConfigForYear(baseConfig, year);
  const seasonStructure = extractSeasonStructure(readJson<any>(read, feedPath(league, year, 'league')));
  const seasonConfig = applySeasonStructure(yearResolved, seasonStructure);

  const tiers = getTierAllPlayStandings(
    franchises,
    seasonConfig,
    calculatedAllPlay,
    tierMembership,
    // MFL's own order already applies the league's tiebreakers — never
    // re-sort it locally. Same rule as every other standings consumer.
    { preserveFeedOrder: true }
  );

  const table: Record<string, string[]> = {};
  for (const group of tiers) {
    table[group.tier] = group.teams.map((team) => String(team.id));
  }
  return table;
}

/** Resolved award winners for a season, or {} when the league records none. */
function loadAwards(read: SeasonDataReader, league: LeagueDefinition, year: number): Record<string, any> {
  const history = readJson<{ seasons?: Array<{ year: number; awards?: Record<string, any> }> }>(
    read,
    awardsPath(league),
  );
  const season = history?.seasons?.find((entry) => Number(entry.year) === year);
  return season?.awards ?? {};
}

/**
 * Load everything the planner needs for one league-season.
 *
 * Never throws and never partially fails: a missing feed yields a missing
 * field, which the planner turns into an `unresolved` prize with a reason. A
 * throw here would take down the whole payout page for one absent file.
 */
export function loadPayoutSeasonData(
  league: LeagueDefinition,
  year: number,
  read: SeasonDataReader
): PayoutSeasonData {
  const playoffs = readJson<any>(read, feedPath(league, year, 'playoff-brackets'));
  const weekly = readJson<any>(read, feedPath(league, year, 'weekly-results'));

  return {
    bracketMeta: playoffs?.playoffBrackets?.playoffBracket
      ? [].concat(playoffs.playoffBrackets.playoffBracket)
      : [],
    brackets: playoffs?.brackets ?? {},
    awards: loadAwards(read, league, year),
    weeklyScores: weekly?.weeks ?? [],
    tierTable: buildTierTable(read, league, year),
  };
}

/**
 * Franchise id -> name for the ledger UI, from MFL's own league feed.
 *
 * Falls back through earlier years because the CURRENT league year's feed may
 * not exist yet: MFL creates the new league on rollover day, and the accounting
 * page is most useful in exactly that window (settling last season while the
 * new league is still empty). A page that rendered "Franchise 0007" for every
 * row all offseason would be the alternative.
 */
export function loadFranchises(
  league: LeagueDefinition,
  year: number,
  read: SeasonDataReader
): Array<{ id: string; name: string }> {
  for (const candidate of franchiseYears(year)) {
    const feed = readJson<any>(read, feedPath(league, candidate, 'league'));
    const franchises = feed?.league?.franchises?.franchise;
    if (!Array.isArray(franchises) || franchises.length === 0) continue;
    return franchises
      .map((franchise: any) => ({
        id: String(franchise?.id ?? ''),
        name: String(franchise?.name ?? '').trim() || `Franchise ${franchise?.id}`,
      }))
      .filter((franchise) => franchise.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return [];
}
