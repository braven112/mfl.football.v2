import { describe, it, expect } from 'vitest';
import { getCurrentNFLWeek, getKickoffDate } from '../scripts/article-utils/week-resolver.mjs';
import {
  clampHealthCheckWeek,
  shouldProbeLiveScoring,
  evaluateJsonValue,
  evaluateJsonText,
  buildFailureSummary,
} from '../scripts/lib/gameday-health.mjs';

describe('clampHealthCheckWeek', () => {
  it('floors pre-season week 0 to 1 (early-September runs before TNF week 1)', () => {
    // Week 1 is the right target for the NFL scoreboard, which serves the
    // upcoming schedule year-round. Live scoring is gated separately —
    // see shouldProbeLiveScoring.
    expect(clampHealthCheckWeek(0)).toBe(1);
  });

  it('passes in-season weeks through', () => {
    expect(clampHealthCheckWeek(1)).toBe(1);
    expect(clampHealthCheckWeek(9)).toBe(9);
    expect(clampHealthCheckWeek(18)).toBe(18);
  });

  it('caps past-season weeks at 18', () => {
    expect(clampHealthCheckWeek(25)).toBe(18);
  });

  it('defends against non-finite input', () => {
    expect(clampHealthCheckWeek(NaN)).toBe(1);
    expect(clampHealthCheckWeek(Infinity)).toBe(1);
    // @ts-expect-error deliberate bad input
    expect(clampHealthCheckWeek(undefined)).toBe(1);
  });
});

describe('shouldProbeLiveScoring', () => {
  // The check's first-ever scheduled run (2026-09-03) fired a week before
  // the Week 1 kickoff and reported both leagues' live scoring as broken.
  // MFL serves no live scoring until there are games; the cron window opens
  // in September but kickoff is mid-month, so this gap recurs every season.
  it('skips the probe before the Week 1 kickoff', () => {
    expect(shouldProbeLiveScoring(0)).toBe(false);
  });

  it('probes once the season is under way', () => {
    expect(shouldProbeLiveScoring(1)).toBe(true);
    expect(shouldProbeLiveScoring(9)).toBe(true);
    expect(shouldProbeLiveScoring(18)).toBe(true);
  });

  it('reads the RAW week, so a clamped 0 cannot smuggle the pre-season past it', () => {
    expect(shouldProbeLiveScoring(clampHealthCheckWeek(0))).toBe(true);
    expect(shouldProbeLiveScoring(0)).toBe(false);
  });

  it('defends against non-finite input', () => {
    expect(shouldProbeLiveScoring(NaN)).toBe(false);
    // @ts-expect-error deliberate bad input
    expect(shouldProbeLiveScoring(undefined)).toBe(false);
  });
});

/**
 * The pre-season skip is only safe while we can tell pre-season apart from
 * "we have no idea when the season starts". `getCurrentNFLWeek` returns 0 for
 * both, so the health check treats a missing kickoff date as its own FAILING
 * check rather than skipping live scoring in silence for a whole season.
 */
describe('getKickoffDate — the signal the pre-season skip depends on', () => {
  const COVERED = [2024, 2025, 2026, 2027];

  it('returns a date for every season the table covers', () => {
    for (const year of COVERED) {
      expect(getKickoffDate(year), `kickoff for ${year}`).toBeInstanceOf(Date);
    }
  });

  it('returns null past the end of the table — NOT a date, and not a throw', () => {
    expect(getKickoffDate(Math.max(...COVERED) + 1)).toBeNull();
  });

  it('is the only way to tell a missing year from the pre-season', () => {
    // Both of these are week 0. Only one of them is a normal Tuesday in
    // August, and the health check must not skip live scoring for the other.
    const preSeason = new Date('2026-09-03T12:00:00-07:00');
    expect(getCurrentNFLWeek(2026, preSeason)).toBe(0);
    expect(getKickoffDate(2026)).toBeInstanceOf(Date);

    const uncovered = Math.max(...COVERED) + 1;
    expect(getCurrentNFLWeek(uncovered, new Date(`${uncovered}-11-15T12:00:00-08:00`))).toBe(0);
    expect(getKickoffDate(uncovered)).toBeNull();
  });
});

describe('evaluateJsonValue', () => {
  it('accepts a non-empty object', () => {
    expect(evaluateJsonValue({ week: 5, games: [] }).ok).toBe(true);
  });

  it('accepts a non-empty array', () => {
    expect(evaluateJsonValue([{ id: 1 }]).ok).toBe(true);
  });

  it('rejects null, scalars, empty object, empty array', () => {
    expect(evaluateJsonValue(null).ok).toBe(false);
    expect(evaluateJsonValue('ok').ok).toBe(false);
    expect(evaluateJsonValue(42).ok).toBe(false);
    expect(evaluateJsonValue({}).ok).toBe(false);
    expect(evaluateJsonValue([]).ok).toBe(false);
  });

  it('rejects a 200-with-error-body payload (MFL/app failure shape)', () => {
    const verdict = evaluateJsonValue({ error: 'Valid week parameter required' });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('Valid week parameter required');
  });
});

describe('evaluateJsonText', () => {
  it('accepts a valid non-empty JSON body', () => {
    expect(evaluateJsonText('{"scores":{"0001":12.5}}').ok).toBe(true);
  });

  it('rejects empty and whitespace-only bodies', () => {
    expect(evaluateJsonText('').ok).toBe(false);
    expect(evaluateJsonText('   \n').ok).toBe(false);
  });

  it('rejects an HTML error page masquerading as a response', () => {
    const verdict = evaluateJsonText('<!doctype html><html>502 Bad Gateway</html>');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('not valid JSON');
  });
});

describe('buildFailureSummary', () => {
  const ctx = { week: 5, year: 2026 };

  it('returns null when every check passed', () => {
    const results = [
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ];
    expect(buildFailureSummary(results, ctx)).toBeNull();
  });

  it('lists only the failing checks with counts and context', () => {
    const results = [
      { name: 'theleague /api/live-scoring', ok: false, detail: 'HTTP 500' },
      { name: 'theleague /api/nfl-scoreboard', ok: true },
      { name: 'afl-fantasy MFL export', ok: false, detail: 'fetch failed: timeout' },
    ];
    const summary = buildFailureSummary(results, ctx);
    expect(summary).not.toBeNull();
    expect(summary).toContain('2026 week 5');
    expect(summary).toContain('2/3 checks failing');
    expect(summary).toContain('- theleague /api/live-scoring: HTTP 500');
    expect(summary).toContain('- afl-fantasy MFL export: fetch failed: timeout');
    expect(summary).not.toContain('nfl-scoreboard');
  });

  it('falls back to a generic detail when a failure carries none', () => {
    const summary = buildFailureSummary([{ name: 'x', ok: false }], ctx);
    expect(summary).toContain('- x: failed');
  });
});
