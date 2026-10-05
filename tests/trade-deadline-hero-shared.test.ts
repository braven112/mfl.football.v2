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
import { componentOpeningTag } from './helpers/scan-guard';
import { resolve } from 'node:path';
import { loadThemes } from '../scripts/generate-league-themes.mjs';
import { resolveTheme } from '../scripts/lib/theme-resolve.mjs';

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
    ['LeagueHero', 'src/components/shared/league-hero/LeagueHero.astro'],
  ] as const) {
    it(`${name} imports it from shared/ and passes an href`, () => {
      const src = read(path);
      expect(src).toMatch(/from ['"][^'"]*(shared|\.\.)\/TradeDeadlineHero['"]/);
      const tag = componentOpeningTag(src, 'TradeDeadlineHero');
      expect(tag, `${name} does not render <TradeDeadlineHero>`).not.toBeNull();
      expect(tag!).toMatch(/tradeBuilderHref=\{/);
    });
  }

  it('each league sends owners to its OWN trade builder', () => {
    // The whole point. TheLeague passes a prefixed path through the apex-host
    // resolver (which STRIPS a prefix, never adds one — passing an unprefixed
    // path silently yields a 404 link); the AFL builds its path from the
    // registry rather than writing the directory into the component.
    expect(read('src/components/theleague/SeasonDailyHero.astro'))
      .toMatch(/tradeBuilderHref=\{resolveLeaguePath\('\/theleague\/front-office\/trade-builder'\)\}/);
    // The shared hero (the AFL, and every league after it) builds the path
    // from the registry entry and the league's own hero profile.
    const shared = read('src/components/shared/league-hero/LeagueHero.astro');
    expect(shared).toMatch(/ensureLeaguePrefix\(getLeagueBySlug\(league\)!?, profile\.facts\.tradeDeadline\.path\)/);
    expect(read('src/utils/league-hero/profiles.ts')).toContain("path: '/front-office/trade-builder'");
  });
});

describe('the deadline accent stays an URGENCY signal', () => {
  const themes = loadThemes() as Record<string, Record<'light' | 'dark', Record<string, string | null>>>;
  const urgent = Object.entries(themes).flatMap(([id, t]) =>
    (['light', 'dark'] as const).map((mode) => ({ id, mode, value: resolveTheme(t, mode)['--hero-urgent'] })),
  );

  it('the accent comes from the theme, falling back to the shared error red', () => {
    expect(CSS).toMatch(/--tdhero-accent\s*:\s*var\(--hero-urgent,\s*var\(--color-error/);
    expect(CSS).not.toMatch(/\[data-league=/);
  });

  it('the AFL sets its own red in BOTH themes', () => {
    expect(urgent.filter((u) => u.id === 'afl' && u.value).map((u) => u.mode).sort()).toEqual(['dark', 'light']);
  });

  it('the glow is derived from the accent, so the two cannot drift apart', () => {
    const glows = [...CSS.matchAll(/--tdhero-glow\s*:\s*([^;]+);/g)].map((m) => m[1]!);
    expect(glows.length).toBeGreaterThan(0);
    expect(glows.every((g) => /color-mix\(in srgb, var\(--tdhero-accent\)/.test(g))).toBe(true);
  });

  it('never wires the accent to the bare league accent token', () => {
    // TheLeague's --league-accent is its blue. A "just use the league accent"
    // rule would paint its deadline hero BLUE and delete the urgency.
    expect(CSS).not.toMatch(/--tdhero-accent\s*:\s*var\(\s*--league-accent/);
  });

  it('every urgency colour a theme sets is a red, not a brand colour of another hue', () => {
    // Cheap hue check: red channel dominant. Catches a well-meaning swap to
    // navy or gold, which would read as "no deadline today".
    const set = urgent.filter((u) => u.value);
    expect(set.length).toBeGreaterThan(0);
    const notRed = set.filter(({ value }) => {
      const h = value!.replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
      return !(r > g + 40 && r > b + 40);
    }).map((u) => `${u.id} ${u.mode} ${u.value}`);
    expect(notRed).toEqual([]);
  });
});
