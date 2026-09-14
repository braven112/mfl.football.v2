/**
 * The cross-league read: which leagues an MFL account is in, and this week's
 * live scoring for each of them.
 *
 * ONE implementation, two boards. `/broadcast` (the ten-foot TV display) and
 * MFL Live (`mfl.football/live`) ask the identical question — "every league
 * this owner is in, scored right now" — and answer it from the identical
 * sources. They differ entirely in what they DRAW. This module is the shared
 * half; each board keeps its own view assembly on top.
 *
 * That split is not tidiness. This repo's forked-sibling history
 * (docs/plans/mfl-live-app.md, `tests/page-fork-ratchet.test.ts`) says what
 * happens when two surfaces grow two copies of one rule, and the rules in here
 * are the expensive kind: which host a league is read from, whether a payload
 * that parsed is actually a payload, and what a failed league costs the rest
 * of the board.
 *
 * SERVER-SIDE ONLY. It reads MFL with the owner's own cookie.
 */

import type { AuthUser } from './auth';
import { getCurrentSeasonYear, getLeagueYearForSlug } from './league-year';
import { fetchMyLeagues } from './my-leagues';
import type { BoardLeague } from './sunday-ticket-selection';
import {
  buildBoardLeagues,
  loadLeagueProjections,
  loadLeagueSnapshot,
  readLeagueFranchiseNames,
  readOutsideLiveSnapshot,
} from './broadcast-live-source';
import { hasLiveSignal, type LiveSnapshot } from './live-scoring-snapshot';
import { mapWithConcurrency } from './fan-out';

/**
 * How many leagues are read at once.
 *
 * `/broadcast` defaults to the home leagues (two), so this never binds there.
 * MFL Live defaults to ALL of them, and an owner in a dozen leagues would
 * otherwise open a dozen sockets to MFL on every poll of every device — which
 * is how a board gets itself throttled, and a throttled MFL answers with an
 * HTML page under a 200 rather than an error (see `loadLiveScoringPayload`).
 *
 * Eight is above anything the existing boards do and below anything that reads
 * as a burst.
 */
export const CROSS_LEAGUE_FAN_OUT_LIMIT = 8;

/** One league's live read. */
export interface LeagueLiveRead {
  league: BoardLeague;
  /**
   * The READ succeeded — the body parsed and MFL did not answer with an error.
   * It says nothing about whether any football has been played.
   */
  ok: boolean;
  snapshot: LiveSnapshot | null;
  /**
   * Per league, never pooled. The same back is worth different points under
   * two rule sets, so one shared player-keyed map would rate a TheLeague
   * lineup with the AFL's numbers — the bug that pinned every win-probability
   * bar on the first cut of the broadcast board.
   */
  projections: Map<string, number>;
  /**
   * MFL is actually scoring this week for this league.
   *
   * The distinction `ok` cannot make: an UNPLAYED week comes back as a
   * well-formed 200 with every franchise present, every score "0.00" and every
   * player `nonstarter`. Read literally that says "both teams finished on
   * 0.0", and a board that trusts it prints exactly that over a game nobody
   * has played. `hasLiveSignal` tests for STARTERS, which MFL cannot be
   * scoring a week without.
   *
   * So a caller has three states to render, not two: read failed (`ok` false),
   * read fine but nothing played (`ok` true, this false), and live.
   */
  hasSignal: boolean;
  /**
   * Every franchise's NAME in this league, by id — EMPTY for a registered
   * league, which has committed brands the caller prefers.
   *
   * `myleagues` carries at most the viewer's own franchise name and often not
   * even that, so without this a league this site does not host had no name
   * for anybody: the board showed "Franchise 0015" against "Franchise 0032",
   * and their NFL crests never resolved because the matcher had no name to
   * match.
   */
  franchiseNames: Record<string, string>;
}

export interface ReadCrossLeagueInput {
  user: AuthUser;
  /** The leagues to read — the caller has already applied its own selection. */
  leagues: readonly BoardLeague[];
  week: number;
  /** SEASON year. Results-shaped, so it defaults to the results clock. */
  year?: number;
  concurrency?: number;
  /**
   * Also read each unregistered league's franchise NAMES (one `TYPE=league`
   * export per league, cached an hour).
   *
   * OPT-IN, and off by default, because this read is shared. `/broadcast`
   * calls it too and never looks at the names — so defaulting it on would
   * charge a live television surface a request per outside league for data it
   * discards. A feature does not get to add network work to its neighbours.
   */
  withFranchiseNames?: boolean;
}

/**
 * Every league this owner's MFL account is in, folded together with the ones
 * this site runs.
 *
 * `fetchMyLeagues` is keyed on the owner's MFL cookie, which the session
 * carries as `user.id` — that is what makes one sign-in enough to see a league
 * this site has never heard of.
 *
 * `user.leagueId` appears here for exactly one purpose: making sure the
 * session's OWN league is on the list when `myleagues` did not name it. It is
 * a union, never a filter — the board must not be scoped to the league the
 * owner happened to sign in through, which is one of N and has no special
 * claim on a cross-league surface.
 */
