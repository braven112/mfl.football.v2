/**
 * Which waiver system a league runs — read from MFL, never assumed.
 *
 * MFL's `currentWaiverType` on `export?TYPE=league` is the authority, and the
 * two leagues genuinely differ:
 *
 *   - TheLeague is `BBID_FCFS` — blind bidding, ties broken FIRST COME FIRST
 *     SERVED. **It has no waiver priority order.** MFL still serves a
 *     `waiverSortOrder` for it, because MFL always does, but the number
 *     decides nothing: it is the default reverse-franchise-id list nobody
 *     ever set and nothing ever reads. Showing it to a TheLeague owner is
 *     inventing a queue that does not exist.
 *   - The AFL is `WAIVERS_FCFS` — rolling priority, where the order IS the
 *     mechanism (docs/claude/afl-rules.md § Setting the waiver order).
 *
 * So anything that presents a priority order must gate on this, not on the
 * league slug. A slug check would be a hardcoded league constant (CLAUDE.md
 * "never hardcode league constants") AND would silently lie the day a
 * commissioner switches the setting in MFL — which is a thing they can do
 * from the MFL UI, without touching this repo.
 *
 * BUILD TIME, NOT REQUEST TIME. The feeds are eager-globbed, so this costs a
 * bundled ~12 KB per league-year and zero I/O per render — which is what lets
 * the layout-mounted Transaction Hub ask the question on every page.
 */

import type { WaiverSystem } from './waiver-claim';
import { readBidRules } from './waiver-claim';

import { getLeagueBySlug } from '../config/leagues';
import { leagueFeedPath, listLeagueData, preloadLeagueData, readLeagueDataSync } from './league-data';

/**
 * Every season's league.json for a league, by path — read through the
 * league-data loader (src/utils/league-data.ts), so only the one season a
 * call needs is ever parsed, and none of it is compiled into the function.
 */
function feedsFor(leagueSlug: string): string[] | null {
  // Best-ball has no waiver feeds at all — it is draft-only
  // (docs/claude/rules/best-ball.md), so there is nothing to read.
  if (leagueSlug !== 'theleague' && leagueSlug !== 'afl-fantasy') return null;
  const dataPath = getLeagueBySlug(leagueSlug)?.dataPath;
  return dataPath ? listLeagueData(leagueFeedPath(dataPath, '20*', 'league.json')) : null;
}

/**
 * The most recent league payload we hold for a league, preferring `year`.
 *
 * Falls BACK to the newest year on file rather than to an empty object,
 * because an empty payload reads as `priority` through {@link readBidRules}
 * (no `BBID` in an absent `currentWaiverType`) — which is exactly the wrong
 * default: it would put a fabricated priority order in front of a blind-bid
 * league for the whole window between a rollover and the first feed sync.
 */
function chooseFeed(leagueSlug: string, year: number): string | null {
  const feeds = feedsFor(leagueSlug);
  if (!feeds || feeds.length === 0) return null;
  const exact = feeds.find((path) => path.includes(`/${year}/`));
  return exact ?? [...feeds].sort((a, b) => b.localeCompare(a))[0];
}

function readLeaguePayload(leagueSlug: string, year: number): Record<string, any> | null {
  const chosen = chooseFeed(leagueSlug, year);
  return chosen ? (readLeagueDataSync<any>(chosen)?.league ?? null) : null;
}

/** Load the one league.json {@link getWaiverSystem} reads for this league-year. */
export async function preloadWaiverSystem(leagueSlug: string, year: number): Promise<void> {
  const chosen = chooseFeed(leagueSlug, year);
  if (chosen) await preloadLeagueData([chosen]);
}

/**
 * `'priority'` only when MFL says so. A league we hold no payload for returns
 * null — "we do not know", which callers must not render as either system.
 */
export function getWaiverSystem(leagueSlug: string, year: number): WaiverSystem | null {
  const league = readLeaguePayload(leagueSlug, year);
  if (!league) return null;

  // A PRESENT payload is not a READABLE one, and the difference decides the
  // wrong way by default: `readBidRules` looks for "BBID" in the string, so a
  // `league` object that is missing `currentWaiverType` stringifies to '' and
  // comes back as `priority` — failing OPEN, into a fabricated order, which is
  // the exact outcome this module exists to prevent. `readBidRules` is right
  // to default that way for the claim builder (a league that does not bid is
  // the safe assumption there); it is wrong here, so the check lives at this
  // call site rather than changing a shared helper's contract.
  const declared = String((league as any).currentWaiverType ?? '').trim();
  if (!declared) return null;

  return readBidRules(league).system;
}

/**
 * Whether a waiver PRIORITY ORDER means anything in this league.
 *
 * Fails closed: unknown league, unread feed and blind-bid all answer false,
 * because the cost of hiding a real order is a missing screen, while the cost
 * of showing a fake one is an owner planning around a queue that does not
 * exist.
 */
export function leagueUsesWaiverPriority(leagueSlug: string, year: number): boolean {
  return getWaiverSystem(leagueSlug, year) === 'priority';
}
