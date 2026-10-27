/**
 * Waiver claims for ONE owner in ONE league — the shared body of the site's
 * `/api/waiver-claim` + `/api/waiver-claims` and the phone app's
 * `/api/mfl-live/waivers`.
 *
 * The routes differ only in WHO is asking and HOW the league was resolved:
 * the site reads its session (`getAuthUser`, registry leagues only), the app
 * reads the Bearer session (`getMflLiveUser`) and checks the league against
 * the account's own MFL league list. Everything after that — the bid rules,
 * the window, the add_drop replay, the read-back — is one implementation, so
 * a fix to how MFL is spoken to lands in every surface at once. The scars that
 * shaped it are in the comments below; read them before changing a field.
 *
 * Owner mode only: every MFL call carries the owner's OWN cookie
 * (`ctx.cookie`), never the server's credentials and never FRANCHISE_ID.
 */

import { recordInsightAction, type InsightActor } from './site-insights';
import { getCurrentLeagueYear, getRolloverLeagueYear } from './league-year';
import { mflFetch, describeMflFailure } from './mfl-fetch';
import { createMFLApiClient } from './mfl-matchup-api';
import {
  getLeagueById,
  getLeagueBySlug,
  leagueClock,
  DEFAULT_LEAGUE_ID,
  DEFAULT_LEAGUE_SLUG,
} from '../config/leagues';
import { bustRosterCaches } from './mfl-roster-cache';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS, handledFailure } from './api-response';
import { resolveWaiverWindow } from './waiver-window';
import { summarizeMflPage } from './mfl-page-summary';
import { fetchDropLocks, isPlayerLocked } from './mfl-locked-players';
import { checkRateLimit } from './rate-limit';
import { getPlayerMap } from './player-map';
import {
  readBidRules,
  readPendingWaiverPlayerIds,
  readFiledWaiverClaims,
  validateClaims,
  validateRound,
  activeRosterIdsOf,
  freeAgencyIsLeagueWide,
  poolOfFranchise,
  bidBalance,
  formatBidAmount,
  type FiledWaiverClaim,
  type WaiverClaim,
} from './waiver-claim';

// Every failure goes through `handledFailure`, which sends a 5xx as 200: the
// edge replaces a 5xx body, and the message is the whole point of the reply.
// Guard: tests/claim-route-handled-failure-guard.test.ts.
const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  handledFailure(message, status, extra, JSON_HEADERS);

/** Who is acting, in which league, and where that league lives on MFL. */
export interface OwnerLeagueContext {
  /** The owner's own MFL_USER_ID cookie (`user.id` on either session). */
  cookie: string;
  /** 4-digit franchise id in THIS league. */
  franchiseId: string;
  leagueId: string;
  /** The MFL LEAGUE year the write lands in (never the season year). */
  year: number;
  /** Bare MFL web host, e.g. `www49.myfantasyleague.com` — page handlers live there, not on `api.`. */
  host: string;
  /**
   * Registry slug, which names the zone MFL's calendar is read in
   * (`leagueClock`). Null for a league outside this site, which has no
   * official clock of ours and reads on the registry's default.
   */
  slug: string | null;
  /** Whether another franchise can hold a copy of the same player (the AFL). */
  duplicatePlayers: boolean;
  /** Who to credit in site insights, or null where none applies (the app). */
  insightActor: InsightActor | null;
}

export type ContextResult =
  | { ok: true; ctx: OwnerLeagueContext }
  | { ok: false; message: string; status: number };

/**
 * The site session's context. Registry leagues only: a session whose league
 * we don't know can't be served safely — we'd have no host or year clock, and
 * silently writing into a different league is worse than refusing.
 */
export function siteOwnerContext(
  user: { id?: string; franchiseId?: string; leagueId?: string; name?: string } | null,
): ContextResult {
  if (!user) return { ok: false, message: 'Authentication required. Please sign in.', status: 401 };
  if (!user.id) return { ok: false, message: 'MFL session not found. Please sign in again.', status: 401 };
  if (!user.franchiseId) return { ok: false, message: 'No franchise associated with your account.', status: 403 };

  const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
  const league = getLeagueById(leagueId);
  if (!league) return { ok: false, message: 'Unrecognized league on session. Please sign in again.', status: 400 };

  // Leagues roll to the new MFL year on different clocks: TheLeague flips
  // Feb 14, AFL flips June 1 (registry leagueYearRollover).
  const year = league.leagueYearRollover
    ? getRolloverLeagueYear(league.leagueYearRollover)
    : getCurrentLeagueYear();
  // Never a literal: a hardcoded host sends one league's owners to the other's
  // site (tests/league-literal-guard.test.ts).
  const host = league.mflHost || getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.mflHost;
  return {
    ok: true,
    ctx: {
      cookie: user.id,
      franchiseId: user.franchiseId,
      leagueId,
      year,
      host,
      slug: league.slug,
      duplicatePlayers: !!league.duplicatePlayers,
      insightActor: { leagueId, franchiseId: user.franchiseId, name: user.name },
    },
  };
}

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

