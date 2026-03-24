/**
 * Free Agent Needs Analysis
 *
 * Evaluates a team's roster against projected scores to identify positional
 * gaps and recommend top available free agents.
 *
 * Need thresholds (ranked by projected points across ALL players):
 * - QB, TE, DEF, PK: team needs 1 player in the top 8 at the position
 * - WR, RB: team needs 2 players in the top 16 at the position
 *
 * Designed to be reusable for the Auction Price Predictor.
 */

export interface FreeAgentPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string;
  projectedScore: number;
  /** Headshot URL, set post-analysis by the page that has access to ESPN IDs */
  headshot?: string;
  /** Unix timestamp (seconds), set post-analysis from MFL player feed */
  birthdate?: number | null;
}

export interface PositionNeed {
  position: string;
  topFreeAgents: FreeAgentPlayer[];
}

interface NeedThreshold {
  topN: number;
  minRequired: number;
}

const POSITION_THRESHOLDS: Record<string, NeedThreshold> = {
  QB: { topN: 8, minRequired: 1 },
  TE: { topN: 8, minRequired: 1 },
  DEF: { topN: 8, minRequired: 1 },
  PK: { topN: 8, minRequired: 1 },
  WR: { topN: 16, minRequired: 2 },
  RB: { topN: 16, minRequired: 2 },
};

/** Canonical position display order */
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

const FA_LIST_SIZE = 5;

/**
 * Normalize MFL position strings to uppercase canonical form.
 */
function normalizePosition(pos: string): string {
  if (!pos) return '';
  const upper = pos.toUpperCase();
  return upper === 'DEF' || pos === 'Def' ? 'DEF' : upper;
}

/**
 * Format an MFL player name from "Last, First" to "First Last".
 */
function formatPlayerName(mflName: string): string {
  const parts = mflName.split(', ');
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : mflName;
}

/**
 * Analyze a team's roster to identify positional needs and top free agents.
 *
 * @param franchiseId - The team to evaluate
 * @param projectedScores - MFL projected scores array (id + score)
 * @param playersFeed - All players keyed by ID (id, name, position, team)
 * @param rosterAssignments - Maps player ID → { franchiseId } for rostered players
 * @returns Array of PositionNeed for positions where the team has gaps
 */
export function analyzeFreeAgentNeeds(
  franchiseId: string,
  projectedScores: Array<{ id: string; score: string }>,
  playersFeed: Record<string, { id: string; name: string; position: string; team?: string }>,
  rosterAssignments: Record<string, { franchiseId: string }>,
): PositionNeed[] {
  // Build projected score lookup
  const scoreMap = new Map<string, number>();
  if (Array.isArray(projectedScores)) {
    for (const entry of projectedScores) {
      if (entry?.id && entry?.score) {
        const score = parseFloat(entry.score);
        if (score > 0) scoreMap.set(entry.id, score);
      }
    }
  }

  // Group ALL players by position with their projected scores
  const playersByPosition = new Map<string, Array<{ id: string; name: string; nflTeam: string; score: number; franchiseId: string | null }>>();

  for (const [playerId, player] of Object.entries(playersFeed)) {
    if (!player?.position) continue;
    const pos = normalizePosition(player.position);
    if (!POSITION_THRESHOLDS[pos]) continue;

    const score = scoreMap.get(playerId) ?? 0;
    if (score <= 0) continue;

    const roster = rosterAssignments[playerId];

    if (!playersByPosition.has(pos)) {
      playersByPosition.set(pos, []);
    }
    playersByPosition.get(pos)!.push({
      id: playerId,
      name: player.name,
      nflTeam: player.team ?? '',
      score,
      franchiseId: roster?.franchiseId ?? null,
    });
  }

  // Sort each position group by score descending
  for (const players of playersByPosition.values()) {
    players.sort((a, b) => b.score - a.score);
  }

  // Evaluate needs for each position
  const needs: PositionNeed[] = [];

  for (const pos of POSITION_ORDER) {
    const threshold = POSITION_THRESHOLDS[pos];
    if (!threshold) continue;

    const allPlayers = playersByPosition.get(pos) ?? [];
    const topPlayers = allPlayers.slice(0, threshold.topN);

    // Count how many of the team's players are in the top N
    const teamInTopN = topPlayers.filter((p) => p.franchiseId === franchiseId).length;

    if (teamInTopN >= threshold.minRequired) continue;

    // Team has a need — collect top 5 free agents at this position
    const freeAgents = allPlayers
      .filter((p) => p.franchiseId === null)
      .slice(0, FA_LIST_SIZE)
      .map((p) => ({
        id: p.id,
        name: formatPlayerName(p.name),
        position: pos,
        nflTeam: p.nflTeam,
        projectedScore: p.score,
      }));

    if (freeAgents.length > 0) {
      needs.push({ position: pos, topFreeAgents: freeAgents });
    }
  }

  return needs;
}
