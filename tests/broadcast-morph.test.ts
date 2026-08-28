/**
 * The draft broadcast's shared-element morph.
 *
 * The geometry is pure and tested here directly; the two traps that actually
 * broke this in development are pinned as source guards at the bottom, because
 * both are the kind of thing that looks harmless in a diff and only shows up as
 * "the board stopped animating back" on a TV at draft time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { morphDelta, morphTransform, MORPH_EASING } from '../src/utils/broadcast-morph';

/** The real boxes, measured on a 1920x1080 board (Chromium, Aug 2026). */
const IDLE_CREST = { left: 583, top: 242, width: 367, height: 367 };
const REVEAL_CREST = { left: 593, top: 246, width: 734, height: 734 };
const IDLE_COPY = { left: 1000, top: 380, width: 337, height: 92 };
const REVEAL_TEXT = { left: 439, top: 380, width: 501, height: 466 };

describe('morphDelta', () => {
  it('measures centre to centre, not corner to corner', () => {
    // Two boxes that share a left edge but differ in width have a non-zero dx:
    // the crest doubles in size, so matching corners would leave it visibly off.
    const d = morphDelta(
      { left: 100, top: 0, width: 100, height: 100 },
      { left: 100, top: 0, width: 300, height: 100 }
    );
    expect(d.dx).toBe(100);
    expect(d.dy).toBe(0);
  });

  it('scales artwork by the width ratio', () => {
    const d = morphDelta(IDLE_CREST, REVEAL_CREST);
    expect(d.scale).toBeCloseTo(2, 5);
    // The idle crest sits left of centre and high; the reveal crest is centred.
    expect(d.dx).toBeCloseTo(193.5, 1);
    expect(d.dy).toBeCloseTo(187.5, 1);
  });

  it('never scales type — a copy block translates only', () => {
    // The idle team name is ~2.5vh and the reveal player name ~9vh. Scaling
    // between them reads as a zoom effect, not as the same words moving, and
    // it renders the intermediate frames at fractional font sizes.
    const d = morphDelta(IDLE_COPY, REVEAL_TEXT, false);
    expect(d.scale).toBe(1);
    expect(d.dx).toBeLessThan(0); // the copy slides LEFT into the reveal
  });

  it('is its own inverse — the way back is the way out, reversed', () => {
    const out = morphDelta(IDLE_CREST, REVEAL_CREST);
    const back = morphDelta(REVEAL_CREST, IDLE_CREST);
    expect(back.dx).toBeCloseTo(-out.dx, 5);
    expect(back.dy).toBeCloseTo(-out.dy, 5);
    expect(back.scale).toBeCloseTo(1 / out.scale, 5);
  });

  it('survives a zero-width box rather than emitting scale: Infinity', () => {
    // A crest whose art 404'd is display:none, so it measures 0x0. The caller
    // skips that pair, but the math must not produce NaN/Infinity on the way.
    const d = morphDelta({ left: 0, top: 0, width: 0, height: 0 }, REVEAL_CREST);
    expect(Number.isFinite(d.scale)).toBe(true);
    expect(d.scale).toBe(1);
  });
});

describe('morphTransform', () => {
  it('composes onto the stylesheet transform instead of replacing it', () => {
    // The reveal crest is centred with translate(-50%, -50%). A WAAPI keyframe
    // REPLACES the transform property, so a bare translate would drop the
    // centring and throw the crest half its own width off in both directions.
    const t = morphTransform('matrix(1, 0, 0, 1, -367, -367)', { dx: 10, dy: 20, scale: 2 });
    expect(t).toBe('matrix(1, 0, 0, 1, -367, -367) translate(10px, 20px) scale(2)');
  });

  it('emits the move alone when the element has no transform of its own', () => {
    for (const base of ['', 'none']) {
      expect(morphTransform(base, { dx: 1, dy: 2, scale: 1 })).toBe(
        'translate(1px, 2px) scale(1)'
      );
    }
  });
});

describe('the two traps this morph fell into', () => {
  const morph = readFileSync('src/utils/broadcast-morph.ts', 'utf-8');
  const css = readFileSync('src/styles/draft-broadcast.css', 'utf-8');
  const island = readFileSync(
    'src/components/afl/draft-broadcast/DraftBroadcast.tsx',
    'utf-8'
  );
  /** Source with comments stripped — the notes below describe the traps by
   *  name, so a naive match would pass on the explanation alone. */
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('never fills an animation forwards', () => {
    // A `fill: forwards` transform SURVIVES cancel() on a finished animation in
    // Chrome — it stops being listed by getAnimations() while still applying.
    // The leaving crest stayed pinned on the reveal's box, the next morph
    // measured it there, computed a zero delta, and the board never animated
    // back. Nothing to pin means nothing to un-pin.
    expect(code(morph)).not.toMatch(/fill:\s*'forwards'/);
  });

  it('takes its duration from the stylesheet, not a second copy of the number', () => {
    // The crest's flight and the cross-fade under it have to end together: the
    // leaving element snaps home the instant it lands, and that snap is only
    // invisible because the layer has reached zero opacity by then.
    expect(css).toMatch(/--dbc-fade:\s*\d+m?s/);
    expect(code(island)).toMatch(/getPropertyValue\(\s*'--dbc-fade'\s*\)/);
  });

  it('measures after cancelling, and cancels before it reads a base transform', () => {
    const body = code(morph);
    const cancelAt = body.indexOf('.cancel()');
    expect(cancelAt).toBeGreaterThan(-1);
    expect(body.indexOf('boxOf(idleEl)')).toBeGreaterThan(cancelAt);
    expect(body.indexOf('baseTransform(arriving)')).toBeGreaterThan(cancelAt);
  });

  it('honors reduced motion in the same file that starts the animations', () => {
    // The CSS half of the handoff is disabled in the stylesheet's
    // prefers-reduced-motion block; the JS half has to opt out too, or the
    // screens still fly around for a viewer who asked them not to.
    expect(code(morph)).toMatch(/prefers-reduced-motion/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]*\.dbc__screen/);
  });

  it('uses the reveal card\'s own easing so a morph and a plain swap match', () => {
    expect(MORPH_EASING).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    expect(css).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
  });
});