export async function discoverBoardLeagues(user: AuthUser): Promise<BoardLeague[]> {
  // Its own LEAGUE year, not the season year: MFL lists the leagues of the
  // year whose directory it created, which is not the season being scored.
  const leagueYear = getLeagueYearForSlug('theleague');
  const myLeagues = await fetchMyLeagues(user.id, leagueYear).catch(() => ({ ok: false, leagues: [] }));
  return buildBoardLeagues(myLeagues.leagues ?? [], {
    leagueId: user.leagueId,
    franchiseId: user.franchiseId,
  });
}

/**
 * This week's live scoring for each league, bounded and fault-isolated.
 *
 * PARTIAL RESULTS ARE THE POINT. Every league is read independently and a
 * failure contributes `ok: false` rather than rejecting the batch — one dead
 * feed is not an outage, and a board that blanks because a league nobody was
 * watching timed out is worse than one that says so in a corner.
 *
 * Results come back in the order the leagues were given, so a caller can pair
 * each read with the league that produced it without a lookup.
 */
export async function readCrossLeagueLive(
  input: ReadCrossLeagueInput,
): Promise<LeagueLiveRead[]> {
  const { user, leagues, week } = input;
  const year = input.year ?? getCurrentSeasonYear();
  const limit = input.concurrency ?? CROSS_LEAGUE_FAN_OUT_LIMIT;
  const wantNames = input.withFranchiseNames === true;

  const settled = await mapWithConcurrency(leagues, limit, async (league) => {
    // Both reads for one league share a lane, so the bound counts LEAGUES
    // rather than requests — which is the number that grows with the owner.
    const [result, projections, franchiseNames] = await Promise.all([
      loadLeagueSnapshot({ league, year, week }, (l, y, w) =>
        readOutsideLiveSnapshot(l, y, w, user.id),
      ).catch(() => null),
      loadLeagueProjections(league, week, user.id, year).catch(() => new Map<string, number>()),
      // Skipped unless the caller asked, and skipped for a registered league
      // either way: those have committed brands, which carry the name plus
      // colours and a crest. For everyone else it is cached for an hour in
      // process, so it is not a per-poll request.
      wantNames && !league.registered
        ? readLeagueFranchiseNames(league, year, user.id).catch(
            (): Record<string, string> => ({}),
          )
        : Promise.resolve<Record<string, string>>({}),
    ]);

    const snapshot = result?.snapshot ?? null;
    const ok = !!result?.ok && !!snapshot;
    return {
      league,
      ok,
      snapshot,
      projections,
      franchiseNames,
      // Only a snapshot we actually read can carry signal. A failed read is
      // never "no games yet" — conflating them is what let an outage render
      // as an offseason.
      hasSignal: ok && !!snapshot && hasLiveSignal(snapshot),
    } satisfies LeagueLiveRead;
  });

  return settled.map((outcome, i) =>
    outcome.status === 'fulfilled'
      ? outcome.value
      : {
          league: leagues[i],
          ok: false,
          snapshot: null,
          projections: new Map<string, number>(),
          franchiseNames: {},
          hasSignal: false,
        },
  );
}

/**
 * Each league's OWN franchise name for the viewer, for surfaces that list
 * leagues without reading their scores (`/live/settings`).
 *
 * `myleagues` carries at most `franchise_name` and frequently leaves it blank,
 * which is what made the settings list read "Franchise 0015" for every league
 * this site does not host — the same blank the board suffered. Registered
 * leagues are skipped: `resolveFranchiseIdentity` already has their committed
 * brands.
 *
 * Cheap in practice despite the fan-out: `readLeagueFranchiseNames` caches for
 * an hour in the same process the board uses, so a visit to settings after
 * looking at the board makes no requests at all. Bounded and fault-isolated
 * for the same reasons the live read is — a name is decoration, and one slow
 * league must not hold the page.
 */
export async function readViewerFranchiseNames(
  user: AuthUser,
  leagues: readonly BoardLeague[],
  year: number = getCurrentSeasonYear(),
  concurrency: number = CROSS_LEAGUE_FAN_OUT_LIMIT,
): Promise<Record<string, string>> {
  const targets = leagues.filter((l) => !l.registered && l.host);
  if (targets.length === 0) return {};

  const settled = await mapWithConcurrency(targets, concurrency, async (league) => {
    const names = await readLeagueFranchiseNames(league, year, user.id).catch(
      (): Record<string, string> => ({}),
    );
    return { id: league.id, name: names[league.franchiseId] ?? '' };
  });

  const out: Record<string, string> = {};
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    if (outcome.value.name) out[outcome.value.id] = outcome.value.name;
  }
  return out;
}
