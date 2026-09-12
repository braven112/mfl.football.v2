/**
 * Assemble the whole broadcast board, once.
 *
 * The ONE implementation, called two ways: the page calls it in process for
 * its first paint, and `/api/broadcast-live` calls it for every poll. That is
 * not tidiness — a page that fetches its own API to render itself puts our own
 * edge in the path of its first paint, and this repo has already shipped the
 * outage that causes (docs/claude/rules/live-scoring.md).
 *
 * SERVER-SIDE ONLY. It reads MFL with the owner's cookie and ESPN without one,
 * and translates every ESPN athlete id to an MFL player id before anything
 * leaves.
 */

import type { AuthUser } from './auth';
import { getCurrentSeasonYear, getLeagueYearForSlug } from './league-year';
import { fetchMyLeagues } from './my-leagues';
import type { BoardLeague } from './sunday-ticket-selection';
import { resolveBroadcastLeagues } from './broadcast-selection';
import {
  buildBoardLeagues,
  findOwnerMatchups,
  loadLeagueProjections,
  loadLeagueSnapshot,
  readOutsideLiveSnapshot,
  scoreLeague,
  toLeagueViewer,
} from './broadcast-live-source';
import { buildBroadcastMoments, selectRedZoneAlerts } from './broadcast-moments';
import { loadNflGameDetail } from './nfl-game-detail-source';
import { fetchNflScoreboard } from './nfl-scoreboard-source';
import { getLeagueTeamBrands } from './league-team-brands';
import { getPlayerMap } from './player-map';
import { toBroadcastPair } from './draft-broadcast';
import { chooseTeamName } from './team-names';
import type { LiveSnapshot } from './live-scoring-snapshot';
import type { NflGame, PlayerMeta } from '../types/live-scoring';
import type {
  BroadcastLeaguePanel,
  BroadcastPollResponse,
  BroadcastTeam,
  LiveBroadcastPageData,
} from '../types/live-broadcast';

export interface AssembleBoardInput {
  user: AuthUser;
  /** `?leagues=` — a CHECK against what the session may see, never an input. */
  leaguesParam: string | null;
  /** The remembered set from the broadcast's OWN cookie. */
  leaguesCookie: string | null;
  week: number;
  /** Season year; defaults to the results clock. */
  year?: number;
  soundParam?: string | null;
  soundCookie?: string | null;
  pathname?: string;
  /**
   * `'full'` builds the panels — franchise colours, crests, every name form —
   * for the island's one-time props. `'poll'` skips all of it.
   *
   * Panel identity cannot change during a Sunday, and `/api/broadcast-live`
   * returns only `board.poll`, so building it on every 8-second poll was work
   * computed and thrown away ~2,880 times per television per afternoon.
   */
  mode?: 'full' | 'poll';
}

export interface AssembledBoard {
  leagues: BoardLeague[];
  enabled: string[];
  panels: BroadcastLeaguePanel[];
  playerMeta: Record<string, PlayerMeta>;
  poll: BroadcastPollResponse;
}

const NEUTRAL: Omit<BroadcastTeam, 'franchiseId' | 'name' | 'nameShort' | 'abbrev'> = {
  icon: '',
  iconSmall: '',
  crestStroke: 0,
  primary: '#334155',
  secondary: '#1e293b',
  gradient: '',
};

/**
 * One franchise's identity for the board.
 *
 * Brand colours go through `toBroadcastPair` without exception. A raw config
 * colour is not safe to paint white text on — five TheLeague franchises carry
 * a near-black `colorPrimary`, and the separate `color` field is a CHART hue
 * chosen to sit apart from fifteen other lines, which is why one
 * black-and-red franchise's `color` is pink.
 */
type BrandMap = Record<string, { name: string; nameShort: string; colorPrimary: string; icon: string }>;

