/**
 * Which players a team may declare a contract on, for every team at once.
 *
 * Extracted from `rosters.astro` frontmatter (Phase 7 of
 * docs/plans/rosters-page-split.md). The page still loads the feeds —
 * `import.meta.glob` specifiers must be literal and relative to the file that
 * writes them — and hands them here.
 *
 * Read `docs/claude/rules/` via the contracts-eligibility path-guard domain
 * before changing any of this. Two properties in particular are load-bearing
 * and neither is obvious from the code alone:
 *
 * - **Live transactions are layered over the committed feed.** That feed is
 *   written by the roster-sync cron and baked in at BUILD time, so a waiver
 *   claim processed an hour ago is not in it — and a declaration window is
 *   only 24 hours in season. Without the overlay the page renders a player's
 *   contract years as plain text with no "Declare Contract" action: a silent
 *   no-op, never an error, which is exactly how this class of bug hides.
 * - **Rosters come from the Redis snapshot when it exists.** The static feed
 *   can be ~20 minutes behind, and a freshly-acquired rookie still carrying
 *   empty `contractInfo` there would never light up the rookie override.
 *
 * The engine itself (`getTeamEligibility`) is untouched — this is the wiring
 * that decides what it is fed.
 */
import { getTeamEligibility } from '../contract-eligibility';
import { mergeTransactionRows } from '../mfl-transactions-cache';
import type { RosterPlayer, MFLPlayerInfo } from '../../types/contract-eligibility';

/** The frozen (pre-week-14) averages the tag/extension maths is priced off. */
export interface FrozenSalaryAverages {
  franchiseSalaries?: Record<string, number>;
  extensionSalaries?: Record<string, number>;
  teamOptionSalaries?: Record<string, number>;
}

/** One franchise as MFL's rosters feed shapes it: `player` may be a single object. */
export interface EligibilityFranchise {
  id?: string;
  player?: unknown;
}

export interface EligibilityInput {
  /** The LEAGUE year — rosters, contracts and cap all run on this clock. */
  eligibilityYear: number;
  /** Whether that year is the live one, i.e. whether live data applies at all. */
  isCurrentLeagueYear: boolean;
  /** `transactions.transaction` from the committed feed, already array-wrapped. */
  staticTransactions: unknown[];
  /**
   * The last few days of transactions from Redis, or null when the cache is
   * unavailable or the year is historical — the committed feed then stands.
   */
  liveTransactions: unknown[] | null;
  /** `playersFeedBySeason[year]` — MFL's player info, keyed by id. */
  playersFeed: Record<string, unknown>;
  /** `rosters.franchise` from the committed feed. */
  staticFranchises: EligibilityFranchise[];
  /** The Redis roster snapshot, keyed by player id; null when unavailable. */
  cachedRosterPlayers: Record<string, any> | null;
  frozenSalaryAverages?: FrozenSalaryAverages;
  /** Injectable for tests; the page passes the real clock. */
  now?: Date;
}

/** Per franchise, per player, the declaration the UI may offer. */
export type EligibilityByTeam = Record<string, Record<string, any>>;

export interface EligibilityResult {
  eligibilityByTeam: EligibilityByTeam;
  /** The franchises actually used — live snapshot when there was one. */
  franchises: EligibilityFranchise[];
  /** True when the Redis snapshot supplied the rosters rather than the feed. */
  usedLiveRosters: boolean;
}

/** MFL gives one player as an object and many as an array. */
const playerList = (franchise: EligibilityFranchise): RosterPlayer[] =>
  (Array.isArray(franchise.player)
    ? franchise.player
    : [franchise.player].filter(Boolean)
  ).filter((p: any) => p?.id) as RosterPlayer[];

/**
 * The Redis snapshot is keyed by player; the engine wants it grouped by
 * franchise, in the same shape the feed uses.
 */
const franchisesFromCache = (
  cachedRosterPlayers: Record<string, any>,
): EligibilityFranchise[] => {
  const byFranchise: Record<string, any[]> = {};
  for (const [id, p] of Object.entries(cachedRosterPlayers)) {
    if (!p?.franchiseId) continue;
    (byFranchise[p.franchiseId] ??= []).push({
      id,
      salary: p.salary,
      contractYear: p.contractYear,
      contractInfo: p.contractInfo ?? '',
      status: p.status,
    });
  }
  return Object.entries(byFranchise).map(([id, player]) => ({ id, player }));
};

/** Only the fields the client needs; `undefined` extras are left off entirely. */
const toClientEntry = (p: any): Record<string, any> => {
  const entry: Record<string, any> = {
    type: p.declarationType,
    yearOptions: p.yearOptions,
    deadlineTimestamp: p.deadlineTimestamp,
    isExpired: p.isExpired,
    currentYears: p.currentYears,
    currentSalary: p.currentSalary,
    contractInfo: p.contractInfo,
    isRookieContract: p.isRookieContract,
  };
  if (p.tagSalary !== undefined) entry.tagSalary = p.tagSalary;
  if (p.tagBasis !== undefined) entry.tagBasis = p.tagBasis;
  if (p.extensionSalary !== undefined) entry.extensionSalary = p.extensionSalary;
  if (p.extensionYears !== undefined) entry.extensionYears = p.extensionYears;
  if (p.teamOptionSalary !== undefined) entry.teamOptionSalary = p.teamOptionSalary;
  return entry;
};

export function resolveEligibility({
  eligibilityYear,
  isCurrentLeagueYear,
  staticTransactions,
  liveTransactions,
  playersFeed,
  staticFranchises,
  cachedRosterPlayers,
  frozenSalaryAverages,
  now = new Date(),
}: EligibilityInput): EligibilityResult {
  // Live rows over the build-time feed — see the header note.
  const rawTransactions = mergeTransactionRows(
    staticTransactions as any,
    isCurrentLeagueYear ? (liveTransactions as any) : null,
  );

  const playersMap = new Map<string, MFLPlayerInfo>();
  for (const [id, player] of Object.entries(playersFeed)) {
    playersMap.set(id, player as MFLPlayerInfo);
  }

  const usedLiveRosters = Boolean(isCurrentLeagueYear && cachedRosterPlayers);
  const franchises = usedLiveRosters
    ? franchisesFromCache(cachedRosterPlayers as Record<string, any>)
    : (Array.isArray(staticFranchises) ? staticFranchises : []);

  const eligibilityByTeam: EligibilityByTeam = {};
  for (const franchise of franchises) {
    const franchiseId = franchise.id;
    if (!franchiseId) continue;

    const teamResult = getTeamEligibility(
      franchiseId,
      playerList(franchise),
      rawTransactions,
      playersMap,
      eligibilityYear,
      now,
      frozenSalaryAverages,
    );

    const playerMap: Record<string, any> = {};
    for (const p of teamResult.players) {
      if (!p.eligible) continue;
      playerMap[p.playerId] = toClientEntry(p);
    }
    // A team with nothing to declare is absent, not an empty object — the
    // client checks presence.
    if (Object.keys(playerMap).length > 0) {
      eligibilityByTeam[franchiseId] = playerMap;
    }
  }

  return { eligibilityByTeam, franchises, usedLiveRosters };
}
