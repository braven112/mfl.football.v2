/**
 * Standings board story data: a frozen, invented 6-week season for TheLeague's
 * 16 clubs and the AFL's 24, built inline so a story never depends on a
 * cron-written feed. Identities (names,
 * crests) come from each league's hand-kept config.
 */
import theleagueConfig from '../../src/data/theleague.config.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';
import type { DivisionStandings, TeamStanding } from '../../src/types/standings';

interface ConfigTeam {
  franchiseId: string;
  name: string;
  icon?: string;
  division?: string;
  nameMedium?: string;
  nameShort?: string;
}

const GAMES = 6;
const WEEKS_ALL_PLAY = (teams: number) => GAMES * (teams - 1);

/** One MFL standings row: `wins` decides the record, `rank` the points and all-play. */
function row(team: ConfigTeam, wins: number, rank: number, total: number): TeamStanding {
  const losses = GAMES - wins;
  const apGames = WEEKS_ALL_PLAY(total);
  const apWins = Math.round(apGames * (1 - rank / (total + 1)));
  const pf = (720 - rank * 17.3).toFixed(1);
  return {
    id: team.franchiseId,
    fname: team.name,
    teamName: team.name,
    teamIcon: team.icon ?? '',
    teamBanner: '',
    division: team.division ?? '',
    divwlt: `${Math.min(wins, 3)}-${Math.min(losses, 3)}-0`,
    divpct: '',
    divw: '',
    divl: '',
    divt: '0',
    h2hwlt: `${wins}-${losses}-0`,
    h2hpct: (wins / GAMES).toFixed(3),
    h2hw: String(wins),
    h2hl: String(losses),
    h2ht: '0',
    nondivwlt: '',
    nondivpct: '',
    nondivw: '',
    nondivl: '',
    nondivt: '0',
    all_play_wlt: `${apWins}-${apGames - apWins}-0`,
    all_play_pct: (apWins / apGames).toFixed(3),
    pf,
    pa: (640 - rank * 3.1).toFixed(1),
    pwr: (60 - rank * 1.9).toFixed(2),
    pp: '0',
    strk: rank % 3 === 0 ? 'L1' : `W${(rank % 4) + 1}`,
  } as TeamStanding;
}

// Records by finishing position: the order every list below is already in.
const RECORDS = [6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 3, 2, 4, 1, 2, 3];

// ---------------------------------------------------------------------------
// TheLeague: four divisions of four, one league-wide seed ladder (4 + 3 + 2).
// ---------------------------------------------------------------------------
export const theleagueTeams = theleagueConfig.teams as ConfigTeam[];
const tlRows = theleagueTeams.map((t, i) => row(t, RECORDS[i], i + 1, theleagueTeams.length));

/** Each division's rows in finishing order. */
export const theleagueDivisions: DivisionStandings[] = [...new Set(theleagueTeams.map((t) => t.division!))].map(
  (name) => ({ name, teams: tlRows.filter((r) => r.division === name) })
);

/** Seeds: each division's leader 1-4, then everyone else in finishing order. */
const leaders = theleagueDivisions.map((d) => d.teams[0]);
const rest = tlRows.filter((r) => !leaders.includes(r));
export const theleagueLeague: TeamStanding[] = [...leaders, ...rest].map((t, i) => ({ ...t, seed: i + 1 }));
export const theleagueAllPlay: TeamStanding[] = tlRows;

// ---------------------------------------------------------------------------
// The AFL: two conferences of two divisions; per-conference seeds; two tiers.
// ---------------------------------------------------------------------------
export const aflTeams = (aflConfig as { teams: ConfigTeam[] }).teams;
const divisionToConference = (aflConfig as { divisionToConference: Record<string, string> }).divisionToConference;
const aflRows = aflTeams.map((t, i) => row(t, RECORDS[i], i + 1, aflTeams.length));

export const aflDivisions: DivisionStandings[] = [...new Set(aflTeams.map((t) => t.division!))].map((name) => ({
  name,
  teams: aflRows.filter((r) => r.division === name),
}));

export const aflConferences = ['00', '01'].map((id) => {
  const divisions = aflDivisions.filter((d) => divisionToConference[d.name] === id);
  const winners = divisions.map((d) => d.teams[0]);
  const others = aflRows.filter((r) => divisionToConference[r.division] === id && !winners.includes(r));
  const teams = [...winners, ...others].map((t, i) => ({ ...t, conferenceSeed: i + 1 }));
  return { id, name: id === '00' ? 'American League' : 'National League', teams, divisionWinners: winners.length };
});

const seedOf = new Map(aflConferences.flatMap((c) => c.teams.map((t) => [t.id, t.conferenceSeed] as const)));
export const aflDivisionsSeeded: DivisionStandings[] = aflDivisions.map((d) => ({
  ...d,
  teams: d.teams.map((t) => ({ ...t, conferenceSeed: seedOf.get(t.id) })),
}));

/** All-play tiers: the top half is the Premier League, the rest the D-League. */
export const aflTiers = [
  { tier: 'Premier League', teams: aflRows.slice(0, 12) },
  { tier: 'D-League', teams: aflRows.slice(12) },
];