/**
 * One league's brand map, resolved ONCE per league per assembly.
 *
 * `getLeagueTeamBrands` walks the league's whole config and builds a fresh
 * Record every call, so looking it up inside `teamFor` meant rebuilding all
 * 24 AFL franchises to read one of them — once per franchise, per league, per
 * assembly. Throws for a league this site does not run, which is the normal
 * case for an outside league and not an error.
 */
function brandsFor(slug: string): BrandMap {
  try {
    return slug ? (getLeagueTeamBrands(slug) as BrandMap) : {};
  } catch {
    return {};
  }
}

function teamFor(brands: BrandMap, franchiseId: string, fallbackName: string): BroadcastTeam {
  const brand = brands[franchiseId];

  const name = brand?.name || fallbackName || `Franchise ${franchiseId}`;
  const nameShort = brand?.nameShort || chooseTeamName({ fullName: name }, 'short');
  const abbrev = chooseTeamName({ fullName: name, nameShort }, 'abbrev');

  if (!brand) {
    // An outside league: real names, no artwork. Plainer, never broken.
    return { franchiseId, name, nameShort, abbrev, ...NEUTRAL };
  }

  const pair = toBroadcastPair(brand.colorPrimary, brand.colorPrimary);
  return {
    franchiseId,
    name,
    nameShort,
    abbrev,
    icon: brand.icon || '',
    iconSmall: brand.icon || '',
    crestStroke: 0,
    primary: pair.primary,
    secondary: pair.secondary,
    gradient: '',
  };
}

/** Every franchise name in one league, for naming opponents. */
function namesFor(brands: BrandMap): Record<string, string> {
  return Object.fromEntries(Object.entries(brands).map(([fid, b]) => [fid, b.name]));
}

