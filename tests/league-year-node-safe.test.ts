/**
 * `src/utils/league-year.ts` must be importable from a plain node script.
 *
 * Vite exposes `.env` only on `import.meta.env`, which DOES NOT EXIST under
 * node — and `import.meta.env.X` there throws a TypeError rather than yielding
 * undefined. `scripts/accounting-carry-over.ts` was the first node script to
 * import this module and it crashed on exactly that: TheLeague resolved its
 * league year through `getCurrentLeagueYear()` and threw, while the AFL took
 * the rollover path and did not, so the job half-worked and exited 1.
 *
 * A runtime test cannot catch this — vitest provides `import.meta.env`, so the
 * broken code passes there. The only mechanical guard is the source itself.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW = readFileSync(join(process.cwd(), 'src/utils/league-year.ts'), 'utf8');

/**
 * Comments stripped before matching — the file's own explanation of this bug
 * quotes the offending pattern, and a guard that trips on prose describing the
 * hazard is a guard nobody can satisfy without deleting the explanation.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('league-year is node-safe', () => {
  it('never dereferences import.meta.env directly', () => {
    // `import.meta.env?.X` and `(import.meta as ...).env` are fine; a bare
    // `import.meta.env.X` is the crash.
    const unguarded = SOURCE.match(/import\.meta\.env\.\w/g) ?? [];
    expect(
      unguarded,
      'Read env pins through readEnvPin() — a bare import.meta.env.X throws under node, '
        + 'which is what broke scripts/accounting-carry-over.ts.'
    ).toEqual([]);
  });

  it('falls back to process.env so a node script can still read a pin', () => {
    expect(SOURCE).toMatch(/process\.env/);
  });
});
