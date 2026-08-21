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
      // At least two: one line cannot hold all of this. Three now, since the
      // box-score line has its own row between the name and the score line
      // (see the bottom-anchor test below).
      expect(rows.length, `${selector} must not collapse to one line`).toBeGreaterThanOrEqual(2);
      expect(rows[0], `${selector} line 1 carries the name`).toContain('name');
      // Find the row by CONTENT rather than by index — the box-score line sits
      // below the score line, so the score is not the last row.
      const scoreRow = rows.find((r) => r.includes('score')) ?? [];
      expect(scoreRow, `${selector} pairs the game state with the score`).toContain('meta');
      expect(scoreRow, `${selector} carries the score`).toContain('score');
      // The name must reach across the score column and the meta line across
      // the headshot column — that span is the width the two-line layout buys,
      // and without it we are back to a ~57px name.
      expect(rows[0].filter((a) => a === 'name').length).toBeGreaterThan(1);
      expect(scoreRow.filter((a) => a === 'meta').length).toBeGreaterThan(1);
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
    // `stretch` (not `start`) — both keep content at the top, but only
    // stretch gives the row a shared bottom edge for the score to anchor to.
    // `center` is the original sin and must never come back.
    expect(valueOf(base, '.ls-mx-row', 'align-items')).toBe('stretch');
    expect(valueOf(base, '.ls-mx-row', 'align-items')).not.toBe('center');
    // Same reasoning one level down: a single flex line in a stretched cell
    // would otherwise be centered in it.
    expect(valueOf(base, '.ls-prow', 'align-content')).toBe('flex-start');
  });

  it('centers the shared slot label on the first line, not on the cell', () => {
    // Without this the label drifts downward by half whatever the taller side
    // gained, which is the same bug wearing the center column's clothes.
    expect(valueOf(base, '.ls-mx-pos', 'min-height')).toBe('var(--ls-row-line1)');
    expect(valueOf(base, '.ls-mx-pos', 'align-items')).toBe('center');
    // …and the cell must not be STRETCHED, or those two do the opposite of
    // what they say: a stretched cell is the whole row tall, so centring in it
    // centres over the row rather than over its first line. `.ls-mx-row` is
    // `align-items: stretch` for the player cells' benefit, and this label
    // has to opt out of it. Measured 13px of drift on a row with a box-score
    // line before this line existed.
    expect(
      valueOf(base, '.ls-mx-pos', 'align-self'),
      'the slot label must opt out of the row stretch',
    ).toBe('start');
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

  it('keeps the score at the same offset on both sides of a phone row', () => {
    // The bug: a two-line name pushed the score down and a one-line name did
    // not, so the two sides of a matchup never agreed on where the score sat
    // (owner, 2026-08-21). The headshot masks most of it — a one-line name
    // still occupies the 30px avatar — which is why it read as a couple of
    // stray pixels rather than a whole line.
    //
    // The score line reads under the player and ABOVE his box-score detail
    // (owner direction), so it cannot simply be pushed to the bottom of the
    // row. Its offset is made constant instead, and BOTH halves are needed:
    for (const selector of ['.ls-prow', '.ls-prow.right']) {
      const rows = gridRows(phone, selector);
      expect(rows.length, `${selector} needs name / score / stat rows`).toBe(3);
      expect(rows[0], `${selector}: row 1 carries the name`).toContain('name');
      expect(rows[1], `${selector}: the score sits on row 2`).toContain('score');
      expect(rows[1], `${selector}: the clock rides with the score`).toContain('meta');
      // The box-score detail belongs BELOW the score (owner direction) — and
      // that ordering is also what lets the slack collect beneath it.
      expect(
        rows[2],
        `${selector}: the box-score line goes below the score, not above`,
      ).toContain('stat');

      // `.ls-prow` declares grid-template-rows TWICE: a plain fallback and then
      // `subgrid`. Both matter, so read every declaration rather than just the
      // winning one.
      const decls = declarationsFor(phone, selector)
        .filter(([prop]) => prop === 'grid-template-rows')
        .map(([, value]) => value);
      const all = decls.length ? decls : declarationsFor(phone, '.ls-prow')
        .filter(([prop]) => prop === 'grid-template-rows')
        .map(([, value]) => value);

      // (1) The two sides of a pair must SHARE row tracks. Without this a name
      //     that needs a third line — "Mike Washington Jr." at 360px — grows
      //     only its own side and drops that score a full line.
      expect(
        all[all.length - 1],
        `${selector}: the pair must share row tracks, or a 3-line name drifts`,
      ).toBe('subgrid');

      // (2) The fallback immediately before it, for browsers without subgrid.
      const fallback = (all[all.length - 2] ?? '').split(/\s+/);
      expect(
        fallback.length,
        `${selector}: the pre-subgrid fallback needs one track per row`,
      ).toBe(rows.length);
      // Everything ABOVE the score is content-sized, or a taller opponent
      // inflates it and the score moves; the slack goes to the row BELOW.
      expect(fallback[0], `${selector}: row 1 must not absorb slack`).toBe('auto');
      expect(fallback[1], `${selector}: the score row must not absorb slack`).toBe('auto');
      expect(
        fallback[2],
        `${selector}: the stat row must take the slack, below the score`,
      ).toBe('1fr');
    }

    // Subgrid only reaches `.ls-prow` if it is a real grid item of the pair's
    // row — the wrappers between them have to collapse.
    expect(valueOf(phone, '.ls-mx-row > div:not(.ls-mx-pos)', 'display')).toBe('contents');
    expect(valueOf(phone, '.ls-bench-row > div', 'display')).toBe('contents');
    // And the pair's row must define the three tracks they map onto.
    expect(valueOf(phone, '.ls-mx-row', 'grid-template-rows')).toBe('auto auto 1fr');
    expect(valueOf(phone, '.ls-bench-row', 'grid-template-rows')).toBe('auto auto 1fr');

    // (3) And row 1 is only equal on both sides because the name block is
    //     pinned to two lines. Without this a one-line name yields a 30px
    //     first row (the avatar) and a two-line name ~32px — the exact couple
    //     of pixels this whole test exists for.
    const nameMin = valueOf(phone, '.ls-pname', 'min-height');
    expect(nameMin, 'the name block must reserve two lines').toBeDefined();
    // Derived from the name's own type, not a magic number that silently
    // stops matching the moment the font-size is touched.
    const nameH = valueOf(phone, '.ls-prow', '--ls-name-h') ?? '';
    expect(nameMin).toBe('var(--ls-name-h)');
    expect(nameH, '--ls-name-h must be derived from the name font-size').toContain(
      valueOf(phone, '.ls-pname', 'font-size') ?? 'NO-FONT-SIZE',
    );
    expect(nameH, '--ls-name-h must be derived from the name line-height').toContain(
      valueOf(phone, '.ls-pname', 'line-height') ?? 'NO-LINE-HEIGHT',
    );

    // The cells still have to fill the row, or there is no slack to place.
    expect(
      valueOf(base, '.ls-mx-row', 'align-items'),
      'cells must stretch to the row height',
    ).toBe('stretch');
    expect(valueOf(base, '.ls-prow', 'height')).toBe('100%');
  });

  it('pairs the two benches into shared grid rows rather than two columns', () => {
    // Two independently-flowing columns drift: one box-score line or one
    // wrapping name on the left pushes every row below it out of step with
    // its neighbour on the right, and the gap compounds down the list. Cells
    // that share a grid row cannot disagree about where a row starts.
    // A bench pair is shaped exactly like a starter row: one two-column grid
    // holding both sides. That shared shape is what lets ONE subgrid rule
    // align both sections.
    expect(valueOf(base, '.ls-bench-row', 'display')).toBe('grid');
    expect(valueOf(base, '.ls-bench-row', 'grid-template-columns')).toBe('1fr 1fr');
    // A ROW gap would put space between the paired cells that the starter rows
    // above don't have, and it has to be kept in sync by hand. Columns only.
    expect(valueOf(base, '.ls-bench-row', 'gap')).toBeUndefined();
    expect(valueOf(base, '.ls-bench-row', 'column-gap')).toBeDefined();
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
      // `height: 100%` is REQUIRED (it fills the stretched cell) and cannot
      // clip — it adopts whatever the row already needed. A length would clip,
      // and so would a max-height.
      const h = valueOf(block, '.ls-prow', 'height');
      if (h !== undefined) expect(h, 'a fixed row height would clip').toBe('100%');
      expect(valueOf(block, '.ls-prow', 'max-height')).toBeUndefined();
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
