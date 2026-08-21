/**
 * Resolve one franchise's round-1 draft slot for the AFL homepage spotlight
 * tile (`afl-team-spotlight.ts`).
 *
 * Two different things are needed and they come from two different places:
 *
 *   - The BASE slot — the pick the franchise earned — is standings-derived, via
 *     the same `calculateAFLDraftOrder` the draft predictor page renders. It has
 *     to be, because MFL's board does not preserve it: when a pick is traded,
 *     MFL reassigns the slot to the new owner and the earned position is gone.
 *   - The HELD picks come off MFL's board (`draftResults.json`), which is the
 *     only place trades show up. The 2025 board is the proof this matters —
 *     two franchises held two round-1 picks and two held none.
 *
 * Split into a pure resolver (`resolveAflDraftSlotFrom`) and a thin fs wrapper
 * (`loadAflDraftSlot`) on purpose. `mfl-feeds/**` is cron-written, so a test
 * that asserts against the live board asserts against a file that changes under
 * it — the moment the conference drafts run, "the board is unfinished" stops
 * being true and every such assertion fails on a data-only commit. The pure
 * half takes fixtures and stays deterministic; only the wrapper touches disk.
 *
 * Reads the feeds with `fs` rather than `import.meta.glob`: the homepage is SSR
 * (`prerender = false`), the draft predictor page already reads these exact
 * files the same way, and globbing would compile every season of
 * `weekly-results-raw.json` into the server bundle for one season's use. The
 * three newest seasons stay reachable at request time by design — see
 * `scripts/lib/archived-feed-files.mjs`.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  buildHeadToHeadFromRaw,
  calculateAFLDraftOrder,
  parseConferenceChampions,
  parseNITResults,
} from './afl-draft-utils';
import { getAflLeagueYear, getTestDateFromUrl } from './league-year';
import { getLeagueBySlug } from '../config/leagues';
import { isAflDraftWindowOpen, type AflDraftSlot } from './afl-team-spotlight';
import type { StandingsFranchise } from '../types/standings';
// Static import, not an fs read through the registry's `configPath`: the config
// is already compiled into the bundle (afl-awards.ts imports it the same way),
// which makes this typed, free, and one less 46 KB parse. `configPath` is also
// absent from the `LeagueDefinition` interface — its only other consumers are
// untyped .mjs scripts, so reading it here was a TS2339.
import aflConfig from '../../data/afl-fantasy/afl.config.json';

/** MFL's per-conference draft unit ids on the AFL board. */
const CONFERENCE_UNIT: Record<string, string> = {
  '00': 'CONFERENCE00',
  '01': 'CONFERENCE01',
};

const CONFERENCE_SHORT: Record<string, string> = {
  '00': 'AL',
  '01': 'NL',
};

/** `calculateAFLDraftOrder` labels its two orders by full conference name. */
const CONFERENCE_ORDER_NAME: Record<string, string> = {
  '00': 'American League',
  '01': 'National League',
};

export interface RawDraftPick {
  round?: string;
  pick?: string;
  franchise?: string;
  player?: string;
}

