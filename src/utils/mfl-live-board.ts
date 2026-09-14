/**
 * Assemble the MFL Live board, once.
 *
 * The ONE implementation, called two ways: `/live` calls it IN PROCESS for its
 * first paint, and `/api/live-board` calls it for every poll.
 *
 * That is not tidiness. A page that fetches its own API to render itself puts
 * our own edge in the path of its first paint, and this repo has already
 * shipped the outage: on 2026-09-09 the live-scoring page printed "Scores will
 * appear here when games begin" over a live slate because the hop to our own
 * domain stopped landing — invisible in the logs, because a request blocked at
 * the edge never reaches the route. `tests/live-scoring-self-fetch-guard.test.ts`
 * pins the rule for that page; this one is built to it from the start.
 *
 * SERVER-SIDE ONLY. It reads MFL with the owner's own cookie and ESPN without
 * one, and translates every ESPN athlete id to an MFL player id before
 * anything leaves — `PlayerMeta.espnId` can hold a COLLEGE athlete id, and
 * college and NFL ids are both plain digits, so a bad join downstream would
 * resolve a different person rather than failing.
 */

import type { AuthUser } from './auth';
import { getCurrentSeasonYear } from './league-year';
import { discoverBoardLeagues, readCrossLeagueLive, type LeagueLiveRead } from './cross-league-live';
import { findOwnerMatchups, scoreLeague, toLeagueViewer } from './broadcast-live-source';
import { buildBroadcastMoments, selectRedZoneAlerts, type LeagueViewer } from './broadcast-moments';
import { loadNflGameDetail } from './nfl-game-detail-source';
import { fetchNflScoreboard } from './nfl-scoreboard-source';
import { resolveMflLiveLeagues } from './mfl-live-selection';
import { resolveFranchiseIdentity, identityIconAlt, type FranchiseColorClaim } from './mfl-live-identity';
import { resolveTeamColorPair } from './team-color-contrast';
import { getPlayerMap } from './player-map';
import { getLeagueTeamBrands } from './league-team-brands';
import type { NflGame, PlayerMeta } from '../types/live-scoring';
import type {
  MflLiveBoard,
  MflLiveLeaguePanel,
  MflLiveLeagueStatus,
  MflLiveMatchup,
  MflLiveTeam,
} from '../types/mfl-live';

/**
 * The two grounds a colour is judged against — `--card-bg` in each theme, from
 * `tokens.css` / `tokens-dark.css` under `[data-league="mfl"]`.
 *
 * Both, every time. A single resolved colour would bake in one theme's ground,
 * and this board renders in both: seven TheLeague franchises are `#181818` and
 * several NFL primaries are near-black (LV `#101820`, CHI `#0b162a`), all of
 * which are invisible on the dark card and perfectly fine on the light one.
 */
const MFL_LIVE_LIGHT_CARD = '#ffffff';
const MFL_LIVE_DARK_CARD = '#1e2126';

export interface AssembleMflLiveInput {
  user: AuthUser;
  week: number;
  /** SEASON year — results-shaped. Defaults to the results clock. */
  year?: number;
  /** `?leagues=` — a CHECK against what the session may see, never an input. */
  leaguesParam?: string | null;
  /** The remembered set from this board's OWN cookie. */
  leaguesCookie?: string | null;
}

export interface AssembledMflLive {
  board: MflLiveBoard;
  allLeagues: Array<{ id: string; name: string; registered: boolean }>;
  enabled: string[];
}

/** A franchise's colour claim, with the dark-mode brand values swapped in. */
function darkClaim(claim: FranchiseColorClaim): FranchiseColorClaim {
  // A franchise that hand-picked a dark variant gets it; everyone else falls
  // back to their light value and relies on the legibility nudge below.
  return {
    ...claim,
    colorPrimary: claim.colorPrimaryDark ?? claim.colorPrimary,
    colorSecondary: claim.colorSecondaryDark ?? claim.colorSecondary,
  };
}

/**
 * Split-bar colours for one matchup, resolved per theme.
 *
 * `--tm-*` is MINE and `--to-*` is the opponent's — named from the viewer's
 * side to match `winProbability`, rather than home/away, which would swap
 * meaning depending on where MFL put the owner in the pairing.
 */
