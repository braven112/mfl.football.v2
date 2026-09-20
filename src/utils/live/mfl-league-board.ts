/**
 * ONE league's full board, for any league the signed-in MFL account is in.
 *
 * This is what `/live/league/<mflLeagueId>` renders: every matchup in the
 * league rather than just the viewer's, plus the week's top scorers and MFL's
 * own standings.
 *
 * ── WHY IT GOES THROUGH `readCrossLeagueLive` FOR ONE LEAGUE ──────────────
 * Because the drill-down and the board it was reached from must not disagree.
 * That module already owns every expensive rule involved — which host a league
 * is read from (a registered league by id, an outside one through its own
 * `myleagues` host with the owner's cookie), whether a payload that parsed is
 * actually a payload, how projections are scoped per league, and how franchise
 * names are resolved and cached for a league with no committed brands. Calling
 * it with a one-element list costs nothing and inherits all of it;
 * re-implementing the single-league case would be a second copy of the part
 * that is hard to get right.
 *
 * ── AUTHORISATION IS THE CALLER'S JOB, AND IT IS A CHECK ──────────────────
 * This takes a `BoardLeague` the caller has already found in the owner's OWN
 * `discoverBoardLeagues` list. A league id from a URL is never passed straight
 * through: the request is about to carry the owner's `MFL_USER_ID` to a host
 * named in that payload, and the rule the rest of this app already follows is
 * that a league param is a CHECK against what the session may see, never an
 * input.
 *
 * SERVER-SIDE ONLY.
 */

import type { AuthUser } from '../auth';
import type { LiveBoard, LiveStandingsRow } from '../../types/live';
import type { BoardLeague } from '../sunday-ticket-selection';
import { getCurrentSeasonYear } from '../league-year';
import { readCrossLeagueLive } from '../cross-league-live';
import { emptyLiveSnapshot } from '../live-scoring-snapshot';
import { buildBoardFromSnapshot } from './read';
import { buildLeaders } from './leaders';
import { decorateStandings, readLeagueStandings } from './standings';

export interface AssembleMflLeagueBoardInput {
  user: AuthUser;
  /** Already checked against the owner's own league list. See the header. */
  league: BoardLeague;
  week: number;
  /** SEASON year — this board is results-shaped. */
  year?: number;
}

export interface AssembledMflLeagueBoard {
  board: LiveBoard;
}

export async function assembleMflLeagueBoard(
  input: AssembleMflLeagueBoardInput,
): Promise<AssembledMflLeagueBoard> {
  const { user, league } = input;
  const year = input.year ?? getCurrentSeasonYear();
  const week = input.week;

  const identity = { id: league.id, name: league.name, slug: league.registered?.slug ?? null };

  // League-scoped, and that is load-bearing: franchise ids collide across
  // leagues (all three registry leagues have an `0001`), so the session's own
  // franchise may only light up "YOUR MATCHUP" on the league it belongs to.
  // `BoardLeague.franchiseId` is already per-league — it came from this
  // owner's `myleagues` entry FOR THIS LEAGUE — so it needs no further gate.
  const viewerFranchiseId = league.franchiseId || null;

  // MFL serves no live scoring before the Week 1 Thursday and
  // `getCurrentNFLWeek` answers 0 until then. A falsy week is its own state,
  // never clamped up to 1 — clamping is what turns that gap into a mystery
  // failure against a perfectly healthy league.
  if (!Number.isFinite(week) || week <= 0) {
    return {
      board: buildBoardFromSnapshot({
        league: identity,
        week,
        year,
        ok: true,
        snapshot: emptyLiveSnapshot(),
        projections: new Map(),
        viewerFranchiseId,
        surface: 'mfl',
      }),
    };
  }

  // Independent reads, overlapped. Standings must never be able to cost the
  // SCORES: it is the secondary tab, it is on its own cache, and a league
  // whose standings export is unhappy still has a board worth rendering. Hence
  // `allSettled` semantics via a catch on the one that is allowed to fail.
  const [reads, rawStandings] = await Promise.all([
    readCrossLeagueLive({
      user,
      leagues: [league],
      week,
      year,
      // The names a league with no committed brands needs. Opt-in on that
      // module because `/broadcast` shares the read and discards them; here
      // they are the difference between "Franchise 0015" and a crest.
      withFranchiseNames: true,
    }).catch(() => []),
    // NOTE the absent `franchiseNames`: they are the OTHER half of this
    // `Promise.all` and do not exist yet. They are applied below, once both
    // have landed, rather than serialising two independent MFL reads.
    readLeagueStandings({
      league,
      year,
      mflUserCookie: user.id,
      viewerFranchiseId,
    }).catch((): LiveStandingsRow[] | null => null),
  ]);

  const read = reads[0];

  /**
   * The names, applied to the standings now that both reads are in.
   *
   * Without this the Standings tab resolves its identities from the feed's own
   * `fname` alone, and an outside league whose `leagueStandings` rows omit it
   * shows "Franchise 0001" directly below a Scores tab showing the real name —
   * two views of one league disagreeing about who a franchise is, which is the
   * thing both these modules are written to prevent.
   */
  const standings =
    rawStandings === null
      ? null
      : decorateStandings(rawStandings, {
          league,
          year,
          mflUserCookie: user.id,
          viewerFranchiseId,
          franchiseNames: read?.franchiseNames ?? {},
        });

  // The read failed outright. `ok: false` with an empty snapshot is what makes
  // the panel `unavailable` rather than an empty board reading as "no games" —
  // and the standings still ride along, because a league whose live feed is
  // down can have perfectly readable standings and the tab has no reason to go
  // dark with it.
  if (!read) {
    const board = buildBoardFromSnapshot({
      league: identity,
      week,
      year,
      ok: false,
      snapshot: emptyLiveSnapshot(),
      projections: new Map(),
      viewerFranchiseId,
      surface: 'mfl',
    });
    board.panels[0].standings = standings;
    board.panels[0].leaders = null;
    return { board };
  }

  const board = buildBoardFromSnapshot({
    league: identity,
    week,
    year,
    ok: read.ok,
    snapshot: read.snapshot ?? emptyLiveSnapshot(),
    projections: read.projections,
    franchiseNames: read.franchiseNames,
    viewerFranchiseId,
    // ALWAYS MFL Live's ground, registered league or not: this renders on MFL
    // Live's card, and a colour pair resolved against the wrong ground is a
    // confident wrong legibility answer. Seven TheLeague franchises are
    // `#181818`. See `./surface`.
    surface: 'mfl',
  });

  const panel = board.panels[0];
  panel.standings = standings;
  // Derived from the panel that was just built, so the strip cannot disagree
  // with the cards above it. A panel with no matchups yields empty arrays,
  // which the strip renders as nothing rather than as a row of zeros.
  panel.leaders = buildLeaders(panel);

  return { board };
}
