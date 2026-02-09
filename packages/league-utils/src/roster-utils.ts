/**
 * Roster processing utilities for player lists and tables
 */

import { parseNumber, positionOrder, nflByeWeeks } from '@mfl/shared-utils';

/**
 * Player interface for roster display
 */
export interface RosterPlayer {
  id: string;
  name: string;
  position?: string;
  salary?: number;
  contractYears?: number;
  displayTag?: 'active' | 'practice' | 'injured';
  headshot?: string;
  nflLogo?: string;
  nflTeam?: string;
  byeWeek?: number | null;
  status?: string;
  birthdate?: number; // Unix timestamp in seconds (from MFL API)
  // Annotation fields added by processing functions
  positionDivider?: boolean;
  positionDividerEnd?: boolean;
  tierDivider?: boolean;
  activeStripe?: boolean;
  _positionGroup?: string;
}

/**
 * Get position rank for sorting
 * @param pos - Position code (QB, RB, WR, etc.)
 * @returns Numeric rank (lower = earlier in sort order)
 */
export function getPositionRank(pos?: string): number {
  if (!pos) return positionOrder.length;
  const rank = positionOrder.indexOf(pos.toUpperCase() as any);
  return rank === -1 ? positionOrder.length : rank;
}

/**
 * Sort players by position, then by salary (descending)
 * @param list - Array of players to sort
 * @returns Sorted array (does not mutate original)
 */
export function sortByPosition<T extends RosterPlayer>(list: T[]): T[] {
  return list.slice().sort((a, b) => {
    const diff = getPositionRank(a.position) - getPositionRank(b.position);
    if (diff !== 0) return diff;
    return parseNumber(b.salary) - parseNumber(a.salary);
  });
}

/**
 * Annotate players with position divider markers
 * Adds visual separators between different positions
 * @param rows - Array of players (should be sorted by position)
 * @returns Players with positionDivider and positionDividerEnd fields
 */
export function annotatePositionDividers<T extends RosterPlayer>(rows: T[]): T[] {
  const normalized = rows.map((player, index) => {
    const prevPosition =
      index > 0 ? (rows[index - 1].position ?? '').toUpperCase() : null;
    const current = (player.position ?? '').toUpperCase();
    const showDivider = index === 0 || (index > 0 && current !== prevPosition);
    return {
      ...player,
      positionDivider: showDivider,
      _positionGroup: current,
    };
  });

  return normalized.map((player, index) => {
    const next = normalized[index + 1];
    const isEndDivider =
      !!next && (next._positionGroup ?? '') !== (player._positionGroup ?? '');
    return {
      ...player,
      positionDividerEnd: isEndDivider,
    };
  });
}

/**
 * Annotate players with tier divider markers
 * Adds visual separators between active/practice/injured tiers
 * @param rows - Array of players with displayTag set
 * @returns Players with tierDivider field
 */
export function annotateTierDividers<T extends RosterPlayer>(rows: T[]): T[] {
  let lastTag: string | null = null;
  return rows.map((player) => {
    const currentTag = player.displayTag ?? 'active';
    const divider =
      lastTag !== null && currentTag !== lastTag && currentTag !== 'active';
    lastTag = currentTag;
    return {
      ...player,
      tierDivider: divider,
    };
  });
}

/**
 * Annotate active roster players with alternating stripe pattern
 * Only active players get striping (practice/injured are styled differently)
 * @param rows - Array of players with displayTag set
 * @returns Players with activeStripe field
 */
export function annotateActiveStriping<T extends RosterPlayer>(rows: T[]): T[] {
  let activeIndex = 0;
  return rows.map((player) => {
    if ((player.displayTag ?? 'active') === 'active') {
      const striped = activeIndex % 2 === 1;
      activeIndex += 1;
      return { ...player, activeStripe: striped };
    }
    return { ...player, activeStripe: false };
  });
}

/**
 * Team data structure from API
 */
export interface TeamData {
  players?: RosterPlayer[];
  practiceSquad?: RosterPlayer[];
  injuredReserve?: RosterPlayer[];
}

/**
 * Build display rows from team data
 * Combines active/practice/injured, sorts by position, adds dividers and striping
 * @param teamData - Team roster data
 * @returns Processed and annotated player rows ready for display
 */
export function buildDisplayRows(teamData: TeamData): RosterPlayer[] {
  const mapPlayers = (players: RosterPlayer[] = [], displayTag: 'active' | 'practice' | 'injured' = 'active'): RosterPlayer[] =>
    sortByPosition(players).map((player) => ({
      ...player,
      displayTag,
      byeWeek: player.byeWeek ?? nflByeWeeks[player.nflTeam ?? ''] ?? null,
    }));

  const combined = [
    ...mapPlayers(teamData.players ?? [], 'active'),
    ...mapPlayers(teamData.practiceSquad ?? [], 'practice'),
    ...mapPlayers(teamData.injuredReserve ?? [], 'injured'),
  ];

  const withDividers = annotateTierDividers(annotatePositionDividers(combined));
  return annotateActiveStriping(withDividers);
}

/**
 * Parse salary adjustment metadata from description string
 * Extracts player name, NFL team, salary, and years remaining from drop descriptions
 * @param description - Adjustment description (e.g., "Dropped John Doe RB SF (Salary: $5,000,000, Years: 3)")
 * @returns Parsed metadata
 */
export function parseAdjustmentMeta(description = ''): {
  name: string;
  nflTeam: string;
  salary: number | null;
  yearsRemaining: number | null;
} {
  const meta = {
    name: '',
    nflTeam: '',
    salary: null as number | null,
    yearsRemaining: null as number | null,
  };

  const nameMatch = description.match(/^Dropped\s+([^()]+)\s*\(/i);
  if (nameMatch) {
    meta.name = nameMatch[1].trim();
    const parts = meta.name.split(' ');
    const maybeTeam = parts[parts.length - 2];
    if (maybeTeam && maybeTeam.length === 3) {
      meta.nflTeam = maybeTeam.toUpperCase();
    }
  }

  const salaryMatch = description.match(/Salary:\s*\$?([\d,\.]+)/i);
  if (salaryMatch) {
    const raw = salaryMatch[1].replace(/,/g, '');
    meta.salary = Number(raw) || null;
  }

  const yearsMatch = description.match(/Years:\s*(\d+)/i);
  if (yearsMatch) {
    meta.yearsRemaining = parseInt(yearsMatch[1], 10);
  }

  return meta;
}
