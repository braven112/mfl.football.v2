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
