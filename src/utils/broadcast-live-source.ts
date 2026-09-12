/**
 * The cross-league board: every league the owner plays in, in one model.
 *
 * SERVER-SIDE. The pure half (matchup discovery, panel assembly, scoring) is
 * exported separately from the fetching half so it can be tested against real
 * payload shapes without a network — the same split `espn-game-detail.ts` and
 * `live-scoring-snapshot.ts` already keep, and for the same reason.
 *
 * This calls `loadLiveScoringPayload` in process. It does NOT fetch
 * `/api/broadcast-live` to render itself: a page asking its own edge for what
 * it can read directly put our own CDN in the path of a first paint, and on
 * 2026-09-09 that hop silently stopped landing and printed "scores will appear
 * when games begin" over a live slate (docs/claude/rules/live-scoring.md).
 */

import type { LeagueDefinition } from '../config/leagues';
import { ALL_LEAGUES, getLeagueById } from '../config/leagues';
import type { MyLeague } from './my-leagues';
import type { BoardLeague } from './sunday-ticket-selection';
import { loadLiveScoringPayload } from './live-scoring-source';
import {
  emptyLiveSnapshot,
  hasLiveSignal,
  parseLiveScoringPayload,
  type LiveSnapshot,
} from './live-scoring-snapshot';
import { buildMflExportUrl } from './mfl-url';
import { mflFetch } from './mfl-fetch';
import { computeTeamTotals } from './live-scoring-view';
import { winProbability } from './live-win-probability';
import { getCurrentSeasonYear, getLeagueYearForSlug } from './league-year';
import { projectionsForWeek, readLeagueFeed } from './sunday-ticket-sources';
import type { MatchupPairing, PlayerMeta } from '../types/live-scoring';
import type {
  BroadcastLeagueScore,
  BroadcastTeamScore,
} from '../types/live-broadcast';
import type { LeagueViewer } from './broadcast-moments';

/**
 * Fold `myleagues` and the registry into the board's league list.
 *
 * Every league MFL says the owner is in appears here, registered or not — the
 * picker decides which are ON, and that is a separate question from which
 * EXIST. A registry league the owner is in but which `myleagues` omits is
 * still included when the session names it, because a signed-in owner's own
 * league disappearing from his television because one upstream call came back
 * thin would be the worst possible failure of this board.
 */
