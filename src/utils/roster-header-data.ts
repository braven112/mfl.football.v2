/**
 * The roster header's team switcher, as a grouped structure both leagues
 * render with one component.
 *
 * The two leagues nest differently and the difference is real, not cosmetic:
 * TheLeague has one table of 16 clubs in four divisions, the AFL has 24 in two
 * conferences whose division names are DISJOINT sets (American runs
 * North/South, National runs East/West). So division cannot be the outer
 * grouping — a flat division list would merge two conferences' clubs under
 * labels that do not mean the same thing.
 *
 * Division order comes from the config, never from a hardcoded list: the
 * league registry is the source of truth for per-league constants.
 */

import { conferenceOrder } from './afl-conference';
import type { ConferenceId } from './afl-conference';

export interface HeaderTeam {
  franchiseId: string;
  name: string;
  /** Shorter name for the hover label, where one exists. */
  shortName: string;
  icon: string | null;
  division: string;
  conference: string | null;
}

export interface HeaderDivision {
  name: string;
  teams: HeaderTeam[];
}

export interface HeaderGroup {
  /** Null in a league with no conferences — the row then has no outer rail. */
  conferenceId: string | null;
  conferenceName: string | null;
  /**
   * The two-letter code, for the vertical rail. "American League" set
   * vertically is taller than the crest row, so the full name rendered
   * clipped ("MERICAN LEAGUE"); the rail shows this and the full name stays
   * as the rail's accessible label.
   */
  conferenceShort: string | null;
  divisions: HeaderDivision[];
}

export interface TeamGroupsInput {
  teams: any[];
  /** `config.conferences`, absent in a single-table league. */
  conferences?: Array<{ name: string; code: string; divisions?: string[] }> | null;
  /** `config.divisions` — the league-wide order, for a single-table league. */
  divisions?: string[] | null;
  /**
   * The VIEWER's conference, never the viewed club's. An order that followed
   * the viewed club would reshuffle the row under the cursor on every switch,
   * sending the crest just clicked to the far end. Null keeps the historical
   * order, so a viewer who has chosen nothing sees what they saw before.
   */
  viewerConference?: string | null;
}

const toHeaderTeam = (team: any): HeaderTeam => ({
  franchiseId: String(team?.franchiseId ?? ''),
  name: String(team?.name ?? 'Franchise'),
  shortName: String(team?.nameShort ?? team?.nameMedium ?? team?.name ?? 'Franchise'),
  icon: team?.icon ? String(team.icon) : null,
  division: String(team?.division ?? ''),
  conference: team?.conference != null ? String(team.conference) : null,
});

/**
 * Divisions in the order the config declares, with any division the config
 * forgot appended in first-seen order rather than dropped — a club that
 * vanishes from the switcher is unreachable, which is worse than one sitting
 * under an unexpected heading.
 */
function groupDivisions(teams: any[], declared: string[] | null | undefined): HeaderDivision[] {
  const members = new Map<string, HeaderTeam[]>();
  for (const team of teams) {
    const headerTeam = toHeaderTeam(team);
    if (!headerTeam.franchiseId) continue;
    const bucket = members.get(headerTeam.division);
    if (bucket) bucket.push(headerTeam);
    else members.set(headerTeam.division, [headerTeam]);
  }

  const ordered = [
    ...(declared ?? []).filter((name) => members.has(name)),
    ...[...members.keys()].filter((name) => !(declared ?? []).includes(name)),
  ];

  return ordered.map((name) => ({ name, teams: members.get(name) ?? [] }));
}

export function buildTeamGroups({
  teams,
  conferences,
  divisions,
  viewerConference,
}: TeamGroupsInput): HeaderGroup[] {
  const roster = Array.isArray(teams) ? teams : [];

  // Single-table league: one group, no conference rail.
  if (!Array.isArray(conferences) || conferences.length < 2) {
    return [
      {
        conferenceId: null,
        conferenceName: null,
        conferenceShort: null,
        divisions: groupDivisions(roster, divisions),
      },
    ];
  }

  const byCode = new Map(conferences.map((conference) => [conference.code, conference]));
  const order = conferenceOrder(viewerConference as ConferenceId | null | undefined).filter((code) =>
    byCode.has(code),
  );
  // Any conference the registry has but the order helper does not know about
  // still renders — the helper only encodes which of the AFL's two leads.
  const codes = [
    ...order,
    ...conferences.map((conference) => conference.code).filter((code) => !order.includes(code as ConferenceId)),
  ];

  return codes.map((code) => {
    const conference = byCode.get(code)!;
    const inConference = roster.filter((team) => String(team?.conference ?? '') === code);
    return {
      conferenceId: code,
      conferenceName: conference.name,
      // "American League" -> "AL". Falls back to the first two letters for a
      // conference whose name is a single word.
      conferenceShort:
        conference.name
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => word[0])
          .join('')
          .toUpperCase()
          .slice(0, 3) || null,
      divisions: groupDivisions(inConference, conference.divisions),
    };
  });
}

export interface RailWeek {
  week: number;
  played: boolean;
  outcome: 'W' | 'L' | 'T' | null;
  opponentId: string | null;
  isCurrent: boolean;
}

/**
 * One dot per scheduled week, in week order, for the season rail.
 *
 * Built from the WEEK LIST rather than from the club's own games, so a bye
 * still occupies a slot and the rail stays the same width for every club in
 * the league. A doubleheader week collapses to its last game, matching what
 * `findLastResult` calls the more recent result.
 */
export function buildSeasonRail(
  schedule: Array<{ week: number; games: any[] }>,
  weekNumbers: number[],
  currentWeek: number,
): RailWeek[] {
  const byWeek = new Map(schedule.map((entry) => [entry.week, entry.games]));
  return weekNumbers.map((week) => {
    const games = byWeek.get(week) ?? [];
    const game = games.length > 0 ? games[games.length - 1] : null;
    return {
      week,
      played: Boolean(game?.played),
      outcome: (game?.outcome ?? null) as RailWeek['outcome'],
      opponentId: game?.opponentId != null ? String(game.opponentId) : null,
      isCurrent: week === currentWeek,
    };
  });
}
