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
 * Reads the feeds with `fs` rather than `import.meta.glob` deliberately: the
 * homepage is SSR (`prerender = false`), the draft predictor page already reads
 * these exact files the same way, and globbing would compile every season of
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
import { getAflLeagueYear } from './league-year';
import { getLeagueBySlug } from '../config/leagues';
import { isAflDraftWindowOpen, type AflDraftSlot } from './afl-team-spotlight';
import type { StandingsFranchise } from '../types/standings';

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

interface RawDraftPick {
  round?: string;
  pick?: string;
  franchise?: string;
  player?: string;
}

interface RawDraftUnit {
  unit?: string;
  draftPick?: RawDraftPick | RawDraftPick[];
}

function feedPath(year: number, file: string): string {
  const dataPath = getLeagueBySlug('afl-fantasy')!.dataPath;
  return path.join(process.cwd(), dataPath, 'mfl-feeds', String(year), file);
}

/**
 * Parsed feeds, cached for the life of the process.
 *
 * This runs on the AFL homepage — the most-hit page — and the four feeds it
 * touches come to ~170 KB of JSON, re-parsed on every request without this.
 * They are committed files that only change on deploy, so a process-lifetime
 * cache has exactly the staleness of the `import.meta.glob` the rest of the
 * page uses (and matches how `afl-career-stats.ts` memoizes). A miss is cached
 * too: a feed that does not exist must not be re-stat'd every request.
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

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The board's draft unit for one conference, or null when there is no board. */
function conferenceUnit(
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
function isConferenceDraftComplete(
  board: unknown,
  conferenceId: string
): boolean {
  const unit = conferenceUnit(board, conferenceId);
  if (!unit) return false;
  const picks = asArray(unit.draftPick);
  return picks.length > 0 && picks.every((p) => !!p.player && p.player !== '');
}

/** Round-1 pick numbers this franchise holds on the board, ascending. */
function heldRoundOnePicks(
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

export interface AflDraftSlotOptions {
  franchiseId: string;
  /** '00' (AL) or '01' (NL). Anything else skips the tier. */
  conferenceId?: string;
  referenceDate?: Date;
}

/**
 * The franchise's round-1 slot, or null when the draft tier does not apply —
 * outside the window, unknown conference, or no computable base slot.
 */
export function loadAflDraftSlot(
  opts: AflDraftSlotOptions
): AflDraftSlot | null {
  const { franchiseId, conferenceId, referenceDate } = opts;
  if (!conferenceId || !(conferenceId in CONFERENCE_UNIT)) return null;

  // The AFL league year IS the upcoming draft's year: the registry's June 1
  // rollover flips it the moment the new MFL league is created, and that
  // league's draft is the one being ordered.
  const draftYear = getAflLeagueYear(referenceDate);
  const board = readJson(feedPath(draftYear, 'draftResults.json'));

  if (
    !isAflDraftWindowOpen({
      aflLeagueYear: draftYear,
      calendarYear: (referenceDate ?? new Date()).getFullYear(),
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
  const standings = asArray(standingsFeed?.leagueStandings?.franchise);
  if (!standings.length) return null;

  const aflConfig = readJson<{
    teams?: Array<{
      franchiseId: string;
      name: string;
      icon?: string;
      banner?: string;
      conference?: string;
      division?: string;
    }>;
  }>(path.join(process.cwd(), getLeagueBySlug('afl-fantasy')!.configPath));

  const teamConfigMap = new Map(
    (aflConfig?.teams ?? []).map((team) => [
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
  const brackets = readJson(feedPath(standingsYear, 'playoff-brackets.json'));
  const conferenceChampions = brackets
    ? parseConferenceChampions(brackets, teamConfigMap)
    : new Map<string, string>();
  const nitResults = brackets
    ? parseNITResults(brackets, teamConfigMap)
    : new Map<string, Array<{ franchiseId: string; finishPosition: number }>>();

  // Regular-season head-to-head drives step 1 of the same-division tiebreaker.
  // Missing raw results just drops that step, same as on the predictor page.
  const raw = readJson(feedPath(standingsYear, 'weekly-results-raw.json'));
  const headToHead = raw ? buildHeadToHeadFromRaw(raw) : undefined;

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
