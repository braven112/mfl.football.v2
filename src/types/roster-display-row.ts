/**
 * One row of the TheLeague rosters table.
 *
 * Traced to its producer rather than invented: the field list below is what
 * `scripts/lib/roster-season-payload.mjs` emits per player (see the
 * `playerObj` literal there), plus the annotations the page layers on top —
 * `displayTag` from the active/practice/injured bucket a row came from, and
 * the divider/striping flags the render pipeline adds.
 *
 * This exists because `rosters.astro` declared every row-shaped parameter as
 * `(rows = [])`. That default types the parameter `never[]`, so each property
 * read on a row failed separately: one bad default accounted for ~160 of the
 * file's type errors. Annotate at the parameter, not at the use.
 *
 * Almost everything is optional and nullable on purpose. Rows are assembled
 * from MFL, Sleeper, ESPN and nflverse, any of which can be missing for a
 * given player, and the historical seasons come from a precomputed payload
 * built by an older version of the builder. A row that is missing a field
 * must render, not throw.
 */

/** MFL roster bucket, normalized. */
export type RosterSlot = 'ACTIVE' | 'PRACTICE' | 'INJURED';

/** Which table section a row was rendered under. */
export type RosterDisplayTag = 'active' | 'practice' | 'injured';

/** The betting line and conditions for a player's NFL game this week. */
export interface RosterRowGameOdds {
  spread?: string;
  overUnder?: string | number;
  favoredTeam?: string | null;
  spreadAmount?: number | null;
  weather?: { temperature?: number; displayValue?: string; conditionId?: string } | null;
  opponent?: string;
  isHome?: boolean;
}

export interface RosterDisplayRow {
  // --- identity -----------------------------------------------------------
  id: string;
  name?: string;
  position?: string;
  espnId?: string | null;
  sleeperId?: string | null;
  gsisId?: string | null;

  // --- contract -----------------------------------------------------------
  salary?: number;
  contractYears?: number;
  contractType?: string | null;
  /** Free-text contract note from the live MFL roster, `''` when absent. */
  contractInfo?: string;
  totalRemaining?: number;
  franchiseId?: string | null;
  status?: string;
  rosterSlot?: RosterSlot;

  // --- scoring ------------------------------------------------------------
  points?: number;
  /** `'-'` when the player has no projection, not 0. */
  projectedPoints?: number | string;
  recentScores?: Array<number | string>;
  /** Averages are pre-formatted to one decimal, or `'-'` with no scores. */
  avgRecent?: number | string;
  avgSeason?: number | string;

  // --- NFL context --------------------------------------------------------
  nflTeam?: string;
  nflLogo?: string;
  byeWeek?: number | null;
  opponent?: string | null;
  oppStats?: Record<string, unknown> | null;
  gameOdds?: RosterRowGameOdds | null;

  // --- draft --------------------------------------------------------------
  draftYear?: number | null;
  draftTeam?: string | null;
  draftRound?: number | null;
  draftPick?: number | null;

  // --- bio ----------------------------------------------------------------
  /** Unix seconds, as MFL reports it. */
  birthdate?: number | null;
  headshot?: string;
  college?: string | null;
  collegeLogo?: string | null;
  collegeLogoDark?: string | null;
  height?: string | null;
  weight?: string | number | null;
  number?: string | number | null;
  experience?: number | null;

  // --- Sleeper ------------------------------------------------------------
  depthChartPosition?: string | null;
  depthChartOrder?: number | null;
  depthChartAhead?: unknown;
  injuryStatus?: string | null;
  injuryBodyPart?: string | null;
  sleeperFullName?: string | null;
  sleeperPosition?: string | null;
  fantasyPositions?: string[] | null;
  sleeperAge?: number | null;
  sleeperStatus?: string | null;
  sleeperActive?: boolean | null;

  // --- nflverse snap counts ----------------------------------------------
  offenseSnaps?: number | null;
  defenseSnaps?: number | null;
  stSnaps?: number | null;
  gamesPlayed?: number | null;

  // --- league state -------------------------------------------------------
  tradeBait?: boolean;

  // --- render-pipeline annotations ---------------------------------------
  displayTag?: RosterDisplayTag;
  /** Draw a rule above this row (first row of a position group). */
  positionDivider?: boolean;
  /** Draw a rule below this row (last row of a position group). */
  positionDividerEnd?: boolean;
  /** Draw a rule above this row (start of the practice/injured tier). */
  tierDivider?: boolean;
  /** Zebra striping, counted across active rows only. */
  activeStripe?: boolean;
  /** Set only on players injected by Contract Demo mode. */
  isMock?: boolean;

  /**
   * Rows are spread (`{ ...player, ... }`) through several annotation passes
   * and carry fields from older payload versions, so an exhaustive list is not
   * achievable. Unknown, not any: a new read still has to narrow.
   */
  [key: string]: unknown;
}
