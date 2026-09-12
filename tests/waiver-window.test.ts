/**
 * Waiver window resolution from MFL's league calendar.
 *
 * READ THE EVENT NAMES CAREFULLY. `WAIVER_LOCK` / `WAIVER_UNLOCK` describe the
 * FREE AGENT POOL, not the claim window, so LOCK is what OPENS waivers (nobody
 * can grab a player outright, so the only way in is a claim) and UNLOCK is what
 * ends them. This file asserted the opposite for its whole life, which is how
 * the resolver shipped answering FCFS during a live waiver window. The
 * `the REAL synced calendar` block below is the one that would have caught it —
 * and it was SKIPPING, because calendar.json had never synced.
 *
 * Both leagues alternate between a WAIVER window (claims queued, processed at a
 * deadline) and FCFS (immediate adds). They need different MFL import types, so
 * getting the mode wrong sends a claim through the wrong endpoint.
 *
 * The calendar is the only source: `currentWaiverType` is the league's SYSTEM,
 * not the live state. It is owner-gated, which is why an unauthenticated read
 * once looked like an empty calendar — hence the emphasis below on `unknown`
 * being a real, safe answer rather than something to guess past.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveWaiverWindow, describeWaiverWindow, type MflCalendarEvent } from '../src/utils/waiver-window';

const at = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));

describe('resolveWaiverWindow', () => {
  it('reads WAIVER as open between the pool locking and the next process event', () => {
    const events: MflCalendarEvent[] = [
      { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z') },
      { type: 'WAIVER_REVERSE', start_time: at('2026-09-17T04:00:00Z') },
    ];
    const win = resolveWaiverWindow(events, new Date('2026-09-15T12:00:00Z'));
    expect(win.mode).toBe('waiver');
    expect(win.nextMode).toBe('fcfs');
    expect(win.changesAt?.toISOString()).toBe('2026-09-17T04:00:00.000Z');
  });

  it('reads FCFS after claims process, until the pool locks again', () => {
    const events: MflCalendarEvent[] = [
      { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z') },
      { type: 'WAIVER_REVERSE', start_time: at('2026-09-17T04:00:00Z') },
      { type: 'WAIVER_LOCK', start_time: at('2026-09-20T17:00:00Z') },
    ];
    const win = resolveWaiverWindow(events, new Date('2026-09-18T12:00:00Z'));
    expect(win.mode).toBe('fcfs');
    expect(win.nextMode).toBe('waiver');
  });

  it('expands a weekly recurring event via HAPPENS', () => {
    // One calendar entry covers the season; without expansion every week after
    // the first would resolve off the wrong transition.
    const events: MflCalendarEvent[] = [
      { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z'), happens: '16' },
      { type: 'WAIVER_BBID', start_time: at('2026-09-17T04:00:00Z'), happens: '16' },
    ];
    // Locks recur Sundays 17:00Z; processing recurs Thursdays 04:00Z.
    // Oct 26 is after that week's Sunday lock and before Thursday's
    // processing → waiver.
    expect(resolveWaiverWindow(events, new Date('2026-10-26T12:00:00Z')).mode).toBe('waiver');
    // Oct 29 12:00Z is after Thursday's processing → FCFS until Sunday.
    expect(resolveWaiverWindow(events, new Date('2026-10-29T12:00:00Z')).mode).toBe('fcfs');
    // And the gap BEFORE that Sunday lock is still FCFS, six weeks in.
    expect(resolveWaiverWindow(events, new Date('2026-10-25T12:00:00Z')).mode).toBe('fcfs');
  });

  it('treats UNLOCK, BBID and REVERSE as closing the window', () => {
    // All three end the claim period: the pool reopening and the claims running
    // both leave adds first-come-first-served.
    for (const type of ['WAIVER_UNLOCK', 'WAIVER_BBID', 'WAIVER_REVERSE']) {
      const events = [
        { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z') },
        { type, start_time: at('2026-09-17T04:00:00Z') },
      ];
      expect(
        resolveWaiverWindow(events, new Date('2026-09-18T00:00:00Z')).mode,
        `${type} should close the waiver window`
      ).toBe('fcfs');
    }
  });

  it('reads a lock and a run at the SAME timestamp as LOCKED, whatever order MFL lists them in', () => {
    // TheLeague's 2026 preseason schedules both on one minute:
    //   WAIVER_LOCK  Wed 2026-09-02 19:00 PT
    //   WAIVER_BBID  Wed 2026-09-02 19:00 PT
    // and MFL's transaction log shows it ran BOTH — BBID_AUTO_PROCESS_WAIVERS
    // and LOCK_ALL_PLAYERS at that minute. So the round processes and the pool
    // stays shut: the week that follows is a WAIVER window.
    //
    // `Array.prototype.sort` is stable, so before the fix the winner of the tie
    // was whichever event MFL happened to list last. It listed the run last,
    // the page said "First come, first served" for a locked week, and every
    // pickup went to `import?TYPE=fcfsWaiver` — which a locked pool answers
    // with an empty 200 that stores nothing, so owners got a 502
    // (2026-09-03, Nick Folk). BOTH orderings are asserted because either one
    // is a calendar payload MFL can hand us tomorrow.
    const tie = at('2026-09-03T02:00:00Z');
    const orderings = [
      [
        { type: 'WAIVER_LOCK', start_time: tie },
        { type: 'WAIVER_BBID', start_time: tie },
      ],
      [
        { type: 'WAIVER_BBID', start_time: tie },
        { type: 'WAIVER_LOCK', start_time: tie },
      ],
    ];
    for (const events of orderings) {
      const listed = events.map((e) => e.type).join(' then ');
      const win = resolveWaiverWindow(
        [...events, { type: 'WAIVER_BBID', start_time: at('2026-09-10T02:00:00Z') }],
        new Date('2026-09-03T22:30:00Z')
      );
      expect(win.mode, `${listed} should still read as a locked pool`).toBe('waiver');
      // And the lock/run pair is ONE transition, not two — the next change is
      // the following week's run, not the other half of the tie.
      expect(win.changesAt?.toISOString()).toBe('2026-09-10T02:00:00.000Z');
      expect(win.nextMode).toBe('fcfs');
    }
  });

  it('leaves a same-timestamp pair of CLOSING events closing', () => {
    // The AFL's 2026 calendar carries WAIVER_REVERSE and WAIVER_UNLOCK on the
    // same minute (Labor Day, Mon 2026-09-07 19:00 PT). Collapsing simultaneous
    // marks must not invent a lock that isn't there.
    const tie = at('2026-09-08T02:00:00Z');
    const win = resolveWaiverWindow(
      [
        { type: 'WAIVER_LOCK', start_time: at('2026-08-30T16:00:00Z') },
        { type: 'WAIVER_REVERSE', start_time: tie },
        { type: 'WAIVER_UNLOCK', start_time: tie },
      ],
      new Date('2026-09-09T12:00:00Z')
    );
    expect(win.mode).toBe('fcfs');
  });

  it('returns unknown — not a guess — when the calendar has no waiver events', () => {
    // A wrong confident answer routes the claim through the wrong endpoint.
    // `unknown` lets the UI offer both and let MFL adjudicate.
    expect(resolveWaiverWindow([]).mode).toBe('unknown');
    expect(resolveWaiverWindow(null).mode).toBe('unknown');
    expect(resolveWaiverWindow([{ type: 'DRAFT_START', start_time: at('2026-05-01T00:00:00Z') }]).mode).toBe('unknown');
  });

  it('handles a time before the first transition', () => {
    const events = [{ type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z') }];
    const win = resolveWaiverWindow(events, new Date('2026-09-01T00:00:00Z'));
    expect(win.mode).toBe('fcfs');       // waivers have not opened yet
    expect(win.nextMode).toBe('waiver');
  });

  it('ignores malformed events rather than throwing', () => {
    const events = [
      { type: 'WAIVER_LOCK' },
      { type: 'WAIVER_LOCK', start_time: 'nonsense' },
      { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z') },
    ] as MflCalendarEvent[];
    expect(resolveWaiverWindow(events, new Date('2026-09-15T00:00:00Z')).mode).toBe('waiver');
  });

  it('caps runaway recurrence so a bad HAPPENS cannot hang the page', () => {
    const events = [{ type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z'), happens: '999999' }];
    expect(() => resolveWaiverWindow(events, new Date('2026-09-15T00:00:00Z'))).not.toThrow();
  });
});

describe('describeWaiverWindow', () => {
  const events: MflCalendarEvent[] = [
    { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z') },
    { type: 'WAIVER_BBID', start_time: at('2026-09-17T04:00:00Z') },
  ];

  it('names the mode and when it changes', () => {
    const open = describeWaiverWindow(resolveWaiverWindow(events, new Date('2026-09-15T12:00:00Z')));
    expect(open).toMatch(/^Waivers open · claims process/);
    const fcfs = describeWaiverWindow(resolveWaiverWindow(events, new Date('2026-09-18T12:00:00Z')));
    expect(fcfs).toMatch(/^First come, first served/);
  });

  it('says plainly when it does not know, rather than implying a mode', () => {
    expect(describeWaiverWindow(resolveWaiverWindow([]))).toMatch(/unknown — MFL will decide/);
  });
});

describe('the real weekly cadence, in weekday terms', () => {
  // The league cycle, from the constitution: requests are accepted from Sunday
  // kickoff and ALL claims process Wednesday 9:00 PM PT; FCFS then runs from
  // Wednesday 9:00 PM until the next Sunday kickoff.
  //
  // Wednesday 9:00 PM PT is THURSDAY 04:00 UTC (PDT = UTC-7), which is easy to
  // misread. Asserting by weekday name rather than by raw timestamp is the
  // point of this block: it caught a reviewer statement that put Monday
  // "after Wednesday-night processing".
  const events: MflCalendarEvent[] = [
    { type: 'WAIVER_LOCK', start_time: at('2026-09-13T17:00:00Z'), happens: '16' }, // Sun 10am PT
    { type: 'WAIVER_BBID', start_time: at('2026-09-17T04:00:00Z'), happens: '16' }, // Wed 9pm PT
  ];

  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })
      .format(new Date(iso));

  const cases: Array<[string, 'waiver' | 'fcfs']> = [
    ['2026-09-13T20:00:00Z', 'waiver'], // Sunday afternoon, after the pool locks
    ['2026-09-14T18:00:00Z', 'waiver'], // MONDAY — a waiver day
    ['2026-09-15T18:00:00Z', 'waiver'], // Tuesday
    ['2026-09-17T02:00:00Z', 'waiver'], // Wednesday evening, BEFORE 9pm PT
    ['2026-09-17T05:00:00Z', 'fcfs'],   // Wednesday, just AFTER processing
    ['2026-09-18T18:00:00Z', 'fcfs'],   // Thursday
    ['2026-09-19T18:00:00Z', 'fcfs'],   // Friday
    ['2026-09-20T15:00:00Z', 'fcfs'],   // Sunday morning, before the pool locks
  ];

  for (const [iso, expected] of cases) {
    it(`${dayOf(iso)} ${iso.slice(11, 16)}Z is ${expected}`, () => {
      expect(resolveWaiverWindow(events, new Date(iso)).mode).toBe(expected);
    });
  }
});

describe('the REAL synced calendar', () => {
  // Asserts against MFL's own calendar rather than a fixture.
  //
  // Nothing here hardcodes a clock time or a date. The processing hour differs
  // per league (observed Wed 8pm PT for the AFL, Wed 7pm PT for TheLeague) and
  // `docs/claude/afl-rules.md` still says 9:00 PM — which is exactly why the
  // code reads the calendar instead of the constitution. It also differs
  // BEFORE the season: preseason waiver runs are not on the in-season cadence,
  // so every occurrence outside the regular season is excluded rather than
  // asserted against.
  //
  // What is pinned is the SHAPE that has to hold whatever the hour is: in
  // season, claims process Wednesday evening PT; the Monday before a
  // processing run is a waiver day; the day after it is FCFS. The probe days
  // are derived from a real occurrence, so they move with the calendar.
  //
  // Skips until scripts/fetch-mfl-feeds.mjs has synced the feed — the calendar
  // export is owner-gated, so it cannot be fetched without credentials.
  const leagues = [
    { slug: 'theleague', dir: 'data/theleague/mfl-feeds' },
    { slug: 'afl-fantasy', dir: 'data/afl-fantasy/mfl-feeds' },
  ];

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const PROCESS = ['WAIVER_BBID', 'WAIVER_REVERSE', 'WAIVER_UNLOCK'];
  const OPENS = ['WAIVER_LOCK'];

  /** Same weekly expansion the resolver applies, so occurrences line up. */
  const expand = (events: MflCalendarEvent[], types: string[]): number[] => {
    const out: number[] = [];
    for (const event of events) {
      if (!types.includes(String(event?.type ?? '').toUpperCase())) continue;
      const start = Number(event.start_time) * 1000;
      if (!Number.isFinite(start) || start <= 0) continue;
      const repeats = Math.max(0, Math.min(Number(event.happens) || 0, 30));
      for (let i = 0; i <= repeats; i++) out.push(start + i * SEVEN_DAYS_MS);
    }
    return out.sort((a, b) => a - b);
  };

  const partsPt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles',
    }).formatToParts(new Date(ms));
    return {
      weekday: parts.find((p) => p.type === 'weekday')!.value,
      hour: Number(parts.find((p) => p.type === 'hour')!.value),
    };
  };

  /** Latest synced season directory, so this does not pin a year either. */
  const latestSeason = (dir: string): { file: string; year: number } | null => {
    const root = path.join(process.cwd(), dir);
    if (!fs.existsSync(root)) return null;
    const years = fs
      .readdirSync(root)
      .filter((name) => /^\d{4}$/.test(name))
      .map(Number)
      .sort((a, b) => b - a);
    for (const year of years) {
      const file = path.join(root, String(year), 'calendar.json');
      if (fs.existsSync(file)) return { file, year };
    }
    return null;
  };

  /**
   * Regular-season occurrences only. Preseason waiver runs happen on their own
   * schedule, so including them would assert a cadence the league is not on
   * yet. September through December is the regular season in every year the
   * league has existed.
   */
  const inSeason = (ms: number, year: number) =>
    ms >= Date.UTC(year, 8, 1) && ms < Date.UTC(year + 1, 0, 1);

  for (const { slug, dir } of leagues) {
    const found = latestSeason(dir);

    it.runIf(found)(`${slug}: the RECURRING in-season run is Wednesday evening PT`, () => {
      const { file, year } = found!;
      const events: MflCalendarEvent[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      // The WEEKLY SERIES only — events MFL repeats via HAPPENS. One-off runs
      // are deliberately off-cadence and asserting Wednesday over all of them
      // is simply false: the AFL's 2026 calendar carries a Monday run on
      // Sep 7 (Labor Day, set so the AL could claim around the NL draft) and a
      // Tuesday run on Dec 29 in the playoff weeks. Both are real, both are
      // intentional, and a test that forbids them is a test that will be
      // "fixed" by editing the league's calendar.
      const recurring = events.filter((e) => Number(e.happens) >= 1);
      const runs = expand(recurring, PROCESS).filter((ms) => inSeason(ms, year));
      expect(runs.length, `${file} carries no recurring in-season processing event`).toBeGreaterThan(0);

      for (const ms of runs) {
        const { weekday, hour } = partsPt(ms);
        const when = new Date(ms).toISOString();
        expect(weekday, `recurring run ${when} is not on Wednesday PT`).toBe('Wednesday');
        // Evening, not morning — pins the day and half of the day without
        // asserting 7pm vs 8pm vs 9pm, which is per-league and has moved.
        expect(hour, `recurring run ${when} is not in the evening PT`).toBeGreaterThanOrEqual(17);
        expect(hour).toBeLessThanOrEqual(23);
      }
    });

    it.runIf(found)(`${slug}: locked→run is a waiver window, and after a run is FCFS`, () => {
      const { file, year } = found!;
      const events: MflCalendarEvent[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const opens = expand(events, OPENS);
      const runs = expand(events, PROCESS).filter((ms) => inSeason(ms, year));

      // Assert the SHAPE, derived from real pairs, with no weekday or clock
      // time written down: between the pool locking and the claims running you
      // are on waivers, and immediately after they run you are not. That is
      // the property the claim endpoint actually depends on, and it holds for
      // an off-cadence run just as well as a weekly one.
      const pairs = runs
        .map((run) => ({ run, lock: opens.filter((o) => o < run && o > run - SEVEN_DAYS_MS).pop() }))
        .filter((p): p is { run: number; lock: number } => p.lock !== undefined);

      expect(pairs.length, `${file} has no in-season run preceded by a pool lock`).toBeGreaterThan(0);

      for (const { run, lock } of pairs) {
        const midway = new Date(lock + (run - lock) / 2);
        const justAfter = new Date(run + 60 * 60 * 1000);
        expect(
          resolveWaiverWindow(events, midway).mode,
          `${midway.toISOString()} sits between a lock and its run but did not read as waiver`
        ).toBe('waiver');
        // Unless the next lock lands within the hour, which no league does.
        expect(
          resolveWaiverWindow(events, justAfter).mode,
          `${justAfter.toISOString()} is an hour after a run but did not read as fcfs`
        ).toBe('fcfs');
      }
    });
  }

  it('reports whether the calendar has been synced yet', () => {
    const missing = leagues.filter(({ dir }) => !latestSeason(dir));
    // Not a failure — the feed is owner-gated and syncs in CI. This exists so a
    // green run does not read as "the calendar assertions passed" when they
    // were skipped.
    if (missing.length) {
      console.warn(
        `[waiver-window] calendar.json not synced for: ${missing.map((m) => m.slug).join(', ')} — ` +
          `the real-calendar assertions were SKIPPED.`
      );
    }
    expect(true).toBe(true);
  });
});
