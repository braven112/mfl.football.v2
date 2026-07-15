/**
 * What's New entries — league-scoped access.
 *
 * The single choke point for reading whats-new.json. Pages and resolvers
 * should get entries through {@link getWhatsNewEntriesForLeague} instead of
 * importing the JSON directly, so forgetting to league-filter is structurally
 * impossible for new consumers (cross-league leakage was a real bug — see
 * docs/claude/insights/features/whats-new-blog.md).
 *
 * The per-league slices are memoized at module level: the JSON is static per
 * deploy, so SSR pages (prerender = false) reuse the same filtered arrays
 * instead of re-filtering on every request. Treat the returned arrays as
 * read-only — copy before sorting/mutating (the existing helpers already do).
 */
import rawEntries from '../data/whats-new.json';
import type { LeagueSlug, WhatsNewEntry } from '../types/whats-new';
import { entryAppliesToLeague } from '../types/whats-new';
import { sortEntriesNewestFirst } from './whats-new-helpers';
import { getAuthUser, isCommissionerOrAdmin } from './auth';

const allEntries = rawEntries as WhatsNewEntry[];

const byLeague = new Map<LeagueSlug, WhatsNewEntry[]>();

/** All entries visible in the given league (fail-closed on untagged entries). */
export function getWhatsNewEntriesForLeague(league: LeagueSlug): WhatsNewEntry[] {
  let entries = byLeague.get(league);
  if (!entries) {
    entries = allEntries.filter((e) => entryAppliesToLeague(e, league));
    byLeague.set(league, entries);
  }
  return entries;
}

/**
 * The league's entries as a page should see them: admin-only entries filtered
 * by the requester's session, sorted newest-first. The single implementation
 * of the visibility rule — the index page and the detail resolver both use
 * this, so an admin-only entry can never be visible on one surface and hidden
 * on the other.
 */
export function getVisibleWhatsNewEntries(
  request: Request,
  league: LeagueSlug
): WhatsNewEntry[] {
  const user = getAuthUser(request);
  const isAdmin = !!user && isCommissionerOrAdmin(user);
  const visible = getWhatsNewEntriesForLeague(league).filter(
    (e) => e.visibility !== 'admin' || isAdmin
  );
  return sortEntriesNewestFirst(visible);
}
