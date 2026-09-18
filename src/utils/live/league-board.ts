/**
 * One league's board, assembled the same way for the PAGE and for the POLL.
 *
 * Both callers need identical answers to three questions — who the viewer is,
 * what the franchises are wearing this week, and whether the offseason replay
 * stands in for a feed MFL has switched off — and each of the three has a way
 * of going wrong that only shows on one of them:
 *
 *  - **The viewer must be league-scoped.** Franchise ids collide across
 *    leagues (all three registry leagues have an `0001`), so a session from
 *    one league lights up "YOUR MATCHUP" on another league's franchise.
 *  - **Throwback art must survive the poll.** Resolve it on the page alone and
 *    the board reverts to present-day crests 25 seconds later, which is worse
 *    than never dressing it: the change is attributed to the game.
 *  - **The sample must not paper over an outage.** An empty feed is the
 *    offseason only when the read SUCCEEDED; a failed one also yields no
 *    matchups, and last season's replay over an in-season outage is a lie.
 *
 * SERVER-SIDE ONLY.
 */
import type { AuthUser } from '../auth';
import type { CanonicalLeagueSlug } from '../../config/leagues';
import type { LiveBoard } from '../../types/live';
import type { NflGame } from '../../types/live-scoring';
import type { ThrowbackScope } from '../throwback-scope';
import { getLeagueTeamConfigs } from '../league-team-brands';
import { getLeagueYearForSlug } from '../league-year';
import { applyThrowbackToBoard, type ThrowbackPreview } from '../throwback-live-scoring';
import { getCurrentRosterSample, getLiveScoringSample } from '../../data/live-scoring-sample';
import { buildBoardFromSnapshot, readLeagueLive } from './read';
import type { ConfigTeam } from '../live-scoring-data';

export interface AssembleLeagueBoardInput {
  slug: CanonicalLeagueSlug;
  /** MFL league id, for the session check. */
  leagueId: string;
  week: number;
  /** SEASON year — everything here is results-shaped. */
  year: number;
  authUser: AuthUser | null;
  searchParams: URLSearchParams;
  /**
   * Throwback Week's scope, omitted for a league that does not run it.
   *
   * Load-bearing, not a label: franchise ids 0001-0016 exist in BOTH leagues
   * with different `history[]` arrays, so the wrong scope hands one league's
   * teams the other's era rules.
   */
  throwbackScope?: ThrowbackScope;
  /**
   * Offer the offseason replay. Best Ball does not: the bundled sample is
   * TheLeague's teams, and a brand-new best-ball league has no season to
   * replay — its honest empty state is the better answer.
   */
  sample?: boolean;
}

export interface AssembledLeagueBoard {
  board: LiveBoard;
  /** Badge text when the board is a replay; undefined when it is live. */
  demoLabel?: string;
  /** The try-before-save bar's state, when an era is being previewed. */
  throwbackPreview: ThrowbackPreview | null;
  /** True when the board is the bundled replay rather than a live read. */
  isSample: boolean;
  /** `?demo=live` — sampled fantasy against a REAL, live NFL slate. */
  isRosterSample: boolean;
  /**
   * The replay's OWN NFL slate, for the rail and for the board's fallback.
   *
   * Present only for the plain replay. `?demo=live` deliberately has none: its
   * whole point is real games behind sampled fantasy, and the scoreboard hook
   * serves `fallbackGames` until the first poll lands — so handing it the
   * bundled slate there would show last season's games as the live ones, and
   * permanently, because the store holds no data while ESPN is unreachable.
   */
  sampleGames?: NflGame[];
}

export async function assembleLeagueBoard(
  input: AssembleLeagueBoardInput,
): Promise<AssembledLeagueBoard> {
  const { slug, leagueId, week, year, authUser, searchParams, throwbackScope, sample = false } = input;

  // League-scoped, in ONE place, for every league. See the header.
  const viewerFranchiseId =
    authUser?.leagueId === leagueId ? (authUser.franchiseId ?? null) : null;

  // Throwback Week. The whole resolution — stored picks, the ?previewEra
  // try-before-save path and its admin ?previewFranchise variant — lives in
  // `applyThrowbackToBoard`, which returns a dressed copy of the team configs.
  const throwback = throwbackScope
    ? await applyThrowbackToBoard({
        configTeams: getLeagueTeamConfigs(slug) as ConfigTeam[],
        week,
        scope: throwbackScope,
        leagueId,
        authUser,
        searchParams,
      })
    : null;

  /**
   * The era art, as identity overrides.
   *
   * `readLeagueLive` resolves identity from the registry, so without this the
   * board keeps every club's present-day mark and Throwback Week is invisible.
   * Name, short name and icon only — colours are resolved against the surface's
   * card ground and an era's palette has not been through that check.
   */
  const identityOverrides = throwback
    ? Object.fromEntries(
        throwback.configTeams.map((t) => [
          t.franchiseId,
          { name: t.name, nameShort: t.nameShort, icon: t.icon },
        ]),
      )
    : undefined;

  const demoParam = sample ? searchParams.get('demo') : '0';
  const isRosterSample = sample && demoParam === 'live';
  let isSample = demoParam === '1' || isRosterSample;

  let board: LiveBoard | null = null;
  if (!isSample) {
    board = await readLeagueLive({ slug, week, year, viewerFranchiseId, identityOverrides });
    // An empty-but-HEALTHY feed is the offseason. `ok` is the whole guard: a
    // failed read also yields no matchups.
    if (sample && demoParam !== '0' && board.ok && board.panels[0].matchups.length === 0) {
      isSample = true;
      board = null;
    }
  }

  if (board) {
    return { board, throwbackPreview: throwback?.preview ?? null, isSample: false, isRosterSample };
  }

  // Each league rolls its MFL league year on its own date (TheLeague Feb 14,
  // the AFL June 1), and the roster replay reads THAT year off disk — so it is
  // the per-league clock, never the season one.
  const rosterYear = getLeagueYearForSlug(slug);
  const replay = isRosterSample
    ? getCurrentRosterSample({ slug, year: rosterYear })
    : getLiveScoringSample({ slug, doubleheader: searchParams.get('dh') === '1' });

  return {
    board: buildBoardFromSnapshot({
      slug,
      week: replay.week,
      year,
      ok: true,
      snapshot: replay,
      // A replay carries its own identity: the current player map has since
      // lost players who were on those rosters.
      playerMeta: replay.playerMeta,
      // A projection belongs to a player IN A LEAGUE, and a replay has none —
      // an empty map is the honest answer, never another week's numbers.
      projections: new Map(),
      viewerFranchiseId,
      identityOverrides,
    }),
    demoLabel: isRosterSample
      ? `Live NFL · ${rosterYear} rosters · no fantasy scoring yet`
      : 'Sample data',
    sampleGames: isRosterSample ? undefined : replay.nflGames,
    throwbackPreview: throwback?.preview ?? null,
    isSample: true,
    isRosterSample,
  };
}
