import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { shouldFireReminder, calendarDaysUntil } from '../scripts/lib/roger-reminder-window.mjs';
import {
  getLaborDay,
  getNflKickoff,
  getNflWeekStart,
  parseThrowbackWeeks,
  throwbackEventId,
  isThrowbackEventId,
  throwbackWeekFromEventId,
  buildThrowbackReminder,
  DEFAULT_THROWBACK_WEEKS,
  // @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/throwback-reminder.mjs';

/**
 * Throwback Week (NFL Week 4) reminder pipeline:
 *   compute-league-events.mjs derives the date (kickoff Thursday + 21 days,
 *   never a hardcoded calendar date) and schefter-scan.mjs fires Roger
 *   touches at 14d/7d/2d/day-of through the shared
 *   shouldFireReminder/calendarDaysUntil helpers — asymmetric window,
 *   on-time or one day late, NEVER early (April 2026 post-mortem rules).
 */

describe('NFL week date derivation', () => {
  it('Labor Day is the first Monday of September', () => {
    expect(getLaborDay(2025).getTime()).toBe(new Date(2025, 8, 1).getTime());
    expect(getLaborDay(2026).getTime()).toBe(new Date(2026, 8, 7).getTime());
    expect(getLaborDay(2027).getTime()).toBe(new Date(2027, 8, 6).getTime());
  });

  it('kickoff is the Thursday after Labor Day', () => {
    expect(getNflKickoff(2025).getTime()).toBe(new Date(2025, 8, 4).getTime());
    expect(getNflKickoff(2026).getTime()).toBe(new Date(2026, 8, 10).getTime());
    expect(getNflKickoff(2027).getTime()).toBe(new Date(2027, 8, 9).getTime());
  });

  it('Week 1 starts on kickoff Thursday itself', () => {
    for (const year of [2025, 2026, 2027]) {
      expect(getNflWeekStart(year, 1).getTime()).toBe(getNflKickoff(year).getTime());
    }
  });

  it('Week 4 starts kickoff Thursday + 21 days, and is always a Thursday', () => {
    expect(getNflWeekStart(2025, 4).getTime()).toBe(new Date(2025, 8, 25).getTime());
    expect(getNflWeekStart(2026, 4).getTime()).toBe(new Date(2026, 9, 1).getTime()); // Oct 1 2026
    expect(getNflWeekStart(2027, 4).getTime()).toBe(new Date(2027, 8, 30).getTime());
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      expect(getNflWeekStart(year, 4).getDay()).toBe(4); // Thursday
    }
  });

  it('rejects invalid week numbers', () => {
    expect(() => getNflWeekStart(2026, 0)).toThrow();
    expect(() => getNflWeekStart(2026, 1.5)).toThrow();
  });
});

describe('THROWBACK_WEEKS config parsing (single source of truth)', () => {
  it('parses the real throwback-config.ts (guards against drift)', () => {
    const source = readFileSync(
      path.join(__dirname, '..', 'src', 'data', 'theleague', 'throwback-config.ts'),
      'utf8',
    );
    const weeks = parseThrowbackWeeks(source);
    expect(weeks).not.toBeNull();
    expect(weeks).toEqual(DEFAULT_THROWBACK_WEEKS); // fallback must mirror config
  });

  it('parses multi-week and annotated declarations', () => {
    expect(parseThrowbackWeeks('export const THROWBACK_WEEKS: number[] = [4, 9];')).toEqual([4, 9]);
    expect(parseThrowbackWeeks('export const THROWBACK_WEEKS = [\n  7,\n];')).toEqual([7]);
  });

  it('returns null when the export is missing, empty, or invalid', () => {
    expect(parseThrowbackWeeks('export const OTHER = [4];')).toBeNull();
    expect(parseThrowbackWeeks('export const THROWBACK_WEEKS: number[] = [];')).toBeNull();
    expect(parseThrowbackWeeks('export const THROWBACK_WEEKS = [99];')).toBeNull();
  });
});

describe('event id round-trip', () => {
  it('builds and parses throwback event ids', () => {
    expect(throwbackEventId(4)).toBe('throwback-week-4');
    expect(isThrowbackEventId('throwback-week-4')).toBe(true);
    expect(isThrowbackEventId('nfl-draft')).toBe(false);
    expect(isThrowbackEventId('throwback-week-')).toBe(false);
    expect(throwbackWeekFromEventId('throwback-week-4')).toBe(4);
    expect(throwbackWeekFromEventId('rookie-draft')).toBeNull();
  });
});

