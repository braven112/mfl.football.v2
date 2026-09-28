/**
 * View models for a package league's homepage (archies first): the hero and
 * the team snapshot. Pure functions over committed feeds so they are testable
 * and so the shared component holds markup only.
 *
 * Deliberately league-agnostic. TheLeague's and the AFL's heroes are built on
 * contracts, auctions and conferences; a package league has none of that, so
 * its hero is made only from what every MFL league has: a schedule, scores
 * and standings.
 *
 * Doubleheaders are the norm here (archies plays two games a week in weeks
 * 1-14), so every "this week" value is a LIST of games — never collapse it to
 * one (src/utils/schedule-data.mjs explains the bug that shipped when a header
 * did).
 */
import {
  parseWeeklySchedule,
  franchiseSchedule,
  findLastPlayedWeek,
  findNextWeek,
} from './schedule-data.mjs';
import type { DivisionStandings, StandingRow, PackageDivision } from './package-league';

export interface HomeGame {
  week: number;
  opponentId: string;
  isHome: boolean;
  played: boolean;
  score: number | null;
  opponentScore: number | null;
  outcome: 'W' | 'L' | 'T' | null;
}

export interface WeekScore {
  franchiseId: string;
  score: number;
}

/** The league's most recent fully- or partly-scored week, league-wide. */
export interface WeekInTheBooks {
  week: number;
  top: WeekScore;
  low: WeekScore;
  /** Biggest winning margin that week. */
  blowout: { winnerId: string; loserId: string; margin: number } | null;
  /** Closest decided game that week. */
  nailBiter: { winnerId: string; loserId: string; margin: number } | null;
  games: number;
}

export type PackageHeroState =
  /** Signed-in owner, season under way: their games this week (+ last week's results). */
  | { kind: 'my-week'; week: number; games: HomeGame[]; lastWeek: { week: number; games: HomeGame[] } | null; league: WeekInTheBooks | null }
  /** Signed-in owner, season over for them: how their season finished. */
  | { kind: 'my-season-done'; lastWeek: { week: number; games: HomeGame[] }; league: WeekInTheBooks | null }
  /** Anyone else during the season: the league's latest scored week. */
  | { kind: 'league-week'; league: WeekInTheBooks; nextWeek: number | null }
  /** No games scored yet this season (preseason / offseason). */
  | { kind: 'offseason' };

type ParsedWeek = ReturnType<typeof parseWeeklySchedule>[number];

/** League-wide: the latest week with at least one played game, summarised. */
export function weekInTheBooks(weeks: ParsedWeek[]): WeekInTheBooks | null {
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const { week, matchups } = weeks[i];
    const played = matchups.filter((m) => m.franchises.every((f) => f.score != null));
    if (played.length === 0) continue;

    // A franchise plays twice in a doubleheader week; its "week score" for the
    // top/low call is its best single game, so a team is never listed twice.
    const best = new Map<string, number>();
    let blowout: WeekInTheBooks['blowout'] = null;
    let nailBiter: WeekInTheBooks['nailBiter'] = null;
    for (const { franchises } of played) {
      for (const f of franchises) best.set(f.id, Math.max(best.get(f.id) ?? -Infinity, f.score as number));
      const [a, b] = franchises;
      const margin = Math.round(Math.abs((a.score as number) - (b.score as number)) * 100) / 100;
      if (margin === 0) continue;
      const [winner, loser] = (a.score as number) > (b.score as number) ? [a, b] : [b, a];
      if (!blowout || margin > blowout.margin) blowout = { winnerId: winner.id, loserId: loser.id, margin };
      if (!nailBiter || margin < nailBiter.margin) nailBiter = { winnerId: winner.id, loserId: loser.id, margin };
    }
    const ranked = [...best.entries()].map(([franchiseId, score]) => ({ franchiseId, score })).sort((x, y) => y.score - x.score);
    return { week, top: ranked[0], low: ranked[ranked.length - 1], blowout, nailBiter, games: played.length };
  }
  return null;
}

/** The first week that still has an unplayed game, league-wide. */
function nextLeagueWeek(weeks: ParsedWeek[]): number | null {
  for (const { week, matchups } of weeks) {
    if (matchups.some((m) => m.franchises.some((f) => f.score == null))) return week;
  }
  return null;
}

/**
 * Which hero to show.
 *
 * @param scheduleFeed  The season's MFL `schedule.json`.
 * @param mine          The viewer's franchise IN THIS LEAGUE, or null (never
 *                      a default team: "nobody" is a real answer here).
 */
export function resolvePackageHero(
  scheduleFeed: unknown,
  mine: string | null,
  opts: { inSeason?: boolean } = {},
): PackageHeroState {
  // Out of season the hero looks FORWARD (the next calendar event), never at
  // a finished season's last week: a completed feed would otherwise headline
  // "week 17 in the books" all spring (CLAUDE.md: "The feeds have a completed
  // week" is NOT an offseason guard).
  if (opts.inSeason === false) return { kind: 'offseason' };
  const weeks = parseWeeklySchedule(scheduleFeed);
  const league = weekInTheBooks(weeks);

  if (mine) {
    const sched = franchiseSchedule(weeks, mine);
    if (sched.length > 0) {
      const last = findLastPlayedWeek(sched);
      const next = findNextWeek(sched);
      if (next) return { kind: 'my-week', week: next.week, games: next.games, lastWeek: last, league };
      if (last) return { kind: 'my-season-done', lastWeek: last, league };
    }
  }
  if (league) return { kind: 'league-week', league, nextWeek: nextLeagueWeek(weeks) };
  return { kind: 'offseason' };
}

export interface TeamSnapshot {
  franchiseId: string;
  division: PackageDivision;
  row: StandingRow;
  divisionSize: number;
  /** This team's last scored week and next unplayed week (either may be null). */
  games: { next: { week: number; games: HomeGame[] } | null; last: { week: number; games: HomeGame[] } | null };
  rosterCount: number | null;
}

/**
 * The viewer's team at a glance: division place, record, last and next week.
 * Null when there is no viewer franchise or it is not in the standings.
 */
export function buildTeamSnapshot(
  groups: DivisionStandings[],
  scheduleFeed: unknown,
  mine: string | null,
  rosterCount: number | null,
): TeamSnapshot | null {
  if (!mine) return null;
  for (const g of groups) {
    const row = g.rows.find((r) => r.franchiseId === mine);
    if (!row) continue;
    const sched = franchiseSchedule(parseWeeklySchedule(scheduleFeed), mine);
    return {
      franchiseId: mine,
      division: g.division,
      row,
      divisionSize: g.rows.length,
      games: { next: findNextWeek(sched), last: findLastPlayedWeek(sched) },
      rosterCount,
    };
  }
  return null;
}

/** "W 144.99–126.45" style line for one played game, from the owner's side. */
export function gameResultLine(g: HomeGame): string {
  if (!g.played || g.score == null || g.opponentScore == null) return '';
  return `${g.outcome ?? ''} ${g.score.toFixed(2)}–${g.opponentScore.toFixed(2)}`.trim();
}
