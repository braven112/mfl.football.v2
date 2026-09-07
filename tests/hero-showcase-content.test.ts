/**
 * Hero-showcase content guard.
 *
 * `/showcase` is a portfolio surface: it is read by people deciding whether the
 * engineering behind this site is any good, so a broken card or a truncated
 * sentence costs more here than on a normal page. It is also the one page whose
 * body is generated from a data module, which means the usual "it looked fine
 * when I wrote it" check does not apply — a typo in a block's `kind` renders
 * NOTHING at all, silently, because the component just finds no branch to take.
 *
 * These tests pin the shapes the component can actually render, plus the few
 * content rules that have real consequences:
 *   - the routes stay THIN (the fork ratchet's rule, enforced here too because
 *     this page is exactly the kind that regrows a second copy);
 *   - every gallery card names a palette the stylesheet defines;
 *   - both palettes declare a dark accent, since the light one disappears into
 *     a dark page — the regression that shipped the moment the palette stopped
 *     reading the global `--color-primary`;
 *   - the AFL page is its own document rather than TheLeague's with the nouns
 *     swapped, which is the whole reason a content module exists per league.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import theleague from '../src/data/hero-showcase/theleague';
import afl from '../src/data/hero-showcase/afl-fantasy';
import type { ShowcaseContent } from '../src/types/hero-showcase';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const css = read('src/styles/hero-showcase.css');
const component = read('src/components/shared/hero-showcase/ShowcasePage.astro');

const MODULES: Array<[string, ShowcaseContent]> = [
  ['theleague', theleague],
  ['afl-fantasy', afl],
];

/** Every block kind the component has a branch for. */
const RENDERABLE = [...component.matchAll(/is\(b, '([a-z-]+)'\)/g)].map((m) => m[1]);

describe('hero showcase content', () => {
  it('the component has a branch for every kind, and no dead branches', () => {
    const used = new Set<string>();
    for (const [, content] of MODULES) {
      for (const section of content.sections) for (const b of section.blocks) used.add(b.kind);
    }
    expect(RENDERABLE.length).toBeGreaterThan(0);
    // A kind with no branch renders nothing at all — silently.
    expect([...used].filter((k) => !RENDERABLE.includes(k))).toEqual([]);
    // A branch nothing uses is dead markup to maintain.
    expect(RENDERABLE.filter((k) => !used.has(k))).toEqual([]);
  });

  it.each(MODULES)('%s: every gallery card names a defined accent', (_name, content) => {
    for (const card of content.gallery) {
      expect(css, `.hcx--${card.accent} is not defined`).toContain(`.hcx--${card.accent ?? 'blue'}`);
      expect(card.primary, `${card.key} primary must be a hex`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it.each(MODULES)('%s: declares BOTH ends of the chrome accent', (_name, content) => {
    // The light accent on a dark page is invisible. TheLeague used to get the
    // dark end free from the global --color-primary remap; making the palette
    // per-league removed that, and the AFL page inherited TheLeague blue.
    expect(content.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(content.palette.accentDark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(content.palette.accentDark).not.toBe(content.palette.accent);
  });

  it('gallery summaries are never clamped', () => {
    // The live hero clamps to two lines because its summary is generated. This
    // copy is authored and explanatory, and clamping it truncated all five of
    // TheLeague's cards mid-sentence on a page whose readers are evaluating the
    // work. If the clamp comes back, the copy silently loses its endings again.
    const rule = css.slice(css.indexOf('.hcx__summary {'));
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('line-clamp');
  });

  it.each(MODULES)('%s: gallery summaries stay card-sized', (_name, content) => {
    for (const card of content.gallery) {
      const plain = card.summary.replace(/<[^>]+>/g, '');
      expect(plain.length, `${card.key} summary is ${plain.length} chars`).toBeLessThanOrEqual(230);
    }
  });

  it('a card painted in a franchise colour says whose colour it is', () => {
    // The point of those cards is that the colour is not decorative. A reader
    // who cannot tell which club it belongs to learns nothing from it.
    for (const card of afl.gallery) {
      if (!card.franchise) continue;
      // Any distinctive word will do — "Midwestside Connection" is named in
      // the copy as "Midwestside", which is how an owner would say it.
      const words = card.franchise.split(' ').filter((w) => w.length >= 5);
      expect(
        words.some((w) => card.summary.includes(w)),
        `${card.key} paints ${card.franchise}'s colour but never names the club`,
      ).toBe(true);
    }
    expect(afl.gallery.some((c) => c.franchise), 'the AFL gallery must show franchise colours').toBe(true);
  });

  it('is its own document per league, not one essay with the nouns swapped', () => {
    const titles = (c: ShowcaseContent) => c.sections.map((s) => s.title);
    const shared = titles(theleague).filter((t) => titles(afl).includes(t));
    // Some overlap is honest (both explain the image pipeline); wholesale
    // overlap means one league is reading the other's page.
    expect(shared.length).toBeLessThan(Math.min(theleague.sections.length, afl.sections.length) / 2);
    expect(afl.hero.deckHtml).not.toBe(theleague.hero.deckHtml);
    expect(afl.closing.paragraphs[0]).not.toBe(theleague.closing.paragraphs[0]);
  });

  it.each(MODULES)('%s: sections are numbered in order', (_name, content) => {
    expect(content.sections.map((s) => s.num)).toEqual(
      content.sections.map((_, i) => String(i + 1).padStart(2, '0')),
    );
  });

  it('both routes stay thin wrappers', () => {
    // The shared component exists so this page is built once. A route that
    // grows a body again is the fork this repo already ratchets against.
    for (const route of ['src/pages/theleague/showcase.astro', 'src/pages/afl-fantasy/showcase.astro']) {
      const lines = read(route).split('\n').length;
      expect(lines, `${route} is ${lines} lines`).toBeLessThanOrEqual(80);
      expect(read(route)).toContain('ShowcasePage');
    }
  });

  it('each league links to the other league\'s version', () => {
    expect(theleague.closing.ctas.some((c) => c.href.includes('afl-fantasy'))).toBe(true);
    expect(afl.closing.ctas.some((c) => c.href.includes('theleague'))).toBe(true);
  });
});