export function buildBoardLeagues(
  myLeagues: readonly MyLeague[],
  session: { leagueId: string; franchiseId: string } | null,
): BoardLeague[] {
  const out: BoardLeague[] = [];
  const seen = new Set<string>();

  for (const l of myLeagues) {
    if (!l.id || seen.has(l.id)) continue;
    seen.add(l.id);
    const registered = getLeagueById(l.id) ?? null;
    out.push({
      id: l.id,
      name: registered?.name ?? l.name,
      franchiseId: l.franchiseId,
      franchiseName: l.franchiseName,
      registered,
      host: l.host,
      isSession: !!session && session.leagueId === l.id,
    });
  }

  // The session's own league, if `myleagues` did not name it.
  if (session?.leagueId && !seen.has(session.leagueId)) {
    const registered = getLeagueById(session.leagueId);
    if (registered) {
      out.push({
        id: registered.id,
        name: registered.name,
        franchiseId: session.franchiseId,
        franchiseName: '',
        registered,
        host: null,
        isSession: true,
      });
    }
  }

  // Registry order first (so TheLeague and the AFL lead the header in a stable
  // order rather than in whatever order MFL listed them), then the rest.
  const rank = (l: BoardLeague) => {
    const i = ALL_LEAGUES.findIndex((r: LeagueDefinition) => r.id === l.id);
    return i === -1 ? ALL_LEAGUES.length : i;
  };
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * The viewer's matchups in one league this week — one, or TWO on a doubleheader.
 *
 * Detected from the FEED, never from the calendar. MFL groups the week into
 * pairings and a doubleheader simply puts the same franchise in two of them;
 * the alternative — knowing which week is the doubleheader — is exactly the
 * derivation this repo has got wrong twice, because the late doubleheader week
 * is whichever of Week 12/13 is bye-free that year, not a constant.
 *
 * Order is the feed's own, so "Game 1" and "Game 2" stay put across polls.
 */
export function findOwnerMatchups(
  matchups: readonly MatchupPairing[],
  franchiseId: string,
): { opponentId: string; isHome: boolean }[] {
  const out: { opponentId: string; isHome: boolean }[] = [];
  const seen = new Set<string>();
  for (const m of matchups) {
    if (m.home === franchiseId && m.away) {
      if (seen.has(m.away)) continue;
      seen.add(m.away);
      out.push({ opponentId: m.away, isHome: true });
    } else if (m.away === franchiseId && m.home) {
      if (seen.has(m.home)) continue;
      seen.add(m.home);
      out.push({ opponentId: m.home, isHome: false });
    }
  }
  return out;
}

/**
 * One league's live numbers, scored for the board.
 *
 * `ok` and `live` are deliberately two facts. An upstream failure is `ok:
 * false`; a week MFL is not scoring — which arrives as a perfectly well-formed
 * payload of zeros, every franchise present, every player a nonstarter — is
 * `ok: true, live: false`. Read literally that payload says both teams
 * finished on 0.0, and a board that believes it prints a final score over a
 * game nobody has played.
 */
export function scoreLeague(
  leagueId: string,
  snapshot: LiveSnapshot,
  ok: boolean,
  franchiseId: string,
  meta: Record<string, PlayerMeta>,
  /**
   * THIS league's full-game projections, player id → points.
   *
   * Per league, never global: two leagues score the same player differently,
   * so one shared map would quietly rate a TheLeague lineup with the AFL's
   * numbers. An EMPTY map is honest and survivable — every projection reads 0,
   * so `projectedFinal` collapses to the live score and the win-probability
   * bar goes hard 100/0. That is why the assembler treats a missing
   * projections feed as a thing worth reporting rather than a default.
   */
  projections: ReadonlyMap<string, number> = new Map(),
): BroadcastLeagueScore {
  const teams: Record<string, BroadcastTeamScore> = {};
  const pairs = findOwnerMatchups(snapshot.matchups, franchiseId);

  const totalsFor = (fid: string): BroadcastTeamScore => {
    // STARTERS only. `LiveSnapshot` keeps bench rows in a map of their own
    // precisely so nothing downstream can sum them by accident — a bench row
    // here inflates the projected final and the win-probability bar with
    // points that cannot be scored.
    const rows = snapshot.players[fid] ?? [];
    const totals = computeTeamTotals(rows, meta, {
      score: snapshot.scores[fid],
      yetToPlayFallback: snapshot.playersYetToPlay[fid],
      projections,
    });
    return { ...totals, players: rows };
  };

  teams[franchiseId] = totalsFor(franchiseId);
  const wp: number[] = [];
  for (const pair of pairs) {
    teams[pair.opponentId] = totalsFor(pair.opponentId);
    const mine = teams[franchiseId];
    const theirs = teams[pair.opponentId];
    // Stated from the VIEWER's side every time. A "home" win probability would
    // mean the opposite thing depending on which side of the pairing MFL put
    // him on, and this board is only ever read by one person.
    wp.push(
      winProbability(
        mine.projectedFinal,
        theirs.projectedFinal,
        mine.remainingPoints + theirs.remainingPoints,
      ),
    );
  }

  return { leagueId, ok, live: ok && hasLiveSignal(snapshot), teams, winProbability: wp };
}

/** The per-league viewer shape the moment stream needs. */
export function toLeagueViewer(
  league: Pick<BoardLeague, 'id' | 'name' | 'franchiseId' | 'franchiseName'>,
  snapshot: LiveSnapshot,
  opponentNames: Record<string, string>,
): LeagueViewer {
  const pairs = findOwnerMatchups(snapshot.matchups, league.franchiseId);
  const opponentIds = pairs.map((p) => p.opponentId);
  // Only the franchises the viewer has a stake in. Handing the whole league's
  // starters to the moment stream would make every touchdown in a 24-team
  // league a candidate for his television.
  const players: Record<string, { id: string }[]> = {};
  for (const fid of [league.franchiseId, ...opponentIds]) {
    players[fid] = snapshot.players[fid] ?? [];
  }
  return {
    leagueId: league.id,
    leagueName: league.name,
    franchiseId: league.franchiseId,
    franchiseName: league.franchiseName,
    opponentIds,
    opponentNames,
    players,
  };
}

// ── fetching ───────────────────────────────────────────────────────────────

export interface LoadLeagueSnapshotInput {
  league: BoardLeague;
  /** SEASON year — this board is results-shaped. */
  year: number;
  week: number;
}

export interface LeagueSnapshotResult {
  leagueId: string;
  ok: boolean;
  snapshot: LiveSnapshot;
}

/**
 * One league's live snapshot.
 *
 * A REGISTERED league goes through `loadLiveScoringPayload`, which resolves the
 * MFL host from the league id itself — never from a hint. That matters more
 * than it looks: every league lives on a different `www##` server and a server
 * asked for a league id it does not host answers with its OWN league rather
 * than erroring, so the wrong pairing is a 200, well-formed, right schema,
 * wrong league.
 *
 * An OUTSIDE league has no registry entry, so `resolveHost` would fall back to
 * the default league's host and return someone else's scores. It is therefore
 * read through its own `myleagues` host — which `hostOf` has already
 * constrained to HTTPS `*.myfantasyleague.com` — with the owner's cookie, the
 * same path Sunday Ticket already trusts for outside leagues.
 */
export async function loadLeagueSnapshot(
  input: LoadLeagueSnapshotInput,
  outsideReader?: (league: BoardLeague, year: number, week: number) => Promise<LeagueSnapshotResult>,
): Promise<LeagueSnapshotResult> {
  const { league, year, week } = input;

  if (league.registered) {
    const payload = await loadLiveScoringPayload({ leagueId: league.id, year, week });
    const { ok, week: _w, ...snapshot } = payload;
    return { leagueId: league.id, ok, snapshot: snapshot as LiveSnapshot };
  }

  if (outsideReader) return outsideReader(league, year, week);

  // No reader supplied: an outside league contributes nothing rather than
  // silently contributing the DEFAULT league's scores under its own name.
  return { leagueId: league.id, ok: false, snapshot: emptyLiveSnapshot() };
}

/**
 * An outside league's live scoring, read with the owner's own MFL cookie.
 *
 * The host comes from `myleagues`, which `hostOf` has already constrained to
 * HTTPS `*.myfantasyleague.com` — the origin is about to receive the owner's
 * `MFL_USER_ID`, so a payload naming anything else must never become a
 * destination for that credential, however it got there.
 *
 * Returns `ok: false` rather than throwing, and — like every MFL read in this
 * repo — treats a body it could not PARSE as a failed read rather than an
 * empty week. MFL answers a throttled request with an HTML page under a 200,
 * and `ok: true` with no matchups is precisely the shape of a week that has
 * not been played.
 */
export async function readOutsideLiveSnapshot(
  league: BoardLeague,
  year: number,
  week: number,
  mflUserCookie: string,
): Promise<LeagueSnapshotResult> {
  const empty = emptyLiveSnapshot();

  if (!mflUserCookie || !league.host) {
    return { leagueId: league.id, ok: false, snapshot: empty };
  }

  try {
    const url = buildMflExportUrl({
      type: 'liveScoring',
      leagueId: league.id,
      year,
      params: { W: week, DETAILS: 1 },
      host: league.host,
    });
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!response.ok) return { leagueId: league.id, ok: false, snapshot: empty };
    const body = await response.json().catch(() => null);
    if (body === null || body?.error) return { leagueId: league.id, ok: false, snapshot: empty };
    return { leagueId: league.id, ok: true, snapshot: parseLiveScoringPayload(body) };
  } catch {
    return { leagueId: league.id, ok: false, snapshot: empty };
  }
}

