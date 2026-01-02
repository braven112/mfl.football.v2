/**
 * Player Rankings Parser
 * 
 * Parses dynasty and redraft rankings from various sources:
 * - FantasyPros
 * - FootballGuys  
 * - DynastyLeagueFootball
 * - Custom tab-separated format
 * 
 * Expected format:
 * Rank	Player	Pos	Age	Exp	Bye
 * 1	Brock Bowers LV2	TE1	23	1	8
 */

export interface ParsedRanking {
  rank: number;
  playerName: string;
  nflTeam: string;
  position: string;
  age?: number;
  experience?: string;
  byeWeek?: number;
  tier?: number;
  positionRank?: number; // e.g., TE1, QB2
  matched: boolean;
  mflId?: string;
}

export interface RankingImport {
  source: 'fantasypros' | 'footballguys' | 'dynastyleaguefootball' | 'custom';
  rankingType: 'dynasty' | 'redraft';
  importDate: Date;
  rankings: ParsedRanking[];
  totalPlayers: number;
  tierCount: number;
}

/**
 * Extract player name and NFL team from formats like:
 * - "Brock Bowers LV2"
 * - "Joe Burrow CIN2"
 * - "Patrick Mahomes KC"
 */
function parsePlayerString(playerStr: string): {
  name: string;
  nflTeam: string;
  positionRank?: string;
} {
  // Pattern: "Name TEAM# POS#" or "Name TEAM POS#" or just "Name TEAM"
  const match = playerStr.match(/^(.+?)\s+([A-Z]{2,3})(\d*)(?:\s+([A-Z]+\d+))?$/);
  
  if (match) {
    return {
      name: match[1].trim(),
      nflTeam: match[2],
      positionRank: match[4],
    };
  }
  
  // Fallback: just return the whole string as name
  return {
    name: playerStr.trim(),
    nflTeam: '',
  };
}

/**
 * Extract position rank number from strings like "TE1", "QB12", "RB23"
 */
function extractPositionRank(posStr: string): {
  position: string;
  rank: number;
} | null {
  const match = posStr.match(/^([A-Z]+)(\d+)$/);
  if (match) {
    return {
      position: match[1],
      rank: parseInt(match[2], 10),
    };
  }
  return null;
}

/**
 * Parse tab-separated rankings text
 */
export function parseRankingsText(
  text: string,
  source: 'fantasypros' | 'footballguys' | 'dynastyleaguefootball' | 'custom' = 'custom',
  rankingType: 'dynasty' | 'redraft' = 'dynasty'
): RankingImport {
  const lines = text.trim().split('\n');
  const rankings: ParsedRanking[] = [];
  let currentTier = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Check for tier headers (e.g., "Tier 1", "Tier 2")
    const tierMatch = trimmed.match(/^Tier\s+(\d+)$/i);
    if (tierMatch) {
      currentTier = parseInt(tierMatch[1], 10);
      continue;
    }
    
    // Check for header row (contains "Rank" or "Player")
    if (trimmed.toLowerCase().includes('rank') && trimmed.toLowerCase().includes('player')) {
      continue;
    }
    
    // Split by tabs
    const columns = trimmed.split('\t');
    
    // Need at least: Rank, Player, Pos
    if (columns.length < 3) continue;
    
    const rank = parseInt(columns[0], 10);
    if (isNaN(rank)) continue;
    
    const playerStr = columns[1];
    const posStr = columns[2];
    const age = columns[3] ? parseInt(columns[3], 10) : undefined;
    const experience = columns[4] || undefined;
    const byeWeek = columns[5] ? parseInt(columns[5], 10) : undefined;
    
    // Parse player name and team
    const { name, nflTeam, positionRank } = parsePlayerString(playerStr);
    
    // Extract position from position column or position rank
    let position = posStr;
    let posRankNum: number | undefined;
    
    const posRankData = extractPositionRank(posStr);
    if (posRankData) {
      position = posRankData.position;
      posRankNum = posRankData.rank;
    } else if (positionRank) {
      const prData = extractPositionRank(positionRank);
      if (prData) {
        posRankNum = prData.rank;
      }
    }
    
    rankings.push({
      rank,
      playerName: name,
      nflTeam,
      position,
      age: isNaN(age!) ? undefined : age,
      experience,
      byeWeek: isNaN(byeWeek!) ? undefined : byeWeek,
      tier: currentTier || undefined,
      positionRank: posRankNum,
      matched: false,
    });
  }
  
  // Count unique tiers
  const tiers = new Set(rankings.map(r => r.tier).filter(t => t !== undefined));
  
  return {
    source,
    rankingType,
    importDate: new Date(),
    rankings,
    totalPlayers: rankings.length,
    tierCount: tiers.size,
  };
}

