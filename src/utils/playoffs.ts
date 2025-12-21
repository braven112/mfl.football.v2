/**
 * Playoff utilities for fetching and normalizing MFL playoff brackets and scores
 */

import type { TeamStanding } from '../types/standings';
import { chooseTeamName } from './team-names';

const DEFAULT_HOST =
  (import.meta.env.PUBLIC_MFL_HOST as string | undefined) ||
  'https://www49.myfantasyleague.com';
const DEFAULT_LEAGUE_ID =
  (import.meta.env.PUBLIC_MFL_LEAGUE_ID as string | undefined) || '13522';

const trimHost = (host: string) => host.replace(/\/+$/, '');

const buildMflUrl = (
  year: number | string,
  type: string,
  params: Record<string, string | number | undefined>,
  host = DEFAULT_HOST
) => {
  const { L, ...rest } = params;
  const query = new URLSearchParams({
    TYPE: type,
    L: String(L ?? DEFAULT_LEAGUE_ID),
    JSON: '1',
    ...Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    ),
  });

  return `${trimHost(host)}/${year}/export?${query.toString()}`;
};

type BracketRef = {
  seed?: number;
  franchise_id?: string;
  winner_of_game?: string;
  loser_of_game?: string;
  bracket?: string;
  points?: string | number;
};

export type NormalizedGame = {
  id: string;
  home: BracketRef;
  away: BracketRef;
};

export type NormalizedRound = {
  week: number;
  games: NormalizedGame[];
};

export type NormalizedBracket = {
  id: string;
  name?: string;
  startWeek?: number;
  teamsInvolved?: number;
  rounds: NormalizedRound[];
};

export type WeeklyScoreboard = {
  week: number;
  scores: Map<string, number>;
};

export type LiveScoreboard = {
  week: number;
  scores: Map<
    string,
    {
      score: number;
      gameSecondsRemaining: number;
    }
  >;
};

export type SeededTeam = TeamStanding & {
  bracketSeed: number;
  originalSeed: number;
  record: string;
  icon?: string;
  banner?: string;
  displayName: string;
};

export type SeedMaps = {
  championshipSeeds: Map<number, SeededTeam>;
  playInSeeds: Map<number, SeededTeam>;
  toiletSeeds: Map<number, SeededTeam>;
};

const toNumber = (value: unknown) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const normalizeRef = (ref: any = {}): BracketRef => ({
  seed: toNumber(ref.seed),
  franchise_id: ref.franchise_id || ref.franchiseId,
  winner_of_game: ref.winner_of_game || ref.winnerOfGame,
  loser_of_game: ref.loser_of_game || ref.loserOfGame,
  bracket: ref.bracket,
  points: ref.points,
});

const normalizeGames = (round: any): NormalizedGame[] => {
  const rawGames = round?.playoffGame
    ? Array.isArray(round.playoffGame)
      ? round.playoffGame
      : [round.playoffGame]
    : [];

  return rawGames
    .map(game => ({
      id: String(game.game_id || game.gameId || game.gameid || game.id || ''),
      home: normalizeRef(game.home),
      away: normalizeRef(game.away),
    }))
    .filter(game => game.id);
};

export function normalizePlayoffBracket(
  bracket: any,
  meta?: { id?: string; name?: string; startWeek?: number; teamsInvolved?: number }
): NormalizedBracket | null {
  const raw = bracket?.playoffBracket || bracket;
  const roundData = raw?.playoffRound;
  if (!roundData) return null;

  const roundsArray = Array.isArray(roundData) ? roundData : [roundData];
  const rounds = roundsArray
    .map(round => ({
      week: toNumber(round.week) || 0,
      games: normalizeGames(round),
    }))
    .filter(round => round.games.length > 0);

  if (rounds.length === 0) return null;

  return {
    id: String(meta?.id || raw.bracket_id || raw.id || ''),
    name: meta?.name || raw.name,
    startWeek: meta?.startWeek || toNumber(raw.startWeek) || rounds[0].week,
    teamsInvolved: meta?.teamsInvolved || toNumber(raw.teamsInvolved),
    rounds,
  };
}

