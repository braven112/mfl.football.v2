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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import theleague from '../src/data/hero-showcase/theleague';
import afl from '../src/data/hero-showcase/afl-fantasy';
import type { ShowcaseContent } from '../src/types/hero-showcase';
import { getLeagueTeamBrands } from '../src/utils/league-team-brands';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Every .astro under a directory, recursively — RecapCompositeHero sits in a
    `season-heroes/` subfolder, so a flat readdir would miss an accent. */
const globComponents = (rel: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.astro')) out.push(next);
    }
  };
  walk(rel);
  return out;
};

const css = read('src/styles/hero-showcase.css');
const heroCss = read('src/styles/composite-hero.css');
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

  it.each(MODULES)('%s: every gallery card names an accent the LIVE shell defines', (_name, content) => {
    // The gallery renders CompositeHero, so the stylesheet that has to define
    // the accent is the hero's, not the showcase's. The showcase stylesheet
    // must NOT define one: a `.hcx--*`-style lookalike here is how the page
    // drifted from the heroes three times, so its absence is the guard.
    for (const card of content.gallery) {
      expect(heroCss, `.cmh--${card.accent} is not defined`).toContain(`.cmh--${card.accent}`);
    }
    expect(
      /\.hc[a-z]*--(feature|recap|kickoff|roster|auction|navy|gold)\b/.test(css),
      'hero-showcase.css redefines an accent — the gallery must render the live shell, not a copy of it',
    ).toBe(false);
  });

  it.each(MODULES)('%s: declares BOTH ends of the chrome accent', (_name, content) => {
    // The light accent on a dark page is invisible. TheLeague used to get the
    // dark end free from the global --color-primary remap; making the palette
    // per-league removed that, and the AFL page inherited TheLeague blue.
    expect(content.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(content.palette.accentDark).toMatch(/^#[0-9a-f]{6}$/i);
    expect(content.palette.accentDark).not.toBe(content.palette.accent);
  });

  // ── COVERAGE ────────────────────────────────────────────────────────────
  // The gallery is an INVENTORY, and the failure mode is silent: a hero ships
  // a new state, nobody remembers the showcase exists, and the portfolio page
  // quietly starts describing a system that is one state smaller than the real
  // one. Worse, it happened in the other direction too — the AFL gallery once
  // carried a "CUT DOWN" and a "GAME DAY" card for heroes the AFL does not
  // have, which is how a reviewer ends up expecting a hero that never renders.
  // So coverage is checked BOTH ways, from the source of truth in each case.

  it('every accent the live composites pass has a card in that league\'s gallery', () => {
    // Source of truth: the `accent="…"` literals in the shipped components.
    const shipped = (dir: string) => {
      const accents = new Set<string>();
      for (const file of globComponents(dir)) {
        for (const m of read(file).matchAll(/accent="([a-z]+)"/g)) accents.add(m[1]);
      }
      return accents;
    };

    // TheLeague's composites live under src/components/theleague (RecapCompositeHero
    // is one directory deeper, which is why the walk is recursive).
    const tlAccents = shipped('src/components/theleague');
    expect(tlAccents.size).toBeGreaterThan(0);
    const tlCards = new Set(theleague.gallery.map((g) => g.accent));
    for (const accent of tlAccents) {
      expect(
        tlCards.has(accent as never),
        `TheLeague ships accent="${accent}" but /showcase has no card for it`,
      ).toBe(true);
    }
  });

  it('every AFL composite treatment has a card, and the gallery invents none', () => {
    // Source of truth: the `composite: { … }` literals in the AFL resolver.
    const resolver = read('src/utils/afl-hero-resolver.ts');
    const treatments = [...resolver.matchAll(
      /composite:\s*\{\s*wordmark:\s*'([^']+)',\s*accent:\s*'([a-z]+)'/g,
    )].map(([, wordmark, accent]) => ({
      // The source holds NBSP (U+00A0) escapes to keep two words together.
      wordmark: wordmark.replace(/\\u00a0/g, '\u00a0'),
      accent,
    }));
    expect(treatments.length).toBeGreaterThan(0);

    // Compare on a normalized space: the source holds U+00A0 to keep two
    // words together, the gallery may hold either.
    const norm = (w: string) => w.replace(/\u00a0/g, ' ');
    const cards = afl.gallery.map((g) => ({ wordmark: norm(g.wordmark), accent: g.accent }));

    // Both directions. Every treatment appears…
    for (const t of treatments) {
      expect(
        cards.some((c) => c.wordmark === norm(t.wordmark) && c.accent === t.accent),
        `AFL resolves a "${t.wordmark}" / ${t.accent} composite with no /showcase card`,
      ).toBe(true);
    }
    // …and no card claims a wordmark the AFL never renders.
    const shippedWordmarks = new Set(treatments.map((t) => norm(t.wordmark)));
    for (const card of afl.gallery) {
      expect(
        shippedWordmarks.has(norm(card.wordmark)),
        `/showcase card "${card.key}" shows wordmark "${card.wordmark}", which no AFL hero renders`,
      ).toBe(true);
    }
  });

  it('a state with a red tone is shown for every accent that can take one', () => {
    // `tone` is an overlay, not an accent, and it is the single most-missed
    // state in a gallery because it renders on a handful of days a year.
    for (const [name, mod] of MODULES) {
      const toned = mod.gallery.filter((g) => g.tone === 'red');
      expect(toned.length, `${name}/showcase shows no urgent (tone="red") state`).toBeGreaterThan(0);
      // A toned card must sit beside its untoned sibling — the point is the
      // comparison, and a lone red card reads as its own accent.
      for (const card of toned) {
        expect(
          mod.gallery.some((g) => g.accent === card.accent && !g.tone),
          `${name}: "${card.key}" is the only ${card.accent} card, so its red tone reads as an accent`,
        ).toBe(true);
      }
    }
  });

  it('both halves of the colour rule are shown, and every card declares one', () => {
    // "League events are league coloured, team events are team coloured" is the
    // rule the whole system turns on. A gallery showing only one half teaches
    // the reader the wrong rule.
    for (const [name, mod] of MODULES) {
      for (const card of mod.gallery) {
        expect(['league', 'team'], `${name}: "${card.key}" has no scope`).toContain(card.scope);
      }
      for (const scope of ['league', 'team'] as const) {
        expect(
          mod.gallery.some((g) => g.scope === scope),
          `${name}/showcase never shows a ${scope}-scoped hero`,
        ).toBe(true);
      }
      // A card that names a franchise IS the team half — it may not claim to
      // be a league event, which would state the rule backwards. The component
      // only dresses a card in a club when scope is 'team', so a league card
      // carrying a franchiseId would silently drop it.
      for (const card of mod.gallery.filter((g) => g.franchiseId)) {
        expect(card.scope, `${name}: "${card.key}" names a franchise but claims league scope`).toBe('team');
      }
    }
  });

  it('board cards carry four panels, and spotlight cards carry none', () => {
    // The two shapes are not interchangeable: a board with a `model` renders a
    // cutout on top of its own panels, and a board with no panels renders an
    // empty strip under the copy.
    for (const [name, mod] of MODULES) {
      for (const card of mod.gallery) {
        if (card.shape === 'board') {
          expect(card.panels?.length, `${name}: board "${card.key}" needs four panels`).toBe(4);
          expect(card.model, `${name}: board "${card.key}" must not also cast a spotlight model`).toBeUndefined();
        } else {
          expect(card.panels, `${name}: spotlight "${card.key}" carries panels`).toBeUndefined();
        }
      }
    }
  });

  it('gallery summaries are never clamped', () => {
    // The live hero clamps to two lines because its summary is generated. This
    // copy is authored and explanatory, and clamping it truncated all five of
    // TheLeague's cards mid-sentence on a page whose readers are evaluating the
    // work. If the clamp comes back, the copy silently loses its endings again.
    // Checked at the SOURCE of the clamp, not at a copy of it. This used to
    // read `.hcx__summary` out of hero-showcase.css — a lookalike rule that no
    // longer exists, so `indexOf` returned -1, `slice(-1)` handed back one
    // character, and the assertion passed against an empty string. A guard that
    // cannot fail is worse than no guard: it reports the rule is covered.
    //
    // The clamp is now a PROP on the live shell (`clampSummary` → the
    // `cmh--clamp-summary` class), so the thing to assert is that the gallery
    // never passes it.
    const gallery = component.slice(component.indexOf('<section class="hc-gallery"'));
    const heroCall = gallery.slice(0, gallery.indexOf('</section>'));
    expect(heroCall, 'the gallery renders CompositeHero').toContain('<CompositeHero');
    expect(heroCall, 'a showcase summary must never be clamped').not.toContain('clampSummary');
    // And the clamp itself must stay opt-in, so an adopter that passes nothing
    // cannot inherit it.
    expect(heroCss).toContain('.cmh--clamp-summary .cmh__summary {');
    const base = heroCss.slice(heroCss.indexOf('\n.cmh__summary {'));
    expect(base.slice(0, base.indexOf('}')), 'the BASE summary rule must not clamp').not.toContain('line-clamp');
  });

  /**
   * Length of the text a READER sees, ignoring the markup around it.
   *
   * Deliberately a scanner rather than `html.replace(/<[^>]+>/g, '')`. That
   * one-pass strip is the `js/incomplete-multi-character-sanitization` pattern
   * and CodeQL flagged it high, correctly: on nested or malformed markup a
   * single pass can SYNTHESISE a tag it was meant to remove — `<<a>script`
   * loses `<a>` and becomes `<script`. Nothing here renders the result, so it
   * was not a live vulnerability; the problem is that the line READS as a
   * sanitizer, and the next person to want "the plain text of a summary" would
   * have reached for it.
   *
   * Counting sidesteps the whole category: there is no stripped string to
   * reuse, and the number is what this test actually wanted.
   */
  const visibleLength = (html: string): number => {
    let count = 0;
    let inTag = false;
    for (const ch of html) {
      if (ch === '<') inTag = true;
      else if (ch === '>') inTag = false;
      else if (!inTag) count += 1;
    }
    return count;
  };

  it.each(MODULES)('%s: gallery summaries stay card-sized', (_name, content) => {
    for (const card of content.gallery) {
      const len = visibleLength(card.summary);
      expect(len, `${card.key} summary is ${len} chars`).toBeLessThanOrEqual(230);
    }
  });

  it('a card dressed in a club\'s colours names the club in its copy', () => {
    // The point of those cards is that the colour is not decorative. A reader
    // who cannot tell which club it belongs to learns nothing from it. The
    // NAME is resolved from the registry now, so this checks the copy against
    // the real club rather than against a second hand-typed string.
    for (const [name, mod] of MODULES) {
      const brands = getLeagueTeamBrands(mod.league);
      for (const card of mod.gallery) {
        if (!card.franchiseId) continue;
        const club = brands[card.franchiseId];
        expect(club, `${name}: "${card.key}" names franchise ${card.franchiseId}, which is not in the registry`).toBeTruthy();
        // Any distinctive word will do — "Midwestside Connection" is named in
        // the copy as "Midwestside", which is how an owner would say it.
        const words = club.name.split(' ').filter((w) => w.length >= 5);
        const prose = `${card.summary} ${card.title} ${card.titleAccent ?? ''}`;
        expect(
          words.some((w) => prose.includes(w)) || /your|club|franchise|team/i.test(prose),
          `${name}: "${card.key}" is dressed in ${club.name}'s colours but the copy never says whose they are`,
        ).toBe(true);
      }
    }
    expect(afl.gallery.some((c) => c.franchiseId), 'the AFL gallery must show franchise colours').toBe(true);
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
