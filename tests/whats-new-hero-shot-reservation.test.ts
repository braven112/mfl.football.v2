/**
 * The What's New hero's copy column must RESERVE the screenshot frame.
 *
 * The frame is absolutely positioned, so it exerts no pressure on the text.
 * The only thing keeping the two apart was the shell's `--cmh-content-max` —
 * a per-adopter number tuned for the TRANSPARENT ESPN cutout, where a
 * paragraph running over a shoulder is fine. Over an opaque browser-framed
 * screenshot it is a bug, and the two adopters had both drifted into one:
 * the AFL card asks for 62% while the frame takes 38% plus its own right
 * offset, which overlapped by 27px at a 786px card (Brandon, Sep 2026);
 * TheLeague's 58% left a 1px gap, which is the same bug one wrap away.
 *
 * The fix makes the collision impossible rather than re-tuning the numbers:
 * the frame's geometry lives in tokens on `.fch`, and the copy column's
 * max-width is DERIVED from them, so a future change to the frame's width
 * moves the text with it.
 *
 * Two details are load-bearing and easy to undo by accident:
 *
 *   - Container units on BOTH halves. An absolutely positioned element
 *     resolves `%` against the card's padding box and a max-width resolves
 *     against its content box, so the same `38%` is two numbers ~24px apart —
 *     enough to eat the whole gutter and put the overlap back while the CSS
 *     still reads as if it reserved the column.
 *   - The reservation releases when the frame is not on screen: the light
 *     capture 404s (`.fch--no-shot`), or mobile, where the frame is hidden
 *     and the copy takes the full card. The sibling selector outranks the
 *     shell's own `.cmh__content` rules, so it has to say so itself.
 *
 * Scan-style rather than render-style: the overlap depends on the card width,
 * the viewport and the entry's prose, so a test rendering one hero at one
 * width would pass at 1280 and miss the collision at 1024.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src/styles/whats-new-hero-shot.css'), 'utf8');

/** The body of one rule, by exact selector at the start of a line. */
function ruleBody(selector: string, from = 0): string {
  const at = css.indexOf(`\n${selector} {`, from);
  expect(at, `${selector} is not defined in whats-new-hero-shot.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
}

const MOBILE = css.slice(css.indexOf('@media (max-width: 640px)'));

describe("What's New hero screenshot frame", () => {
  it('publishes its geometry as tokens the copy column can subtract', () => {
    const root = ruleBody('.fch');
    expect(root).toContain('--fch-shot-w:');
    expect(root).toContain('--fch-shot-right:');

    const shot = ruleBody('.fch__shot');
    expect(shot, 'the frame must USE the tokens, or the two can disagree').toContain(
      'width: var(--fch-shot-w)',
    );
    expect(shot).toContain('right: var(--fch-shot-right)');
  });

  it('measures itself in container units, not percentages', () => {
    // `%` here means the frame and the copy column measure against different
    // boxes (padding vs content), which is how a reservation under-reserves.
    const root = ruleBody('.fch');
    expect(root).toContain('container-type: inline-size');
    const width = root.slice(root.indexOf('--fch-shot-w:'));
    expect(width.slice(0, width.indexOf(';'))).not.toMatch(/%/);
  });

  it('holds a column open for itself in the copy', () => {
    const reservation = ruleBody('.fch__shot ~ .cmh__content');
    expect(reservation).toContain('100cqi');
    expect(
      reservation,
      'the reservation must subtract the frame token, not a hand-tuned number',
    ).toContain('var(--fch-shot-w)');
    expect(reservation, 'and leave a gutter between the two').toContain('var(--fch-shot-gutter)');
  });

  it('releases the column when the capture 404s', () => {
    expect(ruleBody('.fch--no-shot .fch__shot ~ .cmh__content')).toContain(
      'max-width: var(--cmh-content-max)',
    );
  });

  it('releases the column on mobile, where the frame is hidden', () => {
    const at = MOBILE.indexOf('.fch__shot ~ .cmh__content {');
    expect(
      at,
      'the mobile block must reset the reservation — the sibling selector outranks .cmh__content',
    ).toBeGreaterThan(-1);
    expect(MOBILE.slice(at, MOBILE.indexOf('}', at))).toContain('max-width: 100%');
  });
});
