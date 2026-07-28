import { describe, it, expect } from 'vitest';
import {
  clampHealthCheckWeek,
  evaluateJsonValue,
  evaluateJsonText,
  buildFailureSummary,
} from '../scripts/lib/gameday-health.mjs';

describe('clampHealthCheckWeek', () => {
  it('floors pre-season week 0 to 1 (early-September runs before TNF week 1)', () => {
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
