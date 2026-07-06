import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import { resolveDateForYear, getAllResolvedAflEvents } from '../src/utils/league-event-resolver';

/**
 * AFL conference-draft pills — date pairing + draft start time.
 *
 * Two regressions pinned here:
 *
 * 1. The dual AL/NL pills looked up their sibling event in the DEDUPED event
 *    list. Dedup keeps only the soonest upcoming occurrence per id, so on NL
 *    draft day (the AL draft now `isPast`) the AL pill resolved to NEXT
 *    year's occurrence — it rendered "Sat, Aug 28" (2027's AL draft) while
 *    Aug 28, 2026 is a Friday. The pairing must anchor on the lead event's
 *    date against the raw (pre-dedup) list.
 *
 * 2. `resolveDateForYear` dropped the `time` field on `computed` date rules,
 *    so both drafts (defined with `"time": "09:00"`) resolved to midnight and
 *    the pills rendered "12:00 AM" for events the hero copy says start 9 AM PT.
 *
 * 2026 anchors: Labor Day is Mon Sep 7 → AL draft Sat Aug 29, NL draft Sun Aug 30.
 */

function draftState(referenceDate: Date) {
  const state = resolveAflHeroState({ referenceDate, whatsNewEntries: [] });
  if (state.kind !== 'calendar-event') {
    throw new Error(`expected calendar-event state, got ${state.kind}`);
  }
  return state;
}

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');

describe('computed date rules honor the time field', () => {
  it('AL draft rule resolves to 9:00 AM, not midnight', () => {
    const date = resolveDateForYear(
      { type: 'computed', rule: 'saturday-before-labor-day-weekend', time: '09:00' },
      2026,
    );
    expect(ymd(date)).toBe('2026-8-29');
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  it('computed rule without a time stays at midnight', () => {
    const date = resolveDateForYear(
      { type: 'computed', rule: 'sunday-before-labor-day-weekend' },
      2026,
    );
    expect(date.getHours()).toBe(0);
  });
});

describe('AFL conference-draft pills', () => {
  it('lead-up week: both pills show this year, 9 AM start', () => {
    const state = draftState(new Date(2026, 7, 26, 12, 0)); // Wed Aug 26
    expect(state.eventId).toBe('afl-al-draft');
    const cd = state.conferenceDraft!;
    expect(ymd(cd.al.date)).toBe('2026-8-29');
    expect(ymd(cd.nl.date)).toBe('2026-8-30');
    expect(cd.al.date.getHours()).toBe(9);
    expect(cd.nl.date.getHours()).toBe(9);
    expect(cd.al.live).toBe(false);
    expect(cd.nl.live).toBe(false);
  });

  it('AL draft day: AL pill is live, both dates are this year', () => {
    const state = draftState(new Date(2026, 7, 29, 12, 0)); // Sat Aug 29
    expect(state.eventId).toBe('afl-al-draft');
    const cd = state.conferenceDraft!;
    expect(ymd(cd.al.date)).toBe('2026-8-29');
    expect(ymd(cd.nl.date)).toBe('2026-8-30');
    expect(cd.al.live).toBe(true);
    expect(cd.nl.live).toBe(false);
  });

  it('NL draft day: AL pill keeps THIS year\'s (just-passed) date, not next year\'s', () => {
    const state = draftState(new Date(2026, 7, 30, 12, 0)); // Sun Aug 30
    expect(state.eventId).toBe('afl-nl-draft');
    const cd = state.conferenceDraft!;
    // The regression: dedup had swapped the past AL event for 2027's
    // occurrence (Sat Aug 28, 2027) and the pill showed "Sat, Aug 28".
    expect(ymd(cd.al.date)).toBe('2026-8-29');
    expect(ymd(cd.nl.date)).toBe('2026-8-30');
    expect(cd.al.live).toBe(false);
    expect(cd.nl.live).toBe(true);
  });

  it('draft-day live boundaries: not live at 8:59 AM, live 9:00 AM through 8:45 PM, over at 8:46 PM', () => {
    const at = (h: number, m: number) => draftState(new Date(2026, 7, 29, h, m)).conferenceDraft!;
    expect(at(8, 59).al.live).toBe(false);
    expect(at(9, 0).al.live).toBe(true);
    expect(at(20, 45).al.live).toBe(true);
    // 8:46 PM: AL is over; the lead flips to the NL draft but the AL pill
    // must still show THIS year's date.
    const after = draftState(new Date(2026, 7, 29, 20, 46));
    expect(after.eventId).toBe('afl-nl-draft');
    expect(ymd(after.conferenceDraft!.al.date)).toBe('2026-8-29');
  });
});

describe('calendar-day countdown (daysUntilStartCalendar)', () => {
  const nlDraft = (referenceDate: Date) => {
    const e = getAllResolvedAflEvents({ leagueYear: 2026, referenceDate })
      .find((x) => x.definition.id === 'afl-nl-draft');
    if (!e) throw new Error('afl-nl-draft not resolved');
    return e;
  };

  it('Sat 8:59 AM: the Sunday 9 AM draft is 1 calendar day out (ceil says 2)', () => {
    const e = nlDraft(new Date(2026, 7, 29, 8, 59));
    expect(e.daysUntilStart).toBe(2); // the old display bug: "2 days out"
    expect(e.daysUntilStartCalendar).toBe(1); // what cards must render
  });

  it('draft-day morning pre-start: 0 calendar days (ceil says 1)', () => {
    const e = nlDraft(new Date(2026, 7, 30, 8, 0));
    expect(e.daysUntilStart).toBe(1);
    expect(e.daysUntilStartCalendar).toBe(0);
  });
});
