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

import { ptParts, REGULAR_SEASON_WEEKS, nflWeekStartIsoDate } from '../src/utils/nfl-week-starts.mjs';
import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { laborDayIsoDate } from '../src/utils/labor-day.mjs';
import { aflNationalLeagueDraft } from '../src/utils/schedule-release.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * Weekdays that routinely carry NFL games, as JS day numbers (0 = Sunday):
 * Thursday, Sunday, Monday.
 *
 * SATURDAY WAS DELIBERATELY REMOVED (2026-09-19, Brandon's call). It used to be
 * in this set on the reasoning that "a false blackout costs a day's wait, a
 * miss deploys into a live slate" — but the NFL plays no Saturday games for
 * the great majority of the season (the Sports Broadcasting Act keeps the NFL
 * off Saturdays while college football is in its regular season), so the rule
 * blacked out ~13 Saturdays a year to protect the two or three at the end that
 * carry a late-season slate. That is a standing weekly tax for an outlier, and
 * the outlier is the thing to ignore.
 *
 * WHAT THIS NOW DOES NOT COVER: the week-15-onward Saturday slates and the
 * wild-card Saturday. They are NOT week starts, so `officialWeekStartDays()`
 * below does not catch them either. From roughly mid-December through the
 * postseason, a Saturday promotion is on the promoter to check. Everything the
 * real schedule opens a week on is still caught automatically, year-round.
 *
 * THIS SET IS NOT THE WHOLE ANSWER, and treating it as such was a bug. The
 * NFL's opening week and its Thanksgiving week do not start on Thursday —
 * 2026 week 1 is WEDNESDAY Sep 9 and week 12 is WEDNESDAY Nov 25 — so a fixed
 * weekday list reported "clear to promote" on two live game days. CLAUDE.md
 * says it outright: kickoff is not a derivation, read the schedule. Hence
 * `officialWeekStartDays()` below, which adds whatever days the real calendar
 * says a week begins on.
 */
const ROUTINE_GAME_WEEKDAYS = new Set([0, 1, 4]);

/**
 * The ISO days a season's weeks actually begin on, from the committed
 * schedule. Derived per season rather than assumed, for the reason above.
 *
 * @param {number} seasonYear
 * @returns {Set<string>}
 */
function officialWeekStartDays(seasonYear) {
  const days = new Set();
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
    try {
      days.add(nflWeekStartIsoDate(seasonYear, week));
    } catch {
      // A season with no schedule yet contributes nothing; the routine
      // weekday set still covers it.
    }
  }
  return days;
}

/**
 * The NFL SEASON year for a calendar day — which is not the calendar year.
 *
 * Week 18 of the 2026 season starts 2027-01-10. Asking
 * `isSeasonWindowOpen(2027, …)` on that day compares against a kickoff still
 * eight months away and answers "not in season" for a live game day. The
 * season clock turns at Labor Day, exactly as CLAUDE.md's two-clocks rule
 * says, so resolve it that way before asking anything about the season.
 *
 * @param {{ iso: string, year: number }} today
 */
function seasonYearOf(today) {
  return today.iso >= laborDayIsoDate(today.year) ? today.year : today.year - 1;
}

/**
 * Every league's MFL league-year rollover, as `{ slug, month, day }`.
 *
 * Read from the registry, never hardcoded: TheLeague rolls on Feb 14, but the
 * AFL and Best Ball declare `leagueYearRollover` of June 1 because their MFL
 * leagues are created in late spring. A blackout that knew only about Feb 14
 * would promote straight through the AFL's transition — the exact class of
 * calendar boundary this check exists to avoid.
 */
function leagueRollovers() {
  return Object.values(LEAGUES).map((league) => ({
    slug: league.slug,
    month: league.leagueYearRollover?.month ?? 2,
    day: league.leagueYearRollover?.day ?? 14,
  }));
}

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
 * `inSeason` is part of the contract, not a debug extra: callers and tests use
 * it to distinguish "clear because it is the offseason" from "clear because it
 * is a Tuesday", and those are different answers. Leaving it off this
 * annotation is what raised the type-error baseline by one — TypeScript
 * believes the JSDoc over the `return`.
 *
 * @param {Date} now
 * @returns {{ blocked: boolean, reasons: string[], date: string, weekday: string, inSeason: boolean, seasonYear: number }}
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
  //
  // The season year is resolved on the Labor Day clock first: in January the
  // calendar year is already the NEXT one, and asking about that season reports
  // a week-18 Sunday as the offseason.
  const seasonYear = seasonYearOf(today);
  const inSeason = isSeasonWindowOpen(seasonYear, now);

  if (inSeason) {
    const isWeekStart = officialWeekStartDays(seasonYear).has(today.iso);
    if (isWeekStart) {
      // Whatever weekday the real schedule opens this week on — Wednesday for
      // 2026's week 1 and week 12.
      reasons.push(
        `${WEEKDAY_NAMES[today.weekday]} ${today.iso} is an NFL week start in the ` +
          `${seasonYear} season schedule — games are being played today`,
      );
    } else if (ROUTINE_GAME_WEEKDAYS.has(today.weekday)) {
      reasons.push(
        `${WEEKDAY_NAMES[today.weekday]} in the ${seasonYear} season — games run ` +
          `Thu/Sun/Mon, and live scoring is the surface owners are watching`,
      );
    }
  }

  // 2. Each league's MFL league-year rollover.
  //
  // ±1 day: the rollover moves every roster, contract and cap number in that
  // league, and the day after is when a bug in the transition surfaces.
  // Shipping code into the middle of it makes the two indistinguishable.
  //
  // Per-league, from the registry — Feb 14 for TheLeague, June 1 for the AFL
  // and Best Ball. One hardcoded date would sail through two of the three.
  for (const rollover of leagueRollovers()) {
    const iso = `${today.year}-${String(rollover.month).padStart(2, '0')}-${String(rollover.day).padStart(2, '0')}`;
    const gap = daysBetween(today.iso, iso);
    if (Math.abs(gap) > 1) continue;
    const when = gap === 0 ? 'today' : gap > 0 ? 'tomorrow' : 'yesterday';
    reasons.push(`${rollover.slug}'s MFL league-year rollover is ${when} (${iso})`);
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
  } catch (err) {
    // A safety check that could not run is NOT an all-clear. Swallowing this
    // turned "we do not know whether today is draft day" into "today is fine",
    // which is the opposite of what a blackout is for. Surface it as a reason
    // so the promotion stops and a human answers the question.
    reasons.push(
      `could not evaluate the AFL draft date (${err?.message ?? err}) — ` +
        `check the league calendar by hand before promoting`,
    );
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    date: today.iso,
    weekday: WEEKDAY_NAMES[today.weekday],
    inSeason,
    seasonYear,
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
