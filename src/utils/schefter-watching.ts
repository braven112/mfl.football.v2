/**
 * "Watching" for the Schefter Report — which players a viewer cares about,
 * and which posts are about them.
 *
 * A viewer's watching set is the union of two lists:
 * - **My Watch List** — the Redis mirror of their MFL watch list
 *   (src/utils/watch-list-store.ts). As fresh as their last visit to a page
 *   that syncs it, which is every page that renders a Watch control.
 * - **Their own roster** — every player they currently roster, read from the
 *   roster cache (Redis, MFL-backed) with the committed feed as fallback.
 *   Commissioner's call (Sep 2026): your own players count as watched
 *   without lifting a finger.
 *
 * `matchPosts` then intersects each post's `playerIds` (structural from the
 * transaction lanes, prose-matched by scripts/schefter-tag-players.mjs) with
 * that set and names the hits so a card can say WHO it matched on.
 *
 * Everything is best-effort: a Redis outage degrades to "nothing watched",
 * never to a failed page.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LeagueDefinition } from '../config/leagues';
import type { SchefterPost } from '../types/schefter';
import { getWatchedPlayerIds } from './watch-list-store';
import { getCachedRosterFranchises } from './mfl-roster-cache';
import { getPlayerMap } from './player-map';
import { postPlayerIds } from './schefter-player-tagger.mjs';

/** Is this post about anyone in the set? Reads structural AND prose-matched ids. */
export function postMentionsAny(post: SchefterPost, ids: Set<string>): boolean {
  return postPlayerIds(post).some((id) => ids.has(id));
}

/**
 * Is this post about the viewer's own team, regardless of who it names?
 *
 * Player ids are not enough for the For You feed. "Your lineup has an OUT
 * starter", a trade you are a party to, a waiver claim you won — these are
 * addressed to a FRANCHISE, and some name no player at all. Posts carry
 * `franchiseIds` for exactly this.
 */
export function postConcernsFranchise(
  post: SchefterPost,
  franchiseId: string | null | undefined,
): boolean {
  if (!franchiseId) return false;
  return (post.franchiseIds ?? []).some((id) => String(id) === franchiseId);
}

/**
 * Post types that are every owner's business regardless of who they name.
 *
 * `ask-roger` is the calendar-deadline lane — "TODAY: Declare Contracts / Cut
 * to 22", "Offseason FA Closes". These carry `franchiseIds: []` because they
 * genuinely apply league-wide, and stamping a franchise on them to force them
 * into a personal feed would be a lie the rest of the code then believes.
 * Including the TYPE instead says the true thing: a deadline is actionable for
 * the reader even though it is not about them.
 *
 * Kept deliberately short. Every type added here is one more thing in a feed
 * whose entire purpose is to be quiet.
 */
const ALWAYS_ACTIONABLE_TYPES = new Set<SchefterPost['type']>(['ask-roger']);

/**
 * The For You test: a post about a player you roster or watch, about your
 * franchise, or a league-wide deadline you have to act on.
 *
 * This is the ONE definition — the feed filter and anything else that asks
 * "is this mine?" must both call it, or they drift.
 */
export function postIsForViewer(
  post: SchefterPost,
  sets: WatchingSets,
  franchiseId: string | null | undefined,
): boolean {
  return (
    ALWAYS_ACTIONABLE_TYPES.has(post.type) ||
    postMentionsAny(post, sets.all) ||
    postConcernsFranchise(post, franchiseId)
  );
}

export type WatchKind = 'watch' | 'roster';

export interface WatchingSets {
  watched: Set<string>;
  roster: Set<string>;
  /** Union of the two. Empty when the viewer has nothing to watch. */
  all: Set<string>;
}

export interface WatchHit {
  id: string;
  name: string;
  kind: WatchKind;
}

/** Player ids on a franchise's roster from the committed MFL feed. */
function rosterIdsFromFeed(league: LeagueDefinition, year: number, franchiseId: string): Set<string> {
  try {
    const file = join(process.cwd(), league.dataPath, 'mfl-feeds', String(year), 'rosters.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const franchises = raw?.rosters?.franchise;
    const list = Array.isArray(franchises) ? franchises : franchises ? [franchises] : [];
    const mine = list.find((f: { id?: string }) => String(f?.id) === franchiseId);
    const players = mine?.player;
    const rows = Array.isArray(players) ? players : players ? [players] : [];
    return new Set(rows.map((p: { id?: string }) => String(p?.id ?? '')).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Player ids on a franchise's roster — live cache first, committed feed second. */
export async function getOwnRosterIds(
  league: LeagueDefinition,
  year: number,
  franchiseId: string,
): Promise<Set<string>> {
  try {
    const franchises = await getCachedRosterFranchises(String(year), league.id);
    const mine = franchises?.find((f) => String(f.id) === franchiseId);
    if (mine) {
      const rows = Array.isArray(mine.player) ? mine.player : [];
      return new Set(rows.map((p) => String(p.id)));
    }
  } catch (err) {
    console.warn('[schefter-watching] roster cache read failed:', err);
  }
  return rosterIdsFromFeed(league, year, franchiseId);
}

export async function resolveWatchingSets(
  league: LeagueDefinition,
  year: number,
  franchiseId: string | null | undefined,
): Promise<WatchingSets> {
  if (!franchiseId) return { watched: new Set(), roster: new Set(), all: new Set() };
  const [watchedIds, roster] = await Promise.all([
    getWatchedPlayerIds(league.slug, franchiseId),
    getOwnRosterIds(league, year, franchiseId),
  ]);
  const watched = new Set(watchedIds);
  return { watched, roster, all: new Set([...watched, ...roster]) };
}

/**
 * For every post that names a watched player, the hits in the post's own id
 * order. A player both watched AND rostered reads as 'watch' — the explicit
 * choice outranks the implicit one.
 */
export function matchPosts(
  posts: SchefterPost[],
  sets: WatchingSets,
  year: number,
): Record<string, WatchHit[]> {
  const out: Record<string, WatchHit[]> = {};
  if (sets.all.size === 0) return out;
  const players = getPlayerMap(year);
  for (const post of posts) {
    const hits: WatchHit[] = [];
    for (const id of postPlayerIds(post)) {
      if (!sets.all.has(id)) continue;
      const kind: WatchKind = sets.watched.has(id) ? 'watch' : 'roster';
      hits.push({ id, name: players.get(id)?.name ?? `Player ${id}`, kind });
    }
    if (hits.length) out[post.id] = hits;
  }
  return out;
}
