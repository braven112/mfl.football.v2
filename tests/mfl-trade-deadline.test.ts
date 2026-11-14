import { describe, expect, it } from 'vitest';
import {
  checkTradeDeadline,
  isTradeDeadlineCheckWindow,
  mflTradeCutoff,
} from '../src/utils/mfl-trade-deadline.mjs';
import { resolveLeagueHeroState } from '../src/utils/league-hero/resolver';

// MFL is the source of truth for the trade deadline (Brandon, 2026-11-13);
// the Constitution is the cross-check, and a disagreement is FLAGGED.
// Epochs are the real 2026 calendar TRADE events.
const TL_2026 = 1794631500; // Fri Nov 13 2026 8:45 PM PT
const AFL_2026 = 1795074300; // Wed Nov 18 2026 11:45 PM PT
const WEEK = 7 * 86400;

const cal = (start: number | string, extra: object[] = []) => [
  { type: 'WAIVER_BBID', start_time: '1790000000', end_time: '1790000000' },
  { type: 'TRADE', start_time: String(start), end_time: '' },
  ...extra,
];

describe('mflTradeCutoff', () => {
  it("reads MFL's TRADE event start as the cutoff instant, on the Pacific clock", () => {
    expect(mflTradeCutoff(cal(TL_2026), 2026)).toEqual({
      epoch: TL_2026,
      isoDate: '2026-11-13',
      time: '20:45',
      cutoffISO: '2026-11-13T20:45:00-08:00',
      timeLabel: '8:45 PM PT',
    });
    expect(mflTradeCutoff(cal(AFL_2026), 2026)?.timeLabel).toBe('11:45 PM PT');
  });

  it('accepts the raw export shape and skips unset (0 / empty) starts', () => {
    expect(mflTradeCutoff({ calendar: { event: { type: 'TRADE', start_time: String(TL_2026) } } }, 2026)?.isoDate).toBe('2026-11-13');
    expect(mflTradeCutoff(cal(''), 2026)).toBeNull();
    expect(mflTradeCutoff(cal('0'), 2026)).toBeNull();
  });

  it("ignores another season's TRADE event", () => {
    expect(mflTradeCutoff(cal(TL_2026 - 52 * WEEK), 2026)).toBeNull();
  });
});

describe('checkTradeDeadline', () => {
  it('matches when MFL and the Constitution agree (TheLeague 2026, date and time)', () => {
    const c = checkTradeDeadline('theleague', 2026, cal(TL_2026));
    expect(c.status).toBe('match');
    expect(c.flag).toBe(false);
  });

  it('compares only the date when the Constitution names no time (AFL)', () => {
    expect(checkTradeDeadline('afl-fantasy', 2026, cal(AFL_2026)).status).toBe('match');
  });

  it("flags MFL's carried-over week-late deadline — the 2024-2026 drift", () => {
    const c = checkTradeDeadline('theleague', 2026, cal(TL_2026 + WEEK));
    expect(c.status).toBe('mismatch');
    expect(c.flag).toBe(true);
    expect(c.message).toBe('MFL closes trading Fri, Nov 20 at 8:45 PM PT, but the Constitution says Fri, Nov 13 at 8:45 PM PT.');
  });

  it('flags a wrong time on the right day', () => {
    const c = checkTradeDeadline('theleague', 2026, cal(TL_2026 + 3 * 3600 + 15 * 60)); // midnight
    expect(c.status).toBe('mismatch');
    expect(c.message).toContain('midnight PT');
  });

  it('flags a calendar with no deadline, but stays quiet with no calendar at all', () => {
    expect(checkTradeDeadline('theleague', 2026, [{ type: 'WAIVER_BBID', start_time: '1790000000' }]).status).toBe('mfl-missing');
    const unknown = checkTradeDeadline('theleague', 2026, []);
    expect(unknown.status).toBe('unknown');
    expect(unknown.flag).toBe(false);
  });

  it('a league with no deadline rule is never flagged', () => {
    expect(checkTradeDeadline('best-ball-1', 2026, cal(TL_2026)).status).toBe('no-rule');
  });
});

describe('isTradeDeadlineCheckWindow', () => {
  const flagged = checkTradeDeadline('theleague', 2026, cal(TL_2026 + WEEK));
  it('opens 60 days before the earlier date and closes after the later one', () => {
    expect(isTradeDeadlineCheckWindow(flagged, new Date('2026-08-01T19:00:00Z'))).toBe(false);
    expect(isTradeDeadlineCheckWindow(flagged, new Date('2026-09-20T19:00:00Z'))).toBe(true);
    expect(isTradeDeadlineCheckWindow(flagged, new Date('2026-11-20T19:00:00Z'))).toBe(true);
    expect(isTradeDeadlineCheckWindow(flagged, new Date('2026-11-21T19:00:00Z'))).toBe(false);
  });
  it('never opens for an unflagged check', () => {
    expect(isTradeDeadlineCheckWindow(checkTradeDeadline('theleague', 2026, cal(TL_2026)), new Date('2026-11-01T19:00:00Z'))).toBe(false);
  });
});

describe('the deadline hero follows MFL', () => {
  const resolve = (iso: string, tradeDeadline: ReturnType<typeof mflTradeCutoff>) =>
    resolveLeagueHeroState({ league: 'theleague', referenceDate: new Date(iso), events: [], tradeDeadline });

  it("runs on MFL's day and counts down to MFL's instant", () => {
    const moved = mflTradeCutoff(cal(TL_2026 + WEEK), 2026);
    const onMflDay = resolve('2026-11-20T20:00:00Z', moved);
    expect(onMflDay.kind).toBe('trade-deadline');
    if (onMflDay.kind === 'trade-deadline') {
      expect(onMflDay.deadlineMidnightPT).toBe('2026-11-20T20:45:00-08:00');
      expect(onMflDay.deadlineLabel).toBe('8:45 PM PT');
    }
    // The Constitution's day is not the deadline when MFL says otherwise.
    expect(resolve('2026-11-13T20:00:00Z', moved).kind).not.toBe('trade-deadline');
  });

  it("falls back to the Constitution's day when MFL's calendar is unavailable", () => {
    const state = resolve('2026-11-13T20:00:00Z', null);
    expect(state.kind).toBe('trade-deadline');
  });
});
