/**
 * Claim context — "may this viewer add this player, and on what terms?"
 *
 * The free-agent pages have always answered that at SSR time, from a
 * page-local pile of feed reads (see the `── Waiver claim context ──` block in
 * either players.astro). That was fine while claiming lived only on those two
 * pages. It no longer does: the player modal offers the claim EVERYWHERE it
 * opens, and the modal is mounted on the homepage, both rosters pages,
 * insights, projected FAs and What's New — pages that must not each grow their
 * own MFL fanout just so a button can decide whether to render.
 *
 * So the answer moved to one place and is fetched once per page, lazily, by
 * `src/utils/player-claim-client.ts` (via `GET /api/claim-context`).
 *
 * WHAT "CLAIMABLE" MEANS HERE, precisely, because a looser definition ships a
 * button that 400s: a player is claimable when he is not rostered by anyone
 * whose roster counts against the viewer. In a league-wide league that is
 * every franchise; in a conference-scoped duplicate-player league (the AFL)
 * it is only the viewer's OWN conference, because the same player is
 * legitimately held once in each. This mirrors the check
 * `POST /api/waiver-claim` runs before the write — that endpoint stays the
 * authority, and this is only what decides whether to offer the affordance.
 *
 * Consequence worth knowing: the set we ship to the client is the ROSTERED
 * ids, and everything else reads as claimable. That is MFL's own model (any
 * unrostered player may be added), so a name the modal has never heard of —
 * a retired player on a franchise-history page, say — will read as claimable
 * until the POST rejects it. Shipping the complement instead would mean
 * shipping MFL's whole player universe to every page, which is the thing this
 * module exists to avoid.
 */

import { getCurrentLeagueYear, getRolloverLeagueYear } from './league-year';
import { mflFetch } from './mfl-fetch';
import { createMFLApiClient } from './mfl-matchup-api';
import { getLeagueById, type LeagueDefinition } from '../config/leagues';
import { resolveWaiverWindow, describeWaiverWindow } from './waiver-window';
import { DEFAULT_VIEWER_CLOCK, type ViewerClock } from './viewer-preferences';
import { readBidRules, conferenceOfFranchise, freeAgencyIsLeagueWide } from './waiver-claim';
import { claimVerb, type ClaimContext } from './claim-context-shape';
import { isAuctionSeason } from './auction-window';
import type { AuthUser } from './auth';

// The wire shape and the verb rule live in claim-context-shape.ts, which the
// browser half imports too — see the note there.
export type { ClaimContext } from './claim-context-shape';
export { claimVerb } from './claim-context-shape';

/** The league year claims would land in — the same clock the write endpoint uses. */
export function claimLeagueYear(league: LeagueDefinition): number {
  return league.leagueYearRollover
    ? getRolloverLeagueYear(league.leagueYearRollover)
    : getCurrentLeagueYear();
}

/**
 * Read the live league payload. `fetch` is fine here (unlike the calendar
 * below): the league export is public.
 */
async function readLeaguePayload(year: number, leagueId: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(
      `https://api.myfantasyleague.com/${year}/export?TYPE=league&L=${leagueId}&JSON=1&_=${Date.now()}`,
    );
    return (await res.json())?.league ?? null;
  } catch {
    return null;
  }
}

/**
 * The committed calendar feed, synced by scripts/fetch-mfl-feeds.mjs.
 *
 * One glob across every league's data directory rather than a literal per
 * league — a glob specifier cannot be a runtime variable, and the registry
 * (`league.dataPath`) is what picks the entry. Both free-agent pages read this
 * same file for the banner above the table, which is exactly why it is here:
 * without it, a live read that fails leaves the FORM saying "window unknown"
 * while the BANNER on the page behind it says waivers are open.
 */
const calendarModules = import.meta.glob(
  '../../data/*/mfl-feeds/20{2[5-9],[3-9][0-9]}/calendar.json',
  { eager: true },
);

function committedWaiverEvents(dataPath: string, year: number): unknown[] {
  const hit = Object.entries(calendarModules).find(([path]) =>
    path.includes(`/${dataPath}/mfl-feeds/${year}/`),
  );
  const events = (hit?.[1] as { default?: unknown })?.default;
  return Array.isArray(events) ? events : [];
}

/**
 * Read MFL's calendar to learn which waiver window is live.
 *
 * mflFetch, NOT fetch: the calendar export is owner-gated and undici drops the
 * Cookie on MFL's api → www## redirect, so a bare fetch reads back "API
 * requires a logged in user", which parses as an empty calendar → 'unknown'.
 * The same trap is documented at the POST endpoint's own calendar read.
 *
 * Returns null — NOT an empty array — when the read did not produce a usable
 * calendar, so the caller can tell "MFL says there are no waiver events" from
 * "we could not ask", and fall back to the committed feed only in the second
 * case.
 */