/**
 * Submit a round of waiver claims (or, in an FCFS window, one immediate
 * add/drop). Body: `{ claims: [{ addPlayerId, bid, dropPlayerId? }], round, year? }`,
 * claims in priority order; `year` is the page's league year and is checked.
 */
export async function submitWaiverClaims(ctx: OwnerLeagueContext, request: Request): Promise<Response> {
  // Authenticated write that fans out to MFL. Same budget as the filed-claims route.
  const limit = await checkRateLimit('waiver-claim', ctx.cookie, 30, 60);
  if (!limit.allowed) return fail('Too many requests — wait a moment and try again.', 429);

  try {
    const { claims, round, year: clientYear } = (await request.json()) as {
      claims?: WaiverClaim[];
      round?: number;
      year?: number;
    };

    const { leagueId, year } = ctx;

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
    // mflFetch with the owner's cookie: a private league outside this site
    // answers its `league` export only to a signed-in member.
    const leagueRes = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=league&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie: ctx.cookie,
    });
    const leaguePayload = (await leagueRes.json())?.league;
    if (!leaguePayload) return fail('Could not read league settings from MFL. No claim was submitted.', 502);

    const rules = readBidRules(leaguePayload);

    // Both waiver systems are supported, but they are genuinely different:
    // TheLeague bids (blindBidWaiverRequest, PICKS `add_bid_drop`), the AFL
    // runs rolling priority (waiverRequest, PICKS `add_drop`). Sending a bid to
    // a priority league would make MFL read the amount as the drop id.
    //
    // ...AND each league alternates between that WAIVER window and an FCFS
    // window where the add happens immediately. Which one is live comes from
    // MFL's own calendar — `currentWaiverType` is the league's SYSTEM, not the
    // current state. Re-derived HERE rather than trusted from the client,
    // because it decides which form fields the write carries, and with them
    // whether the owner ends up with a queued claim or the player.
    // mflFetch, NOT fetch: the calendar export is owner-gated, and Node's
    // undici strips the Cookie header on MFL's api → www49 redirect. A bare
    // fetch here reads back "API requires a logged in user", which parses as an
    // empty calendar → `unknown` → every FCFS add submitted as a queued claim.
    const calendarRes = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=calendar&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie: ctx.cookie,
    });
    const calendarBody = await calendarRes.json().catch(() => null);
    const rawEvents = calendarBody?.calendar?.event;
    const window = resolveWaiverWindow(
      Array.isArray(rawEvents) ? rawEvents : rawEvents ? [rawEvents] : [],
      new Date(),
      leagueClock(ctx.slug).zone
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
    const myFranchise = franchises.find((f: any) => String(f.id) === String(ctx.franchiseId));
    const availableBalance = bidBalance(myFranchise?.bbidAvailableBalance);

    const mflClient = createMFLApiClient({ leagueId, year: String(year), mflUserId: ctx.cookie });
    // getRosterEntries, NOT getRosters: the roster-limit check below needs MFL's
    // per-player `status`, and flattening it to ids is what made a legal 14-of-16
    // AFL roster carrying two injured players read as 16/16 full — refusing every
    // owner with somebody on IR (2026-09-09). IR and taxi squad sit under their
    // OWN league limits (`injuredReserve`, `taxiSquad`), never against rosterSize.
    const rosters = await mflClient.getRosterEntries();
    // An empty roster set means a degraded MFL response, not an empty roster.
    // Proceeding would let "drop a player you don't own" through, so refuse.
    if (!(ctx.franchiseId in rosters)) {
      return fail('Could not verify your roster with MFL. No claim was submitted — try again shortly.', 502);
    }
    const mine = rosters[ctx.franchiseId];
    // Every player the franchise holds — this is DROP eligibility, where an
    // injured player is as droppable as a starter.
    const rosterPlayerIds = new Set<string>(mine.map((p) => String(p.id)));
    // …and the subset that actually occupies one of the league's roster slots.
    const activeRosterIds = activeRosterIdsOf(mine);
    // In a duplicate-player league scoped by conference (the AFL), the same
    // player can be rostered by one franchise in EACH conference — so a rival
    // conference's roster says nothing about your availability, and treating it
    // as "taken" would reject legal claims.
    const leagueWide = freeAgencyIsLeagueWide(leaguePayload);
    const myConference = leagueWide ? null : poolOfFranchise(leaguePayload, ctx.franchiseId);
    const countsAgainstMe = (fid: string) =>
      leagueWide || poolOfFranchise(leaguePayload, fid) === myConference;
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
      activeRosterIds,
      freeAgentIds,
      rosterLimit,
    });
    if (errors.length > 0) return fail(errors[0], 400, { errors });

    // ── Locked players ──────────────────────────────────────────────────────
    // A recently dropped player is LOCKED on MFL (its own add/drop page marks
    // him with a `*`) and MFL refuses the add. Left to the write, that refusal
    // reached the owner as a bare "Claim failed (HTTP 502)", which says nothing
    // about why. MFL publishes the lock list itself, per conference, so ask it
    // first and say so plainly. A failed read is "unknown", not "locked": fall
    // through and let MFL decide, exactly as before this check existed.
    // FCFS only: in the waiver window MFL marks the WHOLE pool locked and a
    // queued claim is the right request for every one of them, so
    // fetchDropLocks answers null there without reading.
    const locked = await fetchDropLocks(leagueId, year, window.mode, { fresh: true });
    // FCFS writes only the FIRST claim (see `writes` below), so only that one is
    // checked there — a locked alternative further down a board must not stop
    // an available first pick.
    const writtenAdds = immediate ? requestedAdds.slice(0, 1) : requestedAdds;
    const lockedAdds = writtenAdds.filter((id) => isPlayerLocked(locked, id, myConference));
    if (lockedAdds.length > 0) {
      return fail(
        lockedAdds.length === 1 && writtenAdds.length === 1
          ? 'This player is locked on MFL — he was recently dropped and cannot be added until the lock lifts. No claim was submitted.'
          : 'One or more of these players is locked on MFL (recently dropped) and cannot be added until the lock lifts. No claim was submitted.',
        409,
        { locked: lockedAdds }
      );
    }

    // ── Write, owner mode ───────────────────────────────────────────────────
    // FCFS is still a different REQUEST — a single immediate add/drop, no round,
    // and only the FIRST claim is meaningful, because an ordered board of
    // alternatives has no meaning when the add resolves instantly — but it is no
    // longer a different ENDPOINT. Both modes replay MFL's own `add_drop` page
    // now; see the writes below for what separates them.

    // ── Snapshot the pending round BEFORE the write ─────────────────────────
    // "The player is in my pending waivers" is NOT proof this request stored
    // anything — he may have been sitting there from an earlier round, in which
    // case a dropped write reads back as a success. The repo's own rule for MFL
    // writes is to WATCH THE VALUE CHANGE (docs/claude/insights/domains/
    // mfl-api.md), so confirmation is the DELTA: present after, absent before.
    // That also needs no assumption about MFL's undocumented round/bid shape.
    const pendingBefore = immediate ? null : await readPendingWaivers(year, leagueId, ctx.cookie);
    // THE LEAGUE'S OWN HOST, never the `api.` gateway — that is for the API, not
    // page handlers, and it answers a posted import with an empty 200 that
    // stores nothing. The site's context takes it from `league.mflHost`; the
    // app's from the account's own MFL league list.
    const writeHost = ctx.host;
    // Where an owner can see the claim with their own eyes. Derived from the
    // registry, never written out — a literal would send TheLeague's owners to
    // the AFL's host (tests/league-literal-guard.test.ts).
    const confirmUrl = `https://${writeHost}/${year}/add_drop?L=${leagueId}`;

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
    //
    // AND THE FCFS ADD REPLAYS THE SAME PAGE — that is the bug fixed on
    // 2026-09-07, live, in the AFL's first FCFS window of the season. It used to
    // POST `import?TYPE=fcfsWaiver`, and that import applies a strict "the
    // resulting roster must be inside the in-season limit" validation which
    // scores the ADD before the DROP. So an owner at 16/16 — which is every
    // owner who needs to drop somebody to make room, i.e. the whole point of an
    // add/drop — is refused. It refuses by answering HTTP 200 with an EMPTY
    // BODY: no error, no transaction, nothing in MFL's log. Three consecutive
    // pickups vanished that way in eleven minutes while another owner made the
    // identical full-roster swap on MFL's own page in the same window.
    // cut-player.ts hit this exact validation from the DROP side and moved to
    // `add_drop` for it; this is the same wall from the ADD side.
    //
    // The two modes differ only in the pair of fields that tells the page what
    // to do: FORCE_WAIVER + `Submit Request` file a CLAIM, and their absence +
    // `Perform Add/Drop` execute the add NOW (MFL's picker.js swaps the button
    // value between exactly those two strings).
    const writes: Array<{ url: string; body: string }> = immediate
      ? [{
          url: `https://${writeHost}/${year}/add_drop`,
          body: new URLSearchParams({
            L: leagueId,
            add_settings: '',
            PROJSRC: 'mfl',
            add_pid: String(claims![0].addPlayerId),
            drop_pid:
              claims![0].dropPlayerId && claims![0].dropPlayerId !== '0000'
                ? String(claims![0].dropPlayerId)
                : '',
            // Inert on an instant add — the page only reads ROUND for a claim —
            // but MFL's form posts it either way, and cut-player.ts sends the
            // same '1' for the same reason: replay the form, don't edit it.
            ROUND: '1',
            COMMENTS: '',
            // NO FORCE_WAIVER, and the unticked button value. This is the one
            // combination that performs the add immediately, which is what an
            // FCFS window is.
            SUBMIT: 'Perform Add/Drop',
          }).toString(),
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
            // THE BID. Blind-bid leagues only, and its absence is why NO claim
            // TheLeague ever filed through this route was stored.
            //
            // `add_drop` was built and proven against the AFL, which runs
            // rolling waiver PRIORITY — position in the order decides, so its
            // form has no amount box and none was ever sent. TheLeague is
            // blind-bid and MFL rejected every claim for it, in as many words:
            //
            //   Cannot Save Request: Invalid Bid Amount (bid amount must not
            //   include letters or symbols)
            //   Cannot Save Request: Bid amount ($) is below bid minimum
            //   ($425000)
            //
            // The `($)` is MFL echoing back the empty value it read.
            //
            // `BBID_AMT` is READ OFF THE LIVE FORM, not inferred. MFL's own JS
            // calls the wrapper `amt_field_id`, and the sibling wrappers
            // `round_field_id` / `comments_field_id` hold inputs named ROUND and
            // COMMENTS — so the obvious guesses were `AMT` and `AMOUNT`, and
            // both are wrong. "Don't ship inferred parameter names to a write
            // endpoint" (docs/claude/insights/domains/mfl-api.md) earned its
            // place again here.
            //
            // Sent as bare integer dollars in a whole-dollar league: MFL parses
            // this field itself and says so — "must not include letters or
            // symbols" — so no `$`, no commas. A CENTS league (archies:
            // bbidIncrement 0.01) sends two decimals ("12.50") via
            // formatBidAmount: its own increment says MFL takes cents there,
            // but that form has not yet been proven against a live claim —
            // the owner chose to enable it (2026-09-28), and MFL's refusal text
            // is surfaced by the page-summary check below if it objects.
            // `validateClaims` has already guaranteed a
            // finite number at or above the minimum and on the increment for a
            // bbid league, so there is nothing left to coerce.
            //
            // Omitted entirely for a priority league rather than sent empty:
            // the AFL's form has no such field and its claims work today.
            ...(rules.blindBid ? { BBID_AMT: formatBidAmount(Number(c.bid), rules.increment) } : {}),
            ROUND: String(round),
            COMMENTS: '',
            // `Submit Request`, NOT `Perform Add/Drop`. MFL's server dispatches
            // on the submit button's VALUE, and its own picker.js rewrites that
            // value the moment FORCE_WAIVER is ticked:
            //
            //   if (obj.checked) { submit.value = "Submit Request";
            //     note.innerHTML = "This add/drop will be submitted as a
            //                       waiver request."; }
            //   else             { submit.value = "Perform Add/Drop"; }
            //
            // Sending the else-branch value asks for an INSTANT ADD, which a
            // locked free-agent pool refuses — MFL said so in as many words
            // once the log finally printed past its nav menu:
            // "Okonkwo, Chigoziem WAS TE Cannot Be Added Because Is Locked."
            // FORCE_WAIVER alone was never enough; the pair is the request.
            //
            // cut-player.ts keeps `Perform Add/Drop` and is right to: a cut is
            // an instant drop, not a claim.
            SUBMIT: 'Submit Request',
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
        mflUserCookie: ctx.cookie,
        body: write.body,
      })) as Response;
      text = (await res.text()).trim();
      // add_drop answers with a full page, so a raw slice is doctype and
      // <head> and nothing else — three rounds of logs proved only that a
      // page came back. The SUBMIT controls are the payload here: a
      // re-rendered form is MFL stating the action it expects right now.
      const page = summarizeMflPage(text);
      console.log(
        `[waiver-claim] add_drop (${immediate ? 'fcfs' : 'waiver'}) → ${res.status} | title=${JSON.stringify(page.title)} | submits=${JSON.stringify(page.submits)}`
      );
      console.log(`[waiver-claim] add_drop text: ${page.text}`);
      // A NON-2xx IS A KNOWN MISS, and it must not fall through to the
      // read-back. Everything below is written for MFL's own 200-with-a-page
      // answer: the complaint scan finds nothing in a 502 gateway page, and the
      // read-back then decides — which is right when it can read the roster,
      // but reports "Submitted, but we could not confirm it" when it cannot.
      // That is the softest possible wording for a write we know never reached
      // MFL. The old FCFS path got this for free (`readMflImportResult` scored
      // a non-2xx as `refused`); retiring that reader took the status check out
      // with it. cut-player.ts keeps the same guard on the same page handler.
      if (!res.ok) {
        return fail(
          `MFL did not accept the request (HTTP ${res.status}). Nothing was recorded — try again, or use MyFantasyLeague.`,
          502,
          { confirmUrl }
        );
      }
      // MFL re-renders the page carrying its own complaint. Stop on the first
      // one rather than firing the rest of the board at a refusing endpoint.
      //
      // `Cannot Save Request:` IS THE ONE THAT MATTERS, and it was missing.
      // MFL states a rejected waiver claim as prose in the page body, one
      // sentence per problem:
      //
      //   Error: invalid waiver request: Cannot Save Request: Invalid Bid
      //   Amount (bid amount must not include letters or symbols)
      //   Cannot Save Request: Bid amount ($) is below bid minimum ($425000)
      //
      // Without that pattern the page classified as "no error found", the
      // pendingWaivers delta then reported the claim as missing, and the owner
      // was told the generic "MFL did not record the claim" — while MFL had
      // named the cause in as many words. That cost an afternoon on 2026-09-03.
      // EVERY occurrence is collected, not the first: MFL emits one line per
      // problem and the second line is usually the actionable one.
      //
      // `Cannot Be Added/Dropped` joins them ON THE IMMEDIATE PATH ONLY. An
      // INSTANT add has refusals a queued claim does not — the headline one
      // being a locked player, which MFL states with the player's own name in
      // front of it:
      //   "Okonkwo, Chigoziem WAS TE Cannot Be Added Because Is Locked."
      // so the leading characters are captured too, or the sentence loses the
      // subject and reads as being about nobody.
      //
      // Scoped, because the queued path posts ONE REQUEST PER CLAIM in a loop
      // and any match here aborts the rest of the board. A new pattern that
      // false-positives on the re-rendered page — which carries the whole free
      // agent listing, not just MFL's complaint — would strand claims 2..n
      // after claim 1 had already been filed. The FCFS path sends exactly one
      // write, so it has no board to strand.
      const complaints = [
        ...[...text.matchAll(/Cannot Save Request:[^<]*/gi)].map((m) => m[0]),
        ...(immediate
          ? [...text.matchAll(/[^<>]{0,60}Cannot Be (?:Added|Dropped) Because[^<]*/gi)].map((m) => m[0])
          : []),
        ...[...text.matchAll(/Transaction Would Create[^<]*/gi)].map((m) => m[0]),
        ...[...text.matchAll(/Exceeds League Limit[^<]*/gi)].map((m) => m[0]),
      ]
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const errorTag = text.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
      if (errorTag?.[1]?.trim()) complaints.push(errorTag[1].trim());
      if (complaints.length > 0) {
        return fail(
          `MFL rejected the ${immediate ? 'add' : 'claim'}: ${[...new Set(complaints)].join(' ')}`,
          502,
          { confirmUrl }
        );
      }
    }
    // NOTHING IS AFFIRMED BY THE BODY ON EITHER PATH, and no code here should
    // ever go looking for an affirmation again. `add_drop` answers a success and
    // a refusal with the same 200 and the same page furniture — the difference
    // is the complaint sentence handled above, and after that the read-back is
    // the only evidence there is.
    //
    // The rule this replaces is worth keeping in view, because it cost a live
    // waiver window: the route once demanded `<status>OK</status>` from the
    // import API and 502'd a real claim, since MFL answers EVERY import type
    // with an empty body whether it stored the write or not. `readMflImportResult`
    // still exists for routes that do talk to `import?TYPE=…`; it must not come
    // back here, where it would classify each of these HTML pages as a refusal.
    //
    // Never discard MFL's body on a write — a silent no-op is invisible without
    // it and it is the whole diagnosis.
    console.warn('[waiver-claim] MFL affirms nothing on add_drop; the read-back decides.', text.slice(0, 300));

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
      //
      // READ IT CACHE-BUSTED, AND READ IT TWICE BEFORE CALLING IT A MISS. Every
      // other MFL read in this route carries `_=Date.now()`; `getRosters()` is
      // the one that does not, so its URL is byte-identical on every call and
      // anything between here and MFL is free to answer from a copy taken
      // before the write. That did not matter while the write never landed. It
      // matters now: a stale or lagging read turns a SUCCESSFUL pickup into
      // "Nothing was recorded — try again", in the one window where the owner
      // will absolutely try again.
      const readMyRoster = async (): Promise<string[] | null> => {
        try {
          const res = await mflFetch({
            url: `https://api.myfantasyleague.com/${year}/export?TYPE=rosters&L=${leagueId}&FRANCHISE=${ctx.franchiseId}&JSON=1&_=${Date.now()}`,
            method: 'GET',
            mflUserCookie: ctx.cookie,
          });
          const franchises = (await res.json())?.rosters?.franchise;
          const list = Array.isArray(franchises) ? franchises : franchises ? [franchises] : [];
          const mineNow = list.find((f: any) => String(f?.id) === String(ctx.franchiseId));
          if (!mineNow) return null;
          const players = Array.isArray(mineNow.player)
            ? mineNow.player
            : mineNow.player
              ? [mineNow.player]
              : [];
          return players.map((p: any) => String(p?.id ?? p));
        } catch {
          return null;
        }
      };
      stored = await readMyRoster();
      // One retry, and only when the answer would be a hard failure — MFL's
      // export can trail its own write by a beat. Bounded and on the failure
      // path only, so a normal pickup pays nothing for it.
      if (stored !== null && !stored.includes(String(claims![0].addPlayerId))) {
        await new Promise((r) => setTimeout(r, 900));
        stored = (await readMyRoster()) ?? stored;
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
      // KNOWN-not-there is a failure; UNKNOWN is not. MFL affirmed nothing (the
      // page is the same either way) and named no complaint, and the roster says
      // the player is not on it — between them that is a definite miss, and
      // calling it "submitted" is the bug this route exists to prevent.
      // `confirmUrl` rides along so the owner is handed MFL's own add/drop page
      // in the same breath: a failed pickup in a first-come window is worth
      // seconds, and re-deriving that link by hand is how one got lost.
      if (stored !== null && missing.length > 0) {
        return fail(
          'MFL did not add the player and your roster does not show them. Nothing was recorded — try again, or add them on MyFantasyLeague.',
          502,
          { confirmUrl }
        );
      }
      if (ctx.insightActor) await recordInsightAction(ctx.insightActor, 'waiver_claim');
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
          confirmUrl,
          // `submitted`, not `requestedAdds`: an FCFS write resolves instantly,
          // so only the first claim was ever sent. Reporting the whole board as
          // submitted would be a lie the client could act on.
          submitted: fcfsAdds,
          confirmed: landed,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }
    stored = await readPendingWaivers(year, leagueId, ctx.cookie);

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

    // KNOWN-not-there is a failure; UNKNOWN is not. `add_drop` affirms nothing
    // on success OR failure, so when the read-back succeeded and the claim is
    // NOT newly pending, the delta is the whole evidence and it says the write
    // did not land. Reporting that as "Round N submitted" is exactly the bug
    // this route was rewritten to stop — so it is a hard failure the owner can
    // act on, not a caveat under a checkmark.
    if (canDiff && unconfirmed.length > 0) {
      return fail(
        `MFL did not record ${
          unconfirmed.length === 1 ? 'the claim' : `${unconfirmed.length} of your claims`
        } — your pending waivers do not show ${unconfirmed.length === 1 ? 'it' : 'them'}. Nothing was filed; try again, or file on MyFantasyLeague.`,
        502,
        { round, submitted: requestedAdds, confirmed: newlyPending, confirmUrl }
      );
    }
    if (ctx.insightActor) await recordInsightAction(ctx.insightActor, 'waiver_claim');
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
        confirmUrl,
        submitted: requestedAdds,
        // Only the ids this request demonstrably ADDED — not everything of ours
        // MFL happens to be holding, which would re-report an older round's
        // claims as confirmations of this one.
        confirmed: newlyPending,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (error) {
    // A staging/preview deployment refuses the send itself — report that,
    // not an outage or an internal error (mfl-fetch#describeMflFailure).
    const failure = describeMflFailure(error);
    if (failure.blocked) return fail(failure.message, 503);
    console.error('[waiver-claim]', error);
    return fail('Something went wrong submitting your claim. No claim was recorded.', 500);
  }
}

