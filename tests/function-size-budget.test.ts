import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bucketOf,
  measure,
  toMb,
  LIMIT_MB,
  BUDGET_MB,
  WARN_MB,
} from '../scripts/check-function-size.mjs';

/**
 * The site is one Vercel function with a hard 250 MB limit, hit three times,
 * each time discovered only when a deploy failed. scripts/check-function-size.mjs
 * is the early signal: CI fails above the budget, and every build prints the
 * breakdown. These tests pin the measurement and that both callers stay wired.
 */
describe('function size budget', () => {
  it('keeps the budget below the limit, and the warning below the budget', () => {
    expect(LIMIT_MB).toBe(250);
    expect(BUDGET_MB).toBeLessThan(LIMIT_MB);
    expect(WARN_MB).toBeLessThan(BUDGET_MB);
  });

  it('buckets hashed chunks by name, pnpm packages by store entry, feeds across seasons', () => {
    expect(bucketOf('dist/server/chunks/players_DykU8PZg.mjs')).toBe('dist chunk: players');
    expect(bucketOf('dist/server/chunks/players_D-GnLl8o.mjs')).toBe('dist chunk: players');
    expect(bucketOf('dist/server/entry.mjs')).toBe('dist (other)');
    expect(bucketOf('node_modules/.pnpm/@resvg+resvg-js-linux-x64-gnu@2.6.2/node_modules/x.node')).toBe(
      'node_modules: @resvg+resvg-js-linux-x64-gnu@2.6.2',
    );
    expect(bucketOf('data/archies/mfl-feeds/2025/weekly-results-raw.json')).toBe(
      'data/archies/mfl-feeds/*/weekly-results-raw.json',
    );
    expect(bucketOf('src/data/owner-map-places.json')).toBe('src/data/');
  });

  it('counts symlinks as links, never their targets (pnpm links point inside the function)', () => {
    const root = mkdtempSync(join(tmpdir(), 'func-'));
    const pkg = join(root, 'node_modules', '.pnpm', 'big@1.0.0');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'blob.bin'), Buffer.alloc(2 * 1024 * 1024));
    symlinkSync(pkg, join(root, 'node_modules', 'big'));
    mkdirSync(join(root, 'dist', 'server', 'chunks'), { recursive: true });
    writeFileSync(join(root, 'dist', 'server', 'chunks', 'ask_D6LHR8-Q.mjs'), Buffer.alloc(1024 * 1024));

    const m = measure(root);
    expect(toMb(m.bytes)).toBeGreaterThan(2.99);
    expect(toMb(m.bytes)).toBeLessThan(3.01);
    expect(m.buckets[0].key).toBe('node_modules: big@1.0.0');
    expect(m.buckets[1].key).toBe('dist chunk: ask');
  });

  it('runs report-only after every build, and enforced in CI', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts.postbuild).toContain('scripts/check-function-size.mjs');
    expect(pkg.scripts.postbuild).not.toContain('--enforce');

    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(/node scripts\/check-function-size\.mjs --enforce/);
  });
});
