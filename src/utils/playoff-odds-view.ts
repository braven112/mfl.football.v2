/**
 * Which playoff-odds file a page shows: the newest week of the newest season
 * (scripts/compute-playoff-odds.mjs names them playoff-odds-<year>-w<NN>.json,
 * so a plain sort is chronological). Shared by the Playoff Odds page and the
 * standings Playoff tab, so both always print the same numbers.
 */
import type { PlayoffRace } from '../types/schefter';
import { oddsGamesByPair, raceBoard } from './matchup-preview-visuals.mjs';

export interface PlayoffOddsSide {
  franchiseId: string;
  playoff: number;
  bye: number;
  winChance?: number;
  win: { playoff: number; bye: number };
  loss: { playoff: number; bye: number };
}

export interface PlayoffOddsFile {
  league: string;
  year: number;
  completedWeek: number;
  week: number;
  lastWeek: number;
  iterations: number;
  /** Conference id → name (empty for a league without conferences). */
  conferenceNames?: Record<string, string>;
  format: { groupBy?: 'league' | 'conference'; byes?: number; rankBy?: 'pct' | 'vp' };
  teams: Array<{
    franchiseId: string;
    division: string;
    conference: string;
    wins: number;
    losses: number;
    ties: number;
    pf: number;
    playoff: number;
    bye: number;
  }>;
  games: Array<{ week: number; a: PlayoffOddsSide; b: PlayoffOddsSide; stakes: { kind: 'playoff' | 'bye'; swing: number } }>;
}

export async function loadLatestPlayoffOdds(
  files: Record<string, () => Promise<PlayoffOddsFile>>,
): Promise<PlayoffOddsFile | null> {
  const keys = Object.keys(files).sort();
  const latest = keys[keys.length - 1];
  if (!latest) return null;
  try {
    return (await files[latest]()) ?? null;
  } catch {
    return null;
  }
}

/** One full board per seeding group (the whole league, or each conference). */
export function playoffOddsBoards(odds: PlayoffOddsFile): Array<{ group: string; label: string; race: PlayoffRace }> {
  const games = oddsGamesByPair(odds);
  const byConference = odds.format?.groupBy === 'conference';
  const groups = byConference ? [...new Set(odds.teams.map((t) => t.conference))].sort() : [''];
  return groups.map((group) => ({
    group,
    label: odds.conferenceNames?.[group] ?? group,
    race: raceBoard(odds, games, new Map(), {
      full: true,
      teams: byConference ? new Set(odds.teams.filter((t) => t.conference === group).map((t) => t.franchiseId)) : null,
    }) as PlayoffRace,
  }));
}

/** franchiseId → that team's odds, for a table column. */
export function playoffOddsByTeam(odds: PlayoffOddsFile | null): Map<string, { playoff: number; bye: number }> {
  return new Map((odds?.teams ?? []).map((t) => [t.franchiseId, { playoff: t.playoff, bye: t.bye }]));
}

/** How a share prints: whole percents, with the two ends spelled honestly. */
export function formatOdds(x: number | null | undefined): string {
  if (x == null) return '–';
  if (x >= 0.995 && x < 1) return '>99%';
  if (x > 0 && x < 0.005) return '<1%';
  return `${Math.round(x * 100)}%`;
}
