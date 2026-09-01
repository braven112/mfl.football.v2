/**
 * Inline-script ratchet — the guard behind "islands, not inline script".
 *
 * `is:inline` and `define:vars` are the two forms that opt out of bundling,
 * typing and imports at once: no TypeScript, nothing for `astro check` to
 * read, and no way to share a helper with the component rendering beside them.
 * A plain `<script>` in an .astro file is none of those things — it is a
 * bundled TS module already covered by the type baseline — so it is not
 * counted here.
 *
 * The baseline records where that code still lives, split two ways:
 *
 *   - `sanctioned` — inline is REQUIRED. Pre-paint theme resolution, the
 *     ClientRouter rescue, `data-astro-rerun`. These may not GROW, but they
 *     are not expected to shrink either.
 *   - `migrating` — inline is just history. This set may only shrink. It
 *     fails if it grows (a regression) and fails if it shrinks (so the number
 *     is retightened rather than quietly leaving slack) — the same idiom as
 *     tests/fixtures/typecheck-baseline.json and page-fork-baseline.json.
 *
 * A file that crosses `bridgeMaxLines` and is in neither list fails, which is
 * the point: it forces the sanctioned-or-migrating choice at the moment the
 * code is written rather than years later.
 */

import { describe, it, expect } from 'vitest';
import { inlineScriptInventory } from '../scripts/lib/inline-script-inventory.mjs';
import baseline from './fixtures/inline-script-baseline.json';

const inventory = inlineScriptInventory();
const migrating = baseline.migrating as Record<string, number>;
const sanctioned = baseline.sanctioned as Record<string, { maxLines: number; why: string }>;
const BRIDGE_MAX = baseline.bridgeMaxLines;

const HOW_TO_SHRINK =
  'Move the block into a React island (or a bundled <script> when no component ' +
  'owns it), then lower its number in tests/fixtures/inline-script-baseline.json. ' +
  'See docs/claude/rules/client-data.md § Retiring an inline script. ' +
  'Report: node scripts/lib/inline-script-inventory.mjs';

describe('inline-script ratchet', () => {
  it('every file with real inline script is classified', () => {
    const unclassified: string[] = [];
    for (const [file, lines] of inventory) {
      if (lines <= BRIDGE_MAX) continue;
      if (file in migrating || file in sanctioned) continue;
      unclassified.push(`${file} — ${lines} lines`);
    }
    expect(
      unclassified,
      'New is:inline / define:vars script that is not in the baseline.\n\n' +
        'Prefer a React island. If the code genuinely must run un-bundled ' +
        '(pre-paint, or data-astro-rerun), add it to `sanctioned` with a `why` ' +
        'that says which. Otherwise add it to `migrating` — and consider not ' +
        'writing it inline in the first place.\n\n' +
        unclassified.join('\n'),
    ).toEqual([]);
  });

  it('no migrating file grows', () => {
    const grown: string[] = [];
    for (const [file, recorded] of Object.entries(migrating)) {
      const actual = inventory.get(file) ?? 0;
      if (actual > recorded) grown.push(`${file}: ${recorded} -> ${actual} (+${actual - recorded})`);
    }
    expect(grown, `Inline script grew in a file that is supposed to be shrinking.\n\n${HOW_TO_SHRINK}\n\n${grown.join('\n')}`).toEqual([]);
  });

  it('the migrating total only moves DOWN, and the baseline is retightened when it does', () => {
    let actual = 0;
    for (const file of Object.keys(migrating)) actual += inventory.get(file) ?? 0;

    if (actual > baseline.migratingTotal) {
      throw new Error(
        `Unbundled script rose from ${baseline.migratingTotal} to ${actual} ` +
          `(+${actual - baseline.migratingTotal}).\n${HOW_TO_SHRINK}`,
      );
    }
    if (actual < baseline.migratingTotal) {
      throw new Error(
        `Unbundled script dropped from ${baseline.migratingTotal} to ${actual} — nice.\n` +
          `Set "migratingTotal" to ${actual} in tests/fixtures/inline-script-baseline.json ` +
          '(and update the per-file entry, or delete it if the file is now clean), ' +
          'so the win is locked in rather than left as slack.',
      );
    }
    expect(actual).toBe(baseline.migratingTotal);
  });

  it('a sanctioned file may not grow past what it was sanctioned for', () => {
    const grown: string[] = [];
    for (const [file, { maxLines }] of Object.entries(sanctioned)) {
      const actual = inventory.get(file) ?? 0;
      if (actual > maxLines) grown.push(`${file}: sanctioned for ${maxLines}, now ${actual}`);
    }
    expect(
      grown,
      'A sanctioned inline script grew. Being allowed to run un-bundled is not ' +
        'a licence to become an application there — put the new logic in a ' +
        'module the inline block calls, or raise the entry deliberately with a ' +
        `reason.\n\n${grown.join('\n')}`,
    ).toEqual([]);
  });

  it('has no stale entries', () => {
    const stale: string[] = [];
    for (const file of [...Object.keys(migrating), ...Object.keys(sanctioned)]) {
      if (!inventory.has(file)) stale.push(`${file} — no unbundled script left; drop the entry`);
    }
    expect(stale, `Stale inline-script baseline entries:\n${stale.join('\n')}`).toEqual([]);
  });

  it('every sanctioned entry explains why inline is required', () => {
    // "Sanctioned" has to mean a reason someone can check, not a file someone
    // did not want to fix. Each `why` names the mechanism: pre-paint, the
    // router rescue, or data-astro-rerun.
    for (const [file, entry] of Object.entries(sanctioned)) {
      expect(entry.why.length, `${file} needs a real why`).toBeGreaterThan(60);
    }
  });
});
