/**
 * Sleeper leagues on `/live/standings` and the app's Standings tab.
 *
 * Produces the same `LiveStandingsLeague` an MFL league does, so the Final,
 * Live and Projected views come from the one `projectStandings` both surfaces
 * already share. What differs is absorbed here:
 *
 *  - **Sleeper publishes records, not an order.** Its rosters carry wins,
 *    losses, ties and points for, and no standings position or tiebreaker. The
 *    Final view is therefore ordered by win percentage, then points for — what
 *    Sleeper's own app shows by default — and is the only place a Sleeper table
 *    is ordered by us. (The "never re-sort MFL's rows" rule is about MFL's
 *    order, which encodes tiebreakers we cannot reproduce; Sleeper sends none.)
 *  - **Never count a week twice.** Sleeper folds a week into the records once
 *    it is processed. `weekGamesCounted` compares the games each roster has
 *    been credited with to the regular-season weeks before this one, and is
 *    null when the two do not line up, which `projectStandings` treats as
 *    "add only matchups still being played".
 *  - **Median games are in the record but not in the matchups.** A league
 *    scoring against the median credits two results a week; the Live view can
 *    only add the head-to-head one, because the median is Sleeper's to settle.
 *  - **Playoff weeks add nothing.** A bracket game is not a regular-season
 *    result, so from `playoff_week_start` the table is Sleeper's record alone.
 *  - **No projections**, so the Projected view is left out for a Sleeper
 *    league (`standingsViewsFor`) and every matchup carries `noProjections`.
 *
 * SERVER-SIDE ONLY.
 */

import type { AuthUser } from '../auth';
import type { LiveMatchup, LiveStandingsRow } from '../../types/live';
import type { BoardLeague } from '../sunday-ticket-selection';
import { buildBoardFromSnapshot } from '../live/read';
import { decorateStandings } from '../live/standings';
import { sleeperGet, type SleeperLeagueSettings, type SleeperRoster } from './client';
import { readSleeperLive, sleeperLeagueIdOf } from './live';
import type { SleeperPlayerMap } from './players';

/** One roster's record. Sleeper splits points into whole and hundredths. */
function recordOf(r: SleeperRoster): { wins: number; losses: number; ties: number; pointsFor: number } {
  const s = r.settings ?? {};
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    wins: n(s.wins),
    losses: n(s.losses),
    ties: n(s.ties),
    pointsFor: Math.round((n(s.fpts) + n(s.fpts_decimal) / 100) * 100) / 100,
  };
}

/**
 * How many of `week`'s head-to-head games Sleeper already holds for a roster:
 * 1 once the week is processed, 0 before, null when the record does not fit
 * the calendar (a league that changed its settings mid-season, say).
 */
export function sleeperWeekGamesCounted(
  record: { wins: number; losses: number; ties: number },
  week: number,
  settings: SleeperLeagueSettings,
): number | null {
  const startWeek = Number(settings.start_week) || 1;
  const perWeek = Number(settings.league_average_match) === 1 ? 2 : 1;
  const played = record.wins + record.losses + record.ties;
  const before = Math.max(0, week - startWeek) * perWeek;
  if (played === before) return 0;
  if (played === before + perWeek) return 1;
  return null;
}

/** Is `week` a playoff week, whose games never reach the regular-season table? */
export function isSleeperPlayoffWeek(week: number, settings: SleeperLeagueSettings): boolean {
  const start = Number(settings.playoff_week_start);
  return Number.isFinite(start) && start > 0 && week >= start;
}

/** Pure: Sleeper's rosters → standings rows, ordered and ranked. Names come later. */
export function sleeperStandingsRows(
  rosters: readonly SleeperRoster[],
  week: number,
  settings: SleeperLeagueSettings,
): LiveStandingsRow[] {
  const winPct = (r: { wins: number; losses: number; ties: number }) => {
    const g = r.wins + r.losses + r.ties;
    return g === 0 ? 0 : (r.wins + r.ties / 2) / g;
  };
  return rosters
    .filter((r) => typeof r?.roster_id === 'number')
    .map((r) => ({ id: String(r.roster_id), ...recordOf(r) }))
    .sort((a, b) => winPct(b) - winPct(a) || b.pointsFor - a.pointsFor || Number(a.id) - Number(b.id))
    .map((r, i) => ({
      franchiseId: r.id,
      rank: i + 1,
      name: '',
      nameShort: '',
      initials: '',
      icon: '',
      iconAlt: '',
      rung: 'text' as const,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      pointsFor: r.pointsFor,
      isViewer: false,
      weekGamesCounted: sleeperWeekGamesCounted(r, week, settings),
    }));
}

export interface SleeperStandingsTable {
  standings: LiveStandingsRow[] | null;
  matchups: LiveMatchup[];
}

/**
 * One Sleeper league's table and this week's matchups. Never throws: a league
 * whose rosters cannot be read is `standings: null`, the "couldn't read the
 * standings" state, and an unreadable week costs only the matchups.
 */
export async function readSleeperStandings(input: {
  user: AuthUser;
  league: BoardLeague;
  week: number;
  year: number;
  players: SleeperPlayerMap;
  /** Seconds left per NFL club, or null when no clock could be read. */
  clock: ReadonlyMap<string, number> | null;
  mflOnly: boolean;
}): Promise<SleeperStandingsTable> {
  const { league, week } = input;
  const sid = sleeperLeagueIdOf(league.id);
  const [leagueBody, rostersBody] = await Promise.all([
    sleeperGet(`/league/${sid}`),
    sleeperGet(`/league/${sid}/rosters`),
  ]);
  if (!Array.isArray(rostersBody)) return { standings: null, matchups: [] };
  const settings: SleeperLeagueSettings =
    (leagueBody as { settings?: SleeperLeagueSettings } | undefined)?.settings ?? {};

  // Read in playoff weeks too: it carries the team names and marks.
  const [read] = await readSleeperLive({ leagues: [league], week, players: input.players, clock: input.clock });

  const rows = sleeperStandingsRows(rostersBody as SleeperRoster[], week, settings);
  const standings = decorateStandings(rows, {
    league,
    year: input.year,
    mflUserCookie: input.user.id,
    viewerFranchiseId: league.franchiseId || null,
    franchiseNames: read?.franchiseNames ?? {},
    franchiseIcons: read?.franchiseIcons ?? {},
    noNflArt: input.mflOnly,
  });

  if (isSleeperPlayoffWeek(week, settings) || !read?.ok || !read.snapshot) return { standings, matchups: [] };
  const board = buildBoardFromSnapshot({
    league: { id: league.id, name: league.name, slug: null },
    week,
    year: input.year,
    ok: true,
    snapshot: read.snapshot,
    projections: read.projections,
    franchiseNames: read.franchiseNames,
    franchiseIcons: read.franchiseIcons,
    viewerFranchiseId: league.franchiseId || null,
    surface: 'mfl',
    mflOnly: input.mflOnly,
  });
  const matchups = (board.panels[0]?.matchups ?? []).map((m) => ({ ...m, noProjections: true }));
  return { standings, matchups };
}
