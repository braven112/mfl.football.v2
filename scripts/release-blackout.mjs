#!/usr/bin/env node
/**
 * Is today a day we must NOT promote staging to production?
 *
 * The release train ships Tuesdays (docs/plans/staging-release-process.md), and
 * on a normal Tuesday every rule here passes. This exists for the other cases:
 * an ad-hoc promotion, a Tuesday that happens to be Thanksgiving week, a
 * release the day the MFL league year rolls over.
 *
 * A script rather than a paragraph in the skill, for the reason CLAUDE.md gives
 * under *Prefer the mechanical path*: a date rule that lives in prose is a rule
 * somebody has to remember at the exact moment they are least inclined to —
 * about to ship, on a Tuesday, with the week's work already reviewed.
 *
 * ALL dates are evaluated in PACIFIC. That is the league's official clock
 * (`officialClock` in the registry) and the zone every deadline in this league
 * is quoted in, so "is it Sunday?" has to mean Sunday in PT, not in UTC — a
 * UTC-evaluated Sunday starts at 4pm Saturday Pacific and ends mid-afternoon.
 *
 *   node scripts/release-blackout.mjs                 # today
 *   node scripts/release-blackout.mjs --date 2026-11-26
 *   node scripts/release-blackout.mjs --json
 *
 * Exit 0 = clear to promote. Exit 1 = blacked out (reason on stdout).
 */

import { ptParts } from '../src/utils/nfl-week-starts.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { laborDayIsoDate } from '../src/utils/labor-day.mjs';
import { aflNationalLeagueDraft } from '../src/utils/schedule-release.mjs';

/**
 * Weekdays that carry NFL games, as JS day numbers (0 = Sunday).
 *
 * Thursday, Saturday, Sunday, Monday. Saturday only carries games from ~week 15
 * on, but it is included year-round-in-season deliberately: the cost of a false
 * blackout is waiting a day, and the cost of a miss is deploying into a live
 * slate. Tuesday, Wednesday and Friday are clear — which is why Tuesday is the
 * train's day.
 */
const GAME_WEEKDAYS = new Set([0, 1, 4, 6]);

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A PT calendar day, as the {year, month, day, weekday} we actually reason about. */
function ptDay(instant) {
  const parts = ptParts(instant);
  const iso = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  // Noon UTC on that ISO date is the same calendar day in every US zone, so the
  // weekday it yields is the PT weekday without a second timezone conversion.
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return { ...parts, iso, weekday };
}

/** Whole days from `from` to `to`, both ISO `YYYY-MM-DD`. Negative = `to` is past. */
function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T12:00:00Z`);
  const b = Date.parse(`${toIso}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * ISO day of a UTC `Date`. Only for helpers that return a Date —
 * `laborDayIsoDate` already hands back a string, and `laborDayDate` returns a
 * day-of-month NUMBER, which is exactly the shape mismatch this comment exists
 * to stop the next reader repeating.
 */
function isoOf(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Decide whether `now` falls in a release blackout.
 *
 * Pure — takes the instant, returns the decision — so the rules are testable at
 * every boundary without touching the system clock.
 *
 * @param {Date} now
 * @returns {{ blocked: boolean, reasons: string[], date: string, weekday: string }}
 */
export function resolveBlackout(now = new Date()) {
  const today = ptDay(now);
  const reasons = [];

  // 1. NFL game days, in season only.
  //
  // Out of season a Sunday is just a Sunday. `isSeasonWindowOpen` is the repo's
  // own answer to "is the season actually being played" and is deliberately not
  // `month >= 9` — see CLAUDE.md on the Sunday that named 17 AFL teams for not
  // setting a lineup nobody could set yet.
  const inSeason = isSeasonWindowOpen(today.year, now);
  if (inSeason && GAME_WEEKDAYS.has(today.weekday)) {
    reasons.push(
      `${WEEKDAY_NAMES[today.weekday]} in season — NFL games run Thu/Sat/Sun/Mon, ` +
        `and live scoring is the surface owners are actually watching`,
    );
  }

  // 2. The MFL league-year rollover, Feb 14 at 8:45 PT.
  //
  // ±1 day: the rollover moves every roster, contract and cap number in the
  // app, and the day after is when a bug in that transition surfaces. Shipping
  // code into the middle of it makes the two indistinguishable.
  const rolloverGap = daysBetween(today.iso, `${today.year}-02-14`);
  if (Math.abs(rolloverGap) <= 1) {
    reasons.push(
      rolloverGap === 0
        ? 'MFL league-year rollover is today (Feb 14, 8:45 PT)'
        : `MFL league-year rollover is ${rolloverGap > 0 ? 'tomorrow' : 'yesterday'} (Feb 14)`,
    );
  }

  // 3. Labor Day through Labor Day + 3 — the season-year rollover.
  //
  // The second of the repo's two independent year clocks, and the window where
  // "in season" flips. Both clocks have shipped bugs; neither day is one to
  // also change code on.
  const laborDay = laborDayIsoDate(today.year);
  const sinceLaborDay = daysBetween(laborDay, today.iso);
  if (sinceLaborDay >= 0 && sinceLaborDay <= 3) {
    reasons.push(
      `Labor Day + ${sinceLaborDay} — the season-year rollover window ` +
        `(getCurrentSeasonYear turns here, and "in season" is Labor Day + 3)`,
    );
  }

  // 4. The AFL's National League draft.
  //
  // Derived, not fixed — the Sunday eight days before Labor Day. The draft room,
  // broadcast and PartyKit are all live that day for a whole conference.
  //
  // TheLeague's draft is NOT covered here: its date lives in the league-events
  // registry rather than an .mjs this script can import. That gap is stated in
  // the /promote skill as a human check rather than silently omitted.
  try {
    const aflDraft = isoOf(aflNationalLeagueDraft(today.year));
    const draftGap = daysBetween(today.iso, aflDraft);
    if (Math.abs(draftGap) <= 1) {
      reasons.push(
        `AFL National League draft is ${draftGap === 0 ? 'today' : draftGap > 0 ? 'tomorrow' : 'yesterday'} ` +
          `(${aflDraft}) — draft room, broadcast and PartyKit are live`,
      );
    }
  } catch {
    // A derivation failure must not block a release. Say nothing and let the
    // human check in the skill carry it.
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    date: today.iso,
    weekday: WEEKDAY_NAMES[today.weekday],
    inSeason,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('release-blackout.mjs');

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const dateArg = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;
  const now = dateArg ? new Date(`${dateArg}T12:00:00-08:00`) : new Date();

  const result = resolveBlackout(now);

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.blocked) {
    console.log(`[blackout] ${result.weekday} ${result.date} — DO NOT PROMOTE`);
    for (const reason of result.reasons) console.log(`  · ${reason}`);
  } else {
    console.log(`[blackout] ${result.weekday} ${result.date} — clear to promote`);
  }

  process.exit(result.blocked ? 1 : 0);
}
