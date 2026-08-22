/**
 * Storage for the locked Schedule Release.
 *
 * WHY A LOCK AT ALL. The optimiser is simulated annealing, so generating twice
 * yields two different — both valid — schedules. Without a lock, sixteen owners
 * opening the reveal page would see sixteen different seasons and sixteen
 * different marquee games, and the commissioner would paste one of them. The
 * first write wins and every later read serves that same record, so the season
 * everyone was shown is the season that gets played.
 *
 * `set(..., { nx: true })` is the whole mechanism: an atomic create-if-absent.
 * Two crons racing, or a retried invocation, cannot overwrite a reveal that has
 * already happened. `lockRelease` reports which way it went so the caller can
 * tell "I revealed it" from "it was already out" — that distinction decides
 * whether Schefter's announcement fires.
 *
 * NO TTL. A reveal is a permanent league record: the article references it, the
 * commissioner may paste days later, and next year's key is a different year.
 * An expiry here would silently un-reveal a season mid-offseason.
 *
 * REDIS-LESS ENVIRONMENTS. `getRedis()` returns null without credentials (local
 * dev, CI). Every function degrades to "not revealed" rather than throwing, so
 * the page renders its countdown instead of an error — but `lockRelease` says
 * so explicitly, because a cron that silently failed to lock would leave the
 * league staring at a countdown that already expired.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRedis } from './redis-client';
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
    netByeSpread: number;
    homeGames: { min: number; max: number };
    minRematchGap: number | null;
  };
}

/** Reveals are per league AND per season — next year is a different record. */
const key = (league: string, year: number) => `schedule-release:${league}:${year}`;

const isRelease = (v: any): v is ScheduleRelease =>
  Boolean(v) && typeof v === 'object' && typeof v.text === 'string' && v.text.length > 0 && Array.isArray(v.marquee);

/**
 * The committed archive scripts/lock-schedule-release.mjs writes after a
 * successful lock. It is the durable half: Redis can be evicted or
 * unconfigured, and a reveal is a permanent league record that Schefter's
 * column still needs to read months later.
 */
function readArchive(league: string, year: number): ScheduleRelease | null {
  const registry = getLeagueBySlug(league);
  if (!registry) return null;
  try {
    const file = path.join(process.cwd(), registry.dataPath, 'schedule-release', `${year}.json`);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRelease(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Redis first, committed archive second. Redis is the live lock — it is what
 * makes first-write-wins atomic and what a commissioner's manual reveal writes.
 * The archive covers the cases Redis cannot: eviction, an environment with no
 * Redis at all, and reading a past season's reveal.
 */
export async function getRelease(league: string, year: number): Promise<ScheduleRelease | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const value = await redis.get<ScheduleRelease>(key(league, year));
      // A malformed record must read as "not revealed" rather than crashing the
      // page — it is recoverable by re-running the lock, a 500 is not.
      if (isRelease(value)) return value;
    } catch {
      // fall through to the archive rather than reporting "not revealed"
    }
  }
  return readArchive(league, year);
}

export type LockOutcome =
  | { status: 'revealed'; release: ScheduleRelease }
  | { status: 'already'; release: ScheduleRelease }
  | { status: 'unavailable'; reason: string };

/**
 * Lock a release. First writer wins; a second call returns the existing record
 * rather than replacing it.
 */
export async function lockRelease(release: ScheduleRelease): Promise<LockOutcome> {
  const redis = await getRedis();
  if (!redis) return { status: 'unavailable', reason: 'Redis is not configured — cannot lock a reveal' };
  const k = key(release.league, release.year);
  try {
    const created = await redis.set(k, release, { nx: true });
    // Upstash answers 'OK' on a successful NX set and null when the key exists.
    if (created) return { status: 'revealed', release };
    const existing = await getRelease(release.league, release.year);
    return existing
      ? { status: 'already', release: existing }
      : { status: 'unavailable', reason: 'key exists but could not be read back' };
  } catch (err: any) {
    return { status: 'unavailable', reason: err?.message ?? 'Redis write failed' };
  }
}

/**
 * Delete a reveal so it can be re-locked. Commissioner-only escape hatch for
 * the case where a schedule was revealed and then found to be wrong; there is
 * no other way back, because the lock is deliberately immutable.
 */
export async function clearRelease(league: string, year: number): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  // NOTE: this clears the LIVE lock only. A committed archive for the same
  // season still reads back through getRelease, by design — the archive is the
  // permanent record and removing it is a deliberate commit, not an API call.
  try {
    await redis.del(key(league, year));
    return true;
  } catch {
    return false;
  }
}
