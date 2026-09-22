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

export interface RailGame {
  played: boolean;
  outcome: 'W' | 'L' | 'T' | null;
  opponentId: string | null;
}

export interface RailWeek {
  week: number;
  isCurrent: boolean;
  /** Every game the club plays that week. Empty means a bye. */
  games: RailGame[];
}

/**
 * The season rail: one mark per GAME, grouped by week.
 *
 * Per game, not per week, and that is the whole point. TheLeague opens 2026
 * with three DOUBLEHEADER weeks (and runs another in week 12); the AFL runs
 * them in 1, 2 and 12 — which weeks move every season, so nothing may
 * hardcode them. This function used to keep `games[games.length - 1]` and
 * throw the other game away, which made the rail disagree with the record
 * printed a few pixels above it: the Pigskins split week 1, the rail drew the
 * win and dropped the loss, and a 1-1 club showed one green mark. Reported as
 * exactly that. The rail is a record when the marks count the games, and a
 * lie when they count the weeks.
 *
 * Still built from the WEEK LIST rather than from the club's own games, so a
 * bye keeps its slot and the rail stays the same width for every club in the
 * league.
 */
export function buildSeasonRail(
  schedule: Array<{ week: number; games: any[] }>,
  weekNumbers: number[],
  currentWeek: number,
): RailWeek[] {
  const byWeek = new Map(schedule.map((entry) => [entry.week, entry.games]));
  return weekNumbers.map((week) => ({
    week,
    isCurrent: week === currentWeek,
    games: (byWeek.get(week) ?? []).map((game: any) => ({
      played: Boolean(game?.played),
      outcome: (game?.outcome ?? null) as RailGame['outcome'],
      opponentId: game?.opponentId != null ? String(game.opponentId) : null,
    })),
  }));
}


/**
 * The header's one featured player.
 *
 * Which player that is depends on what the league HAS, not on a preference:
 *
 *  - A salary league (TheLeague: `salaryCap: true`) shows the best VALUE —
 *    the most fantasy points per dollar of cap, at QB / RB / WR / TE. The biggest contract is a
 *    fact about spending, not about the roster; the best value is the pick
 *    that actually won the club something, and it is the number a cap league
 *    is really playing for.
 *  - A league without salaries (the AFL runs `salaryCap: false` and
 *    `contracts: false`, so there is no salary and therefore no ratio to
 *    compute at all) shows the player who ranks best AT HIS OWN POSITION. A
 *    raw points leader would just be a quarterback every time, because QBs
 *    out-score every other position by construction; ranking within the
 *    position is what makes a WR2 and a QB8 comparable.
 *
 * BOTH modes are restricted to QB / RB / WR / TE, for the same reason. A
 * kicker or defence can top its own tiny position on a quiet week, and on
 * points-per-dollar they are nearly unbeatable: they cost the league minimum
 * and score steadily, so unfiltered they took 5 of TheLeague's 16 cards —
 * "Nick Folk is our best value player" is arithmetically true and not what
 * anyone means.
 */
export const HEADER_PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

export interface HeaderPlayer {
  id: string;
  name: string;
  position: string;
  headshot: string | null;
  /** The one number the card prints — "$7.2M", or "WR3". */
  statValue: string;
  /** What that number is. */
  statLabel: string;
}

interface CandidatePlayer {
  id?: string;
  name?: string;
  position?: string;
  headshot?: string | null;
  salary?: string | number | null;
  points?: string | number | null;
  [key: string]: any;
}

const toPlayer = (p: CandidatePlayer, statValue: string, statLabel: string): HeaderPlayer => ({
  id: String(p.id ?? ''),
  name: String(p.name ?? 'Unknown'),
  position: String(p.position ?? ''),
  headshot: p.headshot ? String(p.headshot) : null,
  statValue,
  statLabel,
});

