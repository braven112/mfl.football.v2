/**
 * Types for the division-strength derived data.
 *
 * The producer is `scripts/compute-division-strength.mjs`; the shared math
 * lives in `src/utils/division-strength.mjs` (plain .mjs so the node script and
 * the .astro pages share one implementation). These interfaces describe what
 * `data/<league>/derived/division-strength.json` contains.
 *
 * Read the header of `src/utils/division-strength.mjs` before using any number
 * off this file — in particular, why `interDivision` and not `totals` is the
 * strength metric.
 */

/** A W-L-T record plus the points on both sides of it. */
export interface DivisionRecord {
  wins: number;
  losses: number;
  ties: number;
  games: number;
  pointsFor: number;
  /** 0 for a season with no game log — `pointsAgainst` needs per-game scores. */
  pointsAgainst: number;
  /** Ties count half. Null when no games were played, never 0. */
  winPct: number | null;
}

/** A contiguous run of years. */
export interface YearRun {
  yearStart: number;
  yearEnd: number;
}

/** Where a division finished in one season's strength ranking. */
export interface RankedYear {
  year: number;
  rank: number;
  /** How many divisions the league had that year — 6 in the AFL through 2012. */
  of: number;
  /** `rank` normalized to 0..1 (1 = first), so eras with different division counts compare. */
  pct: number;
}

/** The owner reference carried on a team-season and on award rows. */
export interface DivisionOwnerRef {
  ownerId: string;
  slug: string;
  title: string | null;
  icon: string | null;
}

/** One franchise's season inside a division. */
export interface DivisionTeamSeason {
  franchiseId: string;
  name: string | null;
  nameMedium: string | null;
  icon: string | null;
  wins: number;
  losses: number;
  ties: number;
  /** From the standings feed, which carries any commissioner adjustment. */
  pointsFor: number;
  /** From the game replay; null when the season has no game log. */
  pointsAgainst: number | null;
  regSeasonRank: number | null;
  wonDivision: boolean;
  /** `champion` | `runner-up` | `third-place` | `playoffs` | `missed`. */
  playoffResult: string;
  /** Null when the season has no game log (AFL 2003). */
  interDivision: DivisionRecord | null;
  intraDivision: DivisionRecord | null;
  /** One owner, or the declared co-owners of a shared team. Never empty. */
  owners: DivisionOwnerRef[];
  /** True when this season is held by declared co-owners. */
  shared: boolean;
}

/** A franchise identified just enough to render a lockup. */
export interface DivisionTeamBrief {
  franchiseId: string;
  name: string | null;
  icon: string | null;
  owners: DivisionOwnerRef[];
}

/** One division within one season. */
export interface DivisionSeason {
  name: string;
  slug: string;
  /** MFL's slot id for that year. Informational — never an identity across years. */
  divisionId: string | null;
  /** 1 = strongest that season. Null when the season has no game log. */
  rank: number | null;
  totals: DivisionRecord;
  interDivision: DivisionRecord | null;
  intraDivision: DivisionRecord | null;
  /** This division's record against each other division that season. */
  vs: Record<string, DivisionRecord>;
  playoffBerths: number;
  divisionWinner: DivisionTeamBrief | null;
  champion: DivisionTeamBrief | null;
  teams: DivisionTeamSeason[];
}

/** One season's report. */
export interface DivisionStrengthYear {
  year: number;
  /**
   * False when the feed carries no scored games — the AFL's 2003 (standings
   * survived, the game log did not) and any season not yet played. Everything
   * derived from games is null/empty in that case; the standings-derived
   * `totals` are still real.
   */
  gamesResolved: boolean;
  lastRegularSeasonWeek: number | null;
  leagueSize: number;
  divisionCount: number;
  /** Named only when `gamesResolved` — one season is a fair sample of itself. */
  strongest: string | null;
  weakest: string | null;
  divisions: DivisionSeason[];
}

/** One owner's era inside one division. */
export interface DivisionOwnerEra {
  ownerId: string;
  slug: string;
  title: string | null;
  icon: string | null;
  seasons: number;
  yearStart: number;
  yearEnd: number;
  /**
   * NON-contiguous by design: realignment moves a team out of a division and
   * sometimes back, so rendering `yearStart–yearEnd` would claim seasons spent
   * in a different division.
   */
  stints: YearRun[];
  years: number[];
  franchiseIds: string[];
  /** Team names worn while in this division. */
  identities: Array<{ name: string | null; yearStart: number; yearEnd: number }>;
  totals: DivisionRecord;
  interDivision: DivisionRecord;
  divisionTitles: number;
  championships: number;
  playoffBerths: number;
  /** Seasons of this era held jointly with a declared co-owner. */
  sharedSeasons: number;
}

/** One division, all-time. Keyed by NAME — see the compute script's header. */
export interface DivisionAllTime {
  name: string;
  slug: string;
  /** Every MFL slot id this name has occupied. Informational only. */
  divisionIds: string[];
  years: number[];
  /** Contiguous runs of `years` — the AFL's Pacific ran 2003-2005 and 2007-2012. */
  eras: YearRun[];
  firstYear: number;
  lastYear: number;
  seasons: number;
  /** Present in the most recently PLAYED season. False = a retired division. */
  active: boolean;
  teamSeasons: number;
  /** Mean raw yearly rank. Not comparable across a change in division count. */
  avgFinish: number | null;
  /** Mean era-normalized finish, 0..1 (1 = always first). The comparable one. */
  avgFinishPct: number | null;
  bestYear: RankedYear | null;
  worstYear: RankedYear | null;
  rankedYears: RankedYear[];
  totals: DivisionRecord;
  /** The strength metric. Intra-division games cancel to .500 and are excluded. */
  interDivision: DivisionRecord;
  intraDivision: DivisionRecord;
  /** All-time record against each other division. Mirrored on the other side. */
  vs: Record<string, DivisionRecord>;
  playoffBerths: number;
  divisionTitles: number;
  championships: number;
  runnerUps: number;
  thirdPlaces: number;
  /** Every owner who has sat in this division, most seasons first. */
  owners: DivisionOwnerEra[];
}

export interface DivisionStrengthSummary {
  divisionCount: number;
  activeDivisions: string[];
  retiredDivisions: string[];
  /** The alignment of the latest season on file, played or not. */
  currentAlignment: string[];
  latestAlignmentYear: number | null;
}

/**
 * The derived file.
 *
 * Note what is deliberately ABSENT: any all-time "strongest" / "weakest" field.
 * Raw all-time interdivisional win% favors short-lived divisions (the AFL's
 * Atlantic existed for one season at .556 and would top such a list), and
 * era-normalized average finish disagrees with it. Consumers present both
 * metrics and make no verdict. Per-season `strongest`/`weakest` are claims and
 * are fine.
 */
export interface DivisionStrengthFile {
  generatedAt: string;
  league: string;
  leagueName: string;
  yearsCovered: number[];
  yearsWithGameLog: number[];
  yearsWithoutGameLog: number[];
  latestPlayedYear: number | null;
  summary: DivisionStrengthSummary;
  divisions: DivisionAllTime[];
  years: DivisionStrengthYear[];
}
