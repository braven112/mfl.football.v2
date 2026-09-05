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
