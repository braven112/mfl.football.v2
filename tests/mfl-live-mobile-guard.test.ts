/**
 * Guard: the MFL Live mobile app (apps/mobile).
 *
 * Three rules that are easy to break from inside the app and invisible until
 * a store review or an EAS build fails:
 *
 *  1. Shared packages are REUSED, never copied — and only as `import type`.
 *     The app installs on its own (apps/mobile/pnpm-workspace.yaml), so a
 *     value import from a workspace package would not resolve in the EAS
 *     build. A type import is erased and costs nothing.
 *  2. Store rules: no ESPN, no NFL logos, no player headshots
 *     (docs/plans/mfl-live-store-app.md, Legal). The app reads the board
 *     only in store mode, `?source=mfl`.
 *  3. The app stays out of the website's install and type check.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const APP = join(ROOT, 'apps/mobile');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const files = sources(APP).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

describe('apps/mobile', () => {
  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it('imports shared packages as types only', () => {
    const bad = files.flatMap((f) =>
      [...f.text.matchAll(/^import\s+(?!type\b)[^;]*from\s+'(@mfl\/[^']+|(?:\.\.\/)+(?:packages|src)\/[^']*)'/gm)].map(
        (m) => `${f.path}: ${m[0]}`,
      ),
    );
    expect(bad).toEqual([]);
  });

  it('never reaches ESPN, NFL logos or headshots', () => {
    const bad = files.flatMap((f) =>
      [/espn/i, /nfl-logos/, /headshot/i].filter((re) => re.test(f.text)).map((re) => `${f.path}: ${re}`),
    );
    expect(bad).toEqual([]);
  });

  it('reads the board in store mode only', () => {
    const api = readFileSync(join(APP, 'src/api.ts'), 'utf8');
    const boardCalls = [...api.matchAll(/\/api\/live-board[^`'"]*/g)].map((m) => m[0]);
    expect(boardCalls.length).toBeGreaterThan(0);
    for (const call of boardCalls) expect(call).toContain('source=mfl');
  });

  it('is its own pnpm workspace, excluded from the website install and type check', () => {
    expect(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')).toMatch(/^\s*-\s*'!apps\/mobile'/m);
    expect(statSync(join(APP, 'pnpm-workspace.yaml')).isFile()).toBe(true);
    expect(statSync(join(APP, 'pnpm-lock.yaml')).isFile()).toBe(true);
    expect(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')).toMatch(/"exclude":\s*\[[^\]]*"apps\/mobile"/);
  });
});
