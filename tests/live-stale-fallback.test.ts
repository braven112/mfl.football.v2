/**
 * A league we could not read never wipes scores we already had.
 *
 * ── THE BUG ───────────────────────────────────────────────────────────────
 * On 2026-09-20 at 10:33 PT an owner screenshotted `/live` showing BOTH
 * leagues as "Couldn't read this league — we reached for the scores and didn't
 * get them", with the freshness pill beside them reading "● Live · updated
 * just now". Both halves were telling the truth about different things: the
 * BOARD poll had succeeded (production logs show every `/api/live-board` in
 * that minute answering 200) while the LEAGUE reads inside it had not, so the
 * island replaced real scores with an error card and then reported itself
 * healthy.
 *
 * `LiveBoard`'s poller already refused to wipe the board on a failed POLL
 * (`data.ok !== false`). This is the same rule one level down, where the
 * failure actually happens, and these are the assertions that keep it:
 *
 *   1. `unavailable` holds the last panel we CONFIRMED, for five minutes.
 *   2. Nothing else is ever held — `not-played` and `no-matchup` are answers
 *      from a feed we read, and substituting older scores for either would
 *      invent a state MFL did not report.
 *   3. A held panel is never silent: `heldSince` travels with it, the board
 *      renders `LvStaleNotice` from it, and the pill stops claiming "Live".
 *   4. The hold is scoped to (week, league), because the week picker swaps
 *      what is on screen without remounting and both registry leagues have a
 *      franchise `0001`.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import LvStaleNotice from '../src/components/shared/live/LvStaleNotice';
import {
  nextHoldExpiry,
  panelMemoryKey,
  resolvePanelViews,
  STALE_HOLD_MS,
  type PanelMemory,
} from '../src/utils/live/stale';
import type { LiveLeagueStatus, LiveMatchup, LivePanel } from '../src/types/live';

const T0 = 1_700_000_000_000;

function matchup(index: number): LiveMatchup {
  const side = (franchiseId: string, live: number) => ({
    franchiseId,
    name: `Team ${franchiseId}`,
    nameShort: franchiseId,
    initials: 'TM',
    icon: '',
    iconAlt: '',
    rung: 'league' as const,
    live,
    projectedFinal: live,
    remainingPoints: 0,
    yetToPlay: 0,
    players: [],
    bench: [],
  });
  return {
    index,
    sides: [side('0001', 88.5), side('0002', 71.2)],
    viewerSide: 0,
    p0: 0.7,
    colorVars: {},
  };
}

function panel(status: LiveLeagueStatus, over: Partial<LivePanel> = {}): LivePanel {
  return {
    leagueId: '13522',
    leagueName: 'The League',
    slug: 'theleague',
    registered: true,
    viewerFranchiseId: '0001',
    status,
    matchups: status === 'ok' ? [matchup(0)] : [],
    ...over,
  };
}

describe('holding the last scores we could confirm', () => {
  describe('an unreadable league keeps the scores we already had', () => {
    it('serves the last confirmed panel instead of the error card', () => {
      const memory = new Map<string, PanelMemory>();
      const good = resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });
      expect(good[0].heldSince).toBeNull();
      expect(good[0].panel.matchups).toHaveLength(1);

      const dropped = resolvePanelViews({
        panels: [panel('unavailable')],
        week: 2,
        memory,
        now: T0 + 30_000,
      });
      // The whole point: matchups, not an empty list with an apology.
      expect(dropped[0].panel.status).toBe('ok');
      expect(dropped[0].panel.matchups).toHaveLength(1);
      expect(dropped[0].panel.matchups[0].sides[0].live).toBe(88.5);
    });

    it('says WHEN — a held score with no age is the worse bug', () => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });
      const held = resolvePanelViews({
        panels: [panel('unavailable')],
        week: 2,
        memory,
        now: T0 + 60_000,
      });
      expect(held[0].heldSince).toBe(T0);
    });

    it('gives up after five minutes and admits it', () => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });

      const insideTheHold = resolvePanelViews({
        panels: [panel('unavailable')],
        week: 2,
        memory,
        now: T0 + STALE_HOLD_MS - 1,
      });
      expect(insideTheHold[0].heldSince).toBe(T0);

      const pastIt = resolvePanelViews({
        panels: [panel('unavailable')],
        week: 2,
        memory,
        now: T0 + STALE_HOLD_MS + 1,
      });
      expect(pastIt[0].panel.status).toBe('unavailable');
      expect(pastIt[0].panel.matchups).toHaveLength(0);
      expect(pastIt[0].heldSince).toBeNull();
    });

    it('is five minutes, which is the number the UI promises', () => {
      expect(STALE_HOLD_MS).toBe(5 * 60 * 1000);
    });

    it('forgets an expired panel rather than flashing it hours later', () => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });
      resolvePanelViews({
        panels: [panel('unavailable')],
        week: 2,
        memory,
        now: T0 + STALE_HOLD_MS + 1,
      });
      expect(memory.has(panelMemoryKey(2, '13522'))).toBe(false);
    });

    it('a recovered league replaces the held panel outright', () => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });
      resolvePanelViews({ panels: [panel('unavailable')], week: 2, memory, now: T0 + 30_000 });

      const back = resolvePanelViews({
        panels: [panel('ok', { matchups: [matchup(0), matchup(1)] })],
        week: 2,
        memory,
        now: T0 + 60_000,
      });
      expect(back[0].heldSince).toBeNull();
      expect(back[0].panel.matchups).toHaveLength(2);
    });
  });

  describe('only a failed READ is held', () => {
    /**
     * The four statuses exist precisely so "the feed says nothing" and "we
     * could not reach the feed" stay separate. Holding an answer we DID read
     * would put this code on the wrong side of that line — showing last
     * quarter's scores over a week MFL has told us has not kicked off.
     */
    it.each(['not-played', 'no-matchup'] as const)('never holds %s', (status) => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });

      const views = resolvePanelViews({
        panels: [panel(status)],
        week: 2,
        memory,
        now: T0 + 30_000,
      });
      expect(views[0].panel.status).toBe(status);
      expect(views[0].heldSince).toBeNull();
      expect(views[0].panel.matchups).toHaveLength(0);
    });
  });

  describe('the memory is scoped to a week and a league', () => {
    it('does not show another WEEK’s scores — the picker swaps without remounting', () => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });

      const week3 = resolvePanelViews({
        panels: [panel('unavailable')],
        week: 3,
        memory,
        now: T0 + 30_000,
      });
      expect(week3[0].heldSince).toBeNull();
      expect(week3[0].panel.matchups).toHaveLength(0);
    });

    it('does not show another LEAGUE’s scores — both leagues have a franchise 0001', () => {
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });

      const afl = resolvePanelViews({
        panels: [panel('unavailable', { leagueId: '19621', leagueName: 'AFL', slug: 'afl-fantasy' })],
        week: 2,
        memory,
        now: T0 + 30_000,
      });
      expect(afl[0].heldSince).toBeNull();
      expect(afl[0].panel.matchups).toHaveLength(0);
    });

    it('holds one league while another is fine — a cross-league board is not all-or-nothing', () => {
      const memory = new Map<string, PanelMemory>();
      const afl = { leagueId: '19621', leagueName: 'AFL', slug: 'afl-fantasy' as const };
      resolvePanelViews({
        panels: [panel('ok'), panel('ok', afl)],
        week: 2,
        memory,
        now: T0,
      });

      const views = resolvePanelViews({
        panels: [panel('ok'), panel('unavailable', afl)],
        week: 2,
        memory,
        now: T0 + 30_000,
      });
      expect(views[0].heldSince).toBeNull();
      expect(views[1].heldSince).toBe(T0);
      expect(views[1].panel.matchups).toHaveLength(1);
    });

    it('takes league IDENTITY from the fresh read, never from the held panel', () => {
      // Scores are the held ones by definition; `viewerFranchiseId` decides
      // who gets "YOUR MATCHUP", and a stale one is the cross-league mix-up
      // the panel is scoped to prevent.
      const memory = new Map<string, PanelMemory>();
      resolvePanelViews({ panels: [panel('ok')], week: 2, memory, now: T0 });

      const views = resolvePanelViews({
        panels: [panel('unavailable', { leagueName: 'The League (renamed)', viewerFranchiseId: null })],
        week: 2,
        memory,
        now: T0 + 30_000,
      });
      expect(views[0].panel.leagueName).toBe('The League (renamed)');
      expect(views[0].panel.viewerFranchiseId).toBeNull();
      expect(views[0].panel.matchups).toHaveLength(1);
    });
  });

  describe('the hold expires on a timer, not on the next poll', () => {
    it('reports the EARLIEST expiry, so the first panel to go is the one timed', () => {
      const views = [
        { panel: panel('ok'), heldSince: T0 + 10_000 },
        { panel: panel('ok'), heldSince: T0 },
      ];
      expect(nextHoldExpiry(views)).toBe(T0 + STALE_HOLD_MS);
    });

    it('reports 0 when nothing is held, so the board schedules no timer', () => {
      expect(nextHoldExpiry([{ panel: panel('ok'), heldSince: null }])).toBe(0);
    });
  });
});