/**
 * Match rankings to MFL players by name
 */
export function matchRankingsToPlayers(
  rankings: ParsedRanking[],
  mflPlayers: Array<{ id: string; name: string; position: string; team: string }>
): ParsedRanking[] {
  // Build lookup map for fuzzy matching
  const playerMap = new Map<string, { id: string; position: string; team: string }>();
  
  for (const player of mflPlayers) {
    // Normalize name: lowercase, remove punctuation
    const normalized = player.name.toLowerCase().replace(/[^a-z\s]/g, '');
    playerMap.set(normalized, {
      id: player.id,
      position: player.position,
      team: player.team,
    });
  }
  
  return rankings.map(ranking => {
    const normalizedName = ranking.playerName.toLowerCase().replace(/[^a-z\s]/g, '');
    const match = playerMap.get(normalizedName);
    
    if (match) {
      // Verify position matches (if available)
      if (ranking.position && match.position !== ranking.position) {
        // Position mismatch - might be wrong player
        return ranking;
      }
      
      return {
        ...ranking,
        matched: true,
        mflId: match.id,
        // Update NFL team if it was missing
        nflTeam: ranking.nflTeam || match.team,
      };
    }
    
    return ranking;
  });
}

/**
 * Calculate composite rank from dynasty and redraft rankings
 */
export function calculateCompositeRank(
  dynastyRank: number | undefined,
  redraftRank: number | undefined,
  dynastyWeight: number = 0.6
): number | undefined {
  if (!dynastyRank && !redraftRank) return undefined;
  if (!dynastyRank) return redraftRank;
  if (!redraftRank) return dynastyRank;
  
  const redraftWeight = 1 - dynastyWeight;
  return Math.round(dynastyRank * dynastyWeight + redraftRank * redraftWeight);
}

/**
 * Merge multiple ranking sources
 */
export function mergeRankings(
  rankings: RankingImport[]
): Map<string, {
  playerId: string;
  playerName: string;
  dynastyRank?: number;
  redraftRank?: number;
  compositeRank?: number;
  position: string;
  nflTeam: string;
}> {
  const merged = new Map<string, any>();
  
  for (const rankingSet of rankings) {
    for (const ranking of rankingSet.rankings) {
      if (!ranking.matched || !ranking.mflId) continue;
      
      const existing = merged.get(ranking.mflId) || {
        playerId: ranking.mflId,
        playerName: ranking.playerName,
        position: ranking.position,
        nflTeam: ranking.nflTeam,
      };
      
      if (rankingSet.rankingType === 'dynasty') {
        existing.dynastyRank = ranking.rank;
      } else {
        existing.redraftRank = ranking.rank;
      }
      
      // Recalculate composite rank
      existing.compositeRank = calculateCompositeRank(
        existing.dynastyRank,
        existing.redraftRank
      );
      
      merged.set(ranking.mflId, existing);
    }
  }
  
  return merged;
}

/**
 * Validate rankings import
 */
export function validateRankingsImport(text: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  preview: ParsedRanking[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!text || text.trim().length === 0) {
    errors.push('Rankings text is empty');
    return { isValid: false, errors, warnings, preview: [] };
  }
  
  try {
    const result = parseRankingsText(text);
    
    if (result.rankings.length === 0) {
      errors.push('No valid rankings found in text');
      return { isValid: false, errors, warnings, preview: [] };
    }
    
    if (result.rankings.length < 10) {
      warnings.push(`Only ${result.rankings.length} players found - expected more`);
    }
    
    const unmatchedPlayers = result.rankings.filter(r => !r.playerName || r.playerName.length < 3);
    if (unmatchedPlayers.length > 0) {
      warnings.push(`${unmatchedPlayers.length} players have invalid names`);
    }
    
    // Preview first 10 rankings
    const preview = result.rankings.slice(0, 10);
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      preview,
    };
  } catch (error) {
    errors.push(`Failed to parse rankings: ${error}`);
    return { isValid: false, errors, warnings, preview: [] };
  }
}
