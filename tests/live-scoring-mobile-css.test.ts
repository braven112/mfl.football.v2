/**
 * Mobile guard for the live-scoring board.
 *
 * Two regressions, both reported by an owner on a phone in portrait
 * (2026-08-21), both invisible on a desktop viewport:
 *
 *  - **Nothing said the page was tracking anything.** The mobile breakpoint
 *    hid `.ls-pmeta` wholesale for space — and that row is every per-player
 *    live signal there is: the real game clock, the state dot, the red-zone
 *    flag. What was left looked like a static table of names and zeroes.
 *  - **Names were not names.** `.ls-pname` ellipsised inside a ~70px column in
 *    the two-column matchup view, rendering "Jahmyr Gibbs" as "Jah…".
 *
 * CSS has no runtime to assert against, so this parses the stylesheet's own
 * `@media` block and checks the DECLARATIONS that apply there — not that some
 * string appears in the file. A grep would pass on a rule that was moved,
 * overridden, or re-hidden under a different selector.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/live-scoring.css'), 'utf-8');

/** Strip comments so a commented-out rule can never satisfy this test. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the phone breakpoint, by brace matching (nested rules included). */
function mediaBlock(query: string): string {
  const at = stripped.indexOf(query);
  expect(at, `no ${query} block in live-scoring.css`).toBeGreaterThan(-1);
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

/**
 * Every declaration that applies to `selector` inside `block`, in source
 * order, flattened to `prop: value` pairs. A selector list ("a, b { … }")
 * counts for each of its members.
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

/** Last value wins, same as the cascade within one block. */
function valueOf(block: string, selector: string, prop: string): string | undefined {
  const hits = declarationsFor(block, selector).filter(([p]) => p === prop);
  return hits.length ? hits[hits.length - 1][1] : undefined;
}

const phone = mediaBlock('@media (max-width: 760px)');

/** The rows named by a `grid-template-areas` value, in order. */
function gridRows(block: string, selector: string): string[][] {
  const raw = valueOf(block, selector, 'grid-template-areas') ?? '';
  return [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/));
}

describe('live-scoring on a phone', () => {
  it('gives each player TWO lines instead of one crowded one', () => {
    // One line cannot hold chip + headshot + name + game state + score inside
    // a ~165px matchup column. Both attempts to make it are bugs we shipped:
    // ellipsising the name to "Jah…", then squeezing every fixed column until
    // the row just read as crowded (owner, 2026-08-21).
    expect(valueOf(phone, '.ls-prow', 'display')).toBe('grid');
    // `display: contents` on the identity wrapper is what lets the name and
    // the meta line be placed on different rows — they are nested in the DOM
    // because the DESKTOP layout stacks them as one block.
    expect(
      valueOf(phone, '.ls-pid', 'display'),
      'without display:contents the grid areas below cannot reach .ls-pname / .ls-pmeta',
    ).toBe('contents');

    for (const selector of ['.ls-prow', '.ls-prow.right']) {
      const rows = gridRows(phone, selector);
      expect(rows.length, `${selector} must lay the row out on two lines`).toBe(2);
      expect(rows[0], `${selector} line 1 carries the name`).toContain('name');
      expect(rows[1], `${selector} line 2 carries the game state`).toContain('meta');
      expect(rows[1], `${selector} line 2 carries the score`).toContain('score');
      // The name must reach across the score column and the meta line across
      // the headshot column — that span is the width the two-line layout buys,
      // and without it we are back to a ~57px name.
      expect(rows[0].filter((a) => a === 'name').length).toBeGreaterThan(1);
      expect(rows[1].filter((a) => a === 'meta').length).toBeGreaterThan(1);
    }

    // Mirrored, not re-ordered: the home side reuses the same markup.
    expect(gridRows(phone, '.ls-prow')[0].join(' '))
      .toBe([...gridRows(phone, '.ls-prow.right')[0]].reverse().join(' '));
  });

  it('keeps the per-player meta row, which is the only live signal on the row', () => {
    expect(
      valueOf(phone, '.ls-pmeta', 'display'),
      'The meta row carries the game clock, state dot and red-zone flag. ' +
        'Hiding it makes the board indistinguishable from a static table. ' +
        'Shed individual pieces (the logo, down & distance) instead.',
    ).not.toBe('none');
  });

  it('keeps the game clock and the red-zone flag', () => {
    expect(valueOf(phone, '.ls-pclock', 'display')).not.toBe('none');
    expect(valueOf(phone, '.ls-rz', 'display')).not.toBe('none');
  });

  it('shows full player names instead of ellipsising them', () => {
    // The desktop rule sets `white-space: nowrap` + `text-overflow: ellipsis`.
    // Overriding white-space alone is enough to kill the ellipsis (it only
    // applies to a single non-wrapping line), and leaving `overflow: hidden`
    // in place is deliberate: it is the backstop that keeps a pathological
    // name from sliding under the score column.
    expect(valueOf(phone, '.ls-pname', 'white-space'), 'names must wrap, not truncate').toBe('normal');
    // `anywhere` would also shrink the column's intrinsic minimum and break a
    // name mid-word; `break-word` wraps between words and only splits one that
    // genuinely cannot fit.
    expect(valueOf(phone, '.ls-pname', 'overflow-wrap')).toBe('break-word');
    // And the desktop rule it is overriding must actually still be the one
    // that truncates, or this override is guarding nothing.
    const desktop = /\.ls-pname\s*\{([^}]*)\}/.exec(stripped)?.[1] ?? '';
    expect(desktop).toContain('nowrap');
  });

  it('keeps the feed-freshness pill and its ticking age readable', () => {
    // The games-live clause is the one droppable part; the state word and the
    // age are the evidence, and hiding either brings the original bug back.
    expect(valueOf(phone, '.ls-status', 'display')).not.toBe('none');
    expect(valueOf(phone, '.ls-status-lbl', 'display')).not.toBe('none');
    expect(valueOf(phone, '.ls-status-age', 'display')).not.toBe('none');
  });

  it('the freshness pill distinguishes a failed feed from a quiet one', () => {
    // Same split the poll store keeps between `status` and `data`: "we could
    // not reach the feed" must never render the same as "nothing is happening".
    const tone = (t: string) => new RegExp(`\\.ls-status\\.${t}[^{]*\\{[^}]*color:`).test(stripped);
    expect(tone('live')).toBe(true);
    expect(tone('error')).toBe(true);
    expect(stripped).toMatch(/\.ls-dot\.err[^{]*\{[^}]*background:/);
  });
});
