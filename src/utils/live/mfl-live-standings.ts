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
 */
import type { AuthUser } from '../auth';
import type { LiveMatchup, LiveStandingsRow } from '../../types/live';
import { getCurrentSeasonYear } from '../league-year';
import { CROSS_LEAGUE_FAN_OUT_LIMIT, discoverBoardLeagues } from '../cross-league-live';
import { mapWithConcurrency } from '../fan-out';
import { resolveMflLiveLeagues } from '../mfl-live-selection';
import { assembleMflLeagueBoard } from './mfl-league-board';
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
  table: Pick<LiveStandingsLeague, 'standings' | 'matchups'>,
  proLocked: boolean,
): MflLiveStandingsViews | null {
  if (!table.standings) return null;
  const views: MflLiveStandingsViews = {};
  for (const mode of STANDINGS_MODES) {
    if (isStandingsModeLocked(mode, proLocked)) continue;
    views[mode] = projectStandings(table.standings, table.matchups, mode);
  }
  return views;
}

export async function assembleMflLiveStandings(
  input: AssembleMflLiveStandingsInput,
): Promise<MflLiveStandings> {
  const { user, week } = input;
  const year = input.year ?? getCurrentSeasonYear();

  const leagues = await discoverBoardLeagues(user);
  const { enabled } = resolveMflLiveLeagues(input.leaguesParam, input.leaguesCookie, leagues);
  const on = leagues.filter((l) => enabled.includes(l.id));

  const settled = await mapWithConcurrency(on, CROSS_LEAGUE_FAN_OUT_LIMIT, async (league) => {
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
