/**
 * The What's New screenshot's two failure modes are not the same failure.
 *
 * A feature composite ships the capture twice — a light half and a `-dark`
 * half — and CSS shows whichever matches the viewer's theme, because SSR
 * cannot know which that is. So there are two independent 404s:
 *
 *   - the LIGHT capture is missing → there is no screenshot at all, and the
 *     frame should go away (`fch--no-shot` reveals the league mark instead);
 *   - the DARK capture is missing → only the VARIANT is absent. The light
 *     capture is still perfectly readable, so `fch__shot--no-dark` tells the
 *     stylesheet to show it in dark mode too.
 *
 * Wiring both to the light handler throws away a good screenshot because its
 * optional sibling is absent — a whole hero degraded by a missing `-dark.webp`
 * that nobody promised existed. The AFL's composite shipped exactly that (found
 * in review, Sep 2026); TheLeague's has always had it right.
 *
 * Pinned across BOTH leagues because the bug arrived by copying one into the
 * other, which is the direction it will arrive from again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const SHOT_COMPOSITES: Array<[string, string]> = [
  ['TheLeague', 'src/components/theleague/FeatureCompositeHero.astro'],
  ['AFL', 'src/components/afl/AflCompositeHero.astro'],
];

/** The `onerror` attribute on the img carrying `cls`. */
function handlerFor(src: string, cls: string): string {
  const at = src.indexOf(cls);
  expect(at, `${cls} not found`).toBeGreaterThan(-1);
  const tail = src.slice(at);
  // Stop at THIS tag's end, not at the next `/>` in the file: with an explicit
  // closing tag (or none after) the old bound ran into a later element and
  // could return ITS onerror — and this suite exists to catch exactly a
  // wrong-handler wiring, so a wrong extraction here reads as a pass.
  const tagEnd = tail.indexOf('>');
  expect(tagEnd, `unterminated tag around ${cls}`).toBeGreaterThan(-1);
  const m = tail.slice(0, tagEnd).match(/onerror="([^"]+)"/);
  expect(m, `no onerror beside ${cls}`).toBeTruthy();
  return m![1];
}

describe('feature screenshot fallbacks', () => {
  it.each(SHOT_COMPOSITES)('%s: a missing dark variant does not drop the frame', (_name, file) => {
    const src = read(file);
    const dark = handlerFor(src, 'fch__shot-img--dark');
    expect(
      dark,
      'the dark half must degrade to the light capture, not hide the screenshot',
    ).toContain('fch__shot--no-dark');
    expect(dark, 'the dark half must not drop the whole frame').not.toContain('fch--no-shot');
  });

  it.each(SHOT_COMPOSITES)('%s: a missing light capture DOES drop the frame', (_name, file) => {
    // The other direction still has to work: with no light capture there is
    // nothing to show, and an empty browser frame is worse than the mark.
    const light = handlerFor(read(file), 'fch__shot-img--light');
    expect(light).toContain('fch--no-shot');
  });

  it('the stylesheet defines both classes the handlers name', () => {
    // A handler adding a class nothing styles fails silently — the image 404s,
    // the class lands, and the layout does not move.
    const css = read('src/styles/whats-new-hero-shot.css');
    expect(css).toContain('.fch--no-shot');
    expect(css).toContain('.fch__shot--no-dark');
  });
});
