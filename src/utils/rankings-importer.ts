/**
 * Rankings Importer
 * 
 * Imports player rankings from external sources (FantasyPros, DLF, FootballGuys, etc.)
 * and matches them to MFL player IDs using fuzzy matching algorithms.
 * 
 * Supports formats:
 * - Tab-separated (copy/paste from websites)
 * - CSV
 * - JSON
 */

import type { PlayerRankingImport } from '../types/auction-predictor';

// =============================================================================
// NAME NORMALIZATION & MATCHING
// =============================================================================

/**
 * Normalize player name for matching
 * - Remove punctuation, Jr/Sr/III, etc.
 * - Lowercase
 * - Handle common variations
 */
export function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '') // Remove periods
    .replace(/'/g, '') // Remove apostrophes
    .replace(/\s+jr\.?$/i, '') // Remove Jr
    .replace(/\s+sr\.?$/i, '') // Remove Sr
    .replace(/\s+iii$/i, '') // Remove III
    .replace(/\s+ii$/i, '') // Remove II
    .replace(/\s+iv$/i, '') // Remove IV
    .replace(/\s+v$/i, '') // Remove V
    .replace(/[^\w\s]/g, '') // Remove other punctuation
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching player names
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate similarity score between two names (0-1, higher is better)
 */
function calculateSimilarity(name1: string, name2: string): number {
  const norm1 = normalizePlayerName(name1);
  const norm2 = normalizePlayerName(name2);
  
  // Exact match
  if (norm1 === norm2) {
    return 1.0;
  }
  
  // Levenshtein-based similarity
  const maxLen = Math.max(norm1.length, norm2.length);
  const distance = levenshteinDistance(norm1, norm2);
  const similarity = 1 - (distance / maxLen);
  
  return similarity;
}

/**
 * Match ranking name to MFL player
 */
interface MFLPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
}

interface RankingMatch {
  playerId: string | null;
  confidence: number; // 0-1
  matched: boolean;
  alternatives?: Array<{
    playerId: string;
    name: string;
    confidence: number;
  }>;
}

export function matchPlayerToMFL(
  rankingName: string,
  rankingPosition: string,
  mflPlayers: MFLPlayer[],
  threshold: number = 0.7
): RankingMatch {
  // Filter to same position
  const positionPlayers = mflPlayers.filter(p => p.position === rankingPosition);
  
  if (positionPlayers.length === 0) {
    return { playerId: null, confidence: 0, matched: false };
  }
  
  // Calculate similarity scores
  const scores = positionPlayers.map(player => ({
    playerId: player.id,
    name: player.name,
    confidence: calculateSimilarity(rankingName, player.name),
  }));
  
  // Sort by confidence descending
  scores.sort((a, b) => b.confidence - a.confidence);
  
  const bestMatch = scores[0];
  const alternatives = scores.slice(1, 4); // Top 3 alternatives
  
  if (bestMatch.confidence >= threshold) {
    return {
      playerId: bestMatch.playerId,
      confidence: bestMatch.confidence,
      matched: true,
      alternatives: alternatives.filter(alt => alt.confidence >= 0.5),
    };
  } else {
    return {
      playerId: null,
      confidence: bestMatch.confidence,
      matched: false,
      alternatives: alternatives.filter(alt => alt.confidence >= 0.5),
    };
  }
}

// =============================================================================
// PARSING FUNCTIONS
// =============================================================================

interface ParsedRanking {
  rank: number;
  playerName: string;
  position: string;
  team: string;
  tier?: number;
  notes?: string;
}

/**
 * Parse tab-separated rankings
 * Expected format: Rank \t Player \t Team \t Position \t Tier (optional)
 * Or: Player \t Position \t Team (rank inferred from order)
 */
