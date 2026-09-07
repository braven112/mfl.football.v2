/**
 * GET /api/app-badge → the number for the installed app's icon badge.
 *
 *   { count, parts: { trades, lineup, poll } }
 *
 * Called by the installed app on launch and after a push arrives — never by
 * the website, which has no icon to badge. See src/utils/app-badge.ts for what
 * the three parts mean and why nothing else is counted.
 *
 * Three rules govern this route:
 *
 * 1. **Identity comes only from the session JWT.** Every part is scoped to the
 *    caller's own league and franchise; nothing in the request chooses the
 *    target. Both leagues have a franchise 0001, so a body-supplied franchise
 *    would badge the wrong owner in the wrong league.
 *
 * 2. **Every part fails QUIET.** A part that throws contributes 0 and the rest
 *    still answer. A badge is a nicety; it must never be the reason an owner
 *    opening the app sees an error, and a 500 here would leave a stale count
 *    stuck on the icon with no way to clear it.
 *
 * 3. **Answers are cached briefly per franchise.** Under the ClientRouter a
 *    keen owner can produce a page-load every few seconds, and two of the
 *    three parts read MFL. The client throttles too (see TheLeagueLayout), but
 *    a server-side cache is what actually bounds MFL traffic, because the
 *    client's throttle lives in sessionStorage and every new tab starts fresh.
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthUser } from '../../utils/auth';
import { json, JSON_HEADERS_NO_STORE } from '../../utils/api-response';
import { getLeagueById, type LeagueDefinition } from '../../config/leagues';
import { getLeagueYearForMflId } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';
import { buildMflExportUrl } from '../../utils/mfl-url';
import { getRedis } from '../../utils/redis-client';
import { appBadgeCacheKey } from '../../utils/app-badge-cache';
import {
  readBallot,
  readOwnersPollWindow,
  windowState,
} from '../../utils/owners-poll-store';
import {
  EMPTY_PARTS,
  isLineupBadgeWindow,
  ownerLineupNeedsAttention,
  resolveBadgeCount,
  type BadgeParts,
} from '../../utils/app-badge';
import {
  buildLineupWarnings,
  buildPlayerIndex,
  parseByeTeams,
  parseInjuries,
  parseRequiredStarters,
  parseStartingLineups,
} from '../../../scripts/lib/lineup-warnings.mjs';

const headers = JSON_HEADERS_NO_STORE;

/** NFL-wide exports (byes, injuries) are league-independent. */
const MFL_API_HOST = 'api.myfantasyleague.com';

/** How long a computed badge is reused for the same franchise. */
const CACHE_TTL_SEC = 90;

/** Repo root, for reading committed mfl-feeds. */
const ROOT = process.cwd();

/** Read a committed MFL feed, or null. Never throws. */
function readFeed(league: LeagueDefinition, year: number, filename: string): unknown | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(ROOT, league.dataPath, 'mfl-feeds', String(year), filename), 'utf8'),
    );
  } catch {
    return null;
  }
}

