/**
 * What's New — FULL history access (active file + per-year archives).
 *
 * whats-new.json is capped at WHATS_NEW_ACTIVE_MAX entries (see
 * scripts/lib/retention-policy.mjs); older entries live in
 * src/data/whats-new-archive/<year>.json. Only the archive index and the
 * [id] permalink resolver need the full history, so ONLY they import this
 * module — everything else (homepage rows, hero resolver, cross-league
 * digest, admin dashboard) uses whats-new-entries.ts and stays bounded.
 * Importing this module from a broadly-shared surface would drag the whole
 * archive back into that surface's server chunk.
 */
import rawActive from '../data/whats-new.json';
import type { LeagueSlug, WhatsNewEntry } from '../types/whats-new';
import { entryAppliesToLeague } from '../types/whats-new';
import { sortEntriesNewestFirst } from './whats-new-helpers';
import { getAuthUser, isCommissionerOrAdmin } from './auth';

const archiveModules = import.meta.glob<{ default: WhatsNewEntry[] }>(
  '../data/whats-new-archive/*.json',
  { eager: true }
);

const allEntries: WhatsNewEntry[] = (() => {
  const seen = new Set<string>();
  const merged: WhatsNewEntry[] = [];
  const push = (entry: WhatsNewEntry) => {
    if (entry?.id && !seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  };
  (rawActive as WhatsNewEntry[]).forEach(push);
  for (const mod of Object.values(archiveModules)) {
    const entries = (mod as { default?: WhatsNewEntry[] }).default ?? (mod as unknown as WhatsNewEntry[]);
    if (Array.isArray(entries)) entries.forEach(push);
  }
  return merged;
})();

const byLeague = new Map<LeagueSlug, WhatsNewEntry[]>();

/** Every entry ever published that's visible in the given league. */
export function getAllWhatsNewEntriesForLeague(league: LeagueSlug): WhatsNewEntry[] {
  let entries = byLeague.get(league);
  if (!entries) {
    entries = allEntries.filter((e) => entryAppliesToLeague(e, league));
    byLeague.set(league, entries);
  }
  return entries;
}

/**
 * Full-history counterpart of whats-new-entries.ts#getVisibleWhatsNewEntries
 * — identical visibility rule (admin-only entries need an admin session),
 * sorted newest-first.
 */
export function getAllVisibleWhatsNewEntries(
  request: Request,
  league: LeagueSlug
): WhatsNewEntry[] {
  const user = getAuthUser(request);
  const isAdmin = !!user && isCommissionerOrAdmin(user);
  const visible = getAllWhatsNewEntriesForLeague(league).filter(
    (e) => e.visibility !== 'admin' || isAdmin
  );
  return sortEntriesNewestFirst(visible);
}
