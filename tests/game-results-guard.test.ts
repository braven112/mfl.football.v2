import { describe, it } from 'vitest';
import { expectClean, scanForbidden } from './helpers/scan-guard';

/**
 * A game's result has ONE definition: src/utils/game-results.mjs.
 *
 * Until Oct 2026 about a dozen surfaces each turned two scores into a W, L or
 * T their own way, and they disagreed at the edges: one dropped every forfeit,
 * one counted MFL's placeholder "T" on an unplayed week, one read the score on
 * the one AFL game where MFL broke a tie. They now call `resultOf`,
 * `scoreResult`, `sideResult`, `weekGames` or `allPlayWeek`, and this fails on
 * a file that compares two scores into a result letter again.
 *
 * The pattern is a `<` / `>` comparison followed by `? 'W'` (or 'L' / 'T').
 * Mapping a flag the shared module already decided (`g.tie ? 'T' : …`) is not
 * a comparison and passes. Comment lines are skipped; tests are outside the
 * scanned roots.
 */
describe('game results come from game-results.mjs', () => {
  it('no file compares two scores into a W/L/T of its own', () => {
    const result = scanForbidden({
      roots: ['src', 'scripts'],
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.astro'],
      forbidden: [{ name: 'inline score result', pattern: /[\w)\]]\s*[<>]=?\s*[\w.()[\]]+\s*\?\s*['"][WLT]['"]/ }],
      allowlist: [
        { file: 'src/utils/game-results.mjs', names: ['inline score result'], reason: 'the definition itself' },
      ],
      exempt: ({ line }) => {
        const t = line.trim();
        return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
      },
    });
    expectClean(result, 'Turn scores into a result with resultOf / scoreResult / sideResult from src/utils/game-results.mjs');
  });
});
