import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import { buildMflLiveDraftUrl, buildMflOptionUrl } from '../src/utils/mfl-url';
import { LEAGUES } from '../src/config/leagues';

/**
 * Draft day → the hero must link to where that conference actually DRAFTS.
 *
 * The regression this pins: on the morning of the AL draft the hero counted
 * down "0 DAYS TO AL DRAFT" and its only CTA was our own draft-order page.
 * The order is settled by then and the broadcast board is read-only, so the
 * one thing an owner actually needed from the homepage that day — the room
 * they pick in — was the one thing the hero did not link to.
 *
 * The two conferences draft on DIFFERENT MFL pages and must never be crossed:
 * the AL meets live in MFL's ajax_ld applet; the NL runs a slow email draft
 * off MFL's email-draft option page, which never opens that applet.
 *
 * And an MFL draft page is offered ONLY to an owner of the drafting
 * conference. Each card also leads for people who don't draft in it — the
 * other conference once its own draft is past, and logged-out visitors, whose
 * lead falls back to the earliest draft. They keep the internal destinations
 * (the order, or the board once picks are live).
 *
 * 2026 anchors: Labor Day is Mon Sep 7 → AL draft Sat Aug 29, 12:30 PM PT
 * (live through 8:45 PM), NL draft Sun Aug 30, 9:00 AM PT.
 */

const AFL = LEAGUES['afl-fantasy'];

const viewFor = (referenceDate: Date, userConferenceId?: '00' | '01') => {
  const state = resolveAflHeroState({ referenceDate, whatsNewEntries: [], userConferenceId });
  if (state.kind !== 'calendar-event') {
    throw new Error(`expected calendar-event state, got ${state.kind}`);
  }
  return state.view;
};

const hrefsOf = (view: ReturnType<typeof viewFor>) => [
  view.link,
  ...(view.secondaryLinks ?? []).map((l) => l.href),
];

const roomUrl2026 = buildMflLiveDraftUrl({
  leagueId: AFL.id,
  year: 2026,
  host: `https://${AFL.mflHost}`,
});

const emailDraftUrl2026 = buildMflOptionUrl({
  leagueId: AFL.id,
  year: 2026,
  option: 52,
  host: `https://${AFL.mflHost}`,
});

describe('buildMflLiveDraftUrl', () => {
  it('builds the league-host room URL for the given season', () => {
    expect(roomUrl2026).toBe(`https://${AFL.mflHost}/2026/ajax_ld?L=${AFL.id}`);
  });

  it('strips a trailing slash on the host', () => {
    expect(buildMflLiveDraftUrl({ leagueId: '1', year: 2026, host: 'https://x.test/' })).toBe(
      'https://x.test/2026/ajax_ld?L=1',
    );
  });
});

describe('buildMflOptionUrl', () => {
  it('builds the email-draft option page for the given season', () => {
    expect(emailDraftUrl2026).toBe(`https://${AFL.mflHost}/2026/options?L=${AFL.id}&O=52`);
  });
});

describe('AL draft-day hero CTA', () => {
  const morningOf = new Date(2026, 7, 29, 7, 19); // Sat Aug 29, 7:19 AM — pre-start
  const justBefore = new Date(2026, 7, 29, 12, 29);
  const live = new Date(2026, 7, 29, 13, 0);
  const dayBefore = new Date(2026, 7, 28, 12, 0); // Fri Aug 28

  it('morning of the draft: the CTA is the live draft room, opened externally', () => {
    const view = viewFor(morningOf, '00');
    expect(view.link).toBe(roomUrl2026);
    expect(view.linkLabel).toBe('Enter Draft Room');
    expect(view.isExternal).toBe(true);
    // Countdown still reads 0 days — the room link is additive, not a re-skin.
    expect(view.countValue).toBe(0);
  });

  it('morning of the draft: the displaced draft order stays reachable', () => {
    const view = viewFor(morningOf, '00');
    expect(view.secondaryLinks).toEqual([
      { label: 'View Draft Order', href: '/afl-fantasy/draft-predictor' },
    ]);
    // The board is 108 empty slots until the first pick — never offered early.
    expect(JSON.stringify(view.secondaryLinks)).not.toContain('draft-broadcast');
  });

  it('one minute before the first pick still offers the room', () => {
    expect(viewFor(justBefore, '00').link).toBe(roomUrl2026);
  });

  it('once live, the room is the CTA and the board becomes the second link', () => {
    const view = viewFor(live, '00');
    expect(view.link).toBe(roomUrl2026);
    expect(view.linkLabel).toBe('Enter Draft Room');
    expect(view.secondaryLinks).toEqual([
      { label: 'AL Draft Board', href: '/afl-fantasy/draft-broadcast?conference=00', live: true },
    ]);
  });

  it('the day BEFORE the draft is unchanged — order page, no external link', () => {
    const view = viewFor(dayBefore, '00');
    expect(view.link).toBe('/afl-fantasy/draft-predictor');
    expect(view.linkLabel).toBe('View Draft Order');
    expect(view.isExternal).toBeFalsy();
    expect(view.secondaryLinks).toBeUndefined();
  });

  it('the room URL carries the DRAFTED season, not the calendar year of the render', () => {
    // Rendered in 2026 for the 2026 draft; the year comes from the event date,
    // so a hero resolved for a future draft can never link into a stale room.
    expect(viewFor(morningOf, '00').link).toContain('/2026/');
  });
});

