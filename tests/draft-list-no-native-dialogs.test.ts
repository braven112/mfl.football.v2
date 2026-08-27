/**
 * No native modal dialogs in the My Draft List UI.
 *
 * Regression guard. The push was gated on `window.confirm`, and DuckDuckGo's
 * mobile browser suppresses it — a suppressed dialog returns false, so
 * `if (!confirmed) return` aborted the push while reporting nothing at all.
 * It was the single path out of the handler that did not call say(). Vercel
 * logs confirmed the shape of it: page loads and GETs, zero POSTs.
 *
 * A destructive action must never depend on a modal the browser is free to
 * refuse to show, so confirmation is in-page and this test keeps it that way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

const FILES = [
  'src/components/theleague/custom-rankings/DraftListSync.tsx',
  'src/components/theleague/custom-rankings/CustomRankingsPage.tsx',
];

/** Strip comments so the explanatory notes naming confirm() don't self-trip. */
function code(path: string): string {
  return readFileSync(join(root, path), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('My Draft List UI uses no native dialogs', () => {
  for (const file of FILES) {
    it(`${file} calls no confirm/alert/prompt`, () => {
      const src = code(file);
      expect(src).not.toMatch(/(?<![.\w])confirm\s*\(/);
      expect(src).not.toMatch(/(?<![.\w])alert\s*\(/);
      expect(src).not.toMatch(/(?<![.\w])prompt\s*\(/);
      expect(src).not.toMatch(/window\.(confirm|alert|prompt)/);
    });
  }

  it('DraftListSync confirms in-page instead', () => {
    const src = code(FILES[0]);
    expect(src).toContain('cr-sync__confirm');
    // The confirmation must actually run the write, not just display.
    expect(src).toMatch(/runPush/);
    expect(src).toMatch(/runRestore/);
  });

  it('every user-facing early return in handlePush reports something', () => {
    // The original defect was a single silent `return` on a suppressed
    // dialog. Every guard the OWNER can trip must say() or open the in-page
    // confirmation first. The leading `if (busy) return` is exempt: it is a
    // re-entrancy guard behind an already-disabled button, so tripping it is
    // not something an owner can do or needs told about.
    const src = readFileSync(join(root, FILES[0]), 'utf-8');
    const body = src.slice(src.indexOf('const handlePush'), src.indexOf('const runPush'));
    const afterBusyGuard = body.slice(body.indexOf('return;') + 'return;'.length);
    const guards = afterBusyGuard.split('return;').slice(0, -1);
    expect(guards.length).toBeGreaterThan(0);
    for (const stmt of guards) {
      expect(stmt).toMatch(/say\(|setPending\(/);
    }
  });
});
