/**
 * The team list a ballot is built from — shared by the Owners' Poll page and
 * the homepage pop-up, so both show an owner the same numbers.
 *
 * Teams are ordered ALPHABETICALLY, never by the Pecking Order composite. The
 * column already published the machine's ranking, and re-sorting the ballot by
 * it would anchor every owner to that order — which is precisely the thing the
 * poll exists to disagree with. Record, points for and all-play are shown as
 * neutral context; the composite rank is deliberately absent.
 */
import { getLeagueTeamBrands } from './league-team-brands';
import type { BallotTeam } from '../components/shared/owners-poll/BallotBuilder';

/** The slice of a Pecking Order issue's standings row a ballot card reads. */
export interface BallotStandingsRow {
  franchiseId: string;
  wins?: number;
  losses?: number;
  ties?: number;
  ppg?: number;
  pf?: number;
  allPlayWLT?: string;
}

/**
 * Every franchise's standings row from the NEWEST issue in a list. The issue
 * files nest teams under divisions; a list with no issues yields [] and the
 * cards simply lose their stats line.
 */
export function newestIssueStandings(
  issues: Array<{ year: number; week: number; standings?: any }>,
): BallotStandingsRow[] {
  const newest = [...issues].sort((a, b) => b.year - a.year || b.week - a.week)[0];
  return (newest?.standings?.divisions ?? []).flatMap(
    (division: { teams?: BallotStandingsRow[] }) => division.teams ?? [],
  );
}

export function buildBallotTeams(leagueSlug: string, standings: BallotStandingsRow[]): BallotTeam[] {
  const byFranchise = new Map(standings.map((row) => [row.franchiseId, row]));
  return Object.values(getLeagueTeamBrands(leagueSlug))
    .map((brand) => {
      const row = byFranchise.get(brand.franchiseId);
      const wins = row?.wins;
      const losses = row?.losses;
      const ties = row?.ties;
      return {
        ...brand,
        record:
          wins != null && losses != null ? `${wins}-${losses}${ties ? `-${ties}` : ''}` : null,
        ppg: row?.ppg ?? null,
        pf: row?.pf ?? null,
        // "48-12-0" → "48-12": a zero tie column is noise on a phone-width row.
        allPlay: row?.allPlayWLT ? row.allPlayWLT.replace(/-0$/, '') : null,
      };
    })
    .sort((a, b) => a.nameShort.localeCompare(b.nameShort));
}
