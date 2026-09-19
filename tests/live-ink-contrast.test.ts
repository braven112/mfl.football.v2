import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveMatchupColorVars } from '../src/utils/live/model';
import { SURFACE_GROUNDS, type LiveSurface } from '../src/utils/live/surface';
import {
  AA_BODY_TEXT_RATIO,
  DEFAULT_MIN_BG_CONTRAST,
  colorDistance,
  contrastRatio,
} from '../src/utils/team-color-contrast';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * A FRANCHISE COLOUR USED AS TEXT MUST CLEAR WCAG, NOT ΔE.
 *
 * ── THE BUG THIS PINS ─────────────────────────────────────────────────────
 * `resolveTeamColorPair` guarantees ΔE — perceptual distance from the card it
 * sits on. That is the correct metric for a filled bar segment or a border: it
 * says the colour is tellable apart from its ground. It says nothing about
 * READING small text, which needs luminance contrast.
 *
 * The live kit shipped using ONE pair for both. Measured on the AFL's
 * `Drunk Indians` (#314d78) against MFL Live's #1e2126 card:
 *
 *     ΔE 31.3   — comfortably past the gate of 18, so nothing adjusted it
 *     1.89:1    — fails AA body (4.5) and even AA large (3)
 *
 * `ensureLegibleOn` returned it completely unchanged, because the gate it
 * enforces had already been cleared. An owner reported the score as simply
 * unreadable on the dark board, which it was.
 *
 * ── WHY BODY AND NOT LARGE ────────────────────────────────────────────────
 * `.lv-side__score` is `1.05rem` bold = 16.8px, UNDER the 18.66px-bold
 * threshold that would let 3:1 apply, and the win-probability labels are
 * `0.72rem`. Both are body text, so both need 4.5:1. There is no size in the
 * kit that earns the looser floor, which is why there is one ink pair rather
 * than two tiers.
 */

const ROOT = resolve(__dirname, '..');
const KIT = join(ROOT, 'src/components/shared/live');
const SHEET = readFileSync(join(ROOT, 'src/styles/live.css'), 'utf8');

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every real franchise colour claim the two full-management leagues declare. */
const CLAIMS = ALL_LEAGUES.flatMap((league: { configPath?: string }) => {
  if (!league.configPath) return [];
  let cfg: { teams?: { name?: string; colorPrimary?: string; colorSecondary?: string }[] };
  try {
    cfg = JSON.parse(readFileSync(join(ROOT, league.configPath), 'utf8'));
  } catch {
    return [];
  }
  return (cfg.teams ?? [])
    .filter((t) => t.colorPrimary)
    .map((t) => ({
      name: t.name ?? '(unnamed)',
      claim: {
        color: t.colorPrimary!,
        colorPrimary: t.colorPrimary!,
        colorSecondary: t.colorSecondary,
      },
    }));
});

const SURFACES = Object.keys(SURFACE_GROUNDS) as LiveSurface[];

describe('a franchise colour used as TEXT clears WCAG, not ΔE', () => {
  it('found the real franchise claims to measure', () => {
    // A census, not a sample: the bug was in ONE franchise of twenty-four, so
    // a handful of hand-picked colours would have missed it.
    expect(CLAIMS.length).toBeGreaterThan(30);
  });

  /**
   * The ink pair is readable on every card ground, in both themes.
   *
   * Paired against a fixed neutral opponent so the resolver's away-side
   * stepping cannot be what rescues the colour under test — each franchise has
   * to read on its own.
   */
  for (const surface of SURFACES) {
    it(`every franchise's ink clears AA body on the ${surface} card, both themes`, () => {
      const grounds = SURFACE_GROUNDS[surface];
      const failures: string[] = [];

      for (const { name, claim } of CLAIMS) {
        const vars = resolveMatchupColorVars(
          claim,
          { color: '#8a8a8a', colorPrimary: '#8a8a8a' },
          surface,
        );
        for (const [key, ground] of [
          ['--t0-ink-light', grounds.light],
          ['--t0-ink-dark', grounds.dark],
        ] as const) {
          const ink = vars[key];
          const ratio = contrastRatio(ink, ground);
          if (!(ratio >= AA_BODY_TEXT_RATIO)) {
            failures.push(
              `${name} ${key}=${ink} on ${ground} is ${ratio.toFixed(2)}:1 ` +
                `(needs ${AA_BODY_TEXT_RATIO})`,
            );
          }
        }
      }

      expect(failures, failures.join('\n')).toEqual([]);
    });
  }

  /**
   * The fill pair is unchanged, and still only promises ΔE.
   *
   * Asserted so nobody "fixes" this by raising the FILL pair to a WCAG floor:
   * that would wash every bar segment toward the card for no reading benefit,
   * and it is the one thing that would make the two pairs redundant and invite
   * their re-merging.
   */
  it('leaves the fill pair on the ΔE guarantee', () => {
    const indians = { color: '#314d78', colorPrimary: '#314d78', colorSecondary: '#d53755' };
    const vars = resolveMatchupColorVars(
      indians,
      { color: '#8a8a8a', colorPrimary: '#8a8a8a' },
      'mfl',
    );
    const ground = SURFACE_GROUNDS.mfl.dark;

    // The exact case from the report: the fill still clears ΔE and still fails
    // as text, which is why the ink pair has to exist at all.
    expect(colorDistance(vars['--t0-dark'], ground)).toBeGreaterThanOrEqual(
      DEFAULT_MIN_BG_CONTRAST,
    );
    expect(contrastRatio(vars['--t0-dark'], ground)).toBeLessThan(AA_BODY_TEXT_RATIO);
    // ...and the ink pair fixes precisely that.
    expect(contrastRatio(vars['--t0-ink-dark'], ground)).toBeGreaterThanOrEqual(
      AA_BODY_TEXT_RATIO,
    );
  });

  it('keeps a colour that already reads exactly on-brand', () => {
    // `ensureContrastOn` returns untouched anything that passes, so a legible
    // brand colour must not drift. Suh girls' #b97c46 is 4.64:1 on MFL Live's
    // card and has to come back byte-identical.
    const suh = { color: '#b97c46', colorPrimary: '#b97c46', colorSecondary: '#e9e9e9' };
    const vars = resolveMatchupColorVars(
      suh,
      { color: '#8a8a8a', colorPrimary: '#8a8a8a' },
      'mfl',
    );
    expect(vars['--t0-ink-dark']).toBe(vars['--t0-dark']);
  });

  /* ── the call sites ───────────────────────────────────────────────────── */

  it('colours no text in the stylesheet with the fill pair', () => {
    const css = stripComments(SHEET);
    // `border-color` is a FILL and legitimately takes --t0/--t1, so the match
    // is anchored on a `color:` that is not part of a longhand.
    const offenders = [...css.matchAll(/(^|[;{\s])color:\s*var\(--t[01]\)/g)].map((m) => m[0]);
    expect(offenders, offenders.join(' | ')).toEqual([]);
  });

  it('colours no text in a kit component with the fill pair', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(KIT).filter((f) => /\.(tsx|astro)$/.test(f))) {
      const src = stripComments(readFileSync(join(KIT, file), 'utf8'));
      // Catches both `color: 'var(--t0)'` and the template form the card used.
      for (const m of src.matchAll(/color:\s*[`'"]var\(--t\$?\{?[^)]*\)/g)) {
        if (!/-ink/.test(m[0])) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('aliases the ink pair per theme, so it resolves in both', () => {
    // Same two-rule shape as --t0/--t1. A missing dark alias renders the
    // fallback in BOTH themes, which is the silent failure CLAUDE.md warns of.
    expect(SHEET).toMatch(/\.lv-matchup\s*\{[^}]*--t0-ink:\s*var\(--t0-ink-light/);
    expect(SHEET).toMatch(/html\.dark \.lv-matchup\s*\{[^}]*--t0-ink:\s*var\(--t0-ink-dark/);
    expect(SHEET).toMatch(/\.lv-matchup\s*\{[^}]*--t1-ink:\s*var\(--t1-ink-light/);
    expect(SHEET).toMatch(/html\.dark \.lv-matchup\s*\{[^}]*--t1-ink:\s*var\(--t1-ink-dark/);
  });
});
