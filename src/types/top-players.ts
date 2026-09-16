/**
 * Shapes for data/<league>/derived/top-players.json
 * (scripts/compute-top-players.mjs). Pinned by tests/top-players-data.test.ts.
 */

export interface TopPlayerOwner {
  id: string;
  name: string;
  /**
   * The franchise's LIGHT crest from the league config. Only the light one:
   * TeamIconDarkStyles swaps to `iconDark` by CSS keyed on this src, and the
   * server cannot know the resolved theme under a viewer's 'auto' preference.
   */
  icon: string | null;
}

export interface TopPlayerRow {
  id: string;
  name: string;
  position: string;
  team: string | null;
  /** Drives the ESPN headshot. Null for most DEF rows, which use a team logo. */
  espnId: string | null;
  /** A LIST: the AFL rosters the same NFL player once per conference. */
  owners: TopPlayerOwner[];
  /** Week number → points. A week the player did not score is ABSENT, not 0. */
  weeks: Record<string, number>;
  total: number;
  avg: number;
  /** Weeks actually scored — never the number of weeks elapsed. */
  games: number;
  best: number;
  rank: number;
  posRank: number;
}

export interface TopPlayersFile {
  seasonYear: number;
  startWeek: number;
  endWeek: number;
  lastRegularSeasonWeek: number | null;
  completedWeeks: number[];
  positions: string[];
  players: TopPlayerRow[];
}
