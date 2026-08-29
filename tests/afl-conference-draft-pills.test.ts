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
 *    so both drafts (each defined with an explicit `time`) resolved to midnight
 *    and the pills rendered "12:00 AM" for events with real start times
 *    (AL live draft 12:30 PM PT, NL email draft 9 AM PT).
 *
 * 2026 anchors: Labor Day is Mon Sep 7 → AL draft Sat Aug 29 12:30 PM PT
 * (live conference draft), NL draft Sun Aug 30 9:00 AM PT (email draft).
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
  it('AL draft rule resolves to 12:30 PM, not midnight', () => {
    const date = resolveDateForYear(
      { type: 'computed', rule: 'saturday-before-labor-day-weekend', time: '12:30' },
      2026,
    );
    expect(ymd(date)).toBe('2026-8-29');
    expect(date.getHours()).toBe(12);
    expect(date.getMinutes()).toBe(30);
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
  it('lead-up week: both pills show this year — AL 12:30 PM, NL 9 AM', () => {
    const state = draftState(new Date(2026, 7, 26, 12, 0)); // Wed Aug 26
    expect(state.eventId).toBe('afl-al-draft');
    const cd = state.conferenceDraft!;
    expect(ymd(cd.al.date)).toBe('2026-8-29');
    expect(ymd(cd.nl.date)).toBe('2026-8-30');
    expect(cd.al.date.getHours()).toBe(12);
    expect(cd.al.date.getMinutes()).toBe(30);
    expect(cd.nl.date.getHours()).toBe(9);
    expect(cd.al.live).toBe(false);
    expect(cd.nl.live).toBe(false);
  });

  it('AL draft day: AL pill is live, both dates are this year', () => {
    const state = draftState(new Date(2026, 7, 29, 13, 0)); // Sat Aug 29, 1 PM (after 12:30 start)
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

  it('draft-day live boundaries: not live at 12:29 PM, live 12:30 PM through 8:45 PM, over at 8:46 PM', () => {
    const at = (h: number, m: number) => draftState(new Date(2026, 7, 29, h, m)).conferenceDraft!;
    expect(at(12, 29).al.live).toBe(false);
    expect(at(12, 30).al.live).toBe(true);
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

describe('conference-aware draft lead', () => {
  // Both AL (Sat) and NL (Sun) draft windows open together, so the earlier-dated
  // AL draft would lead for everyone. The lead must swap to the viewer's OWN
  // conference draft; guests keep the earliest (AL).
  const leadFor = (referenceDate: Date, userConferenceId?: '00' | '01') => {
    const state = resolveAflHeroState({ referenceDate, whatsNewEntries: [], userConferenceId });
    if (state.kind !== 'calendar-event') {
      throw new Error(`expected calendar-event state, got ${state.kind}`);
    }
    return state.eventId;
  };

  // Wed Aug 26 — inside both drafts' lead-up window, neither live yet.
  const leadUp = new Date(2026, 7, 26, 12, 0);

  it('NL owner leads with the NL draft, not the earlier AL draft', () => {
    expect(leadFor(leadUp, '01')).toBe('afl-nl-draft');
  });

  it('AL owner leads with the AL draft', () => {
    expect(leadFor(leadUp, '00')).toBe('afl-al-draft');
  });

  it('guest (no conference) leads with the earliest draft (AL)', () => {
    expect(leadFor(leadUp)).toBe('afl-al-draft');
  });

  it('mid-July (post-keeper) NL owner already sees the NL draft countdown', () => {
    // Draft urgency window reaches back past the keeper deadline; once keeper is
    // past, the viewer's own conference draft leads.
    expect(leadFor(new Date(2026, 6, 20, 12, 0), '01')).toBe('afl-nl-draft');
  });
});

describe('live conference board links', () => {
  /**
   * The hero leads with the viewer's OWN conference, and the two conferences
   * draft on different DAYS. So on AL draft day an NL owner leads with a
   * not-yet-live NL card whose CTA points at the draft order — and the AL
   * board, which is live right now, was unreachable from the homepage. The
   * lead pick attaches a secondary link to every live board, deduped against
   * the primary CTA.
   */
  const viewFor = (referenceDate: Date, userConferenceId?: '00' | '01') => {
    const state = resolveAflHeroState({ referenceDate, whatsNewEntries: [], userConferenceId });
    if (state.kind !== 'calendar-event') {
      throw new Error(`expected calendar-event state, got ${state.kind}`);
    }
    return state.view;
  };

  const alDraftDay = new Date(2026, 7, 29, 13, 0); // Sat Aug 29, 1 PM — AL live
  const nlDraftDay = new Date(2026, 7, 30, 12, 0); // Sun Aug 30, noon — NL live
  const leadUp = new Date(2026, 7, 26, 12, 0); // Wed Aug 26 — neither live

  it('AL draft day: an NL owner gets the live AL board as a secondary link', () => {
    const view = viewFor(alDraftDay, '01');
    // Their own (not-yet-live) conference still owns the CTA.
    expect(view.link).toBe('/afl-fantasy/draft-predictor');
    expect(view.secondaryLinks).toEqual([
      { label: 'AL Draft Board', href: '/afl-fantasy/draft-broadcast?conference=00', live: true },
    ]);
  });

  it('AL draft day, live: an AL owner picks in the room and watches on the board', () => {
    const view = viewFor(alDraftDay, '00');
    // The CTA is MFL's live draft room (the only place a pick can be made), so
    // the AL board is no longer a duplicate of it and rides along as secondary.
    expect(view.link).toContain('/ajax_ld?L=');
    expect(view.secondaryLinks).toEqual([
      { label: 'AL Draft Board', href: '/afl-fantasy/draft-broadcast?conference=00', live: true },
    ]);
  });

  it('NL draft day: an AL owner reaches the live NL board', () => {
    const view = viewFor(nlDraftDay, '00');
    const hrefs = [view.link, ...(view.secondaryLinks ?? []).map((l) => l.href)];
    expect(hrefs).toContain('/afl-fantasy/draft-broadcast?conference=01');
    // Never offer a board for a draft that has not started — it is 108 empty slots.
    expect(hrefs).not.toContain('/afl-fantasy/draft-broadcast?conference=00');
  });

  it('lead-up week: no board links at all, for either conference', () => {
    for (const conf of ['00', '01'] as const) {
      const view = viewFor(leadUp, conf);
      expect(view.secondaryLinks).toBeUndefined();
      expect(view.link).toBe('/afl-fantasy/draft-predictor');
    }
  });

  it('every board link carries ?conference= — a bare path silently serves the AL', () => {
    for (const ref of [alDraftDay, nlDraftDay]) {
      for (const conf of [undefined, '00', '01'] as const) {
        const view = viewFor(ref, conf);
        const links = [view.link, ...(view.secondaryLinks ?? []).map((l) => l.href)];
        for (const href of links) {
          if (href?.includes('/draft-broadcast')) {
            expect(href).toMatch(/\?conference=(00|01)$/);
          }
        }
      }
    }
  });
});
