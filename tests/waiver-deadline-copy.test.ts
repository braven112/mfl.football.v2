/**
 * The waiver hero's day must come from MFL's calendar, judged on a real clock.
 *
 * THE BUG THIS PINS. The daily hero rotation holds the `waiver-wire` slot from
 * TUESDAY 2pm PT to WEDNESDAY 8pm PT, and both leagues' copy inside it was a
 * fixed string: "CLAIMS RUN TONIGHT · Waivers process Wednesday at 8PM PT". On
 * a Tuesday evening that named the wrong night; on the Tuesday, Dec 29 2026 run
 * MFL actually schedules it named the wrong day outright; and in TheLeague it
 * named the wrong hour every single week (its calendar says 7:00 PM).
 *
 * Three separate things are guarded here, because each shipped on its own:
 *   1. the relative word tracks the real gap, in a named zone, not the server's
 *   2. the day and hour come from the calendar, so a Tuesday run reads Tuesday
 *   3. an unreadable calendar names NO day rather than guessing Wednesday
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relativeDayWord, waiverDeadlineCopy } from '../src/utils/waiver-deadline-copy';
import { resolveWaiverWindow } from '../src/utils/waiver-window';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import type { ViewerClock } from '../src/utils/viewer-preferences';
import { leagueClock } from '../src/config/leagues';

const PT = 'America/Los_Angeles';

/** The AFL's real synced calendar — the same file the pages read. */
const aflCalendar = JSON.parse(
  readFileSync('data/afl-fantasy/mfl-feeds/2026/calendar.json', 'utf8'),
) as Record<string, unknown>;
const aflEvents = Object.values(aflCalendar) as any[];

const theLeagueCalendar = JSON.parse(
  readFileSync('data/theleague/mfl-feeds/2026/calendar.json', 'utf8'),
) as Record<string, unknown>;
const theLeagueEvents = Object.values(theLeagueCalendar) as any[];

/**
 * A viewer who has actually chosen Sydney. The league's own clock comes from
 * the REGISTRY (`officialClock`), not a literal — the whole point of the
 * trailing zone is that it is the league's setting, and a hand-written copy
 * here would keep passing after someone changed it.
 */
const sydney: ViewerClock = {
  prefs: { country: 'AU', zoneId: 'SYD' },
  explicit: true,
  leagueClock: leagueClock('afl-fantasy'),
};

describe('relativeDayWord', () => {
  it('says TONIGHT only when the deadline is the same PT day AND in the evening', () => {
    const wed8pm = new Date('2026-09-16T20:00:00-07:00');
    expect(relativeDayWord(new Date('2026-09-16T09:00:00-07:00'), wed8pm, PT)).toBe('TONIGHT');
    expect(relativeDayWord(new Date('2026-09-16T19:59:00-07:00'), wed8pm, PT)).toBe('TONIGHT');
  });

  it('says TOMORROW from the Tuesday half of the slot — the shipped bug', () => {
    // 6:19 PM PT on Tuesday. The old copy said "CLAIMS RUN TONIGHT" here.
    const tuesdayEvening = new Date('2026-09-15T18:19:00-07:00');
    const wed8pm = new Date('2026-09-16T20:00:00-07:00');
    expect(relativeDayWord(tuesdayEvening, wed8pm, PT)).toBe('TOMORROW');
  });

  it('judges the day in the zone it is given, never in the server zone', () => {
    // The instant in the screenshot: Tuesday 6:19 PM PT — which is already
    // WEDNESDAY 01:19 UTC. A resolver that asks a bare `Date` what day it is
    // gets the SERVER's answer, and on Vercel the server is UTC.
    const tuesdayEvening = new Date('2026-09-15T18:19:00-07:00');
    expect(tuesdayEvening.getUTCDay()).toBe(3); // UTC: Wednesday
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short' }).format(tuesdayEvening),
    ).toBe('Tue'); // PT: Tuesday, which is the truth the owner is reading

    // The deadline is Wed 8:00 PM PT = Thu 03:00 UTC, so the two zones do not
    // even agree on which weekday the RUN is on, let alone the gap to it.
    const wed8pm = new Date('2026-09-16T20:00:00-07:00');
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short' }).format(wed8pm),
    ).toBe('Wed');
    expect(
      new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(wed8pm),
    ).toBe('Thu');

    expect(relativeDayWord(tuesdayEvening, wed8pm, PT)).toBe('TOMORROW');
  });

  it('names the weekday once the deadline is further out than tomorrow', () => {
    expect(
      relativeDayWord(new Date('2026-09-14T09:00:00-07:00'), new Date('2026-09-16T20:00:00-07:00'), PT),
    ).toBe('WEDNESDAY');
  });

  it('says TODAY, not TONIGHT, for a morning deadline', () => {
    expect(
      relativeDayWord(new Date('2026-09-16T06:00:00-07:00'), new Date('2026-09-16T09:00:00-07:00'), PT),
    ).toBe('TODAY');
  });

  it('uses the VIEWER’s day when they have chosen a clock', () => {
    // Wed 8pm PT is Thursday 1pm in Sydney. For a Sydney owner reading at
    // Wednesday 11am PT (Thursday 4am their time) it is TODAY, not tonight.
    const word = relativeDayWord(
      new Date('2026-09-16T11:00:00-07:00'),
      new Date('2026-09-16T20:00:00-07:00'),
      'Australia/Sydney',
    );
    expect(word).toBe('TODAY');
  });
});

