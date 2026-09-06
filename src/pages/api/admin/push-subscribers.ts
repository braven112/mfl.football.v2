/**
 * GET /api/admin/push-subscribers
 *
 * Who in this league can actually be reached by a notification — the metric the
 * GroupMe migration runs on.
 *
 * Deadline reminders are push-first as of Sep 2026: the group chat carries them
 * only for the owners the fan-out could not reach, and it @-mentions those
 * owners by name. That makes chat volume a direct function of this number, and
 * makes "are we done migrating?" a question with a real answer instead of a
 * guess. Nothing else in the app could answer it — `getSubscriptions` had no
 * caller outside the sender, so the commissioner was choosing when to go quiet
 * blind.
 *
 * Read-only, commissioner-gated, safe to poll. No mutations, and it never
 * returns an endpoint, a key or an auth token: a push endpoint is a bearer
 * capability to buzz someone's phone, so what crosses this boundary is counts
 * and booleans. `tests/push-subscribers-api.test.ts` pins that.
 *
 * League scoping comes ONLY from the session JWT, matching schefter-stats:
 * a token without a leagueId must not be able to select another league's
 * roster of who is and is not reachable.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isCommissionerOrAdmin } from '../../../utils/auth';
import { json as jsonResponse } from '../../../utils/api-response';
import { getLeagueById } from '../../../config/leagues';
import { getSchefterLeagueConfig } from '../../../utils/schefter-league-data';
import { getSubscriptions } from '../../../utils/push-subscriptions';
import { readPreferences } from '../../../utils/push-preferences';
import { isCategoryEnabled } from '../../../config/notification-categories';

export const prerender = false;

/**
 * The categories that decide whether an owner still shows up in the group
 * chat. Both are default-on, so an owner appears here as unreachable only by
 * having no subscription at all or by having deliberately muted the category.
 *
 * Kept to the DEADLINE categories on purpose: the columns, the poll and the
 * rumor mill are not what we are migrating, and folding them in would make the
 * headline number drift for reasons that have nothing to do with chat volume.
 */
export const DEADLINE_CATEGORIES = ['roster-deadline', 'lineup-deadline'] as const;

export interface SubscriberRow {
  franchiseId: string;
  name: string;
  /** Registered devices. 0 = this owner is named in every fallback post. */
  devices: number;
  /** Per deadline category: would a send to this owner actually deliver? */
  reachable: Record<string, boolean>;
}

export const GET: APIRoute = async ({ request }) => {
  const json = (body: unknown, status = 200) => jsonResponse(body, status);

  const user = getAuthUser(request);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!isCommissionerOrAdmin(user)) return json({ error: 'forbidden' }, 403);

  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) return json({ error: 'unknown league' }, 403);

  let teams;
  try {
    teams = getSchefterLeagueConfig(league).teams ?? [];
  } catch {
    return json({ error: 'no league config' }, 503);
  }

  const rows: SubscriberRow[] = [];
  for (const team of teams) {
    if (!team.franchiseId) continue;
    // Sequential rather than Promise.all: this is a 16-24 row admin page that
    // nobody polls hot, and two round trips per team in parallel is how an
    // Upstash REST plan starts rate-limiting the endpoints that matter.
    const subs = await getSubscriptions(league.id, team.franchiseId).catch(() => []);
    const stored = await readPreferences(league.id, team.franchiseId).catch(() => ({}));
    const reachable: Record<string, boolean> = {};
    for (const category of DEADLINE_CATEGORIES) {
      // Both halves, because either one alone is a wrong answer: a subscribed
      // owner who muted the category is not reachable, and an owner with the
      // category on but no device is not reachable either. This mirrors what
      // the fan-out actually does at send time.
      reachable[category] = subs.length > 0 && isCategoryEnabled(category, stored, league);
    }
    rows.push({
      franchiseId: team.franchiseId,
      name: team.name || `Franchise ${team.franchiseId}`,
      devices: subs.length,
      reachable,
    });
  }

  const subscribed = rows.filter((r) => r.devices > 0).length;
  return json({
    league: league.navSlug,
    teams: rows.length,
    subscribed,
    /** Teams with no device at all — the floor on every fallback post. */
    unsubscribed: rows.length - subscribed,
    devices: rows.reduce((sum, r) => sum + r.devices, 0),
    /**
     * Per category, how many owners a send would actually reach. This is the
     * number to watch: when it equals `teams`, that category's group posts
     * stop on their own, with nothing to switch off.
     */
    reachable: Object.fromEntries(
      DEADLINE_CATEGORIES.map((c) => [c, rows.filter((r) => r.reachable[c]).length]),
    ),
    rows,
  });
};
