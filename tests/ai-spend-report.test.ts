/**
 * Site Insights' AI spend card (Brandon, 2026-11-21): Ask the History's real
 * per-league monthly cost, read back from the `ai-usage:<slug>:<YYYY-MM>`
 * hashes recordAiUsage writes.
 */
import { describe, expect, it } from 'vitest';
import { HAIKU_MODEL, SONNET_MODEL } from '../src/utils/claude-models.mjs';
import { aiSpendMonths, modelFamily, summarizeAiSpend } from '../src/utils/ai-usage';

const S = SONNET_MODEL;
const H = HAIKU_MODEL;

describe('ai spend report', () => {
  it('lists months newest first on the Pacific clock, across a year boundary', () => {
    // 2027-01-01 03:00 UTC is still Dec 31 in Pacific time.
    expect(aiSpendMonths(3, new Date('2027-01-01T03:00:00Z'))).toEqual(['2026-12', '2026-11', '2026-10']);
    expect(aiSpendMonths(2, new Date('2027-01-15T20:00:00Z'))).toEqual(['2027-01', '2026-12']);
  });

  it('names model families', () => {
    expect(modelFamily(SONNET_MODEL)).toBe('Sonnet');
    expect(modelFamily(HAIKU_MODEL)).toBe('Haiku');
  });

  it('sums every model per league per month, splits out signed-out demo use, and sorts by newest spend', () => {
    const months = ['2026-11', '2026-10'];
    const report = summarizeAiSpend(
      [
        { slug: 'theleague', month: '2026-11', fields: { [`${S}:questions`]: '10', [`${S}:microUsd`]: '1200000', [`${S}:inputTokens`]: '999' } },
        { slug: 'theleague', month: '2026-10', fields: { [`${H}:questions`]: 4, [`${H}:microUsd`]: 20000 } },
        { slug: 'afl-fantasy', month: '2026-11', fields: { [`${S}:questions`]: 30, [`${S}:microUsd`]: 3500000 } },
        { slug: 'theleague-guest', month: '2026-11', fields: { [`${H}:questions`]: 2, [`${H}:microUsd`]: 4000 } },
        { slug: 'theleague', month: '2026-08', fields: { [`${S}:questions`]: 99, [`${S}:microUsd`]: 99000000 } },
      ],
      months,
    );
    expect(report.leagues.map((l) => l.key)).toEqual(['afl-fantasy', 'theleague', 'theleague-guest']);
    const tl = report.leagues[1];
    expect(tl.byMonth['2026-11']).toEqual({ questions: 10, costUsd: 1.2 });
    expect(tl.byMonth['2026-10'].questions).toBe(4);
    expect(tl.models).toEqual(['Haiku', 'Sonnet']);
    const guest = report.leagues[2];
    expect(guest).toMatchObject({ slug: 'theleague', guest: true });
    expect(report.totals['2026-11'].questions).toBe(42);
    expect(report.totals['2026-11'].costUsd).toBeCloseTo(4.704, 6);
    // A month outside the window is ignored, not folded in.
    expect(report.totals['2026-10'].questions).toBe(4);
  });
});
