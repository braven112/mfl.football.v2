/**
 * Sunday Ticket's two pickers are RAILS: one line each, scrolled sideways.
 *
 * They used to wrap, and wrapping is not a small cosmetic difference at phone
 * width — 24 leagues and five countries turned two rows into five, which put
 * five rows of chips between the scoreboard and the board the page exists to
 * show (Brandon, Sep 2026, 412px).
 *
 * Four declarations make a rail a rail, and every one of them has a failure
 * mode of its own if it goes missing:
 *
 *   - `flex-wrap: nowrap` + `overflow-x: auto` on `.st-rail` — the rail itself.
 *   - `flex: none` on `.st-chip` — chips that shrink produce a row that LOOKS
 *     like it fits, which is exactly the cue that there is nothing to scroll to.
 *   - `nowrap` on `.st-others` and `.st-others__list` — opening "Other leagues"
 *     must extend the same rail, not start a second one below it.
 *   - a full-height background on the sticky label — `align-self: stretch`,
 *     because a background only as tall as the TEXT let a chip's rounded ends
 *     show above and below it as it scrolled underneath (caught in review).
 *
 * A fifth joined them in review: inside a scrollport the site's focus ring —
 * drawn outside the box — is clipped, and tabbing to an off-screen chip parks it
 * flush against the clipping edge, so rail chips draw their ring inset.
 *
 * And one markup rule the CSS cannot express: the links OUT — "Reset to my
 * leagues" and "Times in …" — live beside the rail, never inside it. An action
 * you can only reach by swiping past 24 league chips is the same as an action
 * that is not there.
 *
 * Scan-style rather than render-style on purpose: whether a given rail
 * overflows depends on how many leagues the viewer is in and how wide the
 * phone is, so a render at one width with one roster would pass while the
 * shape that matters had already been undone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const css = readFileSync(join(root, 'src/styles/sunday-ticket.css'), 'utf8');
const board = readFileSync(
  join(root, 'src/components/shared/sunday-ticket/SundayTicketBoard.astro'),
  'utf8',
);

/** The body of one rule, by exact selector at the start of a line. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is not defined in sunday-ticket.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

/** Every `<div class="st-rail">…</div>` in the board, balanced by div depth. */
function railMarkup(): string[] {
  const rails: string[] = [];
  const open = /<div class="st-rail">/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(board))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (depth > 0) {
      const nextOpen = board.indexOf('<div', i);
      const nextClose = board.indexOf('</div>', i);
      expect(nextClose, 'an st-rail is never closed').toBeGreaterThan(-1);
      if (nextOpen > -1 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen + 4;
      } else {
        depth -= 1;
        i = nextClose + 6;
      }
    }
    rails.push(board.slice(start, i - 6));
  }
  return rails;
}

describe('Sunday Ticket chip rails', () => {
  it('scrolls sideways instead of wrapping', () => {
    const rail = ruleBody('.st-rail');
    expect(rail).toContain('flex-wrap: nowrap');
    expect(rail).toContain('overflow-x: auto');
    // The third of the trio, and the one that decides WHICH box scrolls: a rail
    // that refuses to shrink below its content hands the overflow to the page.
    expect(rail).toContain('min-width: 0');
  });

  it('keeps the label\u2019s fade inside the gap, off the first chip', () => {
    // A gradient wider than the rail's 0.45rem gap reaches onto the chip beside
    // the label and washes it at rest — the selected one, at every width.
    const fade = ruleBody('.st-chips__label::after');
    expect(fade).toContain('width: 0.45rem');
  });

  it('draws a chip\u2019s focus ring INSIDE the rail that would clip it', () => {
    // The site ring is `outline-offset: 2px` plus a box-shadow, both outside the
    // box and both clipped by the scrollport — and tabbing to an off-screen chip
    // parks it flush against that edge, so this is the normal keyboard path.
    const focus = ruleBody('.st-rail .st-chip:focus-visible');
    expect(focus).toContain('outline-offset: -2px');
    expect(focus).toContain('box-shadow: none');
  });

  it('never lets a chip shrink to fit', () => {
    // A squeezed row reads as one that fits. The half-visible chip at the edge
    // is the ONLY thing telling a viewer there is more to swipe to.
    expect(ruleBody('.st-chip')).toContain('flex: none');
  });

  it('extends the same rail when "Other leagues" opens', () => {
    expect(ruleBody('.st-others')).toContain('flex-wrap: nowrap');
    expect(ruleBody('.st-others__list')).toContain('flex-wrap: nowrap');
  });

  it('keeps the pinned label opaque for the rail’s full height', () => {
    const label = ruleBody('.st-chips__label');
    expect(label).toContain('position: sticky');
    expect(label).toContain('background: var(--page-bg)');
    // Without this the chip scrolling underneath shows its rounded ends above
    // and below a background only as tall as the label's text.
    expect(label).toContain('align-self: stretch');
  });

  it('puts both chip rows in a rail', () => {
    // Two navs, two rails — if a picker is rendered outside one, it wraps.
    expect(railMarkup()).toHaveLength(2);
    for (const rail of railMarkup()) expect(rail).toContain('st-chips__label');
  });

  it('keeps the links out of the rail, where swiping cannot hide them', () => {
    const inside = railMarkup().join('\n');
    expect(inside, '"Reset to my leagues" belongs beside the rail').not.toContain('st-chip--all');
    expect(inside, 'the clock link belongs beside the rail').not.toContain('st-chip--prefs');
    // Still on the page, just not in the scroller.
    expect(board).toContain('st-chip--all');
    expect(board).toContain('st-chip--prefs');
  });
});
