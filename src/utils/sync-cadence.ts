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

// ── The pre-kickoff lineup check ────────────────────────────────────────────
//
// A different question from the tiers above: not "how often", but "is a game
// about to lock players". The lineup warning (scripts/schefter-lineup-check.mjs)
// is useless once a flagged player's game has started — MFL locks him at his
// own kickoff — so it has to run ahead of EVERY kickoff slot, read from the
// real schedule: a Thursday opener, a 6:30am PT London game, the Sunday 10am
// slate, the late window, SNF, MNF. It used to be one Sunday 9:15am PT GitHub
// schedule, which GitHub delivered at 11:44, 12:44 and 12:34 PT on three
// straight Sundays — after every early kickoff, so it warned about players who
// were already locked (2026-10-04: a London game's WR flagged six hours late).

/** How far ahead of a kickoff the check is dispatched. Leaves room for the
 * workflow's ~7-minute run and still lands after most inactives are known. */
export const LINEUP_CHECK_LEAD_MINUTES = 75;

/**
 * Width of the dispatch band ending at the lead mark. Two ticks rather than
 * one so a single dropped Vercel tick cannot skip a kickoff; the script only
 * alerts problems it has not alerted this week, so the second run is quiet.
 */
export const LINEUP_CHECK_BAND_MINUTES = 10;

export interface LineupCheckDecision {
  dispatch: boolean;
  /** The kickoff (epoch seconds) this dispatch is ahead of, when dispatching. */
  kickoff?: number;
  reason: string;
}

/**
 * Should THIS tick dispatch the lineup check? Yes when some kickoff starts
 * between LEAD and LEAD-BAND minutes from now. Stateless, like the tiers: the
 * schedule plus the clock decide.
 */
export function lineupCheckDecision(
  now: Date = new Date(),
  kickoffs: (string | number)[] = []
): LineupCheckDecision {
  const t = now.getTime();
  const leadMs = LINEUP_CHECK_LEAD_MINUTES * 60 * 1000;
  const bandMs = LINEUP_CHECK_BAND_MINUTES * 60 * 1000;
  let best: number | undefined;
  for (const raw of kickoffs) {
    // Epoch SECONDS, same rejection as inGameWindow.
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0) continue;
    const until = seconds * 1000 - t;
    if (until <= leadMs && until > leadMs - bandMs && (best === undefined || seconds < best)) {
      best = seconds;
    }
  }
  if (best === undefined) {
    return { dispatch: false, reason: `No kickoff ${LINEUP_CHECK_LEAD_MINUTES} minutes out.` };
  }
  return {
    dispatch: true,
    kickoff: best,
    reason: `Kickoff at ${new Date(best * 1000).toISOString()} — check lineups before it locks.`,
  };
}

// ── Schefter's scheduled columns ────────────────────────────────────────────
//
// A third question: not "how often" or "before which kickoff", but "is it the
// minute a column is due". These are fixed times on the league's own clock —
// the Saturday 11am PT Matchup Preview (with the lineup roll call first), the
// Tuesday Pecking Order, and so on. They used to be GitHub `schedule:` crons
// on schefter-articles.yml, which GitHub delivers whenever it likes: on
// 2026-11-13 the Friday runs landed 5-8 hours late, and on 2026-11-14 the
// Saturday preview never started at all and was run by hand.
//
// Each slot is written in the LEAGUE clock (Pacific), never UTC, so daylight
// saving is the zone's problem, not a pair of DST-guarded UTC crons. A slot
// matches exactly ONE tick: the tick whose PT hour is the slot's and whose
// minute, floored to TICK_MINUTES, is the slot's minute. One dispatch per
// slot is deliberate — the workflow's concurrency group queues runs, and a
// second dispatch for the same slot would sit in that one pending place and
// could displace a different column queued behind it.

export type SchefterArticleType =
  | 'pecking-order'
  | 'schedule-strength'
  | 'waiver-pickups'
  | 'matchup-preview'
  | 'cut-watch'
  | 'schedule-release';

export interface SchefterArticleSlot {
  type: SchefterArticleType;
  /** 0 = Sunday … 6 = Saturday, in the league clock. `null` = every day. */
  weekday: number | null;
  /** Hour and minute in the league clock. Minute must be a multiple of the tick. */
  hour: number;
  minute: number;
}

/**
 * The columns and when each is due, Pacific time. Each type self-guards on its
 * own season window and dedups on the week's article id, so a slot firing in
 * the offseason is a no-op run, exactly as the old cron was.
 *
 * `schedule-release` is daily and a no-op until the commissioner's paste lands.
 * It sits at :30, not on the hour with the preview, so the two never share a
 * Saturday tick (on GitHub they did, and its `cancel-in-progress` meant one
 * cancelled the other).
 */
