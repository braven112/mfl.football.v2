/**
 * Rankings Parser Utility
 * 
 * Parses copy-pasted text from rankings sites (DLF, FootballGuys, etc.)
 * and matches them to MFL player IDs.
 */

import type { PlayerValuation } from '../types/auction-predictor';

export interface ParsedRanking {
  rank: number;
  playerName: string;
  position: string;
  team?: string;
  matchedPlayerId?: string;
}

export interface RankingsImportResult {
  source: string;
  totalRows: number;
  matchedCount: number;
  rankings: ParsedRanking[];
  unmatched: ParsedRanking[];
}

/**
 * Normalizes player names for fuzzy matching
 * e.g. "Patrick Mahomes II" -> "patrick mahomes"
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '') // Remove punctuation
    .replace(/\s(ii|iii|iv|jr|sr)$/, '') // Remove suffixes
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
}

/**
 * Parses raw text from CSV/TSV
 */
export function parseRankingsText(
  text: string, 
  source: 'dlf' | 'footballguys' | 'fantasypros' | 'generic'
): ParsedRanking[] {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const parsed: ParsedRanking[] = [];
  
  // Detect delimiter (Tab for TSV, Comma for CSV)
  const firstLine = lines[0] || '';
  const isTsv = firstLine.includes('\t');
  const delimiter = isTsv ? '\t' : ',';

  // Heuristic column detection
  // We need to find columns for: Rank, Name, Position, Team
  // Defaults (common formats)
  let colMap = { rank: 0, name: 1, pos: 2, team: 3 };
  
  // Adjust based on source if known formats (Mock implementation)
  if (source === 'dlf') {
    // DLF CSV often: Rank, Player, Pos, Team, Age...
    colMap = { rank: 0, name: 1, pos: 2, team: 3 };
  } else if (source === 'footballguys') {
    // FBG often: Rank, Name, Team, Bye, Pos...
    colMap = { rank: 0, name: 1, team: 2, pos: 4 }; 
  }

  let currentRank = 1;

  for (const line of lines) {
    // Skip headers
    if (line.toLowerCase().startsWith('rank') || line.toLowerCase().startsWith('overall')) continue;

    const cols = line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''));
    
    if (cols.length < 2) continue;

    // Extract Rank
    let rankVal = parseInt(cols[colMap.rank]);
    if (isNaN(rankVal)) {
      // If rank column is missing or implied, use counter
      rankVal = currentRank; 
    } else {
      currentRank = rankVal;
    }

    // Extract Name
    const name = cols[colMap.name];
    
    // Extract Position (try to parse if mixed)
    let pos = cols[colMap.pos] || '';
    // Handle "QB12" format
    if (pos.match(/^[A-Z]{2,3}\d+$/)) {
      pos = pos.replace(/\d+$/, '');
    }

    if (name && name.length > 2) {
      parsed.push({
        rank: rankVal,
        playerName: name,
        position: pos.toUpperCase(),
        team: cols[colMap.team] || '',
      });
      currentRank++;
    }
  }

  return parsed;
}

/**
 * Matches parsed rankings to MFL players
 */
export function matchRankingsToPlayers(
  rankings: ParsedRanking[], 
  mflPlayers: PlayerValuation[]
): RankingsImportResult {
  const matchedRankings: ParsedRanking[] = [];
  const unmatchedRankings: ParsedRanking[] = [];
  let matchedCount = 0;

  // Index MFL players by normalized name for O(1) lookup
  const playerIndex = new Map<string, PlayerValuation>();
  mflPlayers.forEach(p => {
    playerIndex.set(normalizeName(p.name), p);
  });

  for (const item of rankings) {
    const normName = normalizeName(item.playerName);
    const match = playerIndex.get(normName);

    if (match) {
      // Basic match found
      // Optional: Verify position matches to avoid same-name conflicts
      if (item.position && match.position && !item.position.includes(match.position) && !match.position.includes(item.position)) {
         // Position mismatch warning
         // But for now, name match is usually sufficient for fantasy relevant players
      }

      matchedRankings.push({
        ...item,
        matchedPlayerId: match.id
      });
      matchedCount++;
    } else {
      // Try fuzzy matching or manual overrides here in future
      unmatchedRankings.push(item);
    }
  }

  return {
    source: 'unknown',
    totalRows: rankings.length,
    matchedCount,
    rankings: matchedRankings,
    unmatched: unmatchedRankings
  };
}