export interface FiledClaimsOptions {
  /** Leave out headshots and ESPN ids (the store build's rules). */
  storeSafe?: boolean;
}

/** The franchise's filed claims, or null when the read failed or was unreadable. */
async function readClaims(year: number, leagueId: string, cookie: string): Promise<FiledWaiverClaim[] | null> {
  try {
    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=pendingWaivers&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie: cookie,
    });
    return readFiledWaiverClaims(await res.json());
  } catch {
    return null;
  }
}

/**
 * Attach names so the panel is readable without shipping the player map.
 *
 * The claimed player also carries `addHeadshot` / `addEspnId`, because the
 * panel renders him with the same PlayerCell lockup the Free Agents rows use
 * and that lockup needs a photo. Both come from the SAME player map the rows
 * are built from, so the claim card and the table below it can never disagree
 * about a player's face. `espnId` here is the map's best-guess id (NFL or
 * college) — correct for picking a headshot, which is all it is used for.
 * `storeSafe` (the phone app) leaves both out.
 */
function withNames(claims: FiledWaiverClaim[], year: number, opts: FiledClaimsOptions) {
  const players = getPlayerMap(year);
  const name = (id: string | null) => (id ? (players.get(id)?.name ?? `Player ${id}`) : null);
  const position = (id: string | null) => (id ? (players.get(id)?.position ?? '') : '');
  const nflTeam = (id: string | null) => (id ? (players.get(id)?.nflTeam ?? '') : '');
  const headshot = (id: string | null) => (id ? (players.get(id)?.headshot ?? '') : '');
  const espnId = (id: string | null) => (id ? (players.get(id)?.espnId ?? '') : '');
  return claims.map((c) => ({
    ...c,
    addName: name(c.addPlayerId),
    addPosition: position(c.addPlayerId),
    addNflTeam: nflTeam(c.addPlayerId),
    // The store build carries no headshots and no ESPN ids (store rules).
    ...(opts.storeSafe ? {} : { addHeadshot: headshot(c.addPlayerId), addEspnId: espnId(c.addPlayerId) }),
    dropName: name(c.dropPlayerId),
    dropPosition: position(c.dropPlayerId),
    dropNflTeam: nflTeam(c.dropPlayerId),
  }));
}