/**
 * One league's full-game projections for the week, player id → points.
 *
 * Projections are what make "projected final" and the win-probability bar mean
 * anything. Without them every player's remaining expectation is zero, so the
 * projected final collapses onto the live score and `winProbability` takes its
 * `remainingPoints <= 0` branch — a hard 100% / 0% off the current margin, at
 * noon on a Sunday with nine starters yet to kick off. The board shipped that
 * way for one afternoon of development and it is the reason this function
 * exists.
 *
 * Two sources, because a league this site syncs already has the feed on disk:
 *  - REGISTERED: the committed `projectedScores.json`, read at the league's OWN
 *    year. Not the season year — `data/<league>/mfl-feeds/<leagueYear>/` is
 *    where the sync writes, and the AFL's two clocks are three months apart.
 *  - OUTSIDE: a live export with the owner's cookie, same path the outside
 *    live-scoring read already takes.
 *
 * An empty map is a survivable answer, not a failure: the board still shows
 * real live scores, and only the forward-looking numbers go flat.
 */
export async function loadLeagueProjections(
  league: BoardLeague,
  week: number,
  mflUserCookie: string,
): Promise<Map<string, number>> {
  try {
    if (league.registered) {
      const leagueYear = getLeagueYearForSlug(league.registered.slug);
      const payload = readLeagueFeed(league.registered, leagueYear, 'projectedScores.json');
      return projectionsForWeek(payload, week);
    }

    if (!mflUserCookie || !league.host) return new Map();
    const url = buildMflExportUrl({
      type: 'projectedScores',
      leagueId: league.id,
      year: getCurrentSeasonYear(),
      params: { W: week },
      host: league.host,
    });
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!response.ok) return new Map();
    const body = await response.json().catch(() => null);
    // A projections feed is for ONE week. Reading it for another would rank
    // this Sunday by last Sunday's numbers, so `projectionsForWeek` treats a
    // week mismatch as "no projections" rather than "close enough".
    return projectionsForWeek(body, week);
  } catch {
    return new Map();
  }
}
