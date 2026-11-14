import { describe, expect, it } from 'vitest';
import { tradeDeadlineCutoffISO, tradeDeadlineTimeLabel } from '../src/utils/trade-deadline.mjs';

// TheLeague closes trading at 8:45 PM PT on deadline day — the instant MFL's
// calendar TRADE event starts (epoch 1794631500 for 2026). The countdown once
// ran to midnight, giving owners three hours that did not exist.
describe('trade deadline cutoff', () => {
  it("TheLeague counts down to MFL's 8:45 PM PT cutoff, not midnight", () => {
    const iso = tradeDeadlineCutoffISO('theleague', 2026);
    expect(iso).toBe('2026-11-13T20:45:00-08:00');
    expect(new Date(iso!).getTime() / 1000).toBe(1794631500);
    expect(tradeDeadlineTimeLabel('theleague')).toBe('8:45 PM PT');
  });

  it('a league with no cutoff time runs to the midnight that ends deadline day', () => {
    const iso = tradeDeadlineCutoffISO('afl-fantasy', 2026)!;
    expect(iso.endsWith('T00:00:00-08:00')).toBe(true);
    expect(tradeDeadlineTimeLabel('afl-fantasy')).toBe('midnight PT');
  });
});
