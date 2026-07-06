import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * The server TZ pin (src/utils/ensure-pt-timezone.ts) exists because
 * production Vercel runs in UTC while league semantics (event windows,
 * calendar-day boundaries) are defined in Pacific Time. The pin must
 * override a preset TZ — AWS Lambda sets TZ=:UTC, so a soft `||=`
 * assignment would silently no-op in production.
 *
 * The date-math assertion runs in a spawned main-thread Node process:
 * V8 only flushes its cached zone on `process.env.TZ` reassignment in
 * the main thread. Inside a vitest worker thread the reassignment is
 * ignored (see tests/global-setup-timezone.ts), so an in-process
 * assertion would be vacuous — the suite already runs pinned to PT.
 */
describe('ensure-pt-timezone', () => {
  it('sets process.env.TZ unconditionally, overriding a preset value', async () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = ':UTC';
      vi.resetModules();
      await import('../src/utils/ensure-pt-timezone');
      expect(process.env.TZ).toBe('America/Los_Angeles');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('flips Date math from a Lambda-style TZ=:UTC preset to Pacific in a real Node process', () => {
    const tsx = path.join('node_modules', '.bin', 'tsx');
    // Noon PT in August (PDT, UTC-7) is 19:00Z. `before` proves the :UTC
    // preset was live; `after` proves the import flushed the zone cache.
    const script = [
      'const probe = () => new Date(Date.UTC(2026, 7, 26, 19, 0)).getHours();',
      'const before = probe();',
      "require('./src/utils/ensure-pt-timezone.ts');",
      'console.log(JSON.stringify({ before, after: probe(), tz: process.env.TZ }));',
    ].join('\n');

    const out = execFileSync(tsx, ['-e', script], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: ':UTC' },
      encoding: 'utf8',
    });

    expect(JSON.parse(out.trim())).toEqual({
      before: 19,
      after: 12,
      tz: 'America/Los_Angeles',
    });
  });
});
