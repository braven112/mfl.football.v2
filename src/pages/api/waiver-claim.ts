/**
 * POST /api/waiver-claim
 *
 * Submit a round of blind-bid waiver claims for the authenticated user's
 * franchise, via MFL's `import?TYPE=blindBidWaiverRequest`. Owner-mode only —
 * never commissioner credentials, never FRANCHISE_ID (MFL treats that as
 * commissioner impersonation).
 *
 * Body: {
 *   claims: [{ addPlayerId, bid, dropPlayerId? }],   // in priority order
 *   round: number,                                   // required (league is conditional)
 *   replace?: boolean,                               // replace the round vs append
 *   year?: number,                                   // page's league year, checked
 * }
 *
 * WHY THE VALIDATION IS HERE AND NOT ONLY IN THE UI: MFL rejects a bad bid with
 * a terse message after the owner has left the page, and a claim silently
 * dropped is indistinguishable from one that lost. Everything checkable is
 * checked before the write, and the write is verified by reading the round back
 * from `export?TYPE=pendingWaivers` — MFL returns HTTP 200 on failures, so the
 * response body is not evidence (see docs/claude/insights/domains/mfl-api.md).
 *
 * Security:
 * - The add must be a genuine free agent, the drop must be on the CALLER'S own
 *   roster; both verified against MFL, not against anything the client sent.
 * - Bid rules come from the live league payload, not constants.
 * - Rate-limited: this is an authenticated write that fans out to MFL.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear, getRolloverLeagueYear } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';
import { createMFLApiClient } from '../../utils/mfl-matchup-api';
import { getLeagueById, DEFAULT_LEAGUE_ID } from '../../config/leagues';
import { bustRosterCaches } from '../../utils/mfl-roster-cache';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import {
  readBidRules,
  validateClaims,
  validateRound,
  buildPicksParam,
  type WaiverClaim,
} from '../../utils/waiver-claim';

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: false, message, ...extra }), { status, headers: JSON_HEADERS });

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return fail('Authentication required. Please sign in.', 401);
  if (!user.id) return fail('MFL session not found. Please sign in again.', 401);
  if (!user.franchiseId) return fail('No franchise associated with your account.', 403);

  try {
    const { claims, round, replace, year: clientYear } = (await request.json()) as {
      claims?: WaiverClaim[];
      round?: number;
      replace?: boolean;
      year?: number;
    };

    const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
    const league = getLeagueById(leagueId);
    // A session carrying a league id we don't know can't be served safely —
    // we'd have no host or year clock, and silently writing into a different
    // league is worse than refusing.
    if (!league) return fail('Unrecognized league on session. Please sign in again.', 400);

    const year = league.leagueYearRollover
      ? getRolloverLeagueYear(league.leagueYearRollover)
      : getCurrentLeagueYear();

    // Around a rollover the page can still be rendering last year's free agent
    // pool while a claim would land in the new league year. Refuse rather than
    // bid on the wrong year's player ids.
    if (clientYear !== undefined && Number(clientYear) !== year) {
      return fail(
        `This page is showing ${clientYear} free agents, but claims would apply to the ${year} league year. Reload the page.`,
        400
      );
    }

    // ── Live league state: bid rules, balance, roster, free agents ──────────
    const leagueRes = await fetch(
      `https://api.myfantasyleague.com/${year}/export?TYPE=league&L=${leagueId}&JSON=1&_=${Date.now()}`
    );
    const leaguePayload = (await leagueRes.json())?.league;
    if (!leaguePayload) return fail('Could not read league settings from MFL. No claim was submitted.', 502);

    const rules = readBidRules(leaguePayload);
    const roundError = validateRound(round, rules);
    if (roundError) return fail(roundError, 400);

    const franchises = Array.isArray(leaguePayload.franchises?.franchise)
      ? leaguePayload.franchises.franchise
      : [leaguePayload.franchises?.franchise].filter(Boolean);
    const mine = franchises.find((f: any) => String(f.id) === String(user.franchiseId));
    const availableBalance = Math.floor(Number(mine?.bbidAvailableBalance ?? 0));

    const mflClient = createMFLApiClient({ leagueId, year: String(year), mflUserId: user.id });
    const rosters = await mflClient.getRosters();
    // An empty roster set means a degraded MFL response, not an empty roster.
    // Proceeding would let "drop a player you don't own" through, so refuse.
    if (!(user.franchiseId in rosters)) {
      return fail('Could not verify your roster with MFL. No claim was submitted — try again shortly.', 502);
    }
    const rosterPlayerIds = new Set<string>(
      (rosters[user.franchiseId] as any[]).map((p: any) => String(p.id ?? p))
    );
    const rosteredEverywhere = new Set<string>(
      Object.values(rosters).flatMap((list: any) => (list as any[]).map((p: any) => String(p.id ?? p)))
    );
    const requestedAdds = (claims ?? []).map((c) => String(c?.addPlayerId));
    const freeAgentIds = new Set(requestedAdds.filter((id) => id && !rosteredEverywhere.has(id)));

    const rosterLimit = Number(leaguePayload.rosterSize) || undefined;
    const errors = validateClaims(claims ?? [], {
      rules,
      availableBalance,
      rosterPlayerIds,
      freeAgentIds,
      rosterLimit,
    });
    if (errors.length > 0) return fail(errors[0], 400, { errors });

    // ── Write, owner mode ───────────────────────────────────────────────────
    const params = new URLSearchParams({ L: leagueId, PICKS: buildPicksParam(claims!) });
    if (rules.conditional) params.set('ROUND', String(round));
    if (replace) params.set('REPLACE', '1');

    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/import?TYPE=blindBidWaiverRequest&L=${leagueId}`,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });
    const text = (await res.text()).trim();
    if (!res.ok || /<error/i.test(text)) {
      return fail(`MFL rejected the claim: ${text.slice(0, 300) || `HTTP ${res.status}`}`, 502);
    }

    // ── Verify by reading the round back ────────────────────────────────────
    // MFL answers a dropped write with HTTP 200 and no error, so the response
    // is not evidence that anything was stored.
    let stored: string[] = [];
    try {
      const pending = await fetch(
        `https://api.myfantasyleague.com/${year}/export?TYPE=pendingWaivers&L=${leagueId}&JSON=1&_=${Date.now()}`,
        { headers: { Cookie: `MFL_USER_ID=${user.id}` } }
      );
      const body = await pending.json();
      const raw = body?.pendingWaivers?.waiver ?? body?.pendingWaivers?.pendingWaiver ?? [];
      stored = (Array.isArray(raw) ? raw : [raw]).map((w: any) => String(w?.player?.id ?? w?.id ?? ''));
    } catch {
      // Verification is best-effort: a read failure here must not be reported
      // as a failed write, because the write may well have landed.
      stored = [];
    }

    // A won claim changes rosters, and the page that submitted it will re-read
    // them; drop the cache so it does not serve a pre-claim snapshot.
    await bustRosterCaches(String(year), leagueId);
    const unconfirmed = requestedAdds.filter((id) => stored.length > 0 && !stored.includes(id));

    return new Response(
      JSON.stringify({
        success: true,
        message: unconfirmed.length
          ? `Submitted, but MFL has not echoed ${unconfirmed.length} of your claims yet. Check your pending waivers.`
          : `Round ${round} submitted — ${claims!.length} claim${claims!.length === 1 ? '' : 's'}.`,
        round,
        submitted: requestedAdds,
        confirmed: stored.filter((id) => requestedAdds.includes(id)),
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[waiver-claim]', error);
    return fail('Something went wrong submitting your claim. No claim was recorded.', 500);
  }
};
