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