export async function assembleBroadcastBoard(input: AssembleBoardInput): Promise<AssembledBoard> {
  const { user, week } = input;
  const mode = input.mode ?? 'full';
  const year = input.year ?? getCurrentSeasonYear();

  // `myleagues` is keyed on the owner's MFL cookie, which the session carries
  // as `user.id` (see mfl-login). Its own league year, not the season year:
  // MFL lists the leagues of the year whose directory it created.
  const leagueYear = getLeagueYearForSlug('theleague');
  const myLeagues = await fetchMyLeagues(user.id, leagueYear).catch(() => ({ ok: false, leagues: [] }));
  const leagues = buildBoardLeagues(myLeagues.leagues ?? [], {
    leagueId: user.leagueId,
    franchiseId: user.franchiseId,
  });

  // The param narrows what the SESSION already allows; it can never widen it,
  // because `resolveBroadcastLeagues` only ever returns ids present in
  // `leagues`, and `leagues` came from this owner's own cookie.
  const { enabled } = resolveBroadcastLeagues(input.leaguesParam, input.leaguesCookie, leagues);
  const on = leagues.filter((l) => enabled.includes(l.id));

  // Fan out: every enabled league's MFL snapshot, plus the two ESPN reads,
  // all at once. A league that fails contributes `ok: false` and nothing else
  // — one bad feed must not blank the board.
  const [snapshots, projectionSets, scoreboard, detail] = await Promise.all([
    Promise.all(
      on.map((league) =>
        loadLeagueSnapshot({ league, year, week }, (l, y, w) =>
          readOutsideLiveSnapshot(l, y, w, user.id),
        ).catch(() => ({ leagueId: league.id, ok: false, snapshot: null as LiveSnapshot | null })),
      ),
    ),
    // Per league, never pooled: two leagues score the same player differently,
    // so one shared map would rate a TheLeague lineup with the AFL's numbers.
    Promise.all(
      on.map((league) =>
        loadLeagueProjections(league, week, user.id)
          .then((map) => [league.id, map] as const)
          .catch(() => [league.id, new Map<string, number>()] as const),
      ),
    ),
    fetchNflScoreboard({ week, year }).catch(() => ({ ok: false, week, games: [] as NflGame[] })),
    loadNflGameDetail({ week, year }).catch(() => null),
  ]);

  const byLeague = new Map(snapshots.map((s) => [s.leagueId, s]));
  const projectionsByLeague = new Map(projectionSets);

  // Player identity for everyone on the board. The season map is the right
  // one: this is results-shaped and a player's identity for scoring purposes
  // belongs to the season being played.
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
      // Never shipped for JOINING — see the type. Present only because the
      // headshot cascade reads it, and it can be a COLLEGE id.
      espnId: null,
      // Deliberately 0 in the SHIPPED payload. A projection belongs to a
      // player IN A LEAGUE, and this map is player-keyed and shared across
      // every league on the board, so there is no single right value to put
      // here. Scoring uses the per-league maps instead (`scoreLeague`'s
      // `projections`), and nothing on the client reads this field.
      projected: 0,
    };
  };

  const panels: BroadcastLeaguePanel[] = [];
  const leagueScores = [];
  const viewers = [];

  for (const league of on) {
    const result = byLeague.get(league.id);
    const snapshot = result?.snapshot ?? null;
    const ok = !!result?.ok && !!snapshot;
    const slug = league.registered?.slug ?? '';
    const brands = brandsFor(slug);
    const names = namesFor(brands);

    if (!snapshot) {
      if (mode === 'full') {
        // The panel still exists, at full height, saying so. Dropping it would
        // re-lay out every other panel mid-afternoon, which is exactly the
        // motion a fixed header exists to prevent.
        panels.push({
          leagueId: league.id,
          leagueName: league.name,
          slug,
          franchiseId: league.franchiseId,
          matchups: [],
          status: 'unavailable',
        });
      }
      leagueScores.push({ leagueId: league.id, ok: false, live: false, teams: {}, winProbability: [] });
      continue;
    }

    for (const rows of Object.values(snapshot.players)) for (const r of rows) addMeta(r.id);

    const pairs = findOwnerMatchups(snapshot.matchups, league.franchiseId);

    if (mode === 'full') {
      const mine = teamFor(brands, league.franchiseId, league.franchiseName);
      panels.push({
        leagueId: league.id,
        leagueName: league.name,
        slug,
        franchiseId: league.franchiseId,
        matchups: pairs.map((pair, index) => ({
          index,
          mine,
          opponent: teamFor(brands, pair.opponentId, names[pair.opponentId] ?? ''),
        })),
        // A league with a feed but no pairing is on a bye — a fact, not a fault.
        status: ok ? (pairs.length > 0 ? 'ok' : 'no-matchup') : 'unavailable',
      });
    }

    leagueScores.push(
      scoreLeague(
        league.id,
        snapshot,
        ok,
        league.franchiseId,
        playerMeta,
        projectionsByLeague.get(league.id) ?? new Map(),
      ),
    );
    viewers.push(toLeagueViewer(league, snapshot, names));
  }

  const plays = detail?.plays ?? [];
  const games = scoreboard.games ?? [];

  const poll: BroadcastPollResponse = {
    // The board is `ok` when the assembler ran. An individual league's failure
    // rides on that league's own flag — one dead feed is not an outage.
    ok: true,
    week,
    fetchedAt: new Date().toISOString(),
    leagues: leagueScores,
    moments: buildBroadcastMoments(plays, viewers, playerMeta),
    redZone: selectRedZoneAlerts(games, viewers, playerMeta),
    games,
  };

  return { leagues, enabled, panels, playerMeta, poll };
}

/** The island's one-time props. */
export function toPageData(
  board: AssembledBoard,
  opts: { week: number; year: number; sound: boolean; pathname: string },
): LiveBroadcastPageData {
  return {
    week: opts.week,
    year: opts.year,
    enabled: board.enabled,
    panels: board.panels,
    playerMeta: board.playerMeta,
    initial: board.poll,
    sound: opts.sound,
    available: board.leagues.map((l) => ({
      id: l.id,
      name: l.name,
      registered: !!l.registered,
      enabled: board.enabled.includes(l.id),
    })),
    pathname: opts.pathname,
  };
}
