/**
 * Storage for the locked Schedule Release.
 *
 * ONE STORE: the committed archive at
 * data/<league>/schedule-release/<year>.json, written by the release cron.
 *
 * WHY A LOCK AT ALL. The optimiser is simulated annealing, so generating twice
 * yields two different — both valid — schedules. Without a lock, sixteen owners
 * opening the reveal page would see sixteen different seasons and the
 * commissioner would paste one of them. The archive is the lock: the cron
 * refuses to write one that already exists, so the season everyone was shown is
 * the season that gets played.
 *
 * WHY NOT REDIS. It was Redis first, with the cron POSTing to a token-guarded
 * endpoint to claim an atomic SET NX. That bought nothing here and cost two
 * real things. The repo is PUBLIC, so the shared token could not live in it and
 * became a secret to provision and rotate for an event that fires once a year.
 * And two stores meant two answers: a commissioner revealing in the browser
 * wrote Redis, a later cron wrote the archive, and the page (Redis-first) and
 * Schefter (archive-only) could disagree about what the schedule was.
 *
 * A git commit is a better lock for this than a cache entry. It cannot be
 * evicted, it is reviewable in a diff, it survives forever, and there is
 * exactly one of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLeagueBySlug } from '../config/leagues';

/** One franchise-vs-franchise game, as the planner emits it. */
export interface ReleaseGame {
  away: string;
  home: string;
}

export interface MarqueeGame {
  week: number;
  away: string;
  home: string;
  awayName: string;
  homeName: string;
  why: string[];
}

export interface ScheduleRelease {
  league: string;
  year: number;
  /** ISO timestamp the schedule was locked. */
  revealedAt: string;
  /**
   * Which schedule this record was canonised FROM.
   *
   * `plan` is the normal path — the reveal is the draw the locker just made.
   * `live` means it was taken from the schedule already pasted into MFL,
   * because the committed plan and the pasted season had diverged into two
   * different valid draws. Optional: reveals locked before the distinction
   * existed carry neither.
   */
  source?: 'plan' | 'live';
  /** `WW,AAAA,HHHH` lines, ready to paste into MFL. */
  text: string;
  /** Week number -> games. */
  weeks: Record<string, ReleaseGame[]>;
  doubleheaderWeeks: number[];
  byeFreeWeeks: number[];
  marquee: MarqueeGame[];
  /** Summary numbers shown on the page and reused by Schefter's column. */
  summary: {
    games: number;
    byeFreeDivisionGames: number;
    divisionGameCeiling: number;
    /**
     * Every division game in the season — the denominator `byeFreeDivisionGames`
     * and `divisionGameCeiling` are both counted against. Optional because
     * reveals locked before Aug 2026 carry neither it nor the percentage the
     * page derives from it; those render the bye-free count alone.
     */
    divisionGames?: number;
    netByeSpread: number;
    homeGames: { min: number; max: number };
    minRematchGap: number | null;
  };
  /**
   * How the season did against the goals in force when it was drawn — scored
   * once at lock time (`scoreSeasonGoals`) and stored, never re-derived: the
   * reveal is a record, and a verdict that recomputed would silently change as
   * the league adds goals. Absent on reveals locked before scoring existed.
   */
  goals?: { key: string; rank: number; tier: string; status: string; detail: string }[];
  /** Goals adopted after this draw was locked. They did not apply to it. */
  notYetAdopted?: { key: string; since: number }[];
}

/** Reveals are per league AND per season — next year is a different record. */

const isRelease = (v: any): v is ScheduleRelease =>
  Boolean(v) && typeof v === 'object' && typeof v.text === 'string' && v.text.length > 0 && Array.isArray(v.marquee);

/** Where the release cron commits a locked reveal. */
const archiveFile = (league: string, year: number): string | null => {
  const registry = getLeagueBySlug(league);
  if (!registry) return null;
  return path.join(process.cwd(), registry.dataPath, 'schedule-release', `${year}.json`);
};

/**
 * The locked reveal for a league and season, or null if it has not happened.
 *
 * Async because every caller already awaits it and because the page must be
 * free to move this behind a network call later without a rewrite.
 */
export async function getRelease(league: string, year: number): Promise<ScheduleRelease | null> {
  const file = archiveFile(league, year);
  if (!file) return null;
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // A malformed record reads as "not revealed" rather than crashing the page:
    // that is recoverable by re-running the cron, a 500 is not.
    return isRelease(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Has this season already been revealed? The cron calls this before generating
 * anything, so a second run is a no-op rather than a second schedule.
 */
export async function isRevealed(league: string, year: number): Promise<boolean> {
  return (await getRelease(league, year)) !== null;
}
