/**
 * POST /api/waiver-claim
 *
 * Submit a round of waiver claims for the authenticated user's franchise.
 * Owner-mode only — never commissioner credentials, never FRANCHISE_ID (MFL
 * treats that as commissioner impersonation).
 *
 * A QUEUED CLAIM REPLAYS MFL'S OWN `add_drop` PAGE, not `import?TYPE=…`. The
 * import API answers an authenticated, correctly-hosted waiver request with an
 * empty 200 and stores nothing — proven twice against a live owner session. An
 * immediate (FCFS) add still uses `import?TYPE=fcfsWaiver`, which does work.
 *
 * Body: {
 *   claims: [{ addPlayerId, bid, dropPlayerId? }],   // in priority order
 *   round: number,                                   // required (league is conditional)
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
import { getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_ID, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';
import { bustRosterCaches } from '../../utils/mfl-roster-cache';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import { resolveWaiverWindow } from '../../utils/waiver-window';
import { readMflImportResult } from '../../utils/mfl-import-result';
import { summarizeMflPage } from '../../utils/mfl-page-summary';
import {
  readBidRules,
  readPendingWaiverPlayerIds,
  validateClaims,
  validateRound,
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
    const { claims, round, year: clientYear } = (await request.json()) as {
      claims?: WaiverClaim[];
      round?: number;
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
    // FCFS is a different call entirely: a single immediate add/drop against the
    // import API, no round. Only the FIRST claim is meaningful — an ordered
    // board of alternatives has no meaning when the add resolves instantly.
    const params = new URLSearchParams({ L: leagueId });
    if (immediate) {
      const first = claims![0];
      params.set('ADD', String(first.addPlayerId));
      if (first.dropPlayerId && first.dropPlayerId !== '0000') {
        params.set('DROP', String(first.dropPlayerId));
      }
    }

    // ── Snapshot the pending round BEFORE the write ─────────────────────────
    // "The player is in my pending waivers" is NOT proof this request stored
    // anything — he may have been sitting there from an earlier round, in which
    // case a dropped write reads back as a success. The repo's own rule for MFL
    // writes is to WATCH THE VALUE CHANGE (docs/claude/insights/domains/
    // mfl-api.md), so confirmation is the DELTA: present after, absent before.
    // That also needs no assumption about MFL's undocumented round/bid shape.
    const pendingBefore = immediate ? null : await readPendingWaivers(year, leagueId, user.id);
    // THE LEAGUE'S OWN HOST, never the `api.` gateway — that is for the API, not
    // page handlers, and it answers a posted import with an empty 200 that
    // stores nothing.
    const writeHost = league.mflHost || getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.mflHost;

    // ── The write ───────────────────────────────────────────────────────────
    // A QUEUED CLAIM REPLAYS MFL'S OWN add_drop FORM, it does not call
    // `import?TYPE=waiverRequest`. That import answers an authenticated,
    // correctly-formed, correctly-hosted request with an empty 200 and stores
    // NOTHING — proven twice against Brandon's live session, with the
    // pendingWaivers read-back confirming the claim never appeared.
    //
    // `add_drop` is the page every owner actually uses, and this repo already
    // depends on it twice over: cut-player.ts replays it for the same reason
    // ("the fcfsWaiver API… refuses any cut while a roster is over the limit"),
    // and theleague/players.astro deep-links owners to it precisely because it
    // "auto-presents blind-bid (waiver) vs FCFS based on MFL's own in-season
    // schedule". Its form has always carried `ROUND` — a field that only means
    // anything for a waiver claim.
    //
    // It returns an HTML PAGE, not API XML, so `readMflImportResult` is not the
    // right reader for it (that would classify every response as a refusal).
    // Errors are recognized from the page the way cut-player does it, and
    // success is settled by the pendingWaivers delta below.
    const writes: Array<{ url: string; body: string }> = immediate
      ? [{
          url: `https://${writeHost}/${year}/import?TYPE=fcfsWaiver&L=${leagueId}`,
          body: params.toString(),
        }]
      : claims!.map((c) => ({
          url: `https://${writeHost}/${year}/add_drop`,
          body: new URLSearchParams({
            L: leagueId,
            add_settings: '',
            PROJSRC: 'mfl',
            add_pid: String(c.addPlayerId),
            drop_pid: c.dropPlayerId && c.dropPlayerId !== '0000' ? String(c.dropPlayerId) : '',
            // FORCE_WAIVER IS THE WHOLE THING. Without it `add_drop` attempts an
            // INSTANT add, which a locked free-agent pool refuses — and MFL
            // refuses it by silently re-rendering the form, which is what four
            // rounds of debugging kept landing on. Ticking it is what turns the
            // page into a waiver CLAIM, and it is also what un-hides ROUND and
            // COMMENTS (its onchange calls
            // `check_waiver_claim(this,'add_drop_submit','add_note_field_id','amt_field_id,round_field_id,comments_field_id')`),
            // so those two fields only ever meant anything alongside it.
            //
            // `on`, because MFL's checkbox carries NO `value` attribute, and a
            // browser posts `on` for a valueless checked box. Read off the live
            // authenticated form, not guessed:
            //   <input type="checkbox" name="FORCE_WAIVER" id="FORCE_WAIVER" …>
            FORCE_WAIVER: 'on',
            ROUND: String(round),
            COMMENTS: '',
            SUBMIT: 'Perform Add/Drop',
          }).toString(),
        }));

    // One POST per claim, in the owner's priority order — the form files one at
    // a time, and MFL appends them to the round in the order they arrive.
    let text = '';
    let res!: Response;
    for (const write of writes) {
      console.log(`[waiver-claim] POST ${write.url} (${write.body})`);
      res = (await mflFetch({
        url: write.url,
        method: 'POST',
        mflUserCookie: user.id,
        body: write.body,
      })) as Response;
      text = (await res.text()).trim();
      if (immediate) {
        console.log(`[waiver-claim] MFL response: ${res.status} ${text.slice(0, 300)}`);
      } else {
        // add_drop answers with a full page, so a raw slice is doctype and
        // <head> and nothing else — three rounds of logs proved only that a
        // page came back. The SUBMIT controls are the payload here: a
        // re-rendered form is MFL stating the action it expects right now.
        const page = summarizeMflPage(text);
        console.log(
          `[waiver-claim] add_drop → ${res.status} | title=${JSON.stringify(page.title)} | submits=${JSON.stringify(page.submits)}`
        );
        console.log(`[waiver-claim] add_drop text: ${page.text}`);
      }
      // MFL re-renders the page carrying its own complaint. Stop on the first
      // one rather than firing the rest of the board at a refusing endpoint.
      const pageError =
        text.match(/Transaction Would Create[^<]*/i) ||
        text.match(/Exceeds League Limit[^<]*/i) ||
        text.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
      if (pageError) {
        return fail(
          `MFL rejected the claim: ${(pageError[1] || pageError[0] || '').trim()}`,
          502
        );
      }
    }
    // Require an AFFIRMATIVE `<status>OK</status>`. `!res.ok || /<error/` was
    // not a success check: MFL answers a refused import with HTTP 200 and a
    // body carrying no `<error>` at all (a login page, a permission notice),
    // and this route reported "Round 1 submitted" for exactly that. See
    // src/utils/mfl-import-result.ts.
    // Only the FCFS path talks to the import API and can be read this way. The
    // queued path replayed an HTML page above, which this classifier would call
    // a refusal — its errors were already handled there, and its success is the
    // delta.
    const outcome = immediate
      ? readMflImportResult(text, res.status)
      : { accepted: false, refused: false, error: null, reason: 'add_drop returns a page; the delta decides.' };
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