describe('the board never holds scores silently', () => {
  const board = readFileSync(
    resolve(__dirname, '../src/components/shared/live/LiveBoard.tsx'),
    'utf8',
  );

  it('renders the strip from `heldSince`, above the cards it is captioning', () => {
    expect(board).toMatch(/panelHeld !== null && <LvStaleNotice heldSince=\{panelHeld\}/);
  });

  it('draws the panels from the VIEWS, or nothing is ever held', () => {
    // The whole feature in one line: rendering `board.panels` directly is the
    // pre-fix behaviour, and it looks identical in review.
    expect(board).toMatch(/panelViews\.map\(/);
    expect(board).not.toMatch(/board\.panels\.map\(/);
  });

  it('stops the pill claiming "Live" over held scores', () => {
    // The screenshotted contradiction: "● Live · updated just now" sitting
    // above two error cards. A held panel outranks a successful poll.
    expect(board).toMatch(/heldSince\s*\n?\s*\?\s*\{ status: 'error', fetchedAt: heldSince \}/);
  });

  it('reports the OLDEST held panel, which is the age it can honestly claim', () => {
    expect(board).toMatch(/Math\.min\(oldest, v\.heldSince\)/);
  });

  it('keeps the memory in a ref — state written during render is a loop', () => {
    expect(board).toMatch(/const panelMemory = useRef<Map<string, PanelMemory>>/);
  });
});

describe('the strip itself', () => {
  /** React SSR puts `<!-- -->` between adjacent text nodes; it is not content. */
  const html = (heldSince: number) =>
    renderToString(createElement(LvStaleNotice, { heldSince })).replace(/<!-- -->/g, '');

  it('says the scores are held, and how old they are', () => {
    const out = html(Date.now() - 90_000);
    expect(out).toMatch(/last scores we could confirm/i);
    // The age is the load-bearing half — without it this is just a scary
    // banner over numbers the reader cannot date.
    expect(out).toMatch(/from 1m ago/);
  });

  it('says we are still trying, because we are', () => {
    // "Refreshing usually sorts it" is the EMPTY state's line and it asks the
    // reader to act. Here the board is already re-polling on its own, so
    // telling someone to refresh would be busywork we invented.
    expect(html(Date.now())).toMatch(/still trying/i);
  });

  it('is a status region, so it is announced rather than merely drawn', () => {
    expect(html(Date.now())).toMatch(/role="status"/);
  });

  it('is honest on its very FIRST render, before any tick', () => {
    /**
     * The age is seeded from the clock, not from `heldSince`. Seeding from
     * the prop makes the first render read "just now" about scores that are
     * already a minute old — the exact sentence this element exists to stop
     * the board telling — and it would stay wrong until the first 1s tick.
     *
     * The usual objection (a clock read during render is a hydration
     * mismatch) cannot apply here: nothing is ever held on the server, since
     * the hold lives in the island's per-mount memory and the earliest a
     * panel can be held is the first poll that fails.
     */
    expect(html(Date.now() - 45_000)).toMatch(/from 45s ago/);
    expect(html(Date.now())).toMatch(/just now/);
  });
});
