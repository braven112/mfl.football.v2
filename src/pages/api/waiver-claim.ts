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
import { resolveWaiverWindow } from '../../utils/waiver-window';
import { readMflImportResult } from '../../utils/mfl-import-result';
import {
  readBidRules,
  readPendingWaiverPlayerIds,
  validateClaims,
  validateRound,
  buildPicksParam,
  waiverImportType,
  conferenceOfFranchise,
  freeAgencyIsLeagueWide,
  type WaiverClaim,
} from '../../utils/waiver-claim';

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: false, message, ...extra }), { status, headers: JSON_HEADERS });

/**
 * The franchise's currently-pending waiver claims, as player ids — read once
 * before the write and once after, so confirmation can be the delta.
 *
 * `null` means the read did not happen or could not be understood, which is NOT
 * "nothing is pending". A read failure must never be reported as a failed
 * write: the write may well have landed.
 *
 * mflFetch, NOT fetch: this export is owner-gated, and undici drops the Cookie
 * on MFL's api → www## redirect, so a bare fetch reads back an anonymous error
 * payload and the verification silently never runs.
 */
async function readPendingWaivers(
  year: number,
  leagueId: string,
  mflUserCookie: string
): Promise<string[] | null> {
  try {
    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=pendingWaivers&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie,
    });
    return readPendingWaiverPlayerIds(await res.json());
  } catch {
    return null;
  }
}

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

    // Both waiver systems are supported, but they are genuinely different:
    // TheLeague bids (blindBidWaiverRequest, PICKS `add_bid_drop`), the AFL
    // runs rolling priority (waiverRequest, PICKS `add_drop`). Sending a bid to
    // a priority league would make MFL read the amount as the drop id.
    //
    // ...AND each league alternates between that WAIVER window and an FCFS
    // window where the add happens immediately (`fcfsWaiver`). Which one is
    // live comes from MFL's own calendar — `currentWaiverType` is the league's
    // SYSTEM, not the current state. Re-derived HERE rather than trusted from
    // the client, because it decides which endpoint the write goes to.
    // mflFetch, NOT fetch: the calendar export is owner-gated, and Node's
    // undici strips the Cookie header on MFL's api → www49 redirect. A bare
    // fetch here reads back "API requires a logged in user", which parses as an
    // empty calendar → `unknown` → every FCFS add submitted as a queued claim.
    const calendarRes = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=calendar&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie: user.id,
    });
    const calendarBody = await calendarRes.json().catch(() => null);
    const rawEvents = calendarBody?.calendar?.event;
    const window = resolveWaiverWindow(
      Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : []
    );
    // `unknown` means the calendar told us nothing. Fall back to the queued
    // claim rather than an immediate add — a claim that bounces is recoverable,
    // an unintended instant pickup is not.
    const immediate = window.mode === 'fcfs';

    // FCFS executes now — there is no round to file it under.
    const roundError = immediate ? null : validateRound(round, rules);
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
    // In a duplicate-player league scoped by conference (the AFL), the same
    // player can be rostered by one franchise in EACH conference — so a rival
    // conference's roster says nothing about your availability, and treating it
    // as "taken" would reject legal claims.
    const leagueWide = freeAgencyIsLeagueWide(leaguePayload);
    const myConference = leagueWide ? null : conferenceOfFranchise(leaguePayload, user.franchiseId);
    const countsAgainstMe = (fid: string) =>
      leagueWide || conferenceOfFranchise(leaguePayload, fid) === myConference;
    const rosteredEverywhere = new Set<string>(
      Object.entries(rosters)
        .filter(([fid]) => countsAgainstMe(fid))
        .flatMap(([, list]: any) => (list as any[]).map((p: any) => String(p.id ?? p)))
    );
    const requestedAdds = (claims ?? []).map((c) => String(c?.addPlayerId));
    const freeAgentIds = new Set(requestedAdds.filter((id) => id && !rosteredEverywhere.has(id)));

    const rosterLimit = Number(leaguePayload.rosterSize) || undefined;
    const errors = validateClaims(claims ?? [], {
      // In the FCFS window there is no bid: TheLeague picks up at the league
      // minimum and MFL sets the price itself, so bid rules must not gate it.
      rules: immediate ? { ...rules, system: 'priority', blindBid: false } : rules,
      availableBalance,
      rosterPlayerIds,
      freeAgentIds,
      rosterLimit,
    });
    if (errors.length > 0) return fail(errors[0], 400, { errors });

    // ── Write, owner mode ───────────────────────────────────────────────────
    // FCFS is a different call entirely: a single immediate add/drop, no PICKS
    // list and no round. Only the FIRST claim is meaningful — an ordered board
    // of alternatives has no meaning when the add resolves instantly.
    const params = new URLSearchParams({ L: leagueId });
    if (immediate) {
      const first = claims![0];
      params.set('ADD', String(first.addPlayerId));
      if (first.dropPlayerId && first.dropPlayerId !== '0000') {
        params.set('DROP', String(first.dropPlayerId));
      }
    } else {
      params.set('PICKS', buildPicksParam(claims!, rules.system));
      // `waiverRequest` requires ROUND unconditionally; `blindBidWaiverRequest`
      // only when the league bids conditionally.
      if (rules.conditional || rules.system === 'priority') params.set('ROUND', String(round));
      if (replace) params.set('REPLACE', '1');
    }

    // ── Snapshot the pending round BEFORE the write ─────────────────────────
    // "The player is in my pending waivers" is NOT proof this request stored
    // anything — he may have been sitting there from an earlier round, in which
    // case a dropped write reads back as a success. The repo's own rule for MFL
    // writes is to WATCH THE VALUE CHANGE (docs/claude/insights/domains/
    // mfl-api.md), so confirmation is the DELTA: present after, absent before.
    // That also needs no assumption about MFL's undocumented round/bid shape.
    const pendingBefore = immediate ? null : await readPendingWaivers(year, leagueId, user.id);
    const importType = immediate ? 'fcfsWaiver' : waiverImportType(rules);
    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/import?TYPE=${importType}&L=${leagueId}`,
      method: 'POST',
      mflUserCookie: user.id,
      body: params.toString(),
    });
    const text = (await res.text()).trim();
    // Require an AFFIRMATIVE `<status>OK</status>`. `!res.ok || /<error/` was
    // not a success check: MFL answers a refused import with HTTP 200 and a
    // body carrying no `<error>` at all (a login page, a permission notice),
    // and this route reported "Round 1 submitted" for exactly that. See
    // src/utils/mfl-import-result.ts.
    const outcome = readMflImportResult(text, res.status);
    // Never discard MFL's body on a write — a silent no-op is invisible without
    // it and it is the whole diagnosis.
    if (!outcome.accepted) {
      console.warn('[waiver-claim] MFL did not affirm the write:', outcome.reason ?? outcome.error, text.slice(0, 300));
    }
    // Hard-fail ONLY on an affirmative refusal. `refused`, not `!accepted`:
    // MFL answers `import?TYPE=waiverRequest` with a completely EMPTY body
    // whether it stored the claim or not (probed live — every import type does,
    // including a bogus one), so demanding `<status>OK</status>` here rejects
    // every good claim. That shipped, and it 502'd a real claim during a live
    // waiver window. The read-back below is the only thing that can tell the two
    // apart, so an indeterminate answer goes THROUGH to it rather than stopping
    // here.
    if (outcome.refused) {
      return fail(
        outcome.error
          ? `MFL rejected the claim: ${outcome.error}`
          : 'MFL rejected the claim, so nothing was recorded. Try again, or file it on MyFantasyLeague.',
        502
      );
    }

    // ── Verify by reading the round back ────────────────────────────────────
    // An acknowledged write is a FLOOR, not proof: MFL answers OK and quietly
    // no-ops writes it does not accept. So the claim is only reported as filed
    // once it is read back.
    //
    // `null` means the read-back could not be performed (network failure, or a
    // payload we do not recognize) — which is NOT the same as "nothing is
    // stored", and must never be reported as either success or failure. The
    // previous `stored.length > 0` guard collapsed the two, disabling the
    // verification in the exact case it was written for.
    let stored: string[] | null = null;
    if (immediate) {
      // An FCFS add lands on the ROSTER, not in pendingWaivers — checking the
      // wrong list would report every successful pickup as unconfirmed.
      try {
        const fresh = await createMFLApiClient({ leagueId, year: String(year), mflUserId: user.id }).getRosters();
        stored = user.franchiseId in fresh
          ? ((fresh[user.franchiseId] as any[]) ?? []).map((p: any) => String(p.id ?? p))
          : null;
      } catch {
        stored = null;
      }
      await bustRosterCaches(String(year), leagueId);
      // Verify ONLY what was actually written. The FCFS branch above sends a
      // single ADD (`claims[0]`), so checking the roster against every
      // `requestedAdds` entry would count claims 2..n as missing and report a
      // successful pickup as "probably did NOT go through" — the alternatives
      // in an FCFS board were never submitted and were never meant to be.
      const fcfsAdds = [String(claims![0].addPlayerId)];
      const landed = stored ? fcfsAdds.filter((id) => stored!.includes(id)) : [];
      const missing = stored ? fcfsAdds.filter((id) => !stored!.includes(id)) : fcfsAdds;
      // KNOWN-not-there is a failure; UNKNOWN is not. MFL affirmed nothing (an
      // empty body is its normal answer either way), and the roster says the
      // player is not on it — between them that is a definite miss, and calling
      // it "submitted" is the bug this route exists to prevent.
      if (stored !== null && missing.length > 0 && !outcome.accepted) {
        return fail(
          'MFL did not add the player and your roster does not show them. Nothing was recorded — try again, or add them on MyFantasyLeague.',
          502
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          verified: stored !== null && missing.length === 0,
          message:
            stored === null
              ? 'Submitted, but we could not read your roster back to confirm it. Check your roster before retrying.'
              : missing.length === 0
                ? 'Added — the player is on your roster now.'
                : 'MFL accepted the add but your roster does not show it yet. Check your roster before retrying.',
          mode: 'fcfs',
          // `submitted`, not `requestedAdds`: an FCFS write resolves instantly,
          // so only the first claim was ever sent. Reporting the whole board as
          // submitted would be a lie the client could act on.
          submitted: fcfsAdds,
          confirmed: landed,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }
    stored = await readPendingWaivers(year, leagueId, user.id);

    // A won claim changes rosters, and the page that submitted it will re-read
    // them; drop the cache so it does not serve a pre-claim snapshot.
    await bustRosterCaches(String(year), leagueId);

    // Confirmation is the DELTA, not mere presence: an id that was ALREADY
    // pending before this request proves nothing about this request. Without
    // that, an owner who claims a player in round 1 and re-files him in round 2
    // gets "Round 2 submitted" even when MFL dropped the round-2 write — the
    // exact false confirmation this whole route was rewritten to stop.
    // Both reads must have succeeded to compute it; either one failing leaves
    // the round honestly UNVERIFIED rather than confidently wrong.
    const canDiff = pendingBefore !== null && stored !== null;
    const newlyPending = canDiff
      ? requestedAdds.filter((id) => stored!.includes(id) && !pendingBefore!.includes(id))
      : [];
    const unconfirmed = canDiff ? requestedAdds.filter((id) => !newlyPending.includes(id)) : requestedAdds;
    if (!canDiff) {
      console.warn(
        '[waiver-claim] could not read pendingWaivers on both sides of the write; reporting the round as unverified.',
        { before: pendingBefore === null ? 'unreadable' : 'ok', after: stored === null ? 'unreadable' : 'ok' }
      );
    }

    // KNOWN-not-there is a failure; UNKNOWN is not. `waiverRequest` affirms
    // nothing on success OR failure, so when the read-back succeeded and the
    // claim is NOT newly pending, the delta is the whole evidence and it says
    // the write did not land. Reporting that as "Round N submitted" is exactly
    // the bug this route was rewritten to stop — so it is a hard failure the
    // owner can act on, not a caveat under a checkmark.
    if (canDiff && unconfirmed.length > 0 && !outcome.accepted) {
      return fail(
        `MFL did not record ${
          unconfirmed.length === 1 ? 'the claim' : `${unconfirmed.length} of your claims`
        } — your pending waivers do not show ${unconfirmed.length === 1 ? 'it' : 'them'}. Nothing was filed; try again, or file on MyFantasyLeague.`,
        502,
        { round, submitted: requestedAdds, confirmed: newlyPending }
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        verified: canDiff && unconfirmed.length === 0,
        message: !canDiff
          ? 'Submitted, but we could not read your pending waivers back to confirm it. Check them on MyFantasyLeague.'
          : unconfirmed.length === 0
            ? `Round ${round} submitted — ${claims!.length} claim${claims!.length === 1 ? '' : 's'}.`
            : `MFL accepted the request but your pending waivers do not show ${
                unconfirmed.length === 1 ? 'the claim' : `${unconfirmed.length} of the claims`
              } as newly added yet. Check your pending waivers before retrying.`,
        mode: 'waiver',
        round,
        submitted: requestedAdds,
        // Only the ids this request demonstrably ADDED — not everything of ours
        // MFL happens to be holding, which would re-report an older round's
        // claims as confirmations of this one.
        confirmed: newlyPending,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    console.error('[waiver-claim]', error);
    return fail('Something went wrong submitting your claim. No claim was recorded.', 500);
  }
};
