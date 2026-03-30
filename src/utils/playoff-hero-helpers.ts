/**
 * Playoff Hero Helpers
 *
 * Utilities for building the compact bracket summary used by PlayoffBracketHero.
 * Deliberately thin — translates normalized bracket data into the hero-friendly shape.
 */

import type { NormalizedBracket, NormalizedGame, SeedMaps, SeededTeam } from './playoffs';
import type { PlayoffBracketSummaryGame } from '../types/hero-state';

type BracketRef = NormalizedGame['home'];

/**
 * Determine if a franchise has been eliminated from the championship bracket.
 * A team is eliminated if they appeared in a completed game and lost.
 */
export function isEliminated(franchiseId: string, bracket: NormalizedBracket): boolean {
  // First, resolve which franchise IDs appear in which games
  const gameResults = new Map<string, { winnerId?: string; loserId?: string }>();

  for (const round of bracket.rounds) {
    for (const game of round.games) {
      const homeId = game.home.franchise_id;
      const awayId = game.away.franchise_id;
      const homePoints = typeof game.home.points === 'string' ? parseFloat(game.home.points) : game.home.points;
      const awayPoints = typeof game.away.points === 'string' ? parseFloat(game.away.points) : game.away.points;

      if (homeId && awayId && homePoints != null && awayPoints != null && !isNaN(homePoints) && !isNaN(awayPoints)) {
        const winnerId = homePoints >= awayPoints ? homeId : awayId;
        const loserId = homePoints >= awayPoints ? awayId : homeId;
        gameResults.set(game.id, { winnerId, loserId });
      }
    }
  }

  // Check if franchiseId lost any completed game
  for (const result of gameResults.values()) {
    if (result.loserId === franchiseId) return true;
  }
  return false;
}

/** Resolve a bracket ref (seed, winner_of_game, etc.) to a team's display info */
function resolveRef(
  ref: BracketRef,
  seedMap: Map<number, SeededTeam>,
  _gameResults: Map<string, { winnerId?: string; loserId?: string }>,
  allTeamsMap: Map<string, { name: string; icon?: string }>,
): { franchiseId?: string; seed?: number; displayName: string; icon?: string } {
  // Direct seed reference
  if (ref.seed != null) {
    const team = seedMap.get(ref.seed);
    if (team) {
      return {
        franchiseId: team.id,
        seed: ref.seed,
        displayName: team.displayName,
        icon: team.icon,
      };
    }
    return { seed: ref.seed, displayName: `Seed ${ref.seed}` };
  }

  // Winner/loser of a previous game
  const gameRef = ref.winner_of_game || ref.loser_of_game;
  if (gameRef) {
    const result = _gameResults.get(gameRef);
    const resolvedId = ref.winner_of_game ? result?.winnerId : result?.loserId;
    if (resolvedId) {
      // Look up team display info
      const teamInfo = allTeamsMap.get(resolvedId);
      // Find seed for this team
      let seed: number | undefined;
      for (const [s, t] of seedMap) {
        if (t.id === resolvedId) { seed = s; break; }
      }
      return {
        franchiseId: resolvedId,
        seed,
        displayName: teamInfo?.name ?? resolvedId,
        icon: teamInfo?.icon,
      };
    }
    // Game not yet played — show placeholder
    const prefix = ref.winner_of_game ? 'Winner' : 'Loser';
    return { displayName: `${prefix} of Game ${gameRef}` };
  }

  // Direct franchise_id
  if (ref.franchise_id) {
    const teamInfo = allTeamsMap.get(ref.franchise_id);
    return {
      franchiseId: ref.franchise_id,
      displayName: teamInfo?.name ?? ref.franchise_id,
      icon: teamInfo?.icon,
    };
  }

  return { displayName: 'TBD' };
}

/**
 * Build a compact bracket summary for the playoff hero.
 * Only processes the championship bracket — returns a flat array of games with resolved team info.
 */
export function buildBracketSummary(
  bracket: NormalizedBracket,
  seedMaps: SeedMaps,
  allTeamsMap: Map<string, { name: string; icon?: string }>,
): PlayoffBracketSummaryGame[] {
  const { championshipSeeds } = seedMaps;
  const games: PlayoffBracketSummaryGame[] = [];

  // Build game results map for resolving winner_of_game refs
  const gameResults = new Map<string, { winnerId?: string; loserId?: string }>();
  for (const round of bracket.rounds) {
    for (const game of round.games) {
      const homeId = game.home.franchise_id;
      const awayId = game.away.franchise_id;
      const homePoints = typeof game.home.points === 'string' ? parseFloat(game.home.points) : game.home.points;
      const awayPoints = typeof game.away.points === 'string' ? parseFloat(game.away.points) : game.away.points;

      if (homeId && awayId && homePoints != null && awayPoints != null && !isNaN(homePoints) && !isNaN(awayPoints)) {
        gameResults.set(game.id, {
          winnerId: homePoints >= awayPoints ? homeId : awayId,
          loserId: homePoints >= awayPoints ? awayId : homeId,
        });
      }
    }
  }

  for (const round of bracket.rounds) {
    for (const game of round.games) {
      const home = resolveRef(game.home, championshipSeeds, gameResults, allTeamsMap);
      const away = resolveRef(game.away, championshipSeeds, gameResults, allTeamsMap);

      const homePoints = typeof game.home.points === 'string' ? parseFloat(game.home.points) : game.home.points;
      const awayPoints = typeof game.away.points === 'string' ? parseFloat(game.away.points) : game.away.points;
      const hasScores = homePoints != null && awayPoints != null && !isNaN(homePoints as number) && !isNaN(awayPoints as number);

      games.push({
        gameId: game.id,
        roundWeek: round.week,
        home: { ...home, points: hasScores ? (homePoints as number) : undefined },
        away: { ...away, points: hasScores ? (awayPoints as number) : undefined },
        isComplete: hasScores && (homePoints as number) > 0 && (awayPoints as number) > 0,
      });
    }
  }

  return games;
}