/** A filed claim as the routes send it: MFL's record plus names. */
export type FiledClaimView = ReturnType<typeof withNames>[number];

/** The franchise's pending claims with names, or null when MFL could not be read. */
export async function readFiledClaimsView(
  ctx: OwnerLeagueContext,
  opts: FiledClaimsOptions = {},
): Promise<FiledClaimView[] | null> {
  const claims = await readClaims(ctx.year, ctx.leagueId, ctx.cookie);
  return claims === null ? null : withNames(claims, ctx.year, opts);
}

/** The franchise's pending claims, with names. */
export async function getFiledClaims(ctx: OwnerLeagueContext, opts: FiledClaimsOptions = {}): Promise<Response> {
  const { leagueId, year, host } = ctx;

  const claims = await readClaims(year, leagueId, ctx.cookie);
  if (claims === null) {
    return fail('Could not read your pending waivers from MFL.', 502, {
      confirmUrl: `https://${host}/${year}/add_drop?L=${leagueId}`,
    });
  }
  return new Response(
    JSON.stringify({
      success: true,
      claims: withNames(claims, year, opts),
      confirmUrl: `https://${host}/${year}/add_drop?L=${leagueId}`,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
}

/**
 * Change a claim already filed: `{ action: 'delete' | 'editDrop', round, addPlayerId, dropPlayerId?, comment? }`.
 */
export async function manageFiledClaim(
  ctx: OwnerLeagueContext,
  request: Request,
  opts: FiledClaimsOptions = {},
): Promise<Response> {
  const { leagueId, year, host } = ctx;

  // Authenticated write that fans out to MFL.
  const limit = await checkRateLimit('waiver-claims', ctx.cookie, 30, 60);
  if (!limit.allowed) return fail('Too many requests — wait a moment and try again.', 429);

  const { action, round, addPlayerId, dropPlayerId, comment } = (await request.json()) as {
    action?: string;
    round?: number | string;
    addPlayerId?: string;
    dropPlayerId?: string | null;
    comment?: string;
  };

  const confirmUrl = `https://${host}/${year}/add_drop?L=${leagueId}`;
  const roundStr = String(round ?? '');
  if (!/^\d+$/.test(roundStr)) return fail('Which round? That claim is missing its round.', 400);
  if (!addPlayerId || !/^\d+$/.test(String(addPlayerId))) return fail('Invalid player.', 400);

  // The claim must actually be the CALLER'S. `pendingWaivers` is scoped to the
  // session's own franchise, so finding it there IS the ownership check — there
  // is no id the client could send that would reach someone else's claim.
  const before = await readClaims(year, leagueId, ctx.cookie);
  if (before === null) {
    return fail('Could not read your pending waivers from MFL, so nothing was changed.', 502, { confirmUrl });
  }
  const target = before.find((c) => c.round === roundStr && c.addPlayerId === String(addPlayerId));
  if (!target) {
    return fail('That claim is no longer in your pending waivers. Reload to see the current list.', 409, {
      confirmUrl,
    });
  }

  try {
    if (action === 'delete') {
      // A plain GET, exactly as MFL's own page links it:
      //   add_drop?L=…&F=<franchise>&DELETE=<round>_<add>_<drop>
      const token = `${target.round}_${target.addPlayerId}_${target.dropPlayerId ?? '0000'}`;
      const url = `https://${host}/${year}/add_drop?L=${leagueId}&F=${ctx.franchiseId}&DELETE=${encodeURIComponent(token)}`;
      console.log(`[waiver-claims] GET ${url}`);
      await mflFetch({ url, method: 'GET', mflUserCookie: ctx.cookie });

      const after = await readClaims(year, leagueId, ctx.cookie);
      const gone = after !== null && !after.some((c) => c.round === roundStr && c.addPlayerId === String(addPlayerId));
      return new Response(
        JSON.stringify({
          success: true,
          verified: gone,
          message: after === null
            ? 'Deleted, but we could not read your pending waivers back to confirm it.'
            : gone
              ? 'Claim deleted.'
              : 'MFL accepted the request but the claim is still listed. Check your pending waivers.',
          claims: after ? withNames(after, year, opts) : null,
          confirmUrl,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    if (action === 'editDrop') {
      const newDrop = dropPlayerId && String(dropPlayerId) !== '0000' ? String(dropPlayerId) : '';
      if (newDrop && !/^\d+$/.test(newDrop)) return fail('Invalid player to drop.', 400);

      // MFL's own editor: options?O=255&ROUND=n, posting form_name=editwr.
      // `drop_N` is POSITIONAL within the round — index 0 is the first claim —
      // so it is taken from the claim's position in `addsDrops`, which is the
      // same order MFL renders. Only the single-claim shape has been observed
      // live, so the read-back below is doing real work here, not ceremony.
      const body = new URLSearchParams({
        form_name: 'editwr',
        LEAGUE_ID: leagueId,
        O: '255',
        ROUND: target.round,
        [`drop_${target.index}`]: newDrop,
        comment: String(comment ?? target.comment ?? ''),
        SAVE: 'Save Waiver Request',
      }).toString();
      const url = `https://${host}/${year}/options`;
      console.log(`[waiver-claims] POST ${url} (${body})`);
      await mflFetch({ url, method: 'POST', mflUserCookie: ctx.cookie, body });

      const after = await readClaims(year, leagueId, ctx.cookie);
      const updated = after?.find((c) => c.round === roundStr && c.addPlayerId === String(addPlayerId));
      const applied = !!updated && (updated.dropPlayerId ?? '') === newDrop;
      return new Response(
        JSON.stringify({
          success: true,
          verified: applied,
          message: after === null
            ? 'Saved, but we could not read your pending waivers back to confirm it.'
            : applied
              ? 'Drop updated.'
              : 'MFL accepted the request but the claim still shows the old drop. Check your pending waivers.',
          claims: after ? withNames(after, year, opts) : null,
          confirmUrl,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    return fail('Unknown action.', 400);
  } catch (error) {
    // A staging/preview deployment refuses the send itself — report that,
    // not an outage or an internal error (mfl-fetch#describeMflFailure).
    const failure = describeMflFailure(error);
    if (failure.blocked) return fail(failure.message, 503, { confirmUrl });
    console.error('[waiver-claims]', error);
    return fail('Something went wrong talking to MFL. Nothing was changed.', 500, { confirmUrl });
  }
}
