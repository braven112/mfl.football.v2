import { describe, it, expect, vi } from 'vitest';

/**
 * The server TZ pin (src/utils/ensure-pt-timezone.ts) exists because
 * production Vercel runs in UTC while league semantics (event windows,
 * calendar-day boundaries) are defined in Pacific Time. The pin must
 * override a preset TZ — AWS Lambda sets TZ=:UTC, so a soft `||=`
 * assignment would silently no-op in production.
 */
describe('ensure-pt-timezone', () => {
  it('overrides a preset TZ (Lambda presets TZ=:UTC)', async () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = ':UTC';
      vi.resetModules();
      await import('../src/utils/ensure-pt-timezone');

      expect(process.env.TZ).toBe('America/Los_Angeles');
      // Node flushes its zone cache on TZ reassignment: noon PT in
      // August (PDT, UTC-7) is 19:00Z.
      expect(new Date(Date.UTC(2026, 7, 26, 19, 0)).getHours()).toBe(12);
    } finally {
      process.env.TZ = original;
    }
  });
});