export async function fetchPlayoffBrackets(
  year: number,
  leagueId = DEFAULT_LEAGUE_ID,
  host = DEFAULT_HOST
) {
  const url = buildMflUrl(year, 'playoffBrackets', { L: leagueId }, host);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch playoffBrackets: ${response.status}`);
  }
  const data = await response.json();
  const list = data?.playoffBrackets?.playoffBracket;
  const brackets = Array.isArray(list) ? list : list ? [list] : [];

  return brackets.map((item: any) => ({
    id: String(item.id),
    name: item.name,
    startWeek: toNumber(item.startWeek),
    teamsInvolved: toNumber(item.teamsInvolved),
  }));
}

export async function fetchPlayoffBracket(
  year: number,
  bracketId: string,
  leagueId = DEFAULT_LEAGUE_ID,
  host = DEFAULT_HOST
) {
  const url = buildMflUrl(year, 'playoffBracket', { L: leagueId, BRACKET_ID: bracketId }, host);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch playoffBracket ${bracketId}: ${response.status}`);
  }
  return response.json();
}

export async function fetchWeeklyResults(
  year: number,
  week: number,
  leagueId = DEFAULT_LEAGUE_ID,
  host = DEFAULT_HOST
): Promise<WeeklyScoreboard | null> {
  const url = buildMflUrl(year, 'weeklyResults', { L: leagueId, W: week }, host);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  const results = data?.weeklyResults;
  const matchups = results?.matchup
    ? Array.isArray(results.matchup)
      ? results.matchup
      : [results.matchup]
    : [];

  const scores = new Map<string, number>();
  matchups.forEach((matchup: any) => {
    const franchises = matchup?.franchise
      ? Array.isArray(matchup.franchise)
        ? matchup.franchise
        : [matchup.franchise]
      : [];
    franchises.forEach((team: any) => {
      if (!team?.id) return;
      scores.set(String(team.id), Number(team.score) || 0);
    });
  });

  return {
    week: toNumber(results?.week) || week,
    scores,
  };
}

export async function fetchLiveScoring(
  year: number,
  week: number,
  leagueId = DEFAULT_LEAGUE_ID,
  host = DEFAULT_HOST
): Promise<LiveScoreboard | null> {
  const url = buildMflUrl(year, 'liveScoring', { L: leagueId, W: week }, host);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return null;

  const data = await response.json();
  const franchises = data?.liveScoring?.franchise
    ? Array.isArray(data.liveScoring.franchise)
      ? data.liveScoring.franchise
      : [data.liveScoring.franchise]
    : [];

  const scores = new Map<
    string,
    {
      score: number;
      gameSecondsRemaining: number;
    }
  >();

  franchises.forEach((team: any) => {
    if (!team?.id) return;
    scores.set(String(team.id), {
      score: Number(team.score) || 0,
      gameSecondsRemaining: Number(team.gameSecondsRemaining) || 0,
    });
  });

  return {
    week: toNumber(data?.liveScoring?.week) || week,
    scores,
  };
}

export const formatRecord = (record: string | undefined) => {
  if (!record) return '';
  const [wins = '0', losses = '0', ties = '0'] = record.split('-');
  const tieSegment = ties && ties !== '0' ? `-${ties}` : '';
  return `${wins}-${losses}${tieSegment}`;
};

export const buildSeedMaps = (
  leagueStandings: TeamStanding[],
  assetMap: Map<
    string,
    {
      icon?: string;
      banner?: string;
      aliases?: string[];
      name?: string;
    }
  >
): SeedMaps => {
  const seededTeams: SeededTeam[] = leagueStandings
    .filter(team => team.seed)
    .map(team => ({
      ...team,
      bracketSeed: team.seed || 0,
      originalSeed: team.seed || 0,
      record: formatRecord(team.h2hwlt),
      icon: assetMap.get(team.id)?.icon || '',
      banner: assetMap.get(team.id)?.banner || '',
      displayName: chooseTeamName([
        team.teamName,
        assetMap.get(team.id)?.name || '',
        ...(assetMap.get(team.id)?.aliases || []),
      ]),
    }));

  const championshipSeeds = new Map(
    seededTeams
      .filter(team => team.seed && team.seed <= 7)
      .map(team => [team.bracketSeed, team])
  );

  const playInSeeds = new Map(
    seededTeams
      .filter(team => team.seed && team.seed >= 8 && team.seed <= 9)
      .map(team => [team.bracketSeed, team])
  );

  const toiletSeedsRaw = seededTeams.filter(team => team.seed && team.seed >= 10);
  const toiletSeeds = new Map<number, SeededTeam>();
  const toiletSorted = [...toiletSeedsRaw].sort((a, b) => (b.seed || 0) - (a.seed || 0));
  toiletSorted.forEach((team, idx) => {
    toiletSeeds.set(idx + 1, {
      ...team,
      bracketSeed: idx + 1,
    });
  });

  return {
    championshipSeeds,
    playInSeeds,
    toiletSeeds,
  };
};
