/**
 * MFL's weekly recurrence repeats on the WALL CLOCK, not on epoch time.
 *
 * `occurrences()` used to expand `HAPPENS=n` by adding a fixed `7 × 24h`. That
 * is right for eight months a year and an hour wrong for the rest: after the
 * November DST change every derived deadline landed an hour early. The hero
 * read "claims have processed / open now" for the last hour of a window that
 * was genuinely still open, and `/api/waiver-claim` could route a live claim
 * to the FCFS endpoint against a pool MFL still had locked.
 *
 * THE RULE IS NOT DEDUCED, IT IS RECORDED. MFL's own 2025 transaction log says
 * what it actually did, and this suite asserts against that log rather than
 * against a belief about it — which is the whole reason the bug was safe to
 * fix at all. `tests/waiver-window.test.ts` deliberately pins only the SHAPE
 * of the cadence and never the hour, so it cannot catch this; that is why this
 * file exists beside it rather than inside it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveWaiverWindow, type MflCalendarEvent } from '../src/utils/waiver-window';

const PT = 'America/Los_Angeles';

const ptStamp = (d: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: PT, weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);

const ptHourMinute = (d: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: PT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);

const calendar = (slug: string): MflCalendarEvent[] =>
  Object.values(
    JSON.parse(readFileSync(`data/${slug}/mfl-feeds/2026/calendar.json`, 'utf8')) as Record<string, MflCalendarEvent>,
  );

/**
 * Every distinct moment MFL actually processed waivers in 2025, read back out
 * of its own transaction log in PT. This is the ground truth the rule rests on.
 */
function recordedRuns(slug: string): Array<{ date: string; hm: string }> {
  const feed = JSON.parse(readFileSync(`data/${slug}/mfl-feeds/2025/transactions.json`, 'utf8'));
  const raw = feed?.transactions?.transaction ?? [];
  const list: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : [raw];
  const seen = new Map<string, { date: string; hm: string }>();
  for (const t of list) {
    if (!String(t?.type ?? '').toUpperCase().includes('WAIVER')) continue;
    const ts = Number(t?.timestamp) * 1000;
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const at = new Date(ts);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: PT, dateStyle: 'short' }).format(at);
    seen.set(date, { date, hm: ptHourMinute(at) });
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

describe("MFL's own 2025 log — the rule this fix is derived from", () => {
  // The 2025 transition was Nov 2. A league that recurred on EPOCH would show
  // its runs shifting back an hour on the far side of it. Neither league does.
  for (const [slug, label, hour] of [
    ['afl-fantasy', 'AFL', '20:00'],
    ['theleague', 'TheLeague', '19:00'],
  ] as const) {
    it(`${label} processed at ${hour} PT on BOTH sides of the 2025 DST change`, () => {
      const runs = recordedRuns(slug);
      const before = runs.filter((r) => r.date < '2025-11-02');
      const after = runs.filter((r) => r.date > '2025-11-02');
      expect(before.length).toBeGreaterThan(3);
      expect(after.length).toBeGreaterThan(3);

      // The weekly cadence keeps its hour across the boundary. A late-December
      // run moves to Tuesday in both leagues, and TheLeague's shifts to 20:00
      // that once — the DAY and the HOUR are MFL's to move, which is exactly
      // why neither is hardcoded anywhere.
      const weekly = (rows: typeof runs) => rows.filter((r) => r.hm === hour);
      expect(weekly(before).length).toBeGreaterThan(3);
      expect(weekly(after).length).toBeGreaterThan(3);

      // The real assertion: no run drifted to an hour earlier after the change.
      const drifted = String(Number(hour.slice(0, 2)) - 1).padStart(2, '0') + ':00';
      expect(after.map((r) => r.hm)).not.toContain(drifted);
    });
  }
});

describe('resolveWaiverWindow expands recurrence on the wall clock', () => {
  for (const [slug, label, hour] of [
    ['afl-fantasy', 'AFL', '20:00'],
    ['theleague', 'TheLeague', '19:00'],
  ] as const) {
    it(`${label} keeps ${hour} PT after the 2026 DST change`, () => {
      const events = calendar(slug);
      // 2026's transition is Nov 1. One week either side of it.
      const before = resolveWaiverWindow(events, new Date('2026-10-28T10:00:00-07:00'));
      const after = resolveWaiverWindow(events, new Date('2026-11-04T10:00:00-08:00'));

      expect(before.changesAt).toBeTruthy();
      expect(after.changesAt).toBeTruthy();
      expect(ptHourMinute(before.changesAt!)).toBe(hour);
      expect(ptHourMinute(after.changesAt!)).toBe(hour); // the bug: was one hour earlier
    });

    it(`${label} holds ${hour} PT every week to the end of the season`, () => {
      const events = calendar(slug);
      // Walk the whole in-season stretch and assert the hour never moves. A
      // range rather than two points, because an off-by-one in the solve shows
      // up on one specific week rather than uniformly.
      const seen = new Set<string>();
      for (let d = new Date('2026-09-16T12:00:00Z'); d < new Date('2026-12-16T12:00:00Z'); d = new Date(d.getTime() + 7 * 86_400_000)) {
        const win = resolveWaiverWindow(events, d);
        if (win.mode === 'waiver' && win.changesAt) seen.add(ptHourMinute(win.changesAt));
      }
      expect([...seen]).toEqual([hour]);
    });
  }

  it('is unchanged before the transition — this is a correction, not a shift', () => {
    // Guards against "fixing" the November hour by breaking September's.
    const events = calendar('afl-fantasy');
    const win = resolveWaiverWindow(events, new Date('2026-09-15T18:19:00-07:00'));
    expect(ptStamp(win.changesAt!)).toBe('Wed, Sep 16, 20:00');
  });

  it('takes the zone from its caller, so a non-Pacific league would still be right', () => {
    // Every league in the registry is PT today, which is exactly why the
    // parameter needs a test: nothing else would notice if it were ignored.
    const events = calendar('afl-fantasy');
    const pacific = resolveWaiverWindow(events, new Date('2026-11-04T10:00:00-08:00'), PT);
    const phoenix = resolveWaiverWindow(events, new Date('2026-11-04T10:00:00-08:00'), 'America/Phoenix');
    // Arizona keeps no DST, so a recurrence anchored there does NOT get the
    // hour back — the two must disagree, or the argument is being dropped.
    expect(pacific.changesAt!.getTime()).not.toBe(phoenix.changesAt!.getTime());
    expect(pacific.changesAt!.getTime() - phoenix.changesAt!.getTime()).toBe(3_600_000);
  });
});
