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

export interface LiveStandingsLeague {
  leagueId: string;
  leagueName: string;
  /** MFL's rows, or null when the read failed — never an empty array for that. */
  standings: LiveStandingsRow[] | null;
  /** This week's matchups — what the Live and Projected views add. */
  matchups: LiveMatchup[];
}

export interface MflLiveStandings {
  week: number;
  year: number;
  leagues: LiveStandingsLeague[];
}

export interface AssembleMflLiveStandingsInput {
  user: AuthUser;
  week: number;
  year?: number;
  /** `?leagues=` — a CHECK against what the session may see, never an input. */
  leaguesParam?: string | null;
  leaguesCookie?: string | null;
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
    const { board } = await assembleMflLeagueBoard({ user, league, week, year });
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

  return { week, year, leagues: tables };
}
