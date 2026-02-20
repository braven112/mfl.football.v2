/**
 * Bookmarklet JSON Parser
 *
 * Validates and parses the standard JSON format that all bookmarklets output.
 * Handles position normalization and source auto-detection.
 */

import type {
  BookmarkletOutput,
  BookmarkletPlayer,
  RankingSourceId,
  RankingType,
} from '../types/rankings-import';

export interface ParseResult {
  success: boolean;
  data?: BookmarkletOutput;
  error?: string;
}

const VALID_SOURCES: RankingSourceId[] = [
  'fantasypros', 'cbs', 'sleeper', 'nfl', 'keeptradecut',
  'dlf', 'yahoo', 'espn', 'footballguys', 'custom',
];

const VALID_TYPES: RankingType[] = ['dynasty', 'redraft', 'adp', 'overall'];

/** Map common position variations to canonical forms */
const POSITION_MAP: Record<string, string> = {
  QB: 'QB',
  QUARTERBACK: 'QB',
  RB: 'RB',
  HB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'PK',
  PK: 'PK',
  KICKER: 'PK',
  DST: 'DEF',
  DEF: 'DEF',
  'D/ST': 'DEF',
  DEFENSE: 'DEF',
};

function normalizePosition(pos: string): string {
  // Strip trailing digits — DLF uses "WR1", "RB2", "QB1" etc.
  const upper = (pos ?? '').toUpperCase().trim().replace(/\d+$/, '');
  return POSITION_MAP[upper] ?? upper;
}

/**
 * Parse and validate pasted JSON from a bookmarklet.
 */
export function parseBookmarkletJson(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { success: false, error: 'No data to import. Copy rankings from a bookmarklet first.' };
  }

  // Try parsing as JSON
  let raw: any;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return {
      success: false,
      error: 'Invalid JSON. Make sure you copied the full output from a bookmarklet.',
    };
  }

  // Validate top-level structure
  if (!raw || typeof raw !== 'object') {
    return { success: false, error: 'Expected a JSON object with source, type, and players.' };
  }

  // Accept a bare array as shorthand (custom bookmarklets)
  if (Array.isArray(raw)) {
    raw = {
      source: 'custom',
      type: 'overall',
      exportedAt: new Date().toISOString(),
      players: raw,
    };
  }

  // Validate players array
  if (!Array.isArray(raw.players) || raw.players.length === 0) {
    return { success: false, error: 'No players found in the data.' };
  }

  // Normalize source
  const source: RankingSourceId = VALID_SOURCES.includes(raw.source) ? raw.source : 'custom';

  // Normalize type
  const type: RankingType = VALID_TYPES.includes(raw.type) ? raw.type : 'overall';

  // Normalize players
  const players: BookmarkletPlayer[] = raw.players
    .filter((p: any) => p && (p.name || p.playerName || p.player))
    .map((p: any, idx: number) => ({
      rank: typeof p.rank === 'number' ? p.rank : idx + 1,
      name: (p.name || p.playerName || p.player || '').trim(),
      pos: normalizePosition(p.pos || p.position || ''),
      team: (p.team || '').toUpperCase().trim(),
      tier: typeof p.tier === 'number' ? p.tier : undefined,
    }));

  if (players.length === 0) {
    return { success: false, error: 'Could not parse any player entries from the data.' };
  }

  const data: BookmarkletOutput = {
    source,
    type,
    exportedAt: raw.exportedAt || new Date().toISOString(),
    players,
    metadata: raw.metadata,
  };

  return { success: true, data };
}