export function parseTabSeparated(text: string): ParsedRanking[] {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const rankings: ParsedRanking[] = [];
  
  lines.forEach((line, index) => {
    const fields = line.split('\t').map(f => f.trim());
    
    if (fields.length < 2) {
      return; // Skip invalid lines
    }
    
    let rank: number;
    let playerName: string;
    let position: string;
    let team: string;
    let tier: number | undefined;
    
    // Try to detect format
    const firstField = fields[0];
    const isRankFirst = /^\d+$/.test(firstField);
    
    if (isRankFirst && fields.length >= 4) {
      // Format: Rank | Player | Team | Position | Tier?
      rank = parseInt(firstField);
      playerName = fields[1];
      team = fields[2];
      position = fields[3];
      tier = fields[4] ? parseInt(fields[4]) : undefined;
    } else if (isRankFirst && fields.length >= 3) {
      // Format: Rank | Player | Position | Team?
      rank = parseInt(firstField);
      playerName = fields[1];
      position = fields[2];
      team = fields[3] || '';
    } else if (fields.length >= 3) {
      // Format: Player | Position | Team (rank from order)
      rank = index + 1;
      playerName = fields[0];
      position = fields[1];
      team = fields[2];
    } else {
      // Format: Player | Position (rank from order)
      rank = index + 1;
      playerName = fields[0];
      position = fields[1] || '';
      team = '';
    }
    
    // Normalize position
    position = normalizePosition(position);
    
    if (playerName && position) {
      rankings.push({
        rank,
        playerName,
        position,
        team,
        tier,
      });
    }
  });
  
  return rankings;
}

/**
 * Parse CSV rankings
 */
export function parseCSV(text: string): ParsedRanking[] {
  // Simple CSV parser (doesn't handle quoted fields with commas)
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const rankings: ParsedRanking[] = [];
  
  // Skip header row if present
  const startIndex = lines[0].toLowerCase().includes('rank') || lines[0].toLowerCase().includes('player') ? 1 : 0;
  
  for (let i = startIndex; i < lines.length; i++) {
    const fields = lines[i].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
    
    if (fields.length < 2) continue;
    
    const firstField = fields[0];
    const isRankFirst = /^\d+$/.test(firstField);
    
    let rank: number;
    let playerName: string;
    let position: string;
    let team: string;
    
    if (isRankFirst && fields.length >= 4) {
      rank = parseInt(firstField);
      playerName = fields[1];
      position = fields[2];
      team = fields[3];
    } else if (fields.length >= 3) {
      rank = i - startIndex + 1;
      playerName = fields[0];
      position = fields[1];
      team = fields[2];
    } else {
      rank = i - startIndex + 1;
      playerName = fields[0];
      position = fields[1] || '';
      team = '';
    }
    
    position = normalizePosition(position);
    
    if (playerName && position) {
      rankings.push({ rank, playerName, position, team });
    }
  }
  
  return rankings;
}

/**
 * Parse JSON rankings
 * Expected format: Array<{ rank, name, position, team }>
 */
export function parseJSON(text: string): ParsedRanking[] {
  try {
    const data = JSON.parse(text);
    
    if (!Array.isArray(data)) {
      throw new Error('JSON must be an array');
    }
    
    return data.map((item, index) => ({
      rank: item.rank || index + 1,
      playerName: item.name || item.playerName || item.player,
      position: normalizePosition(item.position || item.pos || ''),
      team: item.team || '',
      tier: item.tier,
      notes: item.notes,
    }));
  } catch (error) {
    console.error('Failed to parse JSON:', error);
    return [];
  }
}

/**
 * Normalize position abbreviations
 */
function normalizePosition(pos: string): string {
  const normalized = pos.toUpperCase().trim();
  
  // Map common variations
  const positionMap: Record<string, string> = {
    'QB': 'QB',
    'QUARTERBACK': 'QB',
    'RB': 'RB',
    'HB': 'RB',
    'RUNNING BACK': 'RB',
    'RUNNINGBACK': 'RB',
    'WR': 'WR',
    'WIDE RECEIVER': 'WR',
    'WIDERECEIVER': 'WR',
    'RECEIVER': 'WR',
    'TE': 'TE',
    'TIGHT END': 'TE',
    'TIGHTEND': 'TE',
    'K': 'PK',
    'PK': 'PK',
    'KICKER': 'PK',
    'DST': 'DEF',
    'DEF': 'DEF',
    'DEFENSE': 'DEF',
    'D/ST': 'DEF',
  };
  
  return positionMap[normalized] || normalized;
}

// =============================================================================
// MAIN IMPORT FUNCTION
// =============================================================================

/**
 * Import rankings from text
 * Auto-detects format (TSV, CSV, JSON)
 */
