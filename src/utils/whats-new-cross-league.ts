/**
 * Cross-league What's New aggregation for the root homepage.
 *
 * The root index page shows the latest entries from BOTH leagues in one
 * feed. This composes the league-scoped choke point
 * ({@link getWhatsNewEntriesForLeague}) rather than reading whats-new.json
 * directly, so the fail-closed league tagging rules stay in one place.
 */
import { ALL_LEAGUES, LEAGUES } from '../config/leagues';
import type { LeagueSlug, WhatsNewEntry } from '../types/whats-new';
import { getWhatsNewEntriesForLeague } from './whats-new-entries';
import { formatEntryDate, sortEntriesNewestFirst } from './whats-new-helpers';

export interface HomepageWhatsNewEntry extends WhatsNewEntry {
  /** Human-readable date string (e.g., "Feb 21, 2026") */
  formattedDate: string;
  /** Detail-page path for the card link (league-correct base path) */
  detailPath: string;
}

/** navSlug ('theleague' | 'afl') → canonical path segment ('theleague' | 'afl-fantasy') */
function canonicalSlugFor(navSlug: LeagueSlug): string {
  const league = ALL_LEAGUES.find((l) => l.navSlug === navSlug);
  return league?.slug ?? LEAGUES.theleague.slug;
}

/**
 * Detail-page path for an entry. Single-league entries link into their own
 * league's What's New; both-league entries default to TheLeague's copy
 * (deterministic, and theleague is the default league).
 */
function detailPathFor(entry: WhatsNewEntry): string {
  const navSlug: LeagueSlug =
    entry.leagues.length === 1 ? entry.leagues[0] : ('theleague' as LeagueSlug);
  return `/${canonicalSlugFor(navSlug)}/whats-new/${entry.id}`;
}

/**
 * Pure core: merge per-league entry slices, dedupe by id (both-league
 * entries appear in every slice), drop admin-only entries, sort newest
 * first, and cap at `limit`.
 */
export function mergeAndRankEntries(
  slices: WhatsNewEntry[][],
  limit: number,
): HomepageWhatsNewEntry[] {
  const byId = new Map<string, WhatsNewEntry>();
  for (const slice of slices) {
    for (const entry of slice) {
      if (entry.visibility === 'admin') continue;
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }

  return sortEntriesNewestFirst([...byId.values()])
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      formattedDate: formatEntryDate(entry.date),
      detailPath: detailPathFor(entry),
    }));
}

/** Latest guest-visible entries across every league, newest first. */
export function getLatestWhatsNewAcrossLeagues(limit = 6): HomepageWhatsNewEntry[] {
  const slices = ALL_LEAGUES.map((league) =>
    getWhatsNewEntriesForLeague(league.navSlug as LeagueSlug),
  );
  return mergeAndRankEntries(slices, limit);
}
