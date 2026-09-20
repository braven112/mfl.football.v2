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
 *    hid `.lv-pmeta` wholesale for space — and that row is every per-player
 *    live signal there is: the real game clock, the state dot, the red-zone
 *    flag. What was left looked like a static table of names and zeroes.
 *  - **Names were not names.** `.lv-pname` ellipsised inside a ~70px column in
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

const css = readFileSync(join(process.cwd(), 'src/styles/live.css'), 'utf-8');
/**
 * The island AND its page wrapper.
 *
 * The board this guarded was one 1,099-line component; the kit splits the same
 * markup across a handful of leaves. Concatenating them keeps every assertion
 * that reads the JSX pointed at the markup it is about, rather than at
 * whichever file happens to hold the root today.
 */
const island = [
  'src/components/shared/live/LiveBoard.tsx',
  'src/components/shared/live/LvMatchupDetail.tsx',
  'src/components/shared/live/LvMatchupCard.tsx',
  'src/components/shared/live/LvLineup.tsx',
  'src/components/shared/live/LvBench.tsx',
  'src/components/shared/live/LvPlayerRow.tsx',
  'src/components/shared/live/LvWinProbBar.tsx',
  'src/components/shared/live/LvFeedStatus.tsx',
  'src/components/shared/live/LvEmptyState.tsx',
]
  .map((f) => readFileSync(join(process.cwd(), f), 'utf-8'))
  .join('\n');