describe('waiverDeadlineCopy — against the real AFL calendar', () => {
  it('reads Wednesday 8:00 PM PT for an ordinary in-season week', () => {
    const now = new Date('2026-09-15T18:19:00-07:00'); // Tuesday evening
    const copy = waiverDeadlineCopy(resolveWaiverWindow(aflEvents, now), { now });
    expect(copy.open).toBe(true);
    expect(copy.line).toBe('Wed 8:00 PM PT');
    expect(copy.word).toBe('TOMORROW');
    expect(copy.accentWord).toBe('TOMORROW.');
    expect(copy.summary).toContain('Waivers process Wed 8:00 PM PT');
    // The shipped bug, stated as the thing that must never come back.
    expect(copy.summary).not.toMatch(/tonight/i);
    expect(copy.countValue).not.toBe('TONIGHT');
  });

  it('says TONIGHT on the Wednesday half of the same slot', () => {
    const now = new Date('2026-09-16T14:00:00-07:00'); // Wednesday afternoon
    const copy = waiverDeadlineCopy(resolveWaiverWindow(aflEvents, now), { now });
    expect(copy.open).toBe(true);
    expect(copy.word).toBe('TONIGHT');
    expect(copy.line).toBe('Wed 8:00 PM PT');
  });

  it('flips to processed once the run has happened', () => {
    const now = new Date('2026-09-16T20:30:00-07:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow(aflEvents, now), { now });
    expect(copy.open).toBe(false);
    expect(copy.accentWord).toBe('PROCESSED.');
    expect(copy.summary).toMatch(/first-come, first-served/);
  });

  it('never hardcodes Wednesday — the Dec 29 run is a TUESDAY', () => {
    // MFL's own 2026 feed schedules WAIVER_REVERSE on Tue Dec 29 8:00 PM PT.
    // Any copy that says "Wednesday" is wrong that week; this is why the day
    // is read rather than written down.
    const now = new Date('2026-12-29T10:00:00-08:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow(aflEvents, now), { now });
    expect(copy.line).toBe('Tue 8:00 PM PT');
    expect(copy.summary).not.toMatch(/wednesday/i);
  });
});

describe('waiverDeadlineCopy — TheLeague processes at 7pm, not 8', () => {
  it('reads the hour off the calendar', () => {
    const now = new Date('2026-09-16T14:00:00-07:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow(theLeagueEvents, now), { now });
    expect(copy.line).toBe('Wed 7:00 PM PT');
    expect(copy.summary).not.toContain('8:00 PM');
  });

  it('is already closed in the hour the slot outlives the deadline', () => {
    // TheLeague's slot runs to 8pm PT; its waivers ran at 7. That hour used to
    // render a countdown reading "Closed".
    const now = new Date('2026-09-16T19:30:00-07:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow(theLeagueEvents, now), { now });
    expect(copy.open).toBe(false);
    expect(copy.countValue).toBe('OPEN NOW');
  });
});

describe('waiverDeadlineCopy — the viewer’s clock', () => {
  it('leads with the viewer’s zone and keeps the league’s PT behind it', () => {
    const now = new Date('2026-09-16T14:00:00-07:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow(aflEvents, now), { now, clock: sydney });
    expect(copy.line).toContain('PT');
    expect(copy.line.startsWith('Thu')).toBe(true);
    expect(copy.line).toMatch(/A[EC][SD]T/);
  });

  it('prints PT alone for a viewer who has chosen nothing', () => {
    const now = new Date('2026-09-16T14:00:00-07:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow(aflEvents, now), { now });
    expect(copy.line).toBe('Wed 8:00 PM PT');
    expect(copy.line).not.toContain('·');
  });
});

describe('waiverDeadlineCopy — an unreadable calendar', () => {
  it('is neither open nor CLEARED — three states, two presentations', () => {
    // `open` answers "are claims being queued", so it is false for `fcfs` AND
    // for `unknown`. A hero that read `!open` as "waivers have cleared"
    // rendered the headline "CLAIMS HAVE SOON." over a summary saying claims
    // were still queued, the moment the calendar could not be read — and the
    // export is owner-gated, so that is a real production state.
    const now = new Date('2026-09-15T18:19:00-07:00');
    const copy = waiverDeadlineCopy(resolveWaiverWindow([], now), { now });
    expect(copy.mode).toBe('unknown');
    expect(copy.mode).not.toBe('fcfs'); // what the heroes branch on
  });

  it('renders a coherent AFL hero when the calendar cannot be read', () => {
    const now = new Date('2026-09-15T18:19:00-07:00');
    const waiver = waiverDeadlineCopy(resolveWaiverWindow([], now), { now });
    const state = resolveAflHeroState({ referenceDate: now, waiver, rng: () => 0.99 } as never) as {
      view?: { headline?: string; accentWord?: string; pill?: string };
      content?: { title?: string };
    };
    const headline = `${state.view?.headline} ${state.view?.accentWord}`;
    expect(headline).toBe('CLAIMS RUN SOON.');
    expect(headline).not.toContain('CLAIMS HAVE'); // the garbled shipped form
    expect(state.view?.pill).toBe('WAIVER DAY');
    expect(state.content?.title).not.toBe('Waivers Have Cleared');
  });

  it('names no day at all rather than guessing Wednesday', () => {
    // The calendar export is owner-gated; an empty read is a real production
    // possibility, and it must not fall back to prose.
    const copy = waiverDeadlineCopy(resolveWaiverWindow([], new Date('2026-09-15T18:19:00-07:00')), {
      now: new Date('2026-09-15T18:19:00-07:00'),
    });
    expect(copy.at).toBeNull();
    expect(copy.summary).not.toMatch(/wednesday|tuesday|tonight|tomorrow/i);
    expect(copy.word).toBe('SOON');
  });
});

describe('the heroes carry no hardcoded waiver day', () => {
  const sources: Array<[string, string]> = [
    ['src/utils/afl-hero-resolver.ts', 'AFL hero resolver'],
    ['src/components/theleague/season-heroes/WaiverWireHero.astro', "TheLeague's waiver hero"],
  ];

  for (const [path, label] of sources) {
    it(`${label} states no waiver weekday or hour in its rendered copy`, () => {
      const src = readFileSync(path, 'utf8');
      // Comments are where the REASONING lives and must stay readable, so only
      // the code is scanned. Block comments and line comments both go.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
      expect(code).not.toMatch(/process(es)?\s+Wednesday/i);
      expect(code).not.toMatch(/\bWednesday at \d/i);
      expect(code).not.toMatch(/\b\d\s?PM PT\b/i);
    });
  }

  it("TheLeague's hero no longer builds the deadline out of local date math", () => {
    const src = readFileSync('src/components/theleague/season-heroes/WaiverWireHero.astro', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    // `new Date(y, m, d, 20, …)` is server-local — UTC on Vercel — and the
    // `+ 7 * 60 * 60 * 1000` that corrected for it is PDT-only.
    expect(code).not.toMatch(/7\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(code).not.toMatch(/daysUntilWed/);
  });
});
