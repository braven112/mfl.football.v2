/**
 * The Owners' Poll — commissioner control for the ballot window.
 *
 *   POST /api/owners-poll/window   { action: 'open' | 'close', week?, year?, hours? }
 *
 * The normal path is automatic: the Tuesday Pecking Order pass opens the
 * ballot and the Wednesday pass tallies it. This is the manual override, for
 * the same three jobs as scripts/owners-poll-window.mjs — recovering from a
 * failed run, extending a window the league asks about, and opening one on a
 * preview deployment where no cron has ever run.
 *
 * It exists as an HTTP route and not only as a CLI because the CLI needs
 * Upstash credentials on the operator's machine, whereas the deployment
 * already has them. A commissioner with a browser can always open a ballot;
 * that should not depend on having pulled env vars.
 *
 * COMMISSIONER ONLY. This writes league-wide state that changes what every
 * owner sees, so it is gated on isCommissionerOrAdmin — which is itself
 * league-scoped, so an admin of one league cannot open the other's ballot.
 *
 * `close` removes the pointer and NOTHING else: it never tallies and never
 * deletes ballots. Tallying is generate-pecking-order.mjs --close-poll. Keeping
 * them apart means a mis-click here cannot publish a consensus or lose a vote,
 * and re-opening the same week picks every ballot back up.
 */

import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { isCommissionerOrAdmin, getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import {
  resolveOwnersPollWindow,
  windowHours,
  SHORT_WINDOW_HOURS,
} from '../../../utils/owners-poll-window.mjs';
import { getSubscriptions } from '../../../utils/push-subscriptions';
import {
  clearOwnersPollWindow,
  countBallots,
  eligibleFranchiseIdsFor,
  readOwnersPollWindow,
  resolveOwnersPollCaller,
  windowState,
  writeOwnersPollWindow,
} from '../../../utils/owners-poll-store';

const headers = JSON_HEADERS_NO_STORE;

/** Longest window a commissioner may open by hand. */
const MAX_HOURS = 24 * 14;

export const POST: APIRoute = async ({ request }) => {
  // Reuse the owner-level resolution first (session, league match, poll
  // enabled), then add the admin gate on top rather than re-deriving any of it.
  const resolved = resolveOwnersPollCaller(request);
  if (!resolved.ok) {
    return json({ error: 'Not authorized to manage the ballot' }, 403, headers);
  }
  const { league, scope, franchiseId } = resolved.caller;

  const user = getAuthUser(request)!;
  if (!isCommissionerOrAdmin(user)) {
    return json({ error: 'Commissioner access required' }, 403, headers);
  }

  const limit = await checkRateLimit('owners-poll-window', franchiseId, 20, 300);
  if (!limit.allowed) {
    return json({ error: 'Too many requests — try again shortly' }, 429, headers);
  }

  let body: { action?: string; week?: number; year?: number; hours?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, headers);
  }

  if (body.action === 'close') {
    const existing = await readOwnersPollWindow(scope);
    if (!existing) {
      return json({ ok: true, status: 'none', message: 'No ballot was open.' }, 200, headers);
    }
    const cleared = await clearOwnersPollWindow(scope);
    if (!cleared) {
      return json({ error: 'Storage unavailable — nothing changed' }, 503, headers);
    }
    return json(
      {
        ok: true,
        status: 'closed',
        message: `Week ${existing.week} is no longer accepting votes. Ballots are untouched.`,
      },
      200,
      headers,
    );
  }

  if (body.action !== 'open') {
    return json({ error: "action must be 'open' or 'close'" }, 400, headers);
  }

  const poll = league.ownersPoll;
  const week = Number(body.week);
  if (!Number.isInteger(week) || week < 1 || week > 25) {
    return json({ error: 'week must be a week number (1-25)' }, 400, headers);
  }
  const year = Number.isInteger(body.year) ? Number(body.year) : new Date().getUTCFullYear();

  const eligibleFranchiseIds = eligibleFranchiseIdsFor(league);
  if (eligibleFranchiseIds.length <= poll.slots) {
    // A top-N ballot needs a field bigger than N, or "rank your top 7" is the
    // whole league and the unranked block is a contradiction.
    return json(
      {
        error: `${league.name} has ${eligibleFranchiseIds.length} franchises but a ballot depth of ${poll.slots}.`,
      },
      409,
      headers,
    );
  }

  const now = new Date();
  let opensAt: string;
  let closesAt: string;
  if (body.hours != null) {
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
      return json({ error: `hours must be between 0 and ${MAX_HOURS}` }, 400, headers);
    }
    opensAt = now.toISOString();
    closesAt = new Date(now.getTime() + hours * 3600000).toISOString();
  } else {
    // The real schedule: close on the next Wednesday at the league's hour.
    ({ opensAt, closesAt } = resolveOwnersPollWindow({
      publishedAt: now,
      closeHourPT: poll.closeHourPT,
      closeWeekday: poll.closeWeekday,
    }));
  }

  const window = { year, week, opensAt, closesAt, slots: poll.slots, eligibleFranchiseIds };
  const saved = await writeOwnersPollWindow(scope, window);
  if (!saved) {
    return json({ error: 'Storage unavailable — nothing changed' }, 503, headers);
  }

  const hours = windowHours(window);
  const ballotsIn = await countBallots(scope, window);

  return json(
    {
      ok: true,
      status: 'open',
      window: { year, week, opensAt, closesAt, slots: poll.slots },
      hours: Math.round(hours * 10) / 10,
      // Re-opening a week picks its existing ballots back up — say so, so a
      // commissioner is not surprised by a non-zero count on a "fresh" open.
      ballotsIn,
      eligibleVoters: eligibleFranchiseIds.length,
      quorum: poll.quorum,
      shortWindow: hours < SHORT_WINDOW_HOURS,
    },
    200,
    headers,
  );
};

