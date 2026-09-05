/**
 * Loading the AFL mock draft's state — the impure half of `afl-mock-draft`.
 *
 * One function, `buildAflMockContext`, answers everything both callers need:
 * the lobby (may I start one, and what do I say if not) and the create
 * endpoint (which franchises, in what order, from which pool). They MUST agree
 * — a lobby that offers a button the endpoint then refuses is worse than no
 * button — so they share this rather than each deriving it.
 *
 * ── Why rosters are fetched live ──────────────────────────────────────────
 *
 * This page exists for the fortnight between the keeper deadline and the
 * draft, which is precisely the window in which rosters change hour to hour:
 * twenty-four franchises cutting nine players each. A committed feed refreshed
 * by cron is a day stale at worst, and a day stale here means naming a player
 * as available who was released — or worse, hiding one who was.
 *
 * So it reads through `getCachedRosterFranchises` (Redis, 2-minute TTL,
 * synchronous refresh on miss) and falls back to the committed feed when Redis
 * is unavailable — dev, or an Upstash outage. The fallback is a real degrade,
 * not a silent one: `rosterSource` says which was used and the lobby prints it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCachedRosterFranchises } from './mfl-roster-cache';
import { getConferenceTeams, type ConferenceId } from './afl-conference';
import { selectDraftUnit } from './draft-utils';
import { getLeagueBySlug } from '../config/leagues';
import {
  AFL_MOCK_ROUNDS,
  buildAflMockOrder,
  keeperDeadlineFor,
  picksMadeIn,
  resolveMockWindow,
  rosterCutState,
  rosterFranchisesOf,
  rosteredPlayerIds,
  type MockWindow,
  type RosterFranchise,
} from './afl-mock-draft';

const AFL_SLUG = 'afl-fantasy';

/** Where a roster snapshot came from — surfaced, never swallowed. */
export type RosterSource = 'live' | 'feed' | 'none';

function readFeed(relativePath: string): unknown {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf-8'));
  } catch {
    return null;
  }
}

function aflFeedPath(year: number, file: string): string {
  return `${getLeagueBySlug(AFL_SLUG)!.dataPath}/mfl-feeds/${year}/${file}`;
}

/**
 * This conference's rosters, live where possible.
 *
 * `getCachedRosterFranchises` returns null when Redis is unreachable, which is
 * the normal case in local dev — hence the feed fallback rather than an error.
 */
export async function loadAflRosterFranchises(
  year: number,
  leagueId: string
): Promise<{ franchises: RosterFranchise[]; source: RosterSource }> {
  try {
    const live = await getCachedRosterFranchises(String(year), leagueId);
    if (live && live.length > 0) return { franchises: live, source: 'live' };
  } catch (err) {
    console.warn('[afl-mock-draft] Live roster fetch failed:', (err as Error).message);
  }

  const franchises = rosterFranchisesOf(readFeed(aflFeedPath(year, 'rosters.json')));
  return franchises.length > 0
    ? { franchises, source: 'feed' }
    : { franchises: [], source: 'none' };
}

export interface AflMockContext {
  conference: ConferenceId;
  /** MFL draft unit, e.g. `CONFERENCE01`. */
  unit: string;
  /** The twelve franchises that draft on this board, in config order. */
  franchiseIds: string[];
  /** Whether a mock is worth running right now, and why not when it isn't. */
  window: MockWindow;
  /** Player ids on this conference's rosters — and only this conference's. */
  rostered: Set<string>;
  /** Pick sequence, overall order, `AFL_MOCK_ROUNDS` rounds deep. */
  draftOrder: string[];
  rounds: number;
  rosterSource: RosterSource;
  /** Season this was resolved for. */
  year: number;
}

export interface BuildAflMockContextInput {
  conference: ConferenceId;
  year: number;
  leagueId: string;
  /** Injectable for tests and `?testDate=`. */
  now?: Date;
}

/**
 * Everything the lobby and the create endpoint both need, resolved once.
 *
 * Deliberately does NOT touch the player catalogue. It answers "may a mock run
 * here, and against whose rosters" — and for most of the year the answer is
 * no, so loading 1.4 MB of players to size a pool nobody will see is work
 * thrown away on the page's commonest state. Callers build the pool from
 * `rostered` once they know the window is open.
 */
export async function buildAflMockContext(
  input: BuildAflMockContextInput
): Promise<AflMockContext> {
  const { conference, year, leagueId } = input;
  const now = input.now ?? new Date();

  const franchiseIds = getConferenceTeams(conference).map((t) => t.franchiseId);
  const unit = `CONFERENCE${conference}`;

  const { franchises, source } = await loadAflRosterFranchises(year, leagueId);
  const rostered = rosteredPlayerIds(franchises, franchiseIds);
  const cuts = rosterCutState(franchises, franchiseIds);

  const draftResults = readFeed(aflFeedPath(year, 'draftResults.json')) as
    | { draftResults?: { draftUnit?: unknown } }
    | null;
  const draftUnit = selectDraftUnit<{ round?: string; pick?: string; franchise?: string; player?: string }>(
    draftResults?.draftResults?.draftUnit as never,
    unit
  );

  return {
    conference,
    unit,
    franchiseIds,
    window: resolveMockWindow({
      cuts,
      picksMade: picksMadeIn(draftUnit),
      deadline: keeperDeadlineFor(year),
      now,
      expectedTeams: franchiseIds.length,
    }),
    rostered,
    draftOrder: buildAflMockOrder(draftUnit, franchiseIds, AFL_MOCK_ROUNDS),
    rounds: AFL_MOCK_ROUNDS,
    rosterSource: source,
    year,
  };
}