describe('buildThrowbackReminder copy', () => {
  it('pre-event touches nudge owners to pick an era', () => {
    for (const touch of ['14d', '7d', '2d'] as const) {
      const r = buildThrowbackReminder(touch, { week: 4, days: touch === '14d' ? 14 : touch === '7d' ? 7 : 2 });
      expect(r).not.toBeNull();
      expect(`${r.headline} ${r.body}`.toLowerCase()).toContain('throwback');
      expect(`${r.headline} ${r.body}`.toLowerCase()).toContain('era');
      // Never LLM-backed: same inputs, same output (deterministic template).
      expect(buildThrowbackReminder(touch, { week: 4, days: 14 })).toEqual(
        buildThrowbackReminder(touch, { week: 4, days: 14 }),
      );
    }
  });

  it('interpolates {days} and {week}', () => {
    const r = buildThrowbackReminder('14d', { week: 4, days: 14 });
    expect(r.body).toContain('4');
    expect(`${r.headline} ${r.body}`).toContain('14');
  });

  it('day-of announces the feature is live on scoring surfaces', () => {
    const r = buildThrowbackReminder('dayof', { week: 4, days: 0 });
    expect(r.body.toLowerCase()).toContain('live scoring');
    expect(r.body.toLowerCase()).toContain('matchups');
    expect(r.body.toLowerCase()).toContain('lineup');
  });

  it('appends the still-on-default count only when known and > 0', () => {
    const withCount = buildThrowbackReminder('7d', { week: 4, days: 7, defaultCount: 5 });
    expect(withCount.body).toContain('5 teams are still riding');

    const one = buildThrowbackReminder('7d', { week: 4, days: 7, defaultCount: 1 });
    expect(one.body).toContain('one team is still riding');

    // Graceful degradation: no Redis / zero remaining → generic copy.
    const unknown = buildThrowbackReminder('7d', { week: 4, days: 7, defaultCount: null });
    expect(unknown.body).not.toContain('still riding');
    const zero = buildThrowbackReminder('7d', { week: 4, days: 7, defaultCount: 0 });
    expect(zero.body).not.toContain('still riding');
  });

  it('day-of never carries the default-count nag even if passed one', () => {
    const r = buildThrowbackReminder('dayof', { week: 4, days: 0, defaultCount: 5 });
    expect(r.body).not.toContain('still riding');
  });

  it('returns null for unknown touch ids', () => {
    expect(buildThrowbackReminder('30d', { week: 4, days: 30 })).toBeNull();
  });
});

describe('reminder window wiring — 2026 Week 4 (Oct 1), never early', () => {
  // Mirrors REMINDER_TOUCHES in scripts/schefter-scan.mjs. Throwback Week is
  // tier=major, so all four touches apply.
  const TOUCHES = [
    { id: '14d', daysOut: 14 },
    { id: '7d', daysOut: 7 },
    { id: '2d', daysOut: 2 },
    { id: 'dayof', daysOut: 0 },
  ];
  const week4 = getNflWeekStart(2026, 4); // Thu Oct 1 2026

  function firingTouches(now: Date): string[] {
    const daysUntil = calendarDaysUntil(week4, now);
    return TOUCHES.filter(t => shouldFireReminder(t.daysOut, daysUntil)).map(t => t.id);
  }

  it('fires each touch on its target day', () => {
    expect(firingTouches(new Date(2026, 8, 17, 9, 0))).toEqual(['14d']); // Sep 17
    expect(firingTouches(new Date(2026, 8, 24, 9, 0))).toEqual(['7d']);  // Sep 24
    expect(firingTouches(new Date(2026, 8, 29, 9, 0))).toEqual(['2d']);  // Sep 29
    expect(firingTouches(new Date(2026, 9, 1, 6, 0))).toEqual(['dayof']); // Oct 1, even early morning
  });

  it('NEVER fires a touch early — especially not day-of on Sep 30 (Wed-before-Thu regression)', () => {
    expect(firingTouches(new Date(2026, 8, 16, 9, 0))).toEqual([]);        // 15d out: nothing
    expect(firingTouches(new Date(2026, 8, 30, 23, 0))).toEqual(['2d']);   // eve of: 2d catch-up only, NOT dayof
    expect(firingTouches(new Date(2026, 8, 25, 9, 0))).not.toContain('2d'); // 6d out: 7d catch-up only
  });

  it('allows one-day-late catch-up if a scan was missed', () => {
    expect(firingTouches(new Date(2026, 8, 18, 9, 0))).toEqual(['14d']); // 13d
    expect(firingTouches(new Date(2026, 9, 2, 9, 0))).toEqual(['dayof']); // day after
    expect(firingTouches(new Date(2026, 9, 3, 9, 0))).toEqual([]);       // two days after: silent
  });
});