/** $7.2M, $968K, $0 — compact, because the card has one line for it. */
export function compactSalary(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/**
 * The roster's best VALUE: most fantasy points per dollar of cap.
 *
 * Expressed per MILLION rather than per dollar. Points per literal dollar is
 * 0.00026 for a good player — a number nobody can read or compare — while
 * "261 pts/$M" sorts identically and says something at a glance.
 *
 * Both guards below are load-bearing:
 *
 *  - A salary of zero or less is SKIPPED, not treated as free. A minimum- or
 *    zero-salary slot would divide to Infinity and win every week on a
 *    technicality, which is the opposite of the question being asked.
 *  - A player who has not scored is skipped too. His ratio is a true zero, so
 *    he can never win, but on a roster where nobody has played yet EVERY
 *    ratio is zero and the "best value" would be whoever the sort happened to
 *    reach first. Null is the honest answer there, and the card hides.
 *
 * Returns null when no player on the roster carries both a salary and a
 * score — which is every non-cap league, and any cap league before week one.
 */
export function bestValuePlayer(players: CandidatePlayer[]): HeaderPlayer | null {
  // `points` is whatever the CALLER puts there, and the caller owns choosing a
  // current-season figure. TheLeague's roster page carries a `points` field
  // that it rewrites with LAST season's totals during the offseason, so it
  // maps `totalSeason` in before calling this.
  let best: CandidatePlayer | null = null;
  let bestRatio = 0;
  for (const player of players ?? []) {
    const position = String(player?.position ?? '').toUpperCase();
    if (!(HEADER_PLAYER_POSITIONS as readonly string[]).includes(position)) continue;
    const salary = Number.parseFloat(String(player?.salary ?? ''));
    const points = Number.parseFloat(String(player?.points ?? ''));
    if (!Number.isFinite(salary) || salary <= 0) continue;
    if (!Number.isFinite(points) || points <= 0) continue;
    const ratio = points / (salary / 1_000_000);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = player;
    }
  }
  if (!best) return null;
  return toPlayer(best, `${Math.round(bestRatio)} pts/$M`, 'Best value');
}

/**
 * The roster's best player RELATIVE TO HIS POSITION.
 *
 * `rankOf` returns a player's 1-based rank among everyone at that position;
 * the lowest rank wins. A player the ranking does not know is skipped rather
 * than treated as rank 0 — an unranked player is unknown, not the best.
 */
export function bestPlayerByPositionRank(
  players: CandidatePlayer[],
  rankOf: (playerId: string, position: string) => number | null,
): HeaderPlayer | null {
  let best: CandidatePlayer | null = null;
  let bestRank = Infinity;
  for (const player of players ?? []) {
    const position = String(player?.position ?? '').toUpperCase();
    if (!(HEADER_PLAYER_POSITIONS as readonly string[]).includes(position)) continue;
    const rank = rankOf(String(player?.id ?? ''), position);
    if (rank == null || !Number.isFinite(rank) || rank < 1) continue;
    if (rank < bestRank) {
      bestRank = rank;
      best = player;
    }
  }
  if (!best) return null;
  const position = String(best.position ?? '').toUpperCase();
  return toPlayer(best, `${position}${bestRank}`, 'Best at position');
}

/**
 * Positional ranks over a whole player pool, by a numeric score.
 *
 * Ranked across the POOL rather than across rostered players, deliberately:
 * an AFL player is routinely rostered in both conferences, so ranking the
 * rostered set would count the same player twice and shift everyone below him.
 */
export function positionalRanks(
  pool: Array<{ id: string; position: string; score: number }>,
): Map<string, number> {
  const byPosition = new Map<string, Array<{ id: string; score: number }>>();
  for (const entry of pool) {
    const position = String(entry.position ?? '').toUpperCase();
    if (!(HEADER_PLAYER_POSITIONS as readonly string[]).includes(position)) continue;
    if (!Number.isFinite(entry.score)) continue;
    (byPosition.get(position) ?? byPosition.set(position, []).get(position)!).push({
      id: String(entry.id),
      score: entry.score,
    });
  }
  const ranks = new Map<string, number>();
  for (const [, entries] of byPosition) {
    entries.sort((a, b) => b.score - a.score);
    entries.forEach((entry, index) => ranks.set(entry.id, index + 1));
  }
  return ranks;
}
