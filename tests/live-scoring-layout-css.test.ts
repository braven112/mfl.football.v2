/**
 * Layout guards for the live-scoring board.
 *
 * CSS has no runtime to assert against, so this parses the stylesheet and
 * checks the DECLARATIONS that apply — in the base cascade and inside the
 * phone breakpoint separately. A grep would pass on a rule that was moved,
 * overridden, or re-hidden under a different selector.
 *
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
 * A third, from the same day: the box-score line sat flush at the row's left
 * edge, under the position chip rather than under the player it describes,
 * and a taller side of a matchup row floated the quieter side's name half a
 * line below its opponent's.
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

/** The stylesheet with every @media block removed — the base cascade only. */
const base = (() => {
  let out = '';
  let i = 0;
  while (i < stripped.length) {
    const at = stripped.indexOf('@media', i);
    if (at < 0) { out += stripped.slice(i); break; }
    out += stripped.slice(i, at);
    const open = stripped.indexOf('{', at);
    let depth = 0;
    let j = open;
    for (; j < stripped.length; j++) {
      if (stripped[j] === '{') depth++;
      else if (stripped[j] === '}') { depth--; if (depth === 0) break; }
    }
    i = j + 1;
  }
  return out;
})();

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


describe('a matchup row keeps its two players level', () => {
  it('top-aligns the two sides instead of centering them', () => {
    // A box-score line only exists for a player who has touched the ball, so
    // one side of a row is routinely taller than the other. Centered, the
    // quiet side's name floats half a line below its opponent's — the two
    // players stopped lining up the moment real stats arrived (owner,
    // 2026-08-21).
    expect(valueOf(base, '.ls-mx-row', 'align-items')).toBe('start');
    // Same reasoning one level down: a single flex line in a stretched cell
    // would otherwise be centered in it.
    expect(valueOf(base, '.ls-prow', 'align-content')).toBe('flex-start');
  });

  it('centers the shared slot label on the first line, not on the cell', () => {
    // Without this the label drifts downward by half whatever the taller side
    // gained, which is the same bug wearing the center column's clothes.
    expect(valueOf(base, '.ls-mx-pos', 'min-height')).toBe('var(--ls-row-line1)');
    expect(valueOf(base, '.ls-mx-pos', 'align-items')).toBe('center');
  });

  it('indents the box-score line to where the player’s name starts', () => {
    // Flush left it sat under the position chip, a whole slot column away
    // from the player it describes.
    expect(valueOf(base, '.ls-pstat', 'padding-left')).toBe('var(--ls-stat-indent)');
    expect(valueOf(base, '.ls-prow.right .ls-pstat', 'padding-right')).toBe('var(--ls-stat-indent)');
    // The indent must be DERIVED from the same values that size the columns
    // it is clearing, or it silently drifts the next time one of them moves.
    const indent = valueOf(base, '.ls-mx-body', '--ls-stat-indent') ?? '';
    for (const token of ['--ls-slot-w', '--ls-face-w', '--ls-row-gap']) {
      expect(indent, `--ls-stat-indent must be computed from ${token}`).toContain(token);
    }
  });

  it('sizes every lineup row to the tallest one, and never by truncating', () => {
    // Owner report, 2026-08-21: rows of different heights left the two sides
    // of the board visibly out of step. The fix has to equalize by GROWING the
    // short rows, never by shrinking the tall one — `grid-auto-rows: 1fr` in
    // an auto-height grid sizes every implicit row to the tallest one's
    // content, which costs whitespace and clips nothing.
    expect(
      valueOf(base, '.ls-mx-rows', 'grid-auto-rows'),
      'lineup rows must share one equalized track size',
    ).toBe('1fr');
    expect(valueOf(base, '.ls-mx-rows', 'display')).toBe('grid');

    // The equalization only reaches rows that are ITEMS of that grid. If
    // .ls-mx-row stopped being a real box (display: contents), each row would
    // size itself again AND `.ls-mx-row { align-items: start }` — the rule
    // that keeps the two players in a row level — would go silently inert.
    expect(valueOf(base, '.ls-mx-row', 'display')).toBe('grid');
  });

  it('pairs the two benches into shared grid rows rather than two columns', () => {
    // Two independently-flowing columns drift: one box-score line or one
    // wrapping name on the left pushes every row below it out of step with
    // its neighbour on the right, and the gap compounds down the list. Cells
    // that share a grid row cannot disagree about where a row starts.
    expect(valueOf(base, '.ls-bench-grid', 'display')).toBe('grid');
    expect(valueOf(base, '.ls-bench-grid', 'grid-auto-rows')).toBe('1fr');
    // The caption row must stay auto-sized, or the team names get stretched to
    // a full player row's height along with everything else.
    expect(
      valueOf(base, '.ls-bench-grid', 'grid-template-rows'),
      'the caption row must be explicit + auto so only player rows equalize',
    ).toBe('auto');
    // A ROW gap would defeat the point — the equalized tracks are what make
    // the rows line up, and gap between them just reintroduces spacing that
    // has to be kept in sync with the starters above.
    expect(valueOf(base, '.ls-bench-grid', 'gap')).toBeUndefined();
    expect(valueOf(base, '.ls-bench-grid', 'column-gap')).toBeDefined();
  });

  it('does not buy equal rows by clamping the name or the stat line', () => {
    // The two tempting ways to make rows uniform are a fixed height and a
    // line clamp, and both truncate. A clamp on the name is the "Jah…" bug
    // this stylesheet already fixed once; a clamp on the box-score line
    // silently drops the tail of a long one ("… · 1 FUM lost").
    for (const block of [base, phone]) {
      for (const selector of ['.ls-pname', '.ls-pstat']) {
        expect(
          valueOf(block, selector, '-webkit-line-clamp'),
          `${selector} must not be line-clamped to equalize rows`,
        ).toBeUndefined();
      }
      // A fixed height on the row would clip whatever didn't fit; the
      // equalization has to come from the track, not from the row box.
      expect(valueOf(block, '.ls-prow', 'height')).toBeUndefined();
    }
    // The phone rule that lets names wrap must still be the one in force.
    expect(valueOf(phone, '.ls-pname', 'white-space')).toBe('normal');
  });

  it('on a phone the box-score line clears the slot chip via grid columns', () => {
    // Column 2 is the headshot, which is where the meta line above it starts —
    // the stat line lines up under the player, not under his slot label.
    expect(valueOf(phone, '.ls-pstat', 'grid-column')).toBe('2 / -1');
    expect(valueOf(phone, '.ls-prow.right .ls-pstat', 'grid-column')).toBe('1 / -2');
  });
});