export function importRankings(
  text: string,
  mflPlayers: MFLPlayer[],
  rankingType: 'dynasty' | 'redraft',
  source: 'fantasypros' | 'dynastyleaguefootball' | 'custom' | 'sleeper' = 'custom'
): PlayerRankingImport {
  // Detect format
  let parsedRankings: ParsedRanking[];
  
  if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
    // JSON format
    parsedRankings = parseJSON(text);
  } else if (text.includes('\t')) {
    // Tab-separated
    parsedRankings = parseTabSeparated(text);
  } else if (text.includes(',')) {
    // CSV
    parsedRankings = parseCSV(text);
  } else {
    // Try tab-separated as fallback
    parsedRankings = parseTabSeparated(text);
  }
  
  // Match players to MFL database
  const rankings = parsedRankings.map(ranking => {
    const match = matchPlayerToMFL(ranking.playerName, ranking.position, mflPlayers);
    
    return {
      rank: ranking.rank,
      playerId: match.playerId || undefined,
      playerName: ranking.playerName,
      position: ranking.position,
      team: ranking.team,
      tier: ranking.tier,
      notes: ranking.notes,
      matched: match.matched,
    };
  });
  
  return {
    source,
    rankingType,
    importDate: new Date(),
    rankings,
  };
}

/**
 * Get import statistics
 */
export function getImportStats(importData: PlayerRankingImport): {
  total: number;
  matched: number;
  unmatched: number;
  matchRate: number;
  byPosition: Record<string, { total: number; matched: number }>;
} {
  const total = importData.rankings.length;
  const matched = importData.rankings.filter(r => r.matched).length;
  const unmatched = total - matched;
  const matchRate = total > 0 ? (matched / total) * 100 : 0;
  
  // By position
  const byPosition: Record<string, { total: number; matched: number }> = {};
  importData.rankings.forEach(ranking => {
    if (!byPosition[ranking.position]) {
      byPosition[ranking.position] = { total: 0, matched: 0 };
    }
    byPosition[ranking.position].total++;
    if (ranking.matched) {
      byPosition[ranking.position].matched++;
    }
  });
  
  return {
    total,
    matched,
    unmatched,
    matchRate,
    byPosition,
  };
}

/**
 * Get unmatched players for manual review
 */
export function getUnmatchedPlayers(importData: PlayerRankingImport) {
  return importData.rankings
    .filter(r => !r.matched)
    .map(r => ({
      rank: r.rank,
      name: r.playerName,
      position: r.position,
      team: r.team,
    }));
}

/**
 * Calculate composite rank from dynasty and redraft rankings
 */
export function calculateCompositeRank(
  playerId: string,
  dynastyImport: PlayerRankingImport | null,
  redraftImport: PlayerRankingImport | null,
  dynastyWeight: number // 0-1
): number | null {
  const dynastyRanking = dynastyImport?.rankings.find(r => r.playerId === playerId);
  const redraftRanking = redraftImport?.rankings.find(r => r.playerId === playerId);
  
  const dynastyRank = dynastyRanking?.rank;
  const redraftRank = redraftRanking?.rank;
  
  if (!dynastyRank && !redraftRank) {
    return null;
  }
  
  if (dynastyRank && !redraftRank) {
    return dynastyRank;
  }
  
  if (!dynastyRank && redraftRank) {
    return redraftRank;
  }
  
  // Both rankings available - calculate weighted average
  const redraftWeight = 1 - dynastyWeight;
  const compositeRank = Math.round(
    (dynastyRank! * dynastyWeight) + (redraftRank! * redraftWeight)
  );
  
  return compositeRank;
}

/**
 * Apply rankings to player valuations
 */
export function applyRankingsToPlayers(
  players: Array<{ id: string; name: string; position: string }>,
  dynastyImport: PlayerRankingImport | null,
  redraftImport: PlayerRankingImport | null,
  dynastyWeight: number = 0.6
): Array<{
  id: string;
  dynastyRank?: number;
  redraftRank?: number;
  compositeRank?: number;
}> {
  return players.map(player => {
    const dynastyRanking = dynastyImport?.rankings.find(r => r.playerId === player.id);
    const redraftRanking = redraftImport?.rankings.find(r => r.playerId === player.id);
    
    const dynastyRank = dynastyRanking?.rank;
    const redraftRank = redraftRanking?.rank;
    const compositeRank = calculateCompositeRank(player.id, dynastyImport, redraftImport, dynastyWeight);
    
    return {
      id: player.id,
      dynastyRank,
      redraftRank,
      compositeRank: compositeRank || undefined,
    };
  });
}
