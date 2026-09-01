/**
 * Waiver window resolution from MFL's league calendar.
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
  it('reads WAIVER as open between an unlock and the next process event', () => {
    const events: MflCalendarEvent[] = [
      { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z') },
      { type: 'WAIVER_REVERSE', start_time: at('2026-09-17T04:00:00Z') },
    ];
    const win = resolveWaiverWindow(events, new Date('2026-09-15T12:00:00Z'));
    expect(win.mode).toBe('waiver');
    expect(win.nextMode).toBe('fcfs');
    expect(win.changesAt?.toISOString()).toBe('2026-09-17T04:00:00.000Z');
  });

  it('reads FCFS after claims process, until the next unlock', () => {
    const events: MflCalendarEvent[] = [
      { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z') },
      { type: 'WAIVER_REVERSE', start_time: at('2026-09-17T04:00:00Z') },
      { type: 'WAIVER_UNLOCK', start_time: at('2026-09-20T17:00:00Z') },
    ];
    const win = resolveWaiverWindow(events, new Date('2026-09-18T12:00:00Z'));
    expect(win.mode).toBe('fcfs');
    expect(win.nextMode).toBe('waiver');
  });

  it('expands a weekly recurring event via HAPPENS', () => {
    // One calendar entry covers the season; without expansion every week after
    // the first would resolve off the wrong transition.
    const events: MflCalendarEvent[] = [
      { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z'), happens: '16' },
      { type: 'WAIVER_BBID', start_time: at('2026-09-17T04:00:00Z'), happens: '16' },
    ];
    // Unlocks recur Sundays 17:00Z; processing recurs Thursdays 04:00Z.
    // Oct 26 is after that week's Sunday unlock and before Thursday's
    // processing → waiver.
    expect(resolveWaiverWindow(events, new Date('2026-10-26T12:00:00Z')).mode).toBe('waiver');
    // Oct 29 12:00Z is after Thursday's processing → FCFS until Sunday.
    expect(resolveWaiverWindow(events, new Date('2026-10-29T12:00:00Z')).mode).toBe('fcfs');
    // And the gap BEFORE that Sunday unlock is still FCFS, six weeks in.
    expect(resolveWaiverWindow(events, new Date('2026-10-25T12:00:00Z')).mode).toBe('fcfs');
  });

  it('treats WAIVER_LOCK and WAIVER_BBID as closing the window too', () => {
    for (const type of ['WAIVER_LOCK', 'WAIVER_BBID', 'WAIVER_REVERSE']) {
      const events = [
        { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z') },
        { type, start_time: at('2026-09-17T04:00:00Z') },
      ];
      expect(
        resolveWaiverWindow(events, new Date('2026-09-18T00:00:00Z')).mode,
        `${type} should close the waiver window`
      ).toBe('fcfs');
    }
  });

  it('returns unknown — not a guess — when the calendar has no waiver events', () => {
    // A wrong confident answer routes the claim through the wrong endpoint.
    // `unknown` lets the UI offer both and let MFL adjudicate.
    expect(resolveWaiverWindow([]).mode).toBe('unknown');
    expect(resolveWaiverWindow(null).mode).toBe('unknown');
    expect(resolveWaiverWindow([{ type: 'DRAFT_START', start_time: at('2026-05-01T00:00:00Z') }]).mode).toBe('unknown');
  });

  it('handles a time before the first transition', () => {
    const events = [{ type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z') }];
    const win = resolveWaiverWindow(events, new Date('2026-09-01T00:00:00Z'));
    expect(win.mode).toBe('fcfs');       // waivers have not opened yet
    expect(win.nextMode).toBe('waiver');
  });

  it('ignores malformed events rather than throwing', () => {
    const events = [
      { type: 'WAIVER_UNLOCK' },
      { type: 'WAIVER_UNLOCK', start_time: 'nonsense' },
      { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z') },
    ] as MflCalendarEvent[];
    expect(resolveWaiverWindow(events, new Date('2026-09-15T00:00:00Z')).mode).toBe('waiver');
  });

  it('caps runaway recurrence so a bad HAPPENS cannot hang the page', () => {
    const events = [{ type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z'), happens: '999999' }];
    expect(() => resolveWaiverWindow(events, new Date('2026-09-15T00:00:00Z'))).not.toThrow();
  });
});

describe('describeWaiverWindow', () => {
  const events: MflCalendarEvent[] = [
    { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z') },
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
    { type: 'WAIVER_UNLOCK', start_time: at('2026-09-13T17:00:00Z'), happens: '16' }, // Sun 10am PT
    { type: 'WAIVER_BBID', start_time: at('2026-09-17T04:00:00Z'), happens: '16' },   // Wed 9pm PT
  ];

  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' })
      .format(new Date(iso));

  const cases: Array<[string, 'waiver' | 'fcfs']> = [
    ['2026-09-13T20:00:00Z', 'waiver'], // Sunday afternoon, after kickoff
    ['2026-09-14T18:00:00Z', 'waiver'], // MONDAY — a waiver day
    ['2026-09-15T18:00:00Z', 'waiver'], // Tuesday
    ['2026-09-17T02:00:00Z', 'waiver'], // Wednesday evening, BEFORE 9pm PT
    ['2026-09-17T05:00:00Z', 'fcfs'],   // Wednesday, just AFTER processing
    ['2026-09-18T18:00:00Z', 'fcfs'],   // Thursday
    ['2026-09-19T18:00:00Z', 'fcfs'],   // Friday
    ['2026-09-20T15:00:00Z', 'fcfs'],   // Sunday morning, before kickoff
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
  const PROCESS = ['WAIVER_BBID', 'WAIVER_REVERSE', 'WAIVER_LOCK'];

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

    it.runIf(found)(`${slug}: in-season claims process Wednesday evening PT`, () => {
      const { file, year } = found!;
      const events: MflCalendarEvent[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const runs = expand(events, PROCESS).filter((ms) => inSeason(ms, year));
      expect(runs.length, `${file} carries no in-season waiver processing event`).toBeGreaterThan(0);

      for (const ms of runs) {
        const { weekday, hour } = partsPt(ms);
        const when = new Date(ms).toISOString();
        expect(weekday, `processing run ${when} is not on Wednesday PT`).toBe('Wednesday');
        // Evening, not morning — pins the day and half of the day without
        // asserting 7pm vs 8pm vs 9pm, which is per-league and has moved.
        expect(hour, `processing run ${when} is not in the evening PT`).toBeGreaterThanOrEqual(17);
        expect(hour).toBeLessThanOrEqual(23);
      }
    });

    it.runIf(found)(`${slug}: the Monday before a real run is waiver, the day after is FCFS`, () => {
      const { file, year } = found!;
      const events: MflCalendarEvent[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const opens = expand(events, ['WAIVER_UNLOCK']);
      const runs = expand(events, PROCESS).filter((ms) => inSeason(ms, year));

      // Anchor on a run that a real unlock precedes within the same week —
      // otherwise the Monday probe could land before waivers ever opened and
      // fail for a reason that has nothing to do with the cadence.
      const anchor = runs.find((ms) => opens.some((o) => o > ms - SEVEN_DAYS_MS && o < ms));
      expect(anchor, 'no in-season processing run is preceded by an unlock').toBeTruthy();

      // Derived from the anchor, not written down: two days back lands on
      // Monday, one day forward on Thursday, both sampled at midday.
      const noonAfter = (ms: number) => {
        const d = new Date(ms);
        d.setUTCHours(19, 0, 0, 0); // ~noon PT on that UTC date
        return d;
      };
      const monday = noonAfter(anchor! - 2 * 24 * 60 * 60 * 1000);
      const dayAfter = noonAfter(anchor! + 24 * 60 * 60 * 1000);

      expect(partsPt(monday.getTime()).weekday).toBe('Monday');
      expect(resolveWaiverWindow(events, monday).mode).toBe('waiver');
      expect(resolveWaiverWindow(events, dayAfter).mode).toBe('fcfs');
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
