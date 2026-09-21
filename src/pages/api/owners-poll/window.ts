/**
 * The Owners' Poll — commissioner EMERGENCY STOP.
 *
 *   POST /api/owners-poll/window   { action: 'pause' | 'resume', hours? }
 *   GET  /api/owners-poll/window   → the derived cycle, or `paused`
 *
 * There is no window to open any more. Voting is always open and the cycle is
 * DERIVED from the clock (`resolvePollCycle`), so the only league-wide state
 * left is a pause flag — a key whose mere presence suspends the poll, absent
 * in the normal case, failing OPEN when it cannot be read. `hours` gives that
 * pause a TTL so a forgotten suspension lapses on its own.
 *
 * It exists as an HTTP route and not only as a CLI because the CLI needs
 * Upstash credentials on the operator's machine, whereas the deployment
 * already has them.
 *
 * COMMISSIONER ONLY. This changes what every owner sees, so it is gated on
 * isCommissionerOrAdmin — which is itself league-scoped, so an admin of one
 * league cannot pause the other's poll.
 *
 * NEITHER action touches a ballot. Pausing never tallies and never deletes;
 * resuming picks every standing ballot back up, because they were never
 * cleared. Tallying is generate-pecking-order.mjs --close-poll, and keeping
 * the two apart means a mis-click here cannot publish a consensus or lose a
 * vote.
 */
import type { APIRoute } from 'astro';
import { json, JSON_HEADERS_NO_STORE } from '../../../utils/api-response';
import { isCommissionerOrAdmin, getAuthUser } from '../../../utils/auth';
import { checkRateLimit } from '../../../utils/rate-limit';
import { getSubscriptions } from '../../../utils/push-subscriptions';
import {
  countBallots,
  eligibleFranchiseIdsFor,
  activePollWindow,
  resolvePollCycle,
  setPollPaused,
  resolveOwnersPollCaller,
} from '../../../utils/owners-poll-store';

const headers = JSON_HEADERS_NO_STORE;

/** Longest auto-expiring pause a commissioner may set by hand. */
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

  let body: { action?: string; hours?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400, headers);
  }

  // Voting is always open now, so the commissioner's control is no longer
  // "open a week" — it is an emergency stop. `pause` suspends the poll for
  // every owner; `resume` lifts it. Ballots are never touched by either.
  if (body.action !== 'pause' && body.action !== 'resume') {
    return json({ error: "action must be 'pause' or 'resume'" }, 400, headers);
  }

  const paused = body.action === 'pause';
  if (paused && body.hours != null) {
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
      return json({ error: `hours must be between 0 and ${MAX_HOURS}` }, 400, headers);
    }
  }

  const ok = await setPollPaused(scope, paused, paused ? Number(body.hours) : undefined);
  if (!ok) {
    return json({ error: 'Storage unavailable — nothing changed' }, 503, headers);
  }

  const window = paused ? null : resolvePollCycle(league);
  const ballotsIn = window ? await countBallots(scope, window) : 0;

  return json(
    {
      ok: true,
      status: paused ? 'paused' : 'open',
      window: window
        ? {
            year: window.year,
            week: window.week,
            opensAt: window.opensAt,
            closesAt: window.closesAt,
            slots: window.slots,
          }
        : null,
      // Standing ballots are untouched by a pause, and a commissioner should
      // not be surprised by a non-zero count on resume.
      ballotsIn,
      eligibleVoters: eligibleFranchiseIdsFor(league).length,
      message: paused
        ? 'Voting is suspended. Every standing ballot is untouched.'
        : 'Voting is open. Standing ballots were never cleared.',
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

  const window = await activePollWindow(league, scope);
  if (!window) {
    return json(
      {
        status: 'paused',
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
      status: 'open',
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
