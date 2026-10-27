/**
 * Where each owner last read their league's MFL chat — the marker behind the
 * app's unread badge (package N).
 *
 * Keyed by MFL league id AND franchise id: every MFL league has a franchise
 * 0001, so a franchise-only key would let one league's reading clear another
 * league's badge (the `rankings-scope` lesson). The app serves any MFL league,
 * so the key uses the MFL id rather than a registry slug.
 *
 * Best-effort and never throws: with Redis down the badge reads 0 and the
 * chat still loads.
 */

import { getRedis } from './redis-client';

export interface ChatReadMarker {
  /** MFL id of the newest message the owner has seen. */
  id: string;
  /** That message's time, for when MFL has trimmed it out of the file. */
  at: string | null;
}

export function chatReadKey(leagueId: string, franchiseId: string): string {
  return `mfl-live:chat-read:${leagueId}:${franchiseId}`;
}

export async function readChatMarker(leagueId: string, franchiseId: string): Promise<ChatReadMarker | null> {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const raw = await redis.get<ChatReadMarker>(chatReadKey(leagueId, franchiseId));
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    return { id: raw.id, at: typeof raw.at === 'string' ? raw.at : null };
  } catch (err) {
    console.error('[mfl-chat] read marker failed:', err);
    return null;
  }
}

export async function writeChatMarker(
  leagueId: string,
  franchiseId: string,
  marker: ChatReadMarker,
): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    await redis.set(chatReadKey(leagueId, franchiseId), marker);
  } catch (err) {
    console.error('[mfl-chat] write marker failed:', err);
  }
}
