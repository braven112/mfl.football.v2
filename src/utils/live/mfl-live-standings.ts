/**
 * MFL Live — every league you watch, as standings (`/live/standings`).
 *
 * The standings tab of each league board (`/live/league/<id>`), fanned out
 * over the leagues the owner has switched ON in `/live/settings`. Each league
 * is assembled by `assembleMflLeagueBoard` — the very function its own board
 * uses — so a table here and the same league's tab can never disagree about
 * a record, a name or a projected finish.
 *
 * ── ONE LEAGUE'S FAILURE IS THAT LEAGUE'S ─────────────────────────────────
 * Bounded by `mapWithConcurrency`, and every league settles on its own. A
 * league whose read throws comes back with `standings: null` — the "couldn't
 * read the standings" state — never as a missing section and never as a
 * rejected page. Four good tables and one honest error beat a blank screen.
 *
 * ── THE SELECTION NARROWS, NEVER WIDENS ───────────────────────────────────
 * The same rule as `/live`: the league list comes from the owner's OWN MFL
 * cookie via `discoverBoardLeagues`, and the `?leagues=` param / cookie can
 * only pick from it (`resolveMflLiveLeagues` returns ids present in it).
 *
 * ── SLEEPER LEAGUES ───────────────────────────────────────────────────────
 * The viewer's linked Sleeper leagues (`sl-…`) join the list the same way they
 * join the board, and come back as the same table shape from
 * `sleeper/standings.ts`. They have no Projected view.
 */
import type { AuthUser } from '../auth';
import type { LiveMatchup, LiveStandingsRow } from '../../types/live';
import { getCurrentSeasonYear } from '../league-year';
import { CROSS_LEAGUE_FAN_OUT_LIMIT, discoverBoardLeagues } from '../cross-league-live';
import { mapWithConcurrency } from '../fan-out';
import { resolveMflLiveLeagues } from '../mfl-live-selection';
import { assembleMflLeagueBoard } from './mfl-league-board';
import { getSleeperLink, sleeperViewerKey } from '../sleeper/link';
import { discoverSleeperBoardLeagues } from '../sleeper/live';
import { applyPlayerFixes, readViewerFixes } from '../sleeper/player-fixes';
import { loadSleeperPlayerMap, type SleeperPlayerMap } from '../sleeper/players';
import { readSleeperStandings } from '../sleeper/standings';
import { loadMflNflClock, SLEEPER_IN_STORE_APP } from '../sleeper/store-clock';
import {
  isStandingsModeLocked,
  projectStandings,
  STANDINGS_MODES,
  type ProjectedStandingsRow,
  type StandingsMode,
} from './standings-projection';

export interface LiveStandingsLeague {
  leagueId: string;
  leagueName: string;
  /** Absent for an MFL league. A Sleeper league has no Projected view. */
  provider?: 'sleeper';
  /** MFL's rows, or null when the read failed — never an empty array for that. */
  standings: LiveStandingsRow[] | null;
  /** This week's matchups — what the Live and Projected views add. */
  matchups: LiveMatchup[];
  /**
   * Store mode only: the table's views, already built by `projectStandings`.
   *
   * The app cannot import site code, and a second copy of the "never count a
   * week twice" overlay on a phone is the copy that drifts. So the server
   * builds every view the viewer may see, and a locked view is simply absent
   * — the lock is enforced here, not trusted to the client. `final` is
   * always present (never locked); null when `standings` is null.
   */
  views?: MflLiveStandingsViews | null;
}

export type MflLiveStandingsViews = Partial<Record<StandingsMode, ProjectedStandingsRow[]>>;

export interface MflLiveStandings {
  week: number;
  year: number;
  leagues: LiveStandingsLeague[];
  /** Store mode only: Live and Projected need MFL Live Pro, and are absent from `views`. */
  proLocked?: boolean;
}

