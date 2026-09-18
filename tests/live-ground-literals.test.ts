/**
 * `live/surface.ts` is the ONLY place a card ground may be named.
 *
 * This is the rule with a shipped bug behind it. `LiveScoreboard.tsx` carried:
 *
 *     const LS_LIGHT_BG = '#ffffff'; // --card-surface (light)
 *     const LS_DARK_BG  = '#262626'; // --card-surface (dark)
 *
 * `#262626` is TheLeague's dark card, and that island renders for THREE
 * leagues. The AFL's dark card is `#16283c`, so every AFL franchise colour was
 * nudged until it was separable from a card it is not drawn on —
 * `resolveTeamColorPair` answering the wrong question, correctly. Three of the
 * AFL's twenty-four franchises then drew at ΔE 10.7 or worse against their
 * real card (`A Bruin Pegs Me`: `#002244` on `#16283c`, a 1.07:1 luminance
 * ratio — indistinguishable). Invisible in review: right in light mode, right
 * on TheLeague, wrong only for some franchises on one league in one theme.
 *
 * MFL Live's assembler had the same shape for the opposite reason — its two
 * constants were CORRECT, because that board is a single surface, but they
 * were a second copy of a value that lives in the stylesheets. A second copy
 * cannot be pinned against the real tokens; a lookup can, and
 * `tests/live-surface-grounds.test.ts` does exactly that.
 *
 * So: one home for the values, and everything else asks. Naming a ground
 * anywhere else is either the bug above or the drift that precedes it.
 *
 * ── WHY THIS IS SCOPED, NOT REPO-WIDE ────────────────────────────────────
 * The broadcast board deliberately holds its own literals (`--lbc-ink`,
 * `--lbc-panel`) because it is dark in BOTH themes and consumes no colour
 * token at all — a posture `tests/broadcast-theme-literals.test.ts` pins from
 * the other direction. It is a different surface with a different contract and
 * is out of scope here, so this guard names the files it governs rather than
 * sweeping `src/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SURFACE_GROUNDS } from '../src/utils/live/surface';

/**
 * The live-scoring surfaces' own code. Add a kit file here as it lands — a
 * shared component renders for every league at once, which is precisely the
 * condition that made naming one league's ground a bug.
 */
const GOVERNED = [
  'src/components/shared/LiveScoreboard.tsx',
  'src/components/shared/mfl-live/MflLiveBoard.tsx',
  'src/components/shared/mfl-live/LeagueToggles.tsx',
  'src/utils/mfl-live-board.ts',
  'src/utils/live-scoring-data.ts',
  'src/utils/live/model.ts',
  'src/utils/live/read.ts',
];

/** Comments stripped FIRST — a guard satisfied by prose is worse than none. */
function code(rel: string): string {
  const raw = readFileSync(resolve(process.cwd(), rel), 'utf-8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every distinct ground value, as a lowercase hex literal. */
const GROUNDS = [
  ...new Set(
    Object.values(SURFACE_GROUNDS).flatMap((g) => [g.light.toLowerCase(), g.dark.toLowerCase()]),
  ),
];

describe('a card ground is named in exactly one place', () => {
  it('SURFACE_GROUNDS actually holds several distinct values', () => {
    // If the leagues' cards ever collapse to one colour this guard still
    // passes but stops protecting anything, so assert the premise.
    expect(GROUNDS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(GOVERNED)('%s names no ground', (rel) => {
    const src = code(rel).toLowerCase();
    const found = GROUNDS.filter((hex) => src.includes(hex));
    expect(found, `${rel} hardcodes ${found.join(', ')} — read it from live/surface.ts instead`).toEqual([]);
  });

  it('every governed file resolves its grounds through the lookup, or needs none', () => {
    // The inverse of the rule: a file that DOES judge colours must be asking
    // `surface.ts`. Without this, deleting the resolve entirely would pass the
    // scan above while quietly dropping the legibility nudge.
    const judges = GOVERNED.filter((rel) => code(rel).includes('resolveTeamColorPair'));
    expect(judges.length).toBeGreaterThan(0);
    for (const rel of judges) {
      expect(code(rel), `${rel} judges colours but never asks for a ground`).toMatch(
        /groundsFor\s*\(|resolveMatchupColorVars/,
      );
    }
  });
});
