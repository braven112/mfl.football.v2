/**
 * Guard: the app icon badge.
 *
 * The badge is the installed app's only reach into an owner who never opens
 * it, which makes both failure directions expensive:
 *
 *  - a badge that cannot be cleared (counting something the owner cannot act
 *    on, or lighting up outside the window where action is possible) trains
 *    people to ignore the icon, and takes the other counts down with it;
 *  - a badge that never lights costs the feature entirely and is invisible
 *    until someone misses a lineup.
 *
 * The window arithmetic is the part most likely to rot, because it is derived
 * from the schedule DATA rather than a weekday and a clock — the same choice
 * gameday-alerts.mjs makes, and for the same reason: no DST handling, and it
 * survives Thanksgiving, the Saturday slates of Weeks 16-18, and Christmas.
 */

import { describe, it, expect } from 'vitest';
import {
  lineupBadgeWindow,
  isLineupBadgeWindow,
  resolveBadgeCount,
  ownerLineupNeedsAttention,
  LINEUP_BADGE_LEAD_MS,
  EMPTY_PARTS,
} from '../src/utils/app-badge';

/** MFL sends every number as a string, kickoffs included. */
function schedule(kickoffsMs: number[]) {
  return {
    nflSchedule: {
      week: '5',
      matchup: kickoffsMs.map((ms) => ({
        kickoff: String(Math.floor(ms / 1000)),
        gameSecondsRemaining: '3600',
      })),
    },
  };
}

const THU = Date.UTC(2026, 9, 8, 0, 20); // Thursday night
const SUN_EARLY = Date.UTC(2026, 9, 11, 17, 0); // the main slate
const SUN_LATE = Date.UTC(2026, 9, 11, 20, 5);
const SUN_NIGHT = Date.UTC(2026, 9, 12, 0, 20);
const MON = Date.UTC(2026, 9, 13, 0, 15);

/** A normal week: one Thursday game, eight at 10am PT, two late, SNF, MNF. */
const NORMAL_WEEK = schedule([
  THU,
  ...Array(8).fill(SUN_EARLY),
  SUN_LATE,
  SUN_LATE,
  SUN_NIGHT,
  MON,
]);

describe('lineupBadgeWindow', () => {
  it('opens a day before the first kickoff and closes at the main slate', () => {
    const window = lineupBadgeWindow(NORMAL_WEEK);
    expect(window).not.toBeNull();
    // The lead exists because the Sunday 9:15am GroupMe warning is useless to
    // anyone starting a Thursday-night player.
    expect(window!.opensAt).toBe(THU - LINEUP_BADGE_LEAD_MS);
    expect(window!.closesAt).toBe(SUN_EARLY);
  });

  it('picks the most-common kickoff as the close, not the last game', () => {
    // Closing at MNF would leave the badge lit for two days after lineups
    // locked, which is the definition of a badge nobody can clear.
    expect(lineupBadgeWindow(NORMAL_WEEK)!.closesAt).not.toBe(MON);
    expect(lineupBadgeWindow(NORMAL_WEEK)!.closesAt).not.toBe(SUN_NIGHT);
  });

  it('handles a week whose biggest window is Saturday', () => {
    // Weeks 16-18 move the slate to Saturday. Nothing here names a weekday,
    // so this needs no special case — it just has to keep working.
    const SAT = Date.UTC(2026, 11, 26, 18, 0);
    const week17 = schedule([SAT, SAT, SAT, SAT, Date.UTC(2026, 11, 27, 21, 0)]);
    expect(lineupBadgeWindow(week17)!.closesAt).toBe(SAT);
  });

  it('fails closed on an unreadable or empty schedule', () => {
    // No badge is the safe answer: staying dark costs one owner checking their
    // own lineup, guessing costs a permanent badge nobody can clear.
    expect(lineupBadgeWindow(null)).toBeNull();
    expect(lineupBadgeWindow({})).toBeNull();
    expect(lineupBadgeWindow({ nflSchedule: { matchup: [] } })).toBeNull();
    expect(lineupBadgeWindow({ nflSchedule: { matchup: [{ kickoff: '0' }] } })).toBeNull();
  });

  it('refuses a window where the slate is not after the opening', () => {
    // A single-kickoff week makes first == slate, so opensAt < closesAt only
    // by the lead — but a schedule where they collapse must yield nothing
    // rather than an inverted range.
    const single = schedule([SUN_EARLY]);
    const window = lineupBadgeWindow(single);
    expect(window!.opensAt).toBe(SUN_EARLY - LINEUP_BADGE_LEAD_MS);
    expect(window!.closesAt).toBe(SUN_EARLY);
  });
});

describe('isLineupBadgeWindow', () => {
  it('is dark early in the week', () => {
    expect(isLineupBadgeWindow(NORMAL_WEEK, THU - LINEUP_BADGE_LEAD_MS - 1)).toBe(false);
  });

  it('lights up a day before the Thursday game', () => {
    expect(isLineupBadgeWindow(NORMAL_WEEK, THU - LINEUP_BADGE_LEAD_MS)).toBe(true);
    expect(isLineupBadgeWindow(NORMAL_WEEK, THU + 1000)).toBe(true);
  });

  it('goes dark the moment the main slate kicks off', () => {
    // Lineups are locked; a badge past this point is a reminder of something
    // the owner can no longer fix.
    expect(isLineupBadgeWindow(NORMAL_WEEK, SUN_EARLY - 1)).toBe(true);
    expect(isLineupBadgeWindow(NORMAL_WEEK, SUN_EARLY)).toBe(false);
    expect(isLineupBadgeWindow(NORMAL_WEEK, MON)).toBe(false);
  });

  it('stays dark when the schedule cannot be read', () => {
    expect(isLineupBadgeWindow(undefined, THU)).toBe(false);
  });
});

describe('resolveBadgeCount', () => {
  it('sums the three parts', () => {
    expect(resolveBadgeCount({ trades: 2, lineup: 1, poll: 1 })).toBe(4);
  });

  it('is zero for an empty set', () => {
    expect(resolveBadgeCount(EMPTY_PARTS)).toBe(0);
    expect(resolveBadgeCount({})).toBe(0);
  });

  it('clamps junk rather than passing it to setAppBadge', () => {
    // A negative or fractional value throws on some engines and no-ops on
    // others, and neither is distinguishable from "no badge" on a phone.
    expect(resolveBadgeCount({ trades: -3, lineup: 1, poll: 0 })).toBe(1);
    expect(resolveBadgeCount({ trades: 1.7, lineup: 0, poll: 0 })).toBe(1);
    expect(resolveBadgeCount({ trades: NaN as unknown as number, lineup: 1, poll: 0 })).toBe(1);
    expect(resolveBadgeCount({ trades: 'lots' as unknown as number })).toBe(0);
  });
});

describe('ownerLineupNeedsAttention', () => {
  const warnings = [{ franchiseId: '0003' }, { franchiseId: '0007' }];

  it('is one bit for the caller, not a count of the league', () => {
    // buildLineupWarnings reports every flagged franchise; badging the league's
    // total would put another owner's bye-week starter on your icon.
    expect(ownerLineupNeedsAttention(warnings, '0003')).toBe(1);
    expect(ownerLineupNeedsAttention(warnings, '0001')).toBe(0);
  });

  it('is one bit even when a lineup has several problems', () => {
    // Three bye-week starters is one thing to go fix, not three.
    expect(ownerLineupNeedsAttention([{ franchiseId: '0001' }], '0001')).toBe(1);
  });

  it('is zero when nothing is flagged', () => {
    expect(ownerLineupNeedsAttention([], '0001')).toBe(0);
  });
});