function matchupColorVars(mine: FranchiseColorClaim, theirs: FranchiseColorClaim): Record<string, string> {
  const opts = { forceAdjust: true, homeVisibilityFallback: true } as const;
  const light = resolveTeamColorPair(mine, theirs, { ...opts, background: MFL_LIVE_LIGHT_CARD });
  const dark = resolveTeamColorPair(darkClaim(mine), darkClaim(theirs), {
    ...opts,
    background: MFL_LIVE_DARK_CARD,
  });
  return {
    '--tm-light': light.home,
    '--to-light': light.away,
    '--tm-dark': dark.home,
    '--to-dark': dark.away,
  };
}

/**
 * Franchise names for one league, so an opponent has a name before the
 * identity ladder runs.
 *
 * A registry league answers from its own config; an outside league has only
 * what MFL gave us, and MFL's `liveScoring` payload carries ids rather than
 * names — so an outside opponent is named by their franchise id until phase 3
 * reads that league's own roster. Honest, and never a blank.
 */
function opponentNames(slug: string | null): Record<string, string> {
  if (!slug) return {};
  try {
    return Object.fromEntries(
      Object.entries(getLeagueTeamBrands(slug)).map(([fid, brand]) => [fid, (brand as { name: string }).name]),
    );
  } catch {
    return {};
  }
}

/** Which of the four honest states this league is in. */
function statusFor(read: LeagueLiveRead, pairCount: number): MflLiveLeagueStatus {
  if (!read.ok || !read.snapshot) return 'unavailable';
  // Checked BEFORE the pairing count: a week nobody has played has pairings
  // and zeros, and calling that "no matchup" would be a second wrong answer.
  if (!read.hasSignal) return 'not-played';
  return pairCount > 0 ? 'ok' : 'no-matchup';
}

