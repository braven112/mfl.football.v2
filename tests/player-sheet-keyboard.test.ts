/**
 * The player sheet opens from the keyboard, not just a click (user,
 * 2026-09-26). Every `[data-player-modal]` opener is a <strong> — not
 * focusable on its own — so each one must carry tabindex="0" and
 * role="button", and the shared trigger must turn Enter / Space into a click.
 * A new page that renders an opener without them ships a sheet keyboard users
 * cannot reach.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(path);
  }
  return out;
}

describe('player sheet openers are keyboard-reachable', () => {
  it('every element rendering data-player-modal is a focusable button', () => {
    const offenders: string[] = [];
    for (const path of walk('src')) {
      const text = readFileSync(path, 'utf8');
      // Each opening tag that carries the attribute, whole (tags span lines in .astro).
      for (const m of text.matchAll(/<[a-z]+\b[^<>]*?data-player-modal=[^<>]*>/gs)) {
        const tag = m[0];
        if (!/tabindex="0"/.test(tag) || !/role="button"/.test(tag)) {
          const line = text.slice(0, m.index).split('\n').length;
          offenders.push(`${path}:${line}`);
        }
      }
    }
    expect(offenders, 'add tabindex="0" role="button" to these openers').toEqual([]);
  });

  it('the shared trigger opens on Enter and Space', () => {
    const trigger = readFileSync('src/utils/player-modal-trigger.ts', 'utf8');
    expect(trigger).toMatch(/e\.key !== 'Enter' && e\.key !== ' '/);
    expect(trigger).toContain("target?.matches?.('[data-player-modal]')");
  });
});