/** Parse an MFL export response, or null. Never throws. */
async function parseExport(res: Response): Promise<any | null> {
  try {
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

/**
 * A public MFL export — league-wide or NFL-wide data with no owner scope.
 *
 * Plain fetch on purpose. `mflFetch` exists to carry an owner's MFL_USER_ID
 * across MFL's cross-origin redirects, and its cookie is REQUIRED: passing it
 * an absent one sends the literal header `MFL_USER_ID=undefined`. Bye weeks
 * and a week's submitted lineups are the same for everyone, so there is no
 * identity to carry here.
 */
async function fetchPublicExport(url: string): Promise<any | null> {
  try {
    return await parseExport(await fetch(url, { headers: { 'User-Agent': 'mfl-app-badge/1.0' } }));
  } catch {
    return null;
  }
}

/** An export that only answers correctly for a signed-in owner. */
async function fetchOwnerExport(url: string, mflUserCookie: string): Promise<any | null> {
  try {
    return await parseExport(await mflFetch({ url, method: 'GET', mflUserCookie }));
  } catch {
    return null;
  }
}

/**
 * Trade offers awaiting THIS owner's answer.
 *
 * Counts only trades offered TO the caller. A trade the caller proposed is
 * waiting on somebody else, and badging it would mean the number could not be
 * cleared by anything the owner does.
 */
async function countTrades(
  league: LeagueDefinition,
  year: number,
  franchiseId: string,
  mflCookie: string,
): Promise<number> {
  const data = await fetchOwnerExport(
    buildMflExportUrl({ type: 'pendingTrades', leagueId: league.id, year }),
    mflCookie,
  );
  if (!data || data.error) return 0;
  const raw = data?.pendingTrades?.pendingTrade ?? data?.pendingTrades?.trade;
  if (!raw) return 0;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(
    (t: any) => String(t?.offeredto ?? t?.franchise2 ?? '').padStart(4, '0') === franchiseId,
  ).length;
}

/**
 * Does the caller's lineup need attention, inside the pre-kickoff window?
 *
 * Lineups are fetched LIVE. The committed weekly-results feed carries scores
 * rather than starters, and the one feed that does carry them is a snapshot —
 * the whole value of this badge is that it reflects a lineup edited two
 * minutes ago. Everything else (names, byes, injuries, roster requirements)
 * comes off disk, refreshed every five minutes by Roster Sync.
 */
async function countLineup(
  league: LeagueDefinition,
  year: number,
  franchiseId: string,
): Promise<number> {
  const nflSchedule = readFeed(league, year, 'nflSchedule.json');
  if (!isLineupBadgeWindow(nflSchedule)) return 0;

  const week = Number((nflSchedule as any)?.nflSchedule?.week);
  if (!Number.isInteger(week) || week < 1 || week > 18) return 0;

  const weeklyResults = await fetchPublicExport(
    `https://${league.mflHost}/${year}/export?TYPE=weeklyResults&L=${league.id}&W=${week}&JSON=1`,
  );
  const lineups = parseStartingLineups(weeklyResults).filter(
    (l: { franchiseId: string }) => l.franchiseId === franchiseId,
  );
  if (lineups.length === 0) return 0;

  const players = readFeed(league, year, 'players.json');
  const leagueJson = readFeed(league, year, 'league.json');
  const injuries = readFeed(league, year, 'injuries.json');
  if (!players || !leagueJson) return 0;

  // Byes are NFL-wide and are NOT among the committed feeds, so this is the
  // one extra fetch. `parseByeTeams` reads an nflByeWeeks export specifically
  // — handing it the nflSchedule feed silently yields an empty bye set, which
  // reads as "every lineup is clean" rather than as a failure.
  const byeWeeks = await fetchPublicExport(
    `https://${MFL_API_HOST}/${year}/export?TYPE=nflByeWeeks&JSON=1`,
  );

  const warnings = buildLineupWarnings({
    lineups,
    players: buildPlayerIndex(players),
    injuries: parseInjuries(injuries ?? {}),
    byeTeams: parseByeTeams(byeWeeks ?? {}, week),
    requiredStarters: parseRequiredStarters(leagueJson),
  });
  return ownerLineupNeedsAttention(warnings, franchiseId);
}

/** An open ballot this owner has not cast. */
async function countPoll(league: LeagueDefinition, franchiseId: string): Promise<number> {
  if (!league.ownersPoll?.enabled) return 0;
  const scope = league.navSlug;
  const window = await readOwnersPollWindow(scope);
  if (!window || windowState(window) !== 'open') return 0;
  const ballot = await readBallot(scope, window, franchiseId);
  return ballot ? 0 : 1;
}

/** Run a part, swallowing any failure into a 0. */
async function part(label: string, run: () => Promise<number>): Promise<number> {
  try {
    return await run();
  } catch (error) {
    console.error(`[app-badge] ${label} failed:`, error);
    return 0;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) {
    // Not an error worth surfacing — the installed app's auth gate handles
    // signing in, and a badge for a signed-out viewer is simply zero.
    return json({ count: 0, parts: EMPTY_PARTS }, 200, headers);
  }

  // Fail CLOSED on a league we don't recognize, the same way every other
  // owner-scoped route does (src/utils/... / api/watch-list.ts). Falling back
  // to the default league would compute — and CACHE — TheLeague's counts for a
  // session that is not TheLeague's, and because both leagues have a franchise
  // 0001 that lands on a real franchise rather than erroring. A 401 also leaves
  // whatever is on the icon alone, which beats inventing a number we cannot
  // actually resolve.
  const league = user.leagueId ? getLeagueById(user.leagueId) : null;
  if (!league) {
    return json({ error: 'This session has no recognized league.' }, 401, headers);
  }

  const franchiseId = user.franchiseId;
  const cacheKey = appBadgeCacheKey(league.id, franchiseId);

  const redis = await getRedis().catch(() => null);
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (parsed && typeof parsed.count === 'number') {
          return json({ ...parsed, cached: true }, 200, headers);
        }
      }
    } catch {
      // A bad cache entry is not worth failing over — recompute.
    }
  }

  // Per-league rollover clock: roster-shaped for trades and lineups alike.
  const year = getLeagueYearForMflId(league.id);

  const [trades, lineup, poll] = await Promise.all([
    part('trades', () => countTrades(league, year, franchiseId, user.id)),
    part('lineup', () => countLineup(league, year, franchiseId)),
    part('poll', () => countPoll(league, franchiseId)),
  ]);

  const parts: BadgeParts = { trades, lineup, poll };
  const payload = { count: resolveBadgeCount(parts), parts };

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(payload), { ex: CACHE_TTL_SEC });
    } catch {
      // Cache write failures are invisible to the owner; the count is right.
    }
  }

  return json(payload, 200, headers);
};
