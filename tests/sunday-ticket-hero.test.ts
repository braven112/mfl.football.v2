import { describe, it, expect } from 'vitest';
import { gameDayPreviewSlotView, isSundayPT } from '../src/utils/afl-hero-resolver';

// Sat Sep 12 2026 09:00 PT = 16:00Z ; Sun Sep 13 2026 08:00 PT = 15:00Z
const SAT = new Date(Date.UTC(2026, 8, 12, 16));
const SUN = new Date(Date.UTC(2026, 8, 13, 15));

describe('the game-day-preview slot is two heroes', () => {
  it('knows Sunday in the league clock, not UTC', () => {
    expect(isSundayPT(SAT)).toBe(false);
    expect(isSundayPT(SUN)).toBe(true);
    // Sun 11:30 PM PT is already Monday in UTC — still Sunday here.
    expect(isSundayPT(new Date(Date.UTC(2026, 8, 14, 6, 30)))).toBe(true);
  });

  it('Saturday is the lineup-lock reminder', () => {
    const v = gameDayPreviewSlotView({ now: SAT, slot: 'game-day-preview', gameWindow: null, week: 1 });
    expect(v.link).toBe('/afl-fantasy/lineup');
    expect(v.pill).toBe('GAME DAY');
  });

  it('Sunday morning is the Sunday Ticket hero, pointing at the board', () => {
    const v = gameDayPreviewSlotView({ now: SUN, slot: 'game-day-preview', gameWindow: null, week: 1 });
    expect(v.link).toBe('/afl-fantasy/sunday-ticket');
    expect(v.pill).toBe('SUNDAY TICKET');
    expect(v.icon).toBe('nfl');
    expect(v.summary).toContain('Week 1');
  });
});

describe('showSundayTicketHero — Saturday from 5pm, only with a lineup in', async () => {
  const { showSundayTicketHero, isSaturdayEveningPT } = await import('../src/utils/sunday-ticket-window');
  const satAt = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 12, h + 7, m)); // PDT = UTC-7

  it('Saturday 4:59pm is not evening; 5:00pm is', () => {
    expect(isSaturdayEveningPT(satAt(16, 59))).toBe(false);
    expect(isSaturdayEveningPT(satAt(17, 0))).toBe(true);
  });

  it('Saturday evening flips only on a confirmed lineup; unknown and false keep the reminder', () => {
    expect(showSundayTicketHero(satAt(18), true)).toBe(true);
    expect(showSundayTicketHero(satAt(18), false)).toBe(false);
    expect(showSundayTicketHero(satAt(18), null)).toBe(false);
    expect(showSundayTicketHero(satAt(18), undefined)).toBe(false);
    expect(showSundayTicketHero(satAt(12), true)).toBe(false);
  });

  it('Sunday flips regardless of the lineup', () => {
    expect(showSundayTicketHero(SUN, null)).toBe(true);
    expect(showSundayTicketHero(SUN, false)).toBe(true);
  });

  it('the AFL slot view follows the same rule', () => {
    const on = gameDayPreviewSlotView({ now: satAt(18), slot: 'game-day-preview', gameWindow: null, week: 1, lineupSubmitted: true });
    const off = gameDayPreviewSlotView({ now: satAt(18), slot: 'game-day-preview', gameWindow: null, week: 1, lineupSubmitted: null });
    expect(on.link).toBe('/afl-fantasy/sunday-ticket');
    expect(off.link).toBe('/afl-fantasy/lineup');
  });
});

describe('hasSubmittedLineup — live first, disk confirm-only, null when unknowable', async () => {
  const { hasSubmittedLineup, lineupSubmittedFromPayload, clearLineupSubmittedCache } = await import('../src/utils/lineup-submitted');
  const { DEFAULT_LEAGUE } = await import('../src/config/leagues');
  const payload = (starters: string) => ({ weeklyResults: { week: '3', matchup: [{ franchise: [{ id: '0001', starters }, { id: '0002' }] }] } });
  const fetchWith = (body: any, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
  // A league year with no feed on disk, so the disk fallback cannot confirm anything.
  const NO_FEED_YEAR = 1999;

  it('reads starters off the payload; a listed franchise with none is false; an unlisted one is null', () => {
    expect(lineupSubmittedFromPayload(payload('100,200,'), 3, '0001')).toBe(true);
    expect(lineupSubmittedFromPayload(payload(''), 3, '0001')).toBe(false);
    expect(lineupSubmittedFromPayload(payload('100'), 3, '0009')).toBeNull();
    expect(lineupSubmittedFromPayload(null, 3, '0001')).toBeNull();
  });

  it('answers from the live export when it carries the week', async () => {
    clearLineupSubmittedCache();
    const r = await hasSubmittedLineup({ league: DEFAULT_LEAGUE, franchiseId: '0001', week: 3, leagueYear: NO_FEED_YEAR, fetchImpl: fetchWith(payload('100,200')) });
    expect(r).toBe(true);
  });

  it('a dead live read with nothing on disk is null, never false', async () => {
    clearLineupSubmittedCache();
    const r = await hasSubmittedLineup({ league: DEFAULT_LEAGUE, franchiseId: '0001', week: 3, leagueYear: NO_FEED_YEAR, fetchImpl: fetchWith({ error: 'throttled' }) });
    expect(r).toBeNull();
    const r2 = await hasSubmittedLineup({ league: DEFAULT_LEAGUE, franchiseId: '0001', week: 3, leagueYear: NO_FEED_YEAR, fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
    expect(r2).toBeNull();
  });

  it('caches the live payload per league/year/week', async () => {
    clearLineupSubmittedCache();
    let calls = 0;
    const f = (async () => { calls++; return { ok: true, json: async () => payload('100') }; }) as unknown as typeof fetch;
    await hasSubmittedLineup({ league: DEFAULT_LEAGUE, franchiseId: '0001', week: 3, leagueYear: NO_FEED_YEAR, fetchImpl: f });
    await hasSubmittedLineup({ league: DEFAULT_LEAGUE, franchiseId: '0002', week: 3, leagueYear: NO_FEED_YEAR, fetchImpl: f });
    expect(calls).toBe(1);
  });
});
