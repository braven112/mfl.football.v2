/**
 * Passive pending-offer capture for MFL Live.
 *
 * The rumor mill's trade-offer lane is fed by owners' OWN reads of their
 * pending offers (`reportOwnerTrades`, src/utils/owner-trade-reports.ts): we
 * only ever see a proposal because one of the two owners in it looked at it
 * with their own MFL login. Until now that read happened only on the pages
 * that show trades (Trades page, Trade Builder send, the app's trades view),
 * so an owner who opened MFL Live just to check scores fed the lane nothing.
 *
 * This runs the same owner-scoped read in the background whenever a signed-in
 * owner loads or polls MFL Live, so the lane fills while people use Live the
 * way they already do. Nothing new is asked of the owner:
 *
 * - **The owner's own session only.** The MFL cookie is the one inside the
 *   signed session JWT they created by signing in to Live (`user.id`), exactly
 *   what the trades view already uses. We never read MFL's own pages or their
 *   browser cookies, and no commissioner or env credential is involved.
 * - **Throttled per account.** One read per `PASSIVE_READ_INTERVAL_S` per
 *   signed-in account, claimed with Redis `SET NX EX` so a web tab and the
 *   phone app polling at once still cost one MFL call. Without Redis there is
 *   no store to report into, so nothing runs.
 * - **Never in the way.** Callers start it beside the board's own work and
 *   await it through `capturePendingOffersQuietly`, which is time-boxed and
 *   never throws: a slow or failed MFL read can't delay or break a scoreboard.
 * - **TheLeague only**, because `reportOwnerTrades` is (its gate lives there,
 *   and so does the reason). An account with no TheLeague team spends one
 *   Redis claim and, at most, one cached `myleagues` read per interval.
 */

import { createHash } from 'node:crypto';
import type { AuthUser } from '../auth';
import { LEAGUES } from '../../config/leagues';
import { getLeagueYearForMflId } from '../league-year';
import { fetchPendingTradeRows } from '../mfl-trade-ops';
import { reportOwnerTrades } from '../owner-trade-reports';
import { getRedis, type RedisClient } from '../redis-client';
import { listOwnerLeagues } from './owner-league';
import { schefterKey, DEFAULT_SCHEFTER_NAV_SLUG } from '../../../scripts/lib/schefter-keys.mjs';

/** How often one account's offers are read while they use Live. */
export const PASSIVE_READ_INTERVAL_S = 15 * 60;

/** The longest a board request waits on the capture before answering anyway. */
export const PASSIVE_READ_BUDGET_MS = 4000;

export type PassiveCaptureOutcome =
  | 'no-store'
  | 'throttled'
  | 'no-team'
  | 'read-failed'
  | 'no-offers'
  | 'reported';

interface TheLeagueTeam {
  franchiseId: string;
  host: string | null;
}

export interface PassiveCaptureDeps {
  redis: () => Promise<Pick<RedisClient, 'set'> | null>;
  findTeam: (user: AuthUser) => Promise<TheLeagueTeam | null>;
  fetchRows: typeof fetchPendingTradeRows;
  report: typeof reportOwnerTrades;
}

/**
 * The throttle key. The account is named by a hash of its MFL cookie, never
 * the cookie itself: a Redis key is not a place for a credential.
 */
export function passiveCaptureKey(user: Pick<AuthUser, 'id'>): string {
  const account = createHash('sha256').update(user.id).digest('hex').slice(0, 24);
  return schefterKey(DEFAULT_SCHEFTER_NAV_SLUG, `trade_offers:passive_read:${account}`);
}

/** The account's TheLeague team: the session's own when it is a TheLeague session, else MFL's list. */
async function findTheLeagueTeam(user: AuthUser): Promise<TheLeagueTeam | null> {
  const theleagueId = LEAGUES.theleague.id;
  if (user.leagueId === theleagueId && /^\d{4}$/.test(user.franchiseId)) {
    return { franchiseId: user.franchiseId, host: null };
  }
  // `myleagues` is Redis-cached per account (src/utils/my-leagues.ts), and
  // this only runs once the per-interval claim is won.
  const listed = await listOwnerLeagues(user);
  if (!listed.ok) return null;
  const team = listed.leagues.find((l) => l.leagueId === theleagueId);
  return team ? { franchiseId: team.franchiseId, host: team.host } : null;
}

const DEFAULT_DEPS: PassiveCaptureDeps = {
  redis: getRedis,
  findTeam: findTheLeagueTeam,
  fetchRows: fetchPendingTradeRows,
  report: reportOwnerTrades,
};

/** One throttled read of the account's pending offers into the rumor lane's intake. */
export async function capturePendingOffers(
  user: AuthUser,
  deps: PassiveCaptureDeps = DEFAULT_DEPS,
): Promise<PassiveCaptureOutcome> {
  if (!user?.id) return 'no-team';
  const redis = await deps.redis().catch(() => null);
  if (!redis) return 'no-store';

  // Claim the interval BEFORE any MFL call, so concurrent polls cost one read
  // and a failed read is not retried on every poll.
  const claimed = await redis
    .set(passiveCaptureKey(user), Date.now(), { nx: true, ex: PASSIVE_READ_INTERVAL_S })
    .catch(() => null);
  if (claimed === null) return 'throttled';

  const team = await deps.findTeam(user).catch(() => null);
  if (!team) return 'no-team';

  const theleagueId = LEAGUES.theleague.id;
  const { trades } = await deps
    .fetchRows({
      leagueId: theleagueId,
      year: getLeagueYearForMflId(theleagueId),
      mflUserCookie: user.id,
      franchiseId: team.franchiseId,
      host: team.host,
    })
    .catch(() => ({ trades: null }));
  if (!trades) return 'read-failed';
  if (trades.length === 0) return 'no-offers';

  await deps.report(team.franchiseId, trades, theleagueId);
  return 'reported';
}

/**
 * The form a board request uses: start it beside the board's own work and
 * await it before answering. Bounded by `budgetMs` and never rejects.
 */
export function capturePendingOffersQuietly(
  user: AuthUser | null | undefined,
  budgetMs = PASSIVE_READ_BUDGET_MS,
  deps: PassiveCaptureDeps = DEFAULT_DEPS,
): Promise<void> {
  if (!user) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  const work = capturePendingOffers(user, deps).then(
    () => undefined,
    (err) => {
      console.warn('[passive-trade-capture] failed:', err);
    },
  );
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}