export const SCHEFTER_ARTICLE_SLOTS: readonly SchefterArticleSlot[] = [
  { type: 'pecking-order', weekday: 2, hour: 7, minute: 0 },
  { type: 'schedule-strength', weekday: 3, hour: 9, minute: 0 },
  { type: 'waiver-pickups', weekday: 3, hour: 22, minute: 0 },
  { type: 'matchup-preview', weekday: 6, hour: 11, minute: 0 },
  { type: 'cut-watch', weekday: 0, hour: 8, minute: 0 },
  { type: 'schedule-release', weekday: null, hour: 11, minute: 30 },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Weekday, hour and minute of `now` on `zone`'s wall clock. */
function wallClock(now: Date, zone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    weekday: WEEKDAYS.indexOf(get('weekday')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
}

export interface SchefterArticleDecision {
  /** The column types due on this tick, in slot order. Empty = skip. */
  types: SchefterArticleType[];
  reason: string;
}

/** Which Schefter columns are due on THIS tick? Stateless, like the tiers. */
export function schefterArticleDecision(
  now: Date = new Date(),
  { slots = SCHEFTER_ARTICLE_SLOTS, zone = LEAGUE_CLOCK.zone }: {
    slots?: readonly SchefterArticleSlot[];
    zone?: string;
  } = {},
): SchefterArticleDecision {
  const clock = wallClock(now, zone);
  const tickMinute = clock.minute - (clock.minute % TICK_MINUTES);
  const types = slots
    .filter(
      (s) =>
        (s.weekday === null || s.weekday === clock.weekday) &&
        s.hour === clock.hour &&
        s.minute === tickMinute,
    )
    .map((s) => s.type);
  const at = `${WEEKDAYS[clock.weekday]} ${String(clock.hour).padStart(2, '0')}:${String(tickMinute).padStart(2, '0')} ${zone}`;
  return {
    types,
    reason: types.length ? `${types.join(', ')} due at ${at}.` : `No column due at ${at}.`,
  };
}

// ── Fixed-interval jobs ─────────────────────────────────────────────────────
//
// Jobs whose old GitHub cron was a plain step ("every 30 min", "every 15 min
// in August"), moved onto the Vercel tick for the same reason as the columns
// above: GitHub drops and delays this repo's scheduled events. Each job's
// own script carries its real gates (season windows, deadlines, dedup), so all
// this decides is "is this tick one of the job's slots". Months are read on
// the league clock, so "May only" means May in Pacific time, not UTC.

export type IntervalJob =
  | 'apply-pending-contracts'
  | 'schefter-rumor-scan'
  | 'sync-draft-pick-contracts'
  | 'apply-august-cuts';

export interface IntervalJobSchedule {
  /** Minutes between dispatches. A multiple of TICK_MINUTES that divides 60. */
  intervalMinutes: number;
  /** 1-12 on the league clock. Omitted = every month. */
  months?: readonly number[];
}

export const INTERVAL_JOBS: Readonly<Record<IntervalJob, IntervalJobSchedule>> = {
  // Owners' submitted contract declarations, written to MFL.
  'apply-pending-contracts': { intervalMinutes: 30 },
  // Rumor mill + trade-offer rumors + the trade-deadline wrap-up.
  'schefter-rumor-scan': { intervalMinutes: 15 },
  // Rookie contracts stamped on new draft picks — TheLeague's May draft window.
  'sync-draft-pick-contracts': { intervalMinutes: 5, months: [5] },
  // TheLeague's August cutdown; the script's --auto picks the mode by date.
  'apply-august-cuts': { intervalMinutes: 15, months: [8] },
};

export interface IntervalJobDecision {
  dispatch: boolean;
  reason: string;
}

/** Should THIS tick dispatch `job`? Stateless: the clock decides. */
export function intervalJobDecision(
  job: IntervalJob,
  now: Date = new Date(),
  zone: string = LEAGUE_CLOCK.zone,
): IntervalJobDecision {
  const { intervalMinutes, months } = INTERVAL_JOBS[job];
  if (months) {
    const month = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'numeric' }).format(now),
    );
    if (!months.includes(month)) {
      return { dispatch: false, reason: `${job} runs only in month(s) ${months.join(', ')}.` };
    }
  }
  // Every interval divides 60 and every zone in use is a whole-hour offset,
  // so the UTC minute is the league-clock minute. The cron fires a little
  // after the minute, so the minute itself is the slot.
  const dispatch = now.getUTCMinutes() % intervalMinutes === 0;
  return {
    dispatch,
    reason: dispatch
      ? `${job} slot (every ${intervalMinutes} min).`
      : `${job} is between dispatches (every ${intervalMinutes} min).`,
  };
}