export interface RawDraftUnit {
  unit?: string;
  draftPick?: RawDraftPick | RawDraftPick[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The board's draft unit for one conference, or null when there is no board. */
export function conferenceUnit(
  board: unknown,
  conferenceId: string
): RawDraftUnit | null {
  const units = asArray(
    (board as { draftResults?: { draftUnit?: RawDraftUnit | RawDraftUnit[] } } | null)
      ?.draftResults?.draftUnit
  );
  if (!units.length) return null;
  // Match strictly on MFL's unit id (`CONFERENCE00`/`CONFERENCE01`, stable
  // across every archived board). No positional fallback on purpose: reading
  // the wrong conference's slots would asterisk a pick the owner never traded,
  // and null degrades the tile to "base slot, no asterisk" instead.
  return units.find((u) => u.unit === CONFERENCE_UNIT[conferenceId]) ?? null;
}

/** True once every slot in this conference's board carries a real selection. */
export function isConferenceDraftComplete(
  board: unknown,
  conferenceId: string
): boolean {
  const unit = conferenceUnit(board, conferenceId);
  if (!unit) return false;
  const picks = asArray(unit.draftPick);
  return picks.length > 0 && picks.every((p) => !!p.player && p.player !== '');
}

/** Round-1 pick numbers this franchise holds on the board, ascending. */
export function heldRoundOnePicks(
  board: unknown,
  conferenceId: string,
  franchiseId: string
): number[] | null {
  const unit = conferenceUnit(board, conferenceId);
  if (!unit) return null;
  const picks = asArray(unit.draftPick).filter((p) => Number(p.round) === 1);
  if (!picks.length) return null;
  return picks
    .filter((p) => p.franchise === franchiseId)
    .map((p) => Number(p.pick))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

/**
 * True when a board is still exactly as MFL seeded it — every franchise holding
 * exactly one round-1 pick, nothing drafted yet.
 *
 * Only in that state can the board be compared against our standings-derived
 * order, because only then are the two describing the same thing. Once a pick
 * is traded MFL has overwritten who earned the slot, and once the draft runs
 * the question is moot. Exported so the test can gate its cross-check on the
 * precondition instead of assuming it holds forever.
 */
export function isBoardStillSeeded(
  board: unknown,
  conferenceId: string
): boolean {
  const unit = conferenceUnit(board, conferenceId);
  if (!unit) return false;
  const picks = asArray(unit.draftPick);
  if (!picks.length) return false;
  if (picks.some((p) => !!p.player && p.player !== '')) return false;
  const roundOne = picks.filter((p) => Number(p.round) === 1);
  const holders = new Set(roundOne.map((p) => p.franchise));
  return roundOne.length > 0 && holders.size === roundOne.length;
}

// ── Pure resolver ───────────────────────────────────────────────────────────

export interface AflDraftSlotInputs {
  franchiseId: string;
  /** '00' (AL) or '01' (NL). */
  conferenceId: string;
  /** The upcoming draft's year — the AFL league year. */
  draftYear: number;
  /** `referenceDate.getFullYear()`, for the June 1 floor. */
  calendarYear: number;
  /** Parsed `draftResults.json` for `draftYear`, or null when unpublished. */
  board: unknown;
  /** Standings rows for season `draftYear - 1`. */
  standings: StandingsFranchise[];
  /** Parsed `playoff-brackets.json` for season `draftYear - 1`, or null. */
  brackets?: unknown;
  /** Parsed `weekly-results-raw.json` for season `draftYear - 1`, or null. */
  weeklyResultsRaw?: unknown;
}

/**
 * The franchise's round-1 slot, or null when the draft tier does not apply.
 * Pure: everything it reads is passed in.
 */
export function resolveAflDraftSlotFrom(
  inputs: AflDraftSlotInputs
): AflDraftSlot | null {
  const {
    franchiseId,
    conferenceId,
    draftYear,
    calendarYear,
    board,
    standings,
    brackets,
    weeklyResultsRaw,
  } = inputs;

  if (!(conferenceId in CONFERENCE_UNIT)) return null;

  if (
    !isAflDraftWindowOpen({
      aflLeagueYear: draftYear,
      calendarYear,
      conferenceDraftComplete: isConferenceDraftComplete(board, conferenceId),
    })
  ) {
    return null;
  }

  if (!standings.length) return null;

  const teamConfigMap = new Map(
    aflConfig.teams.map((team) => [
      team.franchiseId,
      {
        id: team.franchiseId,
        name: team.name,
        icon: team.icon,
        banner: team.banner,
        conference: team.conference,
        division: team.division,
      },
    ])
  );

  // Champions and NIT finishers carry draft-order bonuses; both are absent
  // until the postseason runs, which is exactly the "projected order" state the
  // predictor page also renders.
  const conferenceChampions = brackets
    ? parseConferenceChampions(brackets, teamConfigMap)
    : new Map<string, string>();
  const nitResults = brackets
    ? parseNITResults(brackets, teamConfigMap)
    : new Map<string, Array<{ franchiseId: string; finishPosition: number }>>();

  // Regular-season head-to-head drives step 1 of the same-division tiebreaker.
  // Missing raw results just drops that step, same as on the predictor page.
  const headToHead = weeklyResultsRaw
    ? buildHeadToHeadFromRaw(weeklyResultsRaw)
    : undefined;

  const orders = calculateAFLDraftOrder(
    standings,
    teamConfigMap,
    conferenceChampions,
    nitResults,
    headToHead
  );

  const order = orders.find(
    (o) => o.conference === CONFERENCE_ORDER_NAME[conferenceId]
  );
  const basePick = order?.picks.find(
    (p) => p.round === 1 && p.franchiseId === franchiseId
  )?.pickInRound;
  if (!basePick) return null;

  return {
    basePick,
    heldPicks: heldRoundOnePicks(board, conferenceId, franchiseId),
    conferenceShort: CONFERENCE_SHORT[conferenceId],
    draftYear,
  };
}

// ── Feed loading ────────────────────────────────────────────────────────────

function feedPath(year: number, file: string): string {
  const dataPath = getLeagueBySlug('afl-fantasy')!.dataPath;
  return path.join(process.cwd(), dataPath, 'mfl-feeds', String(year), file);
}

/**
 * Parsed feeds, cached for the life of the process.
 *
 * This runs on the AFL homepage — the most-hit page — and the feeds are not
 * small: the prior season's `weekly-results-raw.json` alone is ~1.6 MB, with
 * the board, standings and brackets adding ~100 KB. Re-reading and re-parsing
 * that per request is not viable, so it happens once per process. The 1.6 MB
 * file buys exactly one thing — the head-to-head ledger behind step 1 of the
 * same-division tiebreaker — and it is loaded anyway, because dropping it would
 * let our base order diverge from the draft predictor's and asterisk a pick
 * nobody traded.
 *
 * Committed feeds only change on deploy, so a process-lifetime cache has
 * exactly the staleness `import.meta.glob` already has (and matches how
 * `afl-career-stats.ts` memoizes). Misses are cached too: a feed that does not
 * exist must not be re-`stat`'d on every request.
 */
const feedCache = new Map<string, unknown>();

function readJson<T>(file: string): T | null {
  if (feedCache.has(file)) return feedCache.get(file) as T | null;
  let parsed: T | null;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    // A feed that does not exist yet is a normal state, not an error: the
    // board is absent until MFL seeds it, and playoff brackets are absent
    // until the postseason runs.
    parsed = null;
  }
  feedCache.set(file, parsed);
  return parsed;
}

export interface AflDraftSlotOptions {
  franchiseId: string;
  /** '00' (AL) or '01' (NL). Anything else skips the tier. */
  conferenceId?: string;
  referenceDate?: Date;
}

/**
 * Read the feeds this franchise's slot needs and resolve it. Returns null when
 * the draft tier does not apply — outside the window, unknown conference, or no
 * computable base slot.
 */
export function loadAflDraftSlot(
  opts: AflDraftSlotOptions
): AflDraftSlot | null {
  const { franchiseId, conferenceId, referenceDate } = opts;
  if (!conferenceId || !(conferenceId in CONFERENCE_UNIT)) return null;

  // ONE date for both halves of the window check. `getAflLeagueYear(undefined)`
  // resolves its own `new Date()` internally, so letting it default while
  // computing `calendarYear` from a second `new Date()` compares two different
  // instants: across a New Year boundary they disagree and the gate flips shut.
  // Browser-side it is worse — `getAflLeagueYear` honors `?testDate=` and a
  // bare `.getFullYear()` does not, so the two would straddle clocks entirely.
  const ref = referenceDate ?? getTestDateFromUrl() ?? new Date();

  // The AFL league year IS the upcoming draft's year: the registry's June 1
  // rollover flips it the moment the new MFL league is created, and that
  // league's draft is the one being ordered.
  const draftYear = getAflLeagueYear(ref);
  const calendarYear = ref.getFullYear();
  const board = readJson(feedPath(draftYear, 'draftResults.json'));

  // Bail before the expensive reads when the window is shut — which is most of
  // the year, and every request outside June → the conference draft.
  if (
    !isAflDraftWindowOpen({
      aflLeagueYear: draftYear,
      calendarYear,
      conferenceDraftComplete: isConferenceDraftComplete(board, conferenceId),
    })
  ) {
    return null;
  }

  // The order for draft year Y is set by season Y-1. Deriving it that way
  // rather than from getCurrentSeasonYear() keeps it off the Labor Day clock:
  // the two agree all offseason, but after kickoff getCurrentSeasonYear() names
  // a season whose standings are still all zeros.
  const standingsYear = draftYear - 1;
  const standingsFeed = readJson<{
    leagueStandings?: { franchise?: StandingsFranchise | StandingsFranchise[] };
  }>(feedPath(standingsYear, 'standings.json'));

  return resolveAflDraftSlotFrom({
    franchiseId,
    conferenceId,
    draftYear,
    calendarYear,
    board,
    standings: asArray(standingsFeed?.leagueStandings?.franchise),
    brackets: readJson(feedPath(standingsYear, 'playoff-brackets.json')),
    weeklyResultsRaw: readJson(
      feedPath(standingsYear, 'weekly-results-raw.json')
    ),
  });
}