async function readWaiverEvents(
  year: number,
  leagueId: string,
  mflUserCookie: string,
): Promise<unknown[] | null> {
  try {
    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=calendar&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie,
    });
    const body = await res.json().catch(() => null);
    const raw = body?.calendar?.event;
    if (!raw) return null;
    return Array.isArray(raw) ? raw : [raw];
  } catch {
    return null;
  }
}

/**
 * Names for a bounded set of player ids.
 *
 * MFL's players export is several megabytes unfiltered, so this asks only for
 * the viewer's own roster (`PLAYERS=` takes a comma list — ~25 ids). A name we
 * cannot resolve falls back to the id rather than dropping the option: the
 * drop picker missing a player is how an owner ends up unable to file a legal
 * claim, and the id at least round-trips.
 */
async function readPlayerNames(year: number, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  try {
    const res = await fetch(
      `https://api.myfantasyleague.com/${year}/export?TYPE=players&PLAYERS=${ids.join(',')}&JSON=1`,
    );
    const raw = (await res.json())?.players?.player;
    for (const p of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      if (p?.id && p?.name) names.set(String(p.id), String(p.name));
    }
  } catch {
    /* fall back to ids below */
  }
  return names;
}

/**
 * Resolve everything the client needs to offer — and then fill in — a claim.
 *
 * Returns null only when the session names a league we don't know: with no
 * host and no year clock there is nothing safe to answer.
 */
export async function resolveClaimContext(user: AuthUser, clock: ViewerClock = DEFAULT_VIEWER_CLOCK): Promise<ClaimContext | null> {
  const league = getLeagueById(user.leagueId);
  if (!league) return null;

  const leagueId = league.id;
  const year = claimLeagueYear(league);

  const leaguePayload = await readLeaguePayload(year, leagueId);
  const rules = readBidRules(leaguePayload ?? {});
  // Live first, committed feed second. The live read is the fresher of the two
  // but it is owner-gated, so it is also the one that can come back empty for
  // reasons that have nothing to do with the league's schedule.
  const live = await readWaiverEvents(year, leagueId, user.id);
  const events = live ?? committedWaiverEvents(league.dataPath, year);
  const window = resolveWaiverWindow(events as never);

  // TheLeague replaces offseason free agency with a live auction on MFL. While
  // that window is open an in-place waiver claim is the wrong mechanism — the
  // free-agent page has always deep-linked to MFL's Place Bid page instead, and
  // the modal must agree with it rather than offering a form beside it. The
  // window comes from the shared resolver, never re-derived here.
  const auctionOpen = isAuctionSeason(league.slug);

  const base: ClaimContext = {
    signedIn: true,
    canClaim: false,
    verb: claimVerb(rules.system),
    system: rules.system,
    franchiseId: user.franchiseId || null,
    rules,
    roster: [],
    year,
    windowMode: window.mode,
    windowLabel: describeWaiverWindow(window, clock),
    rosteredIds: [],
  };

  // Every early return below is a DEGRADED MFL read, and each one leaves
  // `canClaim` false. That is the gate the client honours — not the empty
  // `rosteredIds`, which on its own would read as "the whole league is a free
  // agent" and light the button up on every player on the page, the viewer's
  // own roster included.
  if (!leaguePayload) return base;

  const franchises = Array.isArray(leaguePayload.franchises?.franchise)
    ? leaguePayload.franchises.franchise
    : [leaguePayload.franchises?.franchise].filter(Boolean);
  const mine = franchises.find((f: any) => String(f.id) === String(user.franchiseId));
  const balance = Math.floor(Number(mine?.bbidAvailableBalance ?? 0));

  let rosters: Record<string, string[]>;
  try {
    rosters = await createMFLApiClient({
      leagueId,
      year: String(year),
      mflUserId: user.id,
    }).getRosters();
  } catch {
    return base;
  }

  // An empty roster set is a degraded response, not an empty league — same
  // reasoning as the null-payload case above.
  if (!rosters || !(user.franchiseId in rosters)) return base;

  // Conference scoping: a rival conference's roster says nothing about the
  // viewer's availability in a duplicate-player league, and counting it would
  // hide players they may legally claim.
  const leagueWide = freeAgencyIsLeagueWide(leaguePayload);
  const myConference = leagueWide ? null : conferenceOfFranchise(leaguePayload, user.franchiseId);
  const countsAgainstMe = (fid: string) =>
    leagueWide || conferenceOfFranchise(leaguePayload, fid) === myConference;

  const rosteredIds = new Set<string>();
  for (const [fid, list] of Object.entries(rosters)) {
    if (!countsAgainstMe(fid)) continue;
    for (const p of list) rosteredIds.add(String((p as any)?.id ?? p));
  }

  const ownIds = (rosters[user.franchiseId] ?? []).map((p: any) => String(p?.id ?? p));
  const names = await readPlayerNames(year, ownIds);
  const roster = ownIds
    .map((id) => ({ id, name: names.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...base,
    canClaim: roster.length > 0 && !auctionOpen,
    roster,
    balance: rules.system === 'bbid' ? balance : undefined,
    rosteredIds: [...rosteredIds],
  };
}