/** Strip comments so a commented-out rule can never satisfy this test. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the phone breakpoint, by brace matching (nested rules included). */
function mediaBlock(query: string): string {
  const at = stripped.indexOf(query);
  expect(at, `no ${query} block in live.css`).toBeGreaterThan(-1);
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



/** A rem length (or a bare `0`) as a number. Anything else is a test bug. */
function rem(value: string): number {
  if (/^-?0$/.test(value.trim())) return 0;
  const m = /^(-?[\d.]+)rem$/.exec(value.trim());
  expect(m, `expected a rem length, got "${value}"`).not.toBeNull();
  return parseFloat(m![1]);
}

/**
 * The LEFT and RIGHT halves of a box property (`padding` / `margin`) as the
 * cascade actually resolves them: the shorthand expanded 1-to-4 values, then
 * any longhand (`-left` / `-right` / `-inline`) applied over it, in source
 * order. `block` cascades on top of `base`, so a phone-only override counts.
 *
 * Reading `value.split(' ')[1]` instead — as the first version of this guard
 * did — sees padding-RIGHT of a four-value shorthand and nothing at all of a
 * longhand, so `padding: 0.7rem 0.4rem 0.7rem 1rem` sails through with a full
 * uncancelled rem on the side that matters.
 */
function boxInline(block: string, selector: string, prop: 'padding' | 'margin'): { left: number; right: number } {
  const decls = [
    ...declarationsFor(base, selector),
    ...(block === base ? [] : declarationsFor(block, selector)),
  ];
  const box = { left: 0, right: 0 };
  for (const [p, v] of decls) {
    if (p === prop) {
      const parts = v.trim().split(/\s+/);
      // 1 → all; 2 → [block, inline]; 3 → [top, inline, bottom]; 4 → [t,r,b,l].
      box.left = rem(parts.length === 4 ? parts[3] : parts[Math.min(1, parts.length - 1)]);
      box.right = rem(parts[Math.min(1, parts.length - 1)]);
    } else if (p === `${prop}-inline`) {
      const parts = v.trim().split(/\s+/);
      box.left = rem(parts[parts.length - 1]);
      box.right = rem(parts[0]);
    } else if (p === `${prop}-left` || p === `${prop}-inline-start`) {
      box.left = rem(v);
    } else if (p === `${prop}-right` || p === `${prop}-inline-end`) {
      box.right = rem(v);
    }
  }
  return box;
}


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

/**
 * What actually applies at PHONE width.
 *
 * ── WHY THIS IS NOT ONE MEDIA BLOCK ANY MORE ──────────────────────────────
 * The sheet this guarded had a desktop matchup layout and re-stated the whole
 * thing inside `@media (max-width: 760px)`. The kit's sheet applies the row
 * layout at the BASE cascade — the same grid at every width — and keeps media
 * blocks for the handful of things that genuinely differ on a phone.
 *
 * So the assertions below cannot ask "is this rule inside the 760px block";
 * they have to ask what a phone RESOLVES, which is the base cascade plus every
 * narrow override in source order. That is strictly stronger: a rule that
 * moved out of the media query still has to be there, and one that was only
 * ever true on a phone still has to be true on a phone.
 *
 * Declared AFTER `base`, because `const` is not hoisted through the temporal
 * dead zone — the concatenation order here IS the cascade order.
 */
const phone = [
  base,
  allMediaBlocks('@media (max-width: 760px)'),
  allMediaBlocks('@media (max-width: 560px)'),
].join('\n');

/**
 * EVERY block matching a query, concatenated in source order.
 *
 * `mediaBlock` returns the first, which silently drops the rest — and the kit's
 * sheet has more than one narrow block, kept apart so each sits beside the
 * rules it overrides. Returns '' when there are none, because "this breakpoint
 * carries nothing" is a legitimate answer once the base cascade does the work.
 */
function allMediaBlocks(query: string): string {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = stripped.indexOf(query, from);
    if (at < 0) break;
    const open = stripped.indexOf('{', at);
    let depth = 0;
    let end = open;
    for (let i = open; i < stripped.length; i++) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    out.push(stripped.slice(open + 1, end));
    from = end + 1;
  }
  return out.join('\n');
}

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
    expect(valueOf(phone, '.lv-prow', 'display')).toBe('grid');
    // `display: contents` on the identity wrapper is what lets the name and
    // the meta line be placed on different rows — they are nested in the DOM
    // because the DESKTOP layout stacks them as one block.
    expect(
      valueOf(phone, '.lv-pid', 'display'),
      'without display:contents the grid areas below cannot reach .lv-pname / .lv-pmeta',
    ).toBe('contents');

    for (const selector of ['.lv-prow', '.lv-prow--right']) {
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
    expect(gridRows(phone, '.lv-prow')[0].join(' '))
      .toBe([...gridRows(phone, '.lv-prow--right')[0]].reverse().join(' '));
  });

  it('keeps the per-player meta row, which is the only live signal on the row', () => {
    expect(
      valueOf(phone, '.lv-pmeta', 'display'),
      'The meta row carries the game clock, state dot and red-zone flag. ' +
        'Hiding it makes the board indistinguishable from a static table. ' +
        'Shed individual pieces (the logo, down & distance) instead.',
    ).not.toBe('none');
  });

  it('keeps the game clock and the red-zone flag', () => {
    expect(valueOf(phone, '.lv-pclock', 'display')).not.toBe('none');
    expect(valueOf(phone, '.lv-rz', 'display')).not.toBe('none');
  });

  it('shows full player names instead of ellipsising them', () => {
    // The desktop rule sets `white-space: nowrap` + `text-overflow: ellipsis`.
    // Overriding white-space alone is enough to kill the ellipsis (it only
    // applies to a single non-wrapping line), and leaving `overflow: hidden`
    // in place is deliberate: it is the backstop that keeps a pathological
    // name from sliding under the score column.
    expect(valueOf(phone, '.lv-pname', 'white-space'), 'names must wrap, not truncate').toBe('normal');
    // `anywhere` would also shrink the column's intrinsic minimum and break a
    // name mid-word; `break-word` wraps between words and only splits one that
    // genuinely cannot fit.
    expect(valueOf(phone, '.lv-pname', 'overflow-wrap')).toBe('break-word');
    // And the sheet must not truncate a name ANYWHERE. The board this replaces
    // ellipsised on desktop and overrode it on a phone; the kit uses one
    // wrapping row at every width, so the assertion becomes the stronger one —
    // nothing in the sheet may reintroduce the truncation that rendered
    // "Jahmyr Gibbs" as "Jah…" in a ~70px column.
    const nameRules = [...stripped.matchAll(/\.lv-pname[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(nameRules.length, 'no .lv-pname rule at all').toBeGreaterThan(0);
    for (const body of nameRules) {
      expect(body, 'a player name must never be ellipsised').not.toMatch(/nowrap|text-overflow/);
    }
  });

  it('keeps the feed-freshness pill and its ticking age readable', () => {
    // The games-live clause is the one droppable part; the state word and the
    // age are the evidence, and hiding either brings the original bug back.
    expect(valueOf(phone, '.lv-status', 'display')).not.toBe('none');
    expect(valueOf(phone, '.lv-status__lbl', 'display')).not.toBe('none');
    expect(valueOf(phone, '.lv-status__age', 'display')).not.toBe('none');
  });

  it('starts the pill at the same x as the back button when the row wraps', () => {
    // The detail header is one flex row: back button, freshness pill. On a
    // phone it wraps, and a wrapped line is laid out against the CONTAINER's
    // padding box — so an inset that lives on `.lv-back` indents the button
    // only, and the pill lands a full rem left of the label above it (owner
    // screenshot, 2026-08-21). The inset therefore belongs to the row.
    // The VALUE is not the rule — the row carrying it is, equally on both
    // sides, in whichever cascade a phone resolves. The sheet this replaces
    // narrowed it at the breakpoint; the kit uses one inset at every width,
    // and either is fine as long as the row owns it.
    for (const block of [base, phone] as const) {
      const row = boxInline(block, '.lv-detail__top', 'padding');
      const inset = row.left;
      expect(inset, 'the row itself must carry the horizontal inset').toBeGreaterThan(0);
      expect(row.right).toBe(inset);
      // And .lv-back must not re-indent its own label: whatever inline padding
      // it keeps for the tap target has to be cancelled by an equal negative
      // margin, on BOTH sides, or the wrapped line disagrees with the label
      // above it again. Resolved from the shorthand AND the longhands, in
      // both cascades — a `padding-left` on its own is the same bug.
      const pad = boxInline(block, '.lv-back', 'padding');
      const mar = boxInline(block, '.lv-back', 'margin');
      expect(pad.left + mar.left, '.lv-back padding-left must net to zero').toBe(0);
      expect(pad.right + mar.right, '.lv-back padding-right must net to zero').toBe(0);
      // The tap target may not extend past the row's own inset, or the button
      // overflows the card (.lv-detail is overflow: hidden).
      expect(-mar.left).toBeLessThanOrEqual(inset);
    }
  });

  it('the freshness pill distinguishes a failed feed from a quiet one', () => {
    // Same split the poll store keeps between `status` and `data`: "we could
    // not reach the feed" must never render the same as "nothing is happening".
    const tone = (t: string) => new RegExp(`\\.lv-status--${t}[^{]*\\{[^}]*color:`).test(stripped);
    expect(tone('live')).toBe(true);
    expect(tone('error')).toBe(true);
    // The error DOT too: the pill's text tone alone is a colour difference a
    // colour-blind reader may not see, and the dot is the other half of it.
    expect(stripped).toMatch(/\.lv-dot--err[^{]*\{[^}]*background:/);
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
    expect(valueOf(base, '.lv-mx-row', 'align-items')).toBe('stretch');
    expect(valueOf(base, '.lv-mx-row', 'align-items')).not.toBe('center');
    // Same reasoning one level down: a single flex line in a stretched cell
    // would otherwise be centered in it.
    expect(valueOf(base, '.lv-prow', 'align-content')).toBe('flex-start');
  });

  it('puts the position on each ROW, never in a shared centre column', () => {
    // The board this replaces carried a third column holding ONE label for the
    // pair, centred on the row's first line so it could not drift downward by
    // half whatever the taller side gained. The kit deletes the column
    // outright, which retires that whole class of bug — and fixes a worse one
    // the centre column could not avoid: a single shared label can only name
    // ONE of the two paired positions, and mislabels the other whenever the
    // sides run different lineup shapes. Its phone breakpoint hid the column
    // for exactly that reason.
    //
    // A position GROUP HEADER spanning the pair is the same bug wearing a
    // different hat, and is ruled out for the same reason: the two sides are
    // sorted independently, so a WR opposite an RB is an ordinary row.
    expect(stripped, 'a shared centre slot column is back').not.toMatch(/\.lv-mx-pos\s*\{/);
    expect(island, 'no per-row position label in the markup').toMatch(/lv-ppos/);
  });

  it('gives the position NO column of its own — it rides the meta line', () => {
    // The label used to hold a `pos` grid area sized `--lv-slot-w`: a fixed
    // 1.6rem plus the row gap, 32px on EACH side of the pair, spent on two
    // characters. On a 390px phone that is 64px out of the two name columns,
    // and it is what wrapped "Jahmyr Gibbs" and "Chris Olave" onto a second
    // line (owner, 2026-09-19). Reserving the track again re-buys that bug, so
    // this pins the ABSENCE of the reservation four independent ways — no
    // grid area, no fixed track width, no `pos` in either side's areas, and no
    // live `--lv-slot-w`. Each is a route the 32px column could return by.
    //
    // EVERY assertion runs over the PHONE cascade as well as the base one.
    // `base` has every `@media` block stripped, so a phone-only
    // reintroduction — `@media (max-width: 760px) { .lv-prow {
    // grid-template-areas: "pos face name name" … } }` — would satisfy a
    // base-only check completely, on the one viewport the bug was reported
    // from. A guard that cannot see the breakpoint cannot guard a
    // phone-width rule.
    for (const [label, block] of [
      ['base', base],
      ['phone', phone],
    ] as const) {
      expect(
        valueOf(block, '.lv-ppos', 'grid-area'),
        `${label}: the position must not take a grid area — that is the 32px column back`,
      ).toBeUndefined();
      for (const prop of ['min-width', 'width', 'flex-basis']) {
        expect(
          valueOf(block, '.lv-ppos', prop),
          `${label}: a fixed ${prop} on the position is the slot column by another name`,
        ).toBeUndefined();
      }
      for (const selector of ['.lv-prow', '.lv-prow--right']) {
        for (const row of gridRows(block, selector)) {
          expect(row, `${label}: ${selector} reserves a pos track again`).not.toContain('pos');
        }
      }
    }
    // The token that sized it is gone, and must not come back — a live
    // `--lv-slot-w` is the tell that somebody is re-reserving the track.
    // This one reads the WHOLE sheet, media blocks included, so it needs no
    // per-cascade loop — and it is the backstop for a reintroduction that
    // invents a new selector the loop above does not name.
    expect(stripped, '--lv-slot-w is back; the slot column is being rebuilt').not.toMatch(
      /--lv-slot-w/,
    );
  });

  it('keeps the position welded to its NFL team so the meta line cannot split them', () => {
    // `.lv-pmeta` wraps (it has to — red zone, down & distance and a clock all
    // land on it). Loose in that flex line, a narrow row can break `RB` off
    // from `· DET`, or start a wrapped line with the separator. One nowrap
    // wrapper makes the group unbreakable; the separator is decorative and is
    // hidden from assistive tech rather than read as "middle dot".
    expect(island, 'position + team are not wrapped together').toMatch(/lv-pwho/);
    // Phone too, not just base — a breakpoint that relaxes the wrapper to save
    // a few pixels would split the group on exactly the width that needs it
    // held together.
    for (const [label, block] of [
      ['base', base],
      ['phone', phone],
    ] as const) {
      expect(
        valueOf(block, '.lv-pwho', 'white-space'),
        `${label}: without nowrap the meta line can break "RB · DET" in half`,
      ).toBe('nowrap');
    }
    expect(island, 'the NFL team is not on the row').toMatch(/lv-pteam/);
    expect(island, 'the separator must be hidden from assistive tech').toMatch(
      /lv-pdiv[^>]*aria-hidden|aria-hidden[^>]*lv-pdiv/s,
    );
    // A team DEFENCE gets no club code: "DEF · SEA" beside a player named
    // "Seattle Seahawks" is the same fact three times in one row.
    expect(island, 'a team defence must not print its own club code').toMatch(
      /isDef\s*\?\s*''\s*:\s*team/,
    );
  });

  it('mirrors the meta line by its AXIS, so the same item wraps on both sides', () => {
    // The right side has to start its meta line from the OUTER edge or the
    // position slides with the width of the clock text and the label column
    // goes ragged on one side of the pair only.
    //
    // `order: 1` on `.lv-pwho` buys that on one line and breaks it on two. The
    // line wraps — it carries a clock, RED ZONE and down-and-distance — and
    // the LAST flex item is the one that wraps, so ordering the position last
    // drops it to line 2 on the right during a live drive while the left keeps
    // it on line 1. Reversing the axis pins the position AND leaves the wrap
    // on the down-and-distance chip, which is what wraps on the left too.
    //
    // DOM order is untouched by either, so this is not an a11y trade — it is
    // the difference between mirroring the line and reordering one item in it.
    expect(
      valueOf(base, '.lv-prow--right .lv-pmeta', 'flex-direction'),
      'the mirrored meta line must reverse its axis, not reorder one child',
    ).toBe('row-reverse');
    for (const sel of ['.lv-pwho', '.lv-prow--right .lv-pwho']) {
      expect(
        valueOf(base, sel, 'order'),
        `${sel}: order makes the position the item that wraps — mirror the axis instead`,
      ).toBeUndefined();
    }
  });

  it('starts the box-score line where the player’s headshot starts', () => {
    // Flush left it once sat under the position chip, a whole slot column away
    // from the player it describes. The board this replaces bought the indent
    // with a derived `padding-left`; the kit spans the GRID instead, at every
    // width, which cannot drift when a column is resized because it names the
    // columns rather than re-deriving their widths.
    //
    // The span is the FULL row now that there is no slot column to clear —
    // column 1 is the headshot, which is where the line has always rendered,
    // and a long line gets the whole row instead of all but one track.
    expect(valueOf(base, '.lv-pstat', 'grid-column')).toBe('1 / -1');
    expect(valueOf(base, '.lv-prow--right .lv-pstat', 'grid-column')).toBe('1 / -1');
    // And NOT with a margin. A margin adds to the 100% basis and pushes the
    // line past the row — the first attempt at this, and the reason the rule
    // says padding-or-grid rather than "indent it somehow".
    for (const sel of ['.lv-pstat', '.lv-prow--right .lv-pstat']) {
      for (const prop of ['margin-left', 'margin-right', 'margin-inline']) {
        expect(valueOf(base, sel, prop), `${sel} must not indent with ${prop}`).toBeUndefined();
      }
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
    for (const selector of ['.lv-prow', '.lv-prow--right']) {
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

      // `.lv-prow` declares grid-template-rows TWICE: a plain fallback and then
      // `subgrid`. Both matter, so read every declaration rather than just the
      // winning one.
      const decls = declarationsFor(phone, selector)
        .filter(([prop]) => prop === 'grid-template-rows')
        .map(([, value]) => value);
      const all = decls.length ? decls : declarationsFor(phone, '.lv-prow')
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

    // Subgrid only reaches `.lv-prow` if it is a real grid item of the pair's
    // row — the wrappers between them have to collapse.
    expect(valueOf(phone, '.lv-mx-row > div', 'display')).toBe('contents');
    expect(valueOf(phone, '.lv-bench-row > div', 'display')).toBe('contents');
    // And the pair's row must define the three tracks they map onto.
    expect(valueOf(phone, '.lv-mx-row', 'grid-template-rows')).toBe('auto auto 1fr');
    expect(valueOf(phone, '.lv-bench-row', 'grid-template-rows')).toBe('auto auto 1fr');

    // (3) And row 1 is only equal on both sides because the name block is
    //     pinned to two lines. Without this a one-line name yields a 30px
    //     first row (the avatar) and a two-line name ~32px — the exact couple
    //     of pixels this whole test exists for.
    const nameMin = valueOf(phone, '.lv-pname', 'min-height');
    expect(nameMin, 'the name block must reserve two lines').toBeDefined();
    // Derived from the name's own type, not a magic number that silently
    // stops matching the moment the font-size is touched.
    // Declared on whichever ancestor owns the row metrics — `.lv-mx-body` in
    // this sheet, the row itself in the one before it. WHERE is not the rule;
    // being derived from the name's own type is.
    const nameH =
      valueOf(phone, '.lv-mx-body', '--lv-name-h')
      ?? valueOf(phone, '.lv-prow', '--lv-name-h')
      ?? '';
    expect(nameMin).toBe('var(--lv-name-h)');
    expect(nameH, '--lv-name-h must be derived from the name font-size').toContain(
      valueOf(phone, '.lv-pname', 'font-size') ?? 'NO-FONT-SIZE',
    );
    expect(nameH, '--lv-name-h must be derived from the name line-height').toContain(
      valueOf(phone, '.lv-pname', 'line-height') ?? 'NO-LINE-HEIGHT',
    );

    // The cells still have to fill the row, or there is no slack to place.
    expect(
      valueOf(base, '.lv-mx-row', 'align-items'),
      'cells must stretch to the row height',
    ).toBe('stretch');
    expect(valueOf(base, '.lv-prow', 'height')).toBe('100%');
  });

  it('pairs the two benches into shared grid rows rather than two columns', () => {
    // Two independently-flowing columns drift: one box-score line or one
    // wrapping name on the left pushes every row below it out of step with
    // its neighbour on the right, and the gap compounds down the list. Cells
    // that share a grid row cannot disagree about where a row starts.
    // A bench pair is shaped exactly like a starter row: one two-column grid
    // holding both sides. That shared shape is what lets ONE subgrid rule
    // align both sections.
    expect(valueOf(base, '.lv-bench-row', 'display')).toBe('grid');
    // Shaped EXACTLY like a starter row, asserted against the starter row
    // rather than against a literal — anything the bench does differently is
    // drift, and pinning the spelling instead of the equality is how the two
    // were allowed to diverge in the first place.
    for (const prop of ['grid-template-columns', 'grid-template-rows', 'gap', 'align-items']) {
      expect(
        valueOf(base, '.lv-bench-row', prop),
        `the bench row's ${prop} must match a starter row's`,
      ).toBe(valueOf(base, '.lv-mx-row', prop));
    }
    // And the columns must be able to SHRINK, or a long name overflows the row
    // instead of wrapping inside it.
    expect(valueOf(base, '.lv-bench-row', 'grid-template-columns')).toContain('minmax(0');
  });

  it('does not buy equal rows by clamping the name or the stat line', () => {
    // The two tempting ways to make rows uniform are a fixed height and a
    // line clamp, and both truncate. A clamp on the name is the "Jah…" bug
    // this stylesheet already fixed once; a clamp on the box-score line
    // silently drops the tail of a long one ("… · 1 FUM lost").
    for (const block of [base, phone]) {
      for (const selector of ['.lv-pname', '.lv-pstat']) {
        expect(
          valueOf(block, selector, '-webkit-line-clamp'),
          `${selector} must not be line-clamped to equalize rows`,
        ).toBeUndefined();
      }
      // `height: 100%` is REQUIRED (it fills the stretched cell) and cannot
      // clip — it adopts whatever the row already needed. A length would clip,
      // and so would a max-height.
      const h = valueOf(block, '.lv-prow', 'height');
      if (h !== undefined) expect(h, 'a fixed row height would clip').toBe('100%');
      expect(valueOf(block, '.lv-prow', 'max-height')).toBeUndefined();
    }
    // The phone rule that lets names wrap must still be the one in force.
    expect(valueOf(phone, '.lv-pname', 'white-space')).toBe('normal');
  });

  it('on a phone the box-score line spans the row via grid columns', () => {
    // Column 1 is the headshot, which is where the meta line above it starts —
    // the stat line lines up under the player. It ran from column 2 while a
    // slot column sat in front of the headshot; with that column gone the
    // full span puts it in the same place and gives a long line the whole row.
    // The breakpoint must not re-introduce an offset of its own.
    expect(valueOf(phone, '.lv-pstat', 'grid-column')).toBe('1 / -1');
    expect(valueOf(phone, '.lv-prow--right .lv-pstat', 'grid-column')).toBe('1 / -1');
  });
});


describe('the no-games board fits the phone', () => {
  // Every scoring card is a <button>, and the UA stylesheet gives buttons
  // border-box. The empty state is a <div>, which gets content-box — so the
  // SAME `.lv-card` rule (width: 100% + 1rem padding + a border) overflowed
  // the page by 34px and put a horizontal scrollbar across the whole phone
  // viewport, but ONLY in the week with no matchups (owner, 2026-08-22).
  // Measured: root scrollWidth 404 against a 393px viewport.
  it('sizes the card shell in border-box, since only some of them are buttons', () => {
    expect(
      valueOf(base, '.lv-card', 'box-sizing'),
      'this repo has no global box-sizing reset; a <div>.lv-card overflows without it',
    ).toBe('border-box');
    // And the declaration this is defending against must still be there, or
    // the guard is guarding nothing.
    expect(valueOf(base, '.lv-card', 'width')).toBe('100%');
    expect(valueOf(base, '.lv-card', 'padding')).toBeDefined();
  });

  it('lets the board track floor collapse on a narrow phone', () => {
    // `minmax(300px, 1fr)` is a floor grid does NOT clamp to the container, so
    // a 320px phone scrolled 4px sideways on the board itself.
    const cols = valueOf(base, '.lv-cards', 'grid-template-columns') ?? '';
    expect(cols).toContain('minmax(min(300px, 100%), 1fr)');
  });

  it('does not paint a win-probability split bar over the empty card', () => {
    // The bar encodes a matchup's win share; over an empty card it falls back
    // to a 50/50 split and renders as a grey bar that reads as a SCROLLBAR
    // rather than a border. The board this replaces cancelled it with
    // `content: none` on the card's ::before; the kit does not render a bar
    // for an empty card at all, which is the stronger form of the same rule —
    // there is nothing to cancel.
    expect(island, 'the empty state must not mount a win-probability bar').not.toMatch(
      /lv-card--empty[\s\S]{0,400}LvWinProbBar/,
    );
    // Non-interactive: it is a plain <div>, never a button. The hover accent
    // is scoped to `button.lv-card`, so a div cannot pick it up.
    expect(island, 'the empty state must not be a button').toMatch(
      /<div className=\{`lv-empty/,
    );
    expect(stripped, 'the hover accent must be button-scoped').toMatch(
      /button\.lv-card:hover/,
    );
    expect(stripped, 'a bare .lv-card:hover would reach the empty state too')
      .not.toMatch(/(^|[^.\w])\.lv-card:hover/m);
  });
  it('goes full bleed by cancelling the named gutters, never with 100vw', () => {
    // `100vw` resolves against the initial containing block, which INCLUDES a
    // classic space-consuming scrollbar, while both this media query and
    // `documentElement.clientWidth` exclude it. A desktop window under 760px on
    // Windows or most Linux therefore gets a card ~15px wider than the viewport
    // and a horizontal scrollbar off the whole page — and nothing up the chain
    // clips it (`main`'s `container-type: inline-size` is layout containment,
    // not paint). A mobile emulator uses overlay scrollbars and never shows it,
    // which is why only a guard catches this one.
    const bleed = declarationsFor(phone, '.lv-page .lv-detail').map(([, v]) => v).join(' ');
    expect(bleed, '.lv-detail must not size itself in vw').not.toMatch(/\d\s*vw/);
    // It must still actually cancel BOTH ancestor gutters: the layout's `main`
    // inline padding and `.lv-page`'s own. Either one alone leaves a visible
    // asymmetric inset that reads as "nearly right".
    const inline = valueOf(phone, '.lv-page .lv-detail', 'margin-inline') ?? '';
    expect(inline, 'must cancel main + .lv-page by token').toContain('--padding-sm');
    expect(inline).toContain('--spacing-md');
    expect(inline, 'a cancel is negative').toMatch(/-1|\* *-|-\(/);
  });

  it('never cancels a gutter it cannot name the ancestor for', () => {
    // SHIPPED, on MFL Live. The full-bleed above cancels two gutters BY NAME,
    // so it is only correct under an ancestor that has those two. `/live`
    // renders the same board inside `MflAppLayout` — no `.lv-page`, clamp-based
    // gutters of its own — and unscoped the rule pulled the card left and right
    // by two tokens that did not match. Both edges overflowed the screen: the
    // team names and the scores were clipped off either side on a phone.
    //
    // So a negative inline margin on a kit element has to be scoped to the
    // ancestor whose padding it is cancelling. A BARE `.lv-detail` rule with
    // one is the bug.
    for (const block of [base, phone] as const) {
      for (const prop of ['margin-inline', 'margin-left', 'margin-right']) {
        const v = valueOf(block, '.lv-detail', prop);
        expect(
          v === undefined || !/-/.test(v),
          `a bare .lv-detail must not carry a negative ${prop} — scope it to the ancestor whose gutter it cancels`,
        ).toBe(true);
      }
    }
  });

  it('does not pull the card up over the Throwback preview bar', () => {
    // The pull-up cancels `.lv-page`'s `padding-top`, but `.ls-tb-preview` is a
    // sibling of the island INSIDE `.lv-page` and carries a `margin-bottom` of
    // that same token — so during Throwback Week an ungated cancel eats the gap
    // under the bar and sits the card flush against it. The gate is on the
    // bar's absence, so a browser without `:has()` drops the rule and keeps the
    // band, which is the harmless half.
    const gated = /\.lv-page:not\(:has\(\.ls-tb-preview\)\)[^{]*\.lv-detail[^{]*\{[^}]*margin-top/;
    expect(phone, 'the margin-top cancel must be gated on the preview bar').toMatch(gated);
    expect(
      valueOf(phone, '.lv-detail', 'margin-top'),
      'an ungated .lv-detail margin-top would apply during Throwback Week',
    ).toBeUndefined();
  });

  it('ends the starter list on :last-of-type, not :last-child', () => {
    // `.lv-mx-body`'s last element is the bench `<details>`, not the last
    // starter row, so `:last-child` matches no row at all unless both benches
    // are empty — leaving a rule hanging under the last player, over the bench
    // disclosure. Both cascades: the base border and the phone hairline.
    // The divider is a pseudo-element here (an inset hairline), not a border
    // on the row — so it is CANCELLED with `content: none` rather than
    // `border-bottom: 0`. Same rule, same selector, different mechanism.
    expect(stripped, 'base divider must end on :last-of-type')
      .toMatch(/\.lv-mx-row:last-of-type::after\s*\{[^}]*content:\s*none/);
    expect(stripped, '.lv-mx-row:last-child no longer selects the last row')
      .not.toMatch(/\.lv-mx-row:last-child/);
    expect(phone, 'the hairline must still end on :last-of-type at phone width')
      .toMatch(/\.lv-mx-row:last-of-type::after/);
    // The bench's own rows ARE last in their grid — that one is correct as is.
    expect(stripped).toMatch(/\.lv-bench-row:last-child/);
  });
  it('needs no folded-yet-to-play workaround, because its cause is gone', () => {
    // ── THE RULE THIS REPLACES, AND WHY IT NO LONGER APPLIES ────────────────
    // The board this guarded put `role="img"` + `aria-label` on the
    // win-probability bar's WRAPPER, which makes the element a LEAF: the
    // percentages, the tag and the yet-to-play counts inside it are never
    // announced. It then had to keep a SECOND, visually-clipped copy of the
    // counts outside the bar so assistive tech had one to read — clipped
    // rather than `display: none`, and gated on the same `isFinal` flag as
    // the bar, or a final matchup hid its only copy.
    //
    // The kit removed the CAUSE: the bar is `aria-hidden` and one
    // `visually-hidden` sentence carries the numbers. There is exactly one
    // announced copy at every width, so there is no second copy to clip, no
    // flag to keep in sync, and no phone-width fudge.
    //
    // This asserts the cause stays gone — reintroducing `role="img"` would
    // silently re-open the bug the workaround existed for, with no workaround
    // left in the sheet to soften it.
    expect(island, 'the bar must not be an a11y leaf again').not.toMatch(
      /lv-wp[^]{0,200}role="img"/,
    );
    expect(island, 'the bar must be hidden from AT, not labelled as an image').toMatch(
      /className="lv-wp__track"[^]{0,120}aria-hidden/,
    );
    expect(island, 'one announced sentence carries the numbers').toMatch(
      /visually-hidden[^]{0,200}Win probability/,
    );
    // And no clipped duplicate crept back in.
    expect(stripped, 'a clipped duplicate is back in the sheet').not.toMatch(/\.lv-ytp/);
  });

  /**
   * THE CARD'S "TO PLAY" COUNT IS SPLIT PER TEAM, and stays split.
   *
   * The kit shipped this SUMMED — `a.yetToPlay + b.yetToPlay` behind one
   * label — which silently undid a fix the league board already carried. A
   * total answers "how much football is left" but never "left for WHOM",
   * which is the question a card reading 87.0 – 106.5 is actually being
   * asked, and the regression was invisible because a single number beside
   * "to play" looks entirely correct on its own.
   *
   * Four separate claims, because collapsing any one of them is how the
   * feature half-returns:
   *
   *  1. BOTH sides' counts are rendered, from `a.` and `b.` — a guard on the
   *     class alone would pass a summed number wearing the split markup.
   *  2. Neither is summed into what is printed.
   *  3. Each dot is coloured from its OWN side's variable, and the two differ.
   *     One `--t0` on both dots is worse than no dots: it states a pairing
   *     that is not there.
   *  4. Both counts reach the `aria-label`. That label REPLACES the header's
   *     markup for a screen reader — the `title` attributes and the dots are
   *     never announced — so a count missing from it is a count half the
   *     audience does not get at all.
   */
  it('splits the card\u2019s "to play" count per team, in each side\u2019s own colour', () => {
    const card = readFileSync(
      join(process.cwd(), 'src/components/shared/live/LvMatchupCard.tsx'),
      'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ');

    // 1 — both sides' counts are printed.
    expect(card, 'the first side\u2019s count is not rendered').toMatch(/\{a\.yetToPlay\}/);
    expect(card, 'the second side\u2019s count is not rendered').toMatch(/\{b\.yetToPlay\}/);

    // 2 — and neither is summed into a printed value.
    expect(card, 'the two counts are summed into what is printed').not.toMatch(
      /\{\s*a\.yetToPlay\s*\+\s*b\.yetToPlay\s*\}/,
    );

    // 3 — two dots, each from its own side's colour variable.
    const dots = [...card.matchAll(/lv-rem__dot[^]{0,160}?var\(--t\$\{(\w+)\}\)/g)].map(
      (m) => m[1],
    );
    expect(dots, 'expected two dots, one per side').toHaveLength(2);
    expect(dots[0], 'both dots read the same side\u2019s colour').not.toBe(dots[1]);

    // 4 — both counts reach the announced label.
    const label = /aria-label=\{([^]*?)\n      \}/.exec(card)?.[1] ?? '';
    expect(label, 'the first side\u2019s count is missing from the aria-label').toMatch(
      /a\.yetToPlay/,
    );
    expect(label, 'the second side\u2019s count is missing from the aria-label').toMatch(
      /b\.yetToPlay/,
    );
  });

  /**
   * The dots are a FILL, so they take the ΔE pair, not the ink pair.
   *
   * `--t0`/`--t1` promise perceptual distance from the card, which is exactly
   * what a small solid shape needs. The ink pair exists for TEXT and steps
   * toward the card\u2019s opposite until it clears WCAG — applied to a dot it
   * would wash the colour for no reading benefit, and it would make the dot
   * stop matching the win-probability bar segment it is meant to key to.
   */
  it('keeps the split dots on the fill pair and the digits on ordinary ink', () => {
    const dot = declarationsFor(base, '.lv-rem__dot');
    expect(dot.length, '.lv-rem__dot is missing from the sheet').toBeGreaterThan(0);
    // The colour is set inline per side, so the rule must not paint one here.
    expect(
      dot.find(([prop]) => prop === 'background' || prop === 'background-color'),
      '.lv-rem__dot hardcodes a colour \u2014 the side\u2019s own variable is set inline',
    ).toBeUndefined();
    // A dot with no `flex: none` is squeezed to an ellipse by the digits.
    expect(valueOf(base, '.lv-rem__dot', 'flex'), 'the dot can be squeezed to an ellipse').toBe(
      'none',
    );
    // The digits are ordinary page text, NOT a franchise colour: two numbers
    // a rem apart, each tinted its own team, is a legibility problem the dot
    // already solves without touching the digits.
    expect(valueOf(base, '.lv-rem__n', 'color')).toBe('var(--page-text)');
  });

  /**
   * One wording for one number, across every surface that prints it.
   *
   * Six places render a yet-to-play count: this island's card header, its
   * matchup detail line, the win-probability bar's folded copies,
   * BroadcastScoreHeader, MflLiveBoard, and the Sunday Ticket pair —
   * SundayTicketMatchups server-side plus SundayTicketLive, which rewrites
   * that same span on every poll. All but the card said "to play", so the
   * same fact read two different ways depending on which screen an owner was
   * looking at — the kind of drift nobody files a bug for and everybody
   * notices.
   *
   * The check is on RENDERED text only. Prose in comments may still say "yet
   * to play" (it reads better in a sentence), and `yetToPlay` is the field
   * name everywhere — neither is what a user sees, so neither is scanned.
   */
  it('prints "to play", never "yet to play", on every surface', () => {
    const SURFACES: Array<[string, string]> = [
      ['LvMatchupCard', 'src/components/shared/live/LvMatchupCard.tsx'],
      ['LvWinProbBar', 'src/components/shared/live/LvWinProbBar.tsx'],
      ['BroadcastScoreHeader', 'src/components/shared/live-broadcast/BroadcastScoreHeader.tsx'],
      ['SundayTicketMatchups', 'src/components/shared/sunday-ticket/SundayTicketMatchups.astro'],
      // The CLIENT half of the Sunday Ticket pair. SundayTicketMatchups
      // server-renders `.st-game__ytp`; this file rewrites that same span on
      // every poll. Leaving it out would let the phrase drift between the
      // first paint and the first refresh OF THE SAME ELEMENT — the one place
      // an owner would see both wordings without changing screens.
      ['SundayTicketLive', 'src/components/shared/sunday-ticket/SundayTicketLive.tsx'],
    ];
    const offenders: string[] = [];
    for (const [name, rel] of SURFACES) {
      const text = readFileSync(join(process.cwd(), rel), 'utf-8')
        // Comments are prose, not UI. All three forms have to go: a block
        // comment, an HTML comment (the .astro surface uses those), and a
        // TRAILING line comment — an earlier version anchored `//` to line
        // start, so `<span>{n} to play</span> // not "yet to play"` failed the
        // guard on its own explanation. The `[^:]` keeps `https://` intact.
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (/yet to play/.test(text)) offenders.push(`${name} (${rel})`);
      if (!/to play/.test(text)) offenders.push(`${name} renders no "to play" at all (${rel})`);
    }
    expect(offenders, 'every surface prints the count as "<n> to play"').toEqual([]);
  });
});
