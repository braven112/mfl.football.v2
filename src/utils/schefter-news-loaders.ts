/**
 * Best-effort side loads for the Schefter news page.
 *
 * Both of these decorate TheLeague's page and neither is worth failing a
 * render over, so both swallow their errors and return an empty result. They
 * live here rather than in the route because they are data loading, not route
 * wiring — the route should read as "fetch, resolve, render".
 */
import { getTopNamedTeams } from '../../scripts/lib/schefter-team-naming.mjs';
import {
  getRecentMessages,
  toSchefterPosts,
  loadTeamConfig,
} from './groupme-storage';
import type { SchefterPost } from '../types/schefter';

export interface HottestDeskRow {
  franchiseId: string;
  mentions: number;
}

/**
 * Most-named franchises in the rumor mill over the last `days`.
 * Returns [] when Redis is unavailable; the widget renders its own empty state.
 */
export async function loadHottestDesks(days = 7, limit = 5): Promise<HottestDeskRow[]> {
  try {
    const url =
      process.env.UPSTASH_REDIS_REST_URL ||
      process.env.KV_REST_API_URL ||
      process.env.STORAGE_REST_API_URL;
    const token =
      process.env.UPSTASH_REDIS_REST_TOKEN ||
      process.env.KV_REST_API_TOKEN ||
      process.env.STORAGE_REST_API_TOKEN;
    if (!url || !token) return [];
    // Deliberately the raw Upstash client, not src/utils/redis-client's
    // wrapper: getTopNamedTeams calls zrange with byScore/rev/offset/count,
    // which the wrapper's signature does not carry. A mismatch here fails
    // soft to an empty widget, so it would hide rather than break.
    const { Redis } = await import('@upstash/redis');
    const rows = await getTopNamedTeams(new Redis({ url, token }), days, limit);
    return (rows ?? []).map((r: { franchiseId: string; count: number }) => ({
      franchiseId: r.franchiseId,
      mentions: r.count,
    }));
  } catch (err) {
    console.warn('[news] hottest-desks load failed:', err);
    return [];
  }
}

/** Recent group-chat messages as feed posts. Signed-in readers only. */
export async function loadGroupMePosts(isAuthenticated: boolean): Promise<SchefterPost[]> {
  if (!isAuthenticated) return [];
  try {
    const [messages, teamConfig] = await Promise.all([getRecentMessages(100), loadTeamConfig()]);
    return toSchefterPosts(messages, teamConfig);
  } catch (err) {
    console.warn('[news] Failed to load GroupMe messages:', err);
    return [];
  }
}