/** Current state, so the commissioner panel can render without guessing. */
export const GET: APIRoute = async ({ request }) => {
  const resolved = resolveOwnersPollCaller(request);
  if (!resolved.ok) {
    return json({ error: 'Not authorized' }, 403, headers);
  }
  const user = getAuthUser(request)!;
  if (!isCommissionerOrAdmin(user)) {
    return json({ error: 'Commissioner access required' }, 403, headers);
  }

  const { scope, league } = resolved.caller;

  // Push coverage, because the poll now leans on push: one chat post a day and
  // everything else personal. That only works if owners have actually opted
  // in, and until this number is healthy the daily chat post is the poll's
  // real reach. Counts only — never which owners, and never an endpoint.
  const pushCoverage = await countPushCoverage(league.id, eligibleFranchiseIdsFor(league));

  const window = await readOwnersPollWindow(scope);
  const state = windowState(window);
  if (!window) {
    return json(
      {
        status: state,
        window: null,
        eligibleVoters: eligibleFranchiseIdsFor(league).length,
        pushCoverage,
      },
      200,
      headers,
    );
  }
  const ballotsIn = await countBallots(scope, window);
  return json(
    {
      status: state,
      window: {
        year: window.year,
        week: window.week,
        opensAt: window.opensAt,
        closesAt: window.closesAt,
        slots: window.slots,
      },
      ballotsIn,
      eligibleVoters: window.eligibleFranchiseIds.length,
      pushCoverage,
    },
    200,
    headers,
  );
};

/**
 * How many franchises have at least one push subscription.
 *
 * A COUNT, deliberately — the commissioner needs to know whether push is
 * reaching the league, not who has it off. Degrades to zeros rather than
 * throwing: a coverage read must never take down the control panel.
 */
async function countPushCoverage(leagueId: string, franchiseIds: string[]) {
  let withPush = 0;
  let devices = 0;
  for (const franchiseId of franchiseIds) {
    try {
      const subs = await getSubscriptions(leagueId, franchiseId);
      if (subs.length > 0) {
        withPush += 1;
        devices += subs.length;
      }
    } catch {
      // Skip this franchise rather than failing the whole count.
    }
  }
  return { withPush, of: franchiseIds.length, devices };
}
