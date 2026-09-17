/**
 * How often the roster sync should actually run, right now.
 *
 * ## Why this is a function and not a cron expression
 *
 * The obvious way to sync faster during games is a day-of-week cron — a
 * quarter-hourly step restricted to Sunday, Monday and Thursday. **That is the
 * exact derivation this repo bans** (`docs/claude/rules/schedule-optimization.md`
 * § "The NFL kickoff is not a derivation"). In 2026 alone it is wrong three
 * times: the season opened on a WEDNESDAY, week 12 moved to Wednesday for
 * Thanksgiving, and week 18 runs all-Sunday. A cron expression cannot read a
 * schedule, so the decision has to live somewhere that can.
 *
 * So Vercel fires this on a flat `TICK_MINUTES` cadence and the ROUTE decides
 * whether that tick becomes a dispatch. A skipped tick costs one function
 * invocation; a dispatch costs a workflow run and — because every changed sync
 * commits to `main` — a production build. Builds are 91% of the Vercel bill,
 * so the whole point of this module is to spend them where they buy something.
 *
 * ## The tiers
 *
 * | Tier     | When                                   | Cadence |
 * |----------|----------------------------------------|---------|
 * | `waiver` | a waiver run, until +WAIVER_TAIL_HOURS | 5 min   |
 * | `game`   | a kickoff, until +GAME_WINDOW_HOURS    | 15 min  |
 * | `idle`   | everything else                        | 60 min  |
 *
 * `waiver` is the tightest deliberately: it is the one moment a dozen rosters
 * change at once, on a schedule owners know and are watching. It is also the
 * failure this whole mechanism was built for — on 2026-09-16 the site sat a
 * full hour past the Wed 19:00 PT run still showing pre-waiver rosters.
 *
 * ## Both leagues, not just TheLeague
 *
 * One workflow run syncs every league, and their waiver runs do not coincide —
 * TheLeague processes `WAIVER_BBID` at Wed 19:00 PT, the AFL `WAIVER_REVERSE`
 * at Wed 20:00 PT. The windows are therefore a UNION over the calendars passed
 * in: any league in its waiver tail puts the whole sync in the waiver tier.
 * Scoping this to one league's calendar would leave the other's owners staring
 * at stale rosters for an hour, which is the original bug wearing a hat.
 *
 * ## Stateless on purpose
 *
 * The tier plus the wall-clock minute decides, so nothing is stored and there
 * is no "when did we last run" record to go stale, disagree with reality, or
 * need a Redis round-trip on a path that must not fail open. Every tier
 * interval divides 60, so the tick slots nest exactly: an idle dispatch is
 * always also a game slot, which is always also a waiver slot. Crossing a tier
 * boundary can therefore never skip a beat.
 */

import { lastWaiverRunAtOrBefore, type MflCalendarEvent } from './waiver-window';
import { LEAGUE_CLOCK } from './viewer-preferences';

/** The Vercel cron's own cadence. Every tier interval must be a multiple. */
export const TICK_MINUTES = 5;

/** How long after a waiver run the roster churn is worth chasing at full speed. */
export const WAIVER_TAIL_HOURS = 2;

/**
 * How long after a kickoff that game is assumed live. Chosen at 3.5h to cover a
 * typical NFL game plus overtime; Sunday's staggered slates overlap into
 * near-continuous coverage anyway, so in practice this sets how long we stay
 * fast after the LAST kickoff of the day rather than gating the middle.
 */
export const GAME_WINDOW_HOURS = 3.5;

export type SyncTier = 'waiver' | 'game' | 'idle';

/** Minutes between dispatches, per tier. Each must divide 60 — see the header. */
export const TIER_INTERVAL_MINUTES: Record<SyncTier, number> = {
  waiver: 5,
  game: 15,
  idle: 60,
};

export interface SyncCadenceInput {
  /** One entry per league — the MFL calendar events for its current league year. */
  calendars?: (MflCalendarEvent[] | null | undefined)[];
  /** Kickoff instants, in EPOCH SECONDS, as MFL's nflSchedule feed reports them. */
  kickoffs?: (string | number)[];
  /** The zone MFL keeps the schedule in; recurrences repeat on THAT wall clock. */
  zone?: string;
}

export interface SyncCadenceDecision {
  tier: SyncTier;
  /** Whether THIS tick should dispatch the workflow. */
  dispatch: boolean;
  /** Minutes between dispatches in the resolved tier. */
  intervalMinutes: number;
  /** Why — surfaced in the route's JSON so a skipped tick is legible in logs. */
  reason: string;
}

const HOUR_MS = 60 * 60 * 1000;

/** Is `now` inside [kickoff, kickoff + GAME_WINDOW_HOURS] for any game? */
function inGameWindow(now: number, kickoffs: (string | number)[]): boolean {
  const windowMs = GAME_WINDOW_HOURS * HOUR_MS;
  for (const raw of kickoffs) {
    // MFL reports kickoff in epoch SECONDS. A millisecond value here would put
    // every game ~55,000 years out and silently disable the tier, so reject
    // anything that is not a plausible second-precision timestamp.
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const at = seconds * 1000;
    if (now >= at && now <= at + windowMs) return true;
  }
  return false;
}

/** Is `now` inside the tail of a waiver run, in ANY of the leagues passed in? */
function inWaiverTail(
  now: number,
  calendars: (MflCalendarEvent[] | null | undefined)[],
  zone: string
): boolean {
  const tailMs = WAIVER_TAIL_HOURS * HOUR_MS;
  for (const events of calendars) {
    const last = lastWaiverRunAtOrBefore(events, new Date(now), zone);
    if (last && now - last.getTime() <= tailMs) return true;
  }
  return false;
}

/**
 * Resolve the tier for `now`, and whether this tick dispatches.
 *
 * Fails toward MORE syncing, never less: with no calendars and no schedule the
 * answer is `idle`, which is hourly — the pre-2026-03 cadence, not silence. A
 * feed that failed to load must not be able to turn the sync off.
 */
export function syncCadenceDecision(
  now: Date = new Date(),
  input: SyncCadenceInput = {}
): SyncCadenceDecision {
  const { calendars = [], kickoffs = [], zone = LEAGUE_CLOCK.zone } = input;
  const t = now.getTime();

  let tier: SyncTier = 'idle';
  let reason = 'No game or waiver window — hourly.';
  if (inWaiverTail(t, calendars, zone)) {
    tier = 'waiver';
    reason = `Within ${WAIVER_TAIL_HOURS}h of a waiver run — rosters are churning.`;
  } else if (inGameWindow(t, kickoffs)) {
    tier = 'game';
    reason = `Within ${GAME_WINDOW_HOURS}h of a kickoff — scores are live.`;
  }

  const intervalMinutes = TIER_INTERVAL_MINUTES[tier];
  // The cron fires a little after the minute, so the minute itself is the slot.
  const dispatch = now.getUTCMinutes() % intervalMinutes === 0;

  return {
    tier,
    dispatch,
    intervalMinutes,
    reason: dispatch ? reason : `${reason} This tick is between dispatches.`,
  };
}