export interface AssembleMflLiveStandingsInput {
  user: AuthUser;
  week: number;
  year?: number;
  /** `?leagues=` — a CHECK against what the session may see, never an input. */
  leaguesParam?: string | null;
  leaguesCookie?: string | null;
  /**
   * The store build of the MFL Live app (`?source=mfl`): MFL data only, with
   * no headshots and no NFL club marks or colours on any row or matchup.
   * Pinned by `tests/mfl-live-standings-store.test.ts`.
   */
  mflOnly?: boolean;
  /** Store mode only: withhold the Pro views (`hasMflLivePro` decides). */
  proLocked?: boolean;
}

/** Every view of one table this viewer may see. See `LiveStandingsLeague.views`. */
export function standingsViewsFor(
  table: Pick<LiveStandingsLeague, 'standings' | 'matchups' | 'provider'>,
  proLocked: boolean,
): MflLiveStandingsViews | null {
  if (!table.standings) return null;
  const views: MflLiveStandingsViews = {};
  for (const mode of STANDINGS_MODES) {
    if (isStandingsModeLocked(mode, proLocked)) continue;
    // Sleeper ships live scores only, so a "projected" table would be the
    // live one under a second label. Absent, and the app falls back to Final.
    if (mode === 'projected' && table.provider === 'sleeper') continue;
    views[mode] = projectStandings(table.standings, table.matchups, mode);
  }
  return views;
}

export async function assembleMflLiveStandings(
  input: AssembleMflLiveStandingsInput,
): Promise<MflLiveStandings> {
  const { user, week } = input;
  const year = input.year ?? getCurrentSeasonYear();

  // MFL and Sleeper discovered together, exactly as the board does, so the
  // same leagues are switched on in both. No Sleeper link: an empty list.
  const [mflLeagues, sleeperLeagues] = await Promise.all([
    discoverBoardLeagues(user),
    input.mflOnly && !SLEEPER_IN_STORE_APP
      ? Promise.resolve([])
      : getSleeperLink(user)
          .then((link) => discoverSleeperBoardLeagues(link, year))
          .catch(() => []),
  ]);
  const leagues = [...mflLeagues, ...sleeperLeagues];
  const { enabled } = resolveMflLiveLeagues(input.leaguesParam, input.leaguesCookie, leagues);
  const on = leagues.filter((l) => enabled.includes(l.id));

  // What every Sleeper league shares: the player map and one NFL clock. The
  // clock is MFL's own schedule on both surfaces — the standings only need
  // "finished or not", and it keeps the store app free of ESPN.
  const onSleeper = on.some((l) => l.provider === 'sleeper');
  const sleeperShared = onSleeper
    ? Promise.all([
        Promise.all([
          loadSleeperPlayerMap(year).catch((): SleeperPlayerMap => ({})),
          readViewerFixes(sleeperViewerKey(user)).catch(() => ({})),
        ]).then(([map, fixes]) => applyPlayerFixes(map, fixes)),
        loadMflNflClock({ year, week }),
      ])
    : Promise.resolve([{}, null] as const);

  const settled = await mapWithConcurrency(on, CROSS_LEAGUE_FAN_OUT_LIMIT, async (league) => {
    if (league.provider === 'sleeper') {
      const [players, clock] = await sleeperShared;
      return readSleeperStandings({ user, league, week, year, players, clock, mflOnly: input.mflOnly === true });
    }
    const { board } = await assembleMflLeagueBoard({
      user,
      league,
      week,
      year,
      mflOnly: input.mflOnly === true,
    });
    return board.panels[0];
  });

  const tables = on.map((league, i): LiveStandingsLeague => {
    const result = settled[i];
    const panel = result.status === 'fulfilled' ? result.value : undefined;
    return {
      leagueId: league.id,
      leagueName: league.name,
      ...(league.provider === 'sleeper' ? { provider: 'sleeper' as const } : {}),
      standings: panel?.standings ?? null,
      matchups: panel?.matchups ?? [],
    };
  });

  if (input.mflOnly) {
    const proLocked = input.proLocked === true;
    return {
      week,
      year,
      proLocked,
      leagues: tables.map((t) => ({ ...t, views: standingsViewsFor(t, proLocked) })),
    };
  }
  return { week, year, leagues: tables };
}