describe('NL draft-day hero CTA', () => {
  const morningOf = new Date(2026, 7, 30, 8, 0); // Sun Aug 30, 8 AM — pre-9 AM start
  const live = new Date(2026, 7, 30, 12, 0);
  const dayBefore = new Date(2026, 7, 29, 7, 19); // Sat Aug 29 — AL draft day

  it('morning of the draft: the CTA is MFL\'s email draft page', () => {
    const view = viewFor(morningOf, '01');
    expect(view.link).toBe(emailDraftUrl2026);
    expect(view.linkLabel).toBe('Open Email Draft');
    expect(view.isExternal).toBe(true);
    expect(view.secondaryLinks).toEqual([
      { label: 'View Draft Order', href: '/afl-fantasy/draft-predictor' },
    ]);
  });

  it('once live, the email draft page is the CTA and the NL board rides along', () => {
    const view = viewFor(live, '01');
    expect(view.link).toBe(emailDraftUrl2026);
    expect(view.secondaryLinks).toEqual([
      { label: 'NL Draft Board', href: '/afl-fantasy/draft-broadcast?conference=01', live: true },
    ]);
  });

  it('the day BEFORE the NL draft is unchanged — order page, no external link', () => {
    const view = viewFor(dayBefore, '01');
    expect(view.link).toBe('/afl-fantasy/draft-predictor');
    expect(view.isExternal).toBeFalsy();
  });
});

describe('the MFL draft page is only for owners of that conference', () => {
  it('logged out on AL draft day: the public CTA stays our own page', () => {
    const morning = viewFor(new Date(2026, 7, 29, 7, 19));
    expect(morning.link).toBe('/afl-fantasy/draft-predictor');
    expect(morning.isExternal).toBeFalsy();
    // A guest we can't identify would just hit MFL's login wall.
    expect(morning.link).not.toContain('ajax_ld');

    const live = viewFor(new Date(2026, 7, 29, 13, 0));
    expect(live.link).toBe('/afl-fantasy/draft-broadcast?conference=00');
    expect(live.linkLabel).toBe('Open the Draft Board');
  });

  it('logged out on NL draft day: same, no email draft page', () => {
    const live = viewFor(new Date(2026, 7, 30, 12, 0));
    expect(live.link).toBe('/afl-fantasy/draft-broadcast?conference=01');
    expect(live.isExternal).toBeFalsy();
  });

  it('AL owner on NL draft day: their card is gone, so they get the board — not the NL email draft', () => {
    // Their own draft is past by now and drops out of the lead candidates, so
    // the NL card leads for them. They do not draft in it.
    const view = viewFor(new Date(2026, 7, 30, 12, 0), '00');
    expect(view.link).toBe('/afl-fantasy/draft-broadcast?conference=01');
    expect(view.isExternal).toBeFalsy();
    expect(view.linkLabel).toBe('Watch the Board');
  });

  it('NL owner on AL draft day: leads with their own card, never the AL room', () => {
    const view = viewFor(new Date(2026, 7, 29, 7, 19), '01');
    expect(view.link).toBe('/afl-fantasy/draft-predictor');
    expect(view.isExternal).toBeFalsy();
  });
});

describe('the two conferences are never crossed', () => {
  const viewers = [undefined, '00', '01'] as const;

  it('nobody is ever sent to the AL room on NL draft day', () => {
    for (const ref of [new Date(2026, 7, 30, 8, 0), new Date(2026, 7, 30, 12, 0)]) {
      for (const conf of viewers) {
        const hrefs = hrefsOf(viewFor(ref, conf));
        for (const href of hrefs) expect(href).not.toContain('ajax_ld');
      }
    }
  });

  it('nobody is ever sent to the email draft page on AL draft day', () => {
    for (const ref of [new Date(2026, 7, 29, 7, 19), new Date(2026, 7, 29, 13, 0)]) {
      for (const conf of viewers) {
        const hrefs = hrefsOf(viewFor(ref, conf));
        for (const href of hrefs) expect(href).not.toContain('options?L=');
      }
    }
  });

  it('an MFL page is never the CTA for a viewer of the other conference, or none', () => {
    for (const ref of [
      new Date(2026, 7, 29, 7, 19),
      new Date(2026, 7, 29, 13, 0),
      new Date(2026, 7, 30, 8, 0),
      new Date(2026, 7, 30, 12, 0),
    ]) {
      for (const conf of viewers) {
        const view = viewFor(ref, conf);
        // Exact-match against the two known MFL destinations rather than a
        // substring test on the URL — a substring check is both a weaker
        // assertion and the shape static analysis flags as unsafe URL matching.
        if (view.link !== roomUrl2026 && view.link !== emailDraftUrl2026) continue;
        // Only an owner of the conference whose card this is may see one.
        expect(view.link).toBe(conf === '00' ? roomUrl2026 : emailDraftUrl2026);
        expect(view.isExternal).toBe(true);
      }
    }
  });
});
