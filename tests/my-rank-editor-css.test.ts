/**
 * Layout guards for the My Rank editor sheet.
 *
 * Reported by an owner on an Android phone (2026-08-22), on the AFL Free
 * Agents page, with nine ranking sources in the list: "I still need to be able
 * to scroll down on the screen to see all of the rankings", then "I can barely
 * close the modal now".
 *
 * Both were the same bug, and it was the height unit. The sheet capped itself
 * at `88vh`, and `vh` on a phone is the viewport with the browser chrome
 * HIDDEN — so with the URL bar and the bottom bar showing, the sheet was
 * taller than the visible area. It is pinned to the bottom
 * (`.mre { align-items: flex-end }`), so the excess went off the TOP: the
 * title and the close button were sliced off above the URL bar, and the rows
 * past the fold sat outside the visible viewport with no scroll that could
 * reach them. `dvh` is the visible viewport and tracks that chrome as it
 * moves.
 *
 * Measured before and after in Chromium at 330x610 (the reporter's visible
 * viewport): the fixed sheet is 538px with the close button at y=89 and the
 * list scrolling 520px of rows through a 408px window.
 *
 * CSS has no runtime to assert against, so this parses the stylesheet and
 * checks the declarations that actually apply. A grep would pass on a rule
 * that was moved, overridden, or re-hidden under a different selector.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/my-rank-editor.css'), 'utf-8');

/** Strip comments so a commented-out rule can never satisfy this test. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of an at-rule block, by brace matching (nested rules included). */
function mediaBlock(query: string): string {
  const at = stripped.indexOf(query);
  expect(at, `no ${query} block in my-rank-editor.css`).toBeGreaterThan(-1);
  const open = stripped.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) return stripped.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${query}`);
}

/** The base cascade: everything outside an at-rule block. */
const base = stripped.replace(/@[a-z-]+[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

/**
 * Every declaration that applies to `selector` inside `block`, in source
 * order. A selector list ("a, b { … }") counts for each of its members.
 */
function declarationsFor(block: string, selector: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rule.exec(block))) {
    const selectors = m[1].split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      out.push([decl.slice(0, i).trim(), decl.slice(i + 1).trim()]);
    }
  }
  return out;
}

/** All values declared for a property, in source order. */
function valuesOf(block: string, selector: string, prop: string): string[] {
  return declarationsFor(block, selector)
    .filter(([p]) => p === prop)
    .map(([, v]) => v);
}

/** Last value wins, same as the cascade within one block. */
function valueOf(block: string, selector: string, prop: string): string | undefined {
  const hits = valuesOf(block, selector, prop);
  return hits.length ? hits[hits.length - 1] : undefined;
}

/** `flex: 1 1 auto` and `flex-grow: 1` both mean the same thing here. */
function grows(block: string, selector: string): boolean {
  const shorthand = valueOf(block, selector, 'flex');
  if (shorthand && /^[1-9]/.test(shorthand)) return true;
  const grow = valueOf(block, selector, 'flex-grow');
  return grow != null && Number(grow) > 0;
}

/** `flex: 0 0 auto` / `flex-shrink: 0` — the part that must hold its height. */
function isFixedHeight(block: string, selector: string): boolean {
  const shorthand = valueOf(block, selector, 'flex');
  if (shorthand && /^0\s+0(\s|$)/.test(shorthand)) return true;
  return valueOf(block, selector, 'flex-shrink') === '0';
}

const wide = mediaBlock('@media (min-width: 640px)');

describe('My Rank editor — the sheet fits the screen and the list scrolls', () => {
  it('lays the sheet out as a capped flex column', () => {
    expect(valueOf(base, '.mre__sheet', 'display')).toBe('flex');
    expect(valueOf(base, '.mre__sheet', 'flex-direction')).toBe('column');
    expect(valueOf(base, '.mre__sheet', 'max-height')).toBeDefined();
  });

  it('caps the sheet in dynamic viewport units, with a vh fallback first', () => {
    // THE regression. `vh` on a phone is the viewport with the browser chrome
    // HIDDEN, so a sheet capped only in vh is taller than what the owner sees
    // — and being bottom-pinned, it loses its top edge, not its bottom.
    for (const block of [base, wide]) {
      const heights = valuesOf(block, '.mre__sheet', 'max-height');
      expect(heights.length, 'expected a vh fallback and a dvh cap').toBeGreaterThanOrEqual(2);
      expect(heights[heights.length - 1]).toMatch(/dvh\)?$/);
      expect(heights[heights.length - 2]).toMatch(/vh\)?$/);
    }
  });

  it('gives the list room to shrink so overflow-y actually scrolls', () => {
    // Not the original regression — a scroll container's automatic minimum
    // size is already 0, so this list did scroll. It is stated anyway because
    // it stops being true the day someone drops the `overflow-y`, and the
    // sheet's whole job is to keep the header and footer reachable.
    expect(valueOf(base, '.mre__list', 'min-height')).toBe('0');
    expect(valueOf(base, '.mre__list', 'overflow-y')).toBe('auto');
    expect(grows(base, '.mre__list'), '.mre__list must take the leftover height').toBe(true);
  });

  it('keeps the empty state inside the sheet too', () => {
    // Same treatment: with no imports the sheet renders `.mre__empty` in the
    // list's place, and it is the flex child that has to absorb the space.
    expect(valueOf(base, '.mre__empty', 'min-height')).toBe('0');
    expect(grows(base, '.mre__empty')).toBe(true);
  });

  it('never lets the header or footer be squeezed out', () => {
    // The header holds the close button and the footer holds Done — if either
    // shrinks or scrolls away, the owner is stuck in the modal.
    expect(isFixedHeight(base, '.mre__header'), '.mre__header must hold its height').toBe(true);
    expect(isFixedHeight(base, '.mre__footer'), '.mre__footer must hold its height').toBe(true);
  });

  it('keeps the sheet pinned to the bottom on a phone', () => {
    // Not cosmetic: it is why overflow spilled off the TOP rather than the
    // bottom, which is what put the close button out of reach.
    expect(valueOf(base, '.mre', 'align-items')).toBe('flex-end');
    expect(valueOf(wide, '.mre', 'align-items')).toBe('center');
  });

  it('does not chain the list scroll to the page behind it', () => {
    expect(valueOf(base, '.mre__list', 'overscroll-behavior')).toBe('contain');
  });
});
