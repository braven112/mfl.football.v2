/**
 * The trade deadline hero is SHARED, and the two things a shared hero gets
 * wrong are the two things guarded here: where its button goes, and whose
 * colours it wears.
 *
 * It lived under theleague/ while the AFL imported it across directories,
 * which is exactly how its CTA came to read `/theleague/trade-builder` for
 * everyone — the one card in the league whose entire job is "go make a trade,
 * now", sending AFL owners into another league's trade builder. Nothing threw;
 * the link simply went somewhere else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const HERO = read('src/components/shared/TradeDeadlineHero.tsx');
const CSS = stripComments(read('src/styles/trade-deadline-hero.css'));

describe('the shared trade deadline hero', () => {
  it('lives in shared/, not under one league', () => {
    // A shared component parked in a league directory is how the hardcoded
    // CTA survived: the AFL imported `../theleague/TradeDeadlineHero` and
    // nothing about that import looked wrong.
    expect(() => read('src/components/shared/TradeDeadlineHero.tsx')).not.toThrow();
    expect(() => read('src/components/theleague/TradeDeadlineHero.tsx')).toThrow();
  });

  it('takes its CTA destination as a prop and names no league itself', () => {
    const code = stripComments(HERO);
    expect(code).toMatch(/href=\{tradeBuilderHref\}/);
    expect(code).not.toMatch(/\/theleague\/|\/afl-fantasy\/|\/best-ball/);
  });

  it('requires the href rather than defaulting it', () => {
    // Optional-with-a-default would have preserved the bug for the next
    // league. Required makes omitting it a type error at the call site.
    const code = stripComments(HERO);
    expect(code).toMatch(/tradeBuilderHref:\s*string;/);
    expect(code).not.toMatch(/tradeBuilderHref\?:/);
    expect(code).not.toMatch(/tradeBuilderHref\s*=\s*['"`]/);
  });

  for (const [name, path] of [
    ['SeasonDailyHero', 'src/components/theleague/SeasonDailyHero.astro'],
    ['AflHero', 'src/components/afl/AflHero.astro'],
  ] as const) {
    it(`${name} imports it from shared/ and passes an href`, () => {
      const src = read(path);
      expect(src).toMatch(/from ['"][^'"]*shared\/TradeDeadlineHero['"]/);
      const tag = src.slice(src.indexOf('<TradeDeadlineHero'));
      expect(tag.slice(0, tag.indexOf('/>'))).toMatch(/tradeBuilderHref=\{/);
    });
  }

  it('each league sends owners to its OWN trade builder', () => {
    // The whole point. TheLeague passes a prefixed path through the apex-host
    // resolver (which STRIPS a prefix, never adds one — passing an unprefixed
    // path silently yields a 404 link); the AFL builds its path from the
    // registry rather than writing the directory into the component.
    expect(read('src/components/theleague/SeasonDailyHero.astro'))
      .toMatch(/tradeBuilderHref=\{resolveLeaguePath\('\/theleague\/trade-builder'\)\}/);
    const afl = read('src/components/afl/AflHero.astro');
    expect(afl).toMatch(/ensureLeaguePrefix\(getLeagueBySlug\('afl-fantasy'\)!?, '\/trade-builder'\)/);
  });
});

describe('the deadline accent stays an URGENCY signal', () => {
  const aflBlocks = [...CSS.matchAll(
    /([^{}]*\[data-league=["']afl["'][^{}]*)\{([^}]*)\}/g,
  )].map((m) => ({ selector: m[1].trim(), body: m[2], dark: /\.dark\b/.test(m[1]) }));

  it('the AFL overrides the accent in BOTH themes', () => {
    const withAccent = aflBlocks.filter((b) => /--tdhero-accent\s*:/.test(b.body));
    expect(withAccent.map((b) => b.dark).sort()).toEqual([false, true]);
  });

  it('sets the glow alongside every accent it overrides', () => {
    // --tdhero-glow is a hardcoded rgba, NOT derived from the accent. Changing
    // one without the other leaves a red wash behind a crimson border.
    const missing = aflBlocks
      .filter((b) => /--tdhero-accent\s*:/.test(b.body) && !/--tdhero-glow\s*:/.test(b.body))
      .map((b) => b.selector);
    expect(missing).toEqual([]);
  });

  it('never wires the accent to the bare league accent token', () => {
    // TheLeague's --league-accent resolves to --color-primary #1c497c. A
    // "just use the league accent" rule would paint its deadline hero BLUE
    // and delete the urgency this component exists to convey.
    expect(CSS).not.toMatch(/--tdhero-accent\s*:\s*var\(\s*--league-accent/);
  });

  it('every accent it does set is a red, not a brand colour of another hue', () => {
    // Cheap hue check: red channel dominant. Catches a well-meaning swap to
    // navy or gold, which would read as "no deadline today".
    const hexes = [...CSS.matchAll(/--tdhero-accent\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
    expect(hexes.length).toBeGreaterThan(0);
    const notRed = hexes.filter((h) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      return !(r > g + 40 && r > b + 40);
    });
    expect(notRed).toEqual([]);
  });
});