export async function assembleMflLiveBoard(
  input: AssembleMflLiveInput,
): Promise<AssembledMflLive> {
  const { user, week } = input;
  const year = input.year ?? getCurrentSeasonYear();

  const leagues = await discoverBoardLeagues(user);
  // The param narrows what the SESSION already allows and can never widen it:
  // `resolveMflLiveLeagues` only returns ids present in `leagues`, and
  // `leagues` came from this owner's own MFL cookie.
  const { enabled } = resolveMflLiveLeagues(input.leaguesParam, input.leaguesCookie, leagues);
  const on = leagues.filter((l) => enabled.includes(l.id));

  // The league fan-out and the two ESPN reads run together. ESPN is fetched
  // WITHOUT the owner's cookie and is per-NFL-GAME rather than per league, so
  // it does not grow with how many leagues an owner is in — the reason the
  // ticker and the red-zone banner are affordable on an all-leagues-on board.
  // Either can fail without costing the scores: the board simply has no rail
  // and no ticker, which is visibly less rather than wrong.
  const [reads, scoreboard, detail] = await Promise.all([
    readCrossLeagueLive({ user, leagues: on, week, year }),
    fetchNflScoreboard({ week, year }).catch(() => ({ ok: false, week, games: [] as NflGame[] })),
    loadNflGameDetail({ week, year }).catch(() => null),
  ]);

  // Player identity for everyone on the board. The SEASON map: this is
  // results-shaped, and a player's identity for scoring purposes belongs to
  // the season being played.
  const identity = getPlayerMap(year);
  const playerMeta: Record<string, PlayerMeta> = {};
  const addMeta = (playerId: string) => {
    if (playerMeta[playerId]) return;
    const who = identity.get(playerId);
    playerMeta[playerId] = {
      id: playerId,
      name: who?.name ?? `Player ${playerId}`,
      position: who?.position ?? '',
      nflTeam: who?.nflTeam ?? '',
      headshot: who?.headshot ?? '',
      // NEVER shipped for joining — it can be a COLLEGE athlete id, and
      // college and NFL ids are both plain digits, so a bad join resolves a
      // different person rather than failing.
      espnId: null,
      // Deliberately 0: a projection belongs to a player IN A LEAGUE and this
      // map is shared across all of them. Scoring uses the per-league maps.
      projected: 0,
    };
  };

  const panels: MflLiveLeaguePanel[] = [];
  /**
   * Who the owner is in each league, for the ticker and the red-zone banner.
   *
   * Built from the SNAPSHOT rather than from the panels: a league with no
   * pairing still has starters, and dropping it here would cost the owner his
   * own touchdowns in a week he happens to be on a bye.
   */
  const viewers: LeagueViewer[] = [];

  for (const read of reads) {
    const { league, snapshot } = read;
    const slug = league.registered?.slug ?? null;
    const pairs = snapshot ? findOwnerMatchups(snapshot.matchups, league.franchiseId) : [];
    const status = statusFor(read, pairs.length);

    // A league with nothing to show still gets a panel, at its own place in
    // the list, saying why. Dropping it would re-order the board mid-afternoon
    // and make an owner wonder where a team went.
    if (status !== 'ok' || !snapshot) {
      panels.push({
        leagueId: league.id,
        leagueName: league.name,
        franchiseId: league.franchiseId,
        slug,
        registered: !!league.registered,
        status,
        matchups: [],
      });
      continue;
    }

    for (const rows of Object.values(snapshot.players)) for (const r of rows) addMeta(r.id);

    const scores = scoreLeague(
      league.id,
      snapshot,
      read.ok,
      league.franchiseId,
      playerMeta,
      read.projections,
    );

    const names = opponentNames(slug);
    const identityFor = (fid: string, fallbackName: string) =>
      resolveFranchiseIdentity({
        franchiseId: fid,
        // The FULL name — never a short name or abbrev. See nfl-name-match.ts:
        // "The Boondock Saints" has nameShort "Saints", which matches NO.
        franchiseName: names[fid] ?? fallbackName,
        leagueSlug: slug,
      });

    const toTeam = (fid: string, fallbackName: string): MflLiveTeam => {
      const id = identityFor(fid, fallbackName);
      const s = scores.teams[fid];
      return {
        franchiseId: fid,
        name: id.name,
        nameShort: id.nameShort,
        initials: id.initials,
        icon: id.icon,
        iconAlt: identityIconAlt(id),
        rung: id.rung,
        live: s?.live ?? 0,
        projectedFinal: s?.projectedFinal ?? 0,
        yetToPlay: s?.yetToPlay ?? 0,
        players: s?.players ?? [],
      };
    };

    const matchups: MflLiveMatchup[] = pairs.map((pair, index) => {
      const mine = toTeam(league.franchiseId, league.franchiseName);
      const opponent = toTeam(pair.opponentId, `Franchise ${pair.opponentId}`);
      return {
        index,
        mine,
        opponent,
        winProbability: scores.winProbability[index] ?? 0.5,
        colorVars: matchupColorVars(
          identityFor(league.franchiseId, league.franchiseName).colors,
          identityFor(pair.opponentId, `Franchise ${pair.opponentId}`).colors,
        ),
      };
    });

    panels.push({
      leagueId: league.id,
      leagueName: league.name,
      franchiseId: league.franchiseId,
      slug,
      registered: !!league.registered,
      status: 'ok',
      matchups,
    });
    viewers.push(toLeagueViewer(league, snapshot, names));
  }

  const games = scoreboard.games ?? [];

  return {
    board: {
      // The BOARD is ok when the assembler ran. A league's own failure rides
      // on its `status` — one dead feed is not an outage.
      ok: true,
      week,
      year,
      fetchedAt: new Date().toISOString(),
      leagues: panels,
      games,
      // Both of these translate every ESPN athlete id to an MFL player id
      // before returning — nothing ESPN-keyed crosses to the client, because a
      // college athlete id and an NFL one are both plain digits and a bad join
      // resolves a different person rather than failing.
      moments: buildBroadcastMoments(detail?.plays ?? [], viewers, playerMeta),
      redZone: selectRedZoneAlerts(games, viewers, playerMeta),
      playerMeta,
    },
    allLeagues: leagues.map((l) => ({ id: l.id, name: l.name, registered: !!l.registered })),
    enabled,
  };
}
