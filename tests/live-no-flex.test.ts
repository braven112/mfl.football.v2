/**
 * No FLEX label reaches the board, on any surface.
 *
 * ── WHY THE CHIP WAS DELETED RATHER THAN RESTYLED ─────────────────────────
 * MFL's `liveScoring` says WHO is starting and never WHERE. A flex chip
 * therefore had to be DERIVED — fill each position's required minimum from the
 * league config, call the leftovers flex — and MFL returns arrays in
 * nondeterministic order, so on a lineup that did not change, two polls could
 * assign the required slot to different players and the chip would swap
 * between them. The board was showing a label that flickered.
 *
 * The kit orders by POSITION instead (`orderLineupRows`) and labels each row
 * with the player's own position, which is a fact the feed actually carries.
 * Several of a position simply sit together.
 *
 * This guard is the deletion's memory: the derivation is gone, and nothing may
 * quietly reintroduce a slot label the feed cannot support.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** Comments stripped FIRST — a guard satisfied by prose is worse than none. */
function code(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return /\.(ts|tsx|astro|css)$/.test(e.name) ? [rel] : [];
  });
}

const KIT = [
  ...walk('src/components/shared/live'),
  'src/utils/live/model.ts',
  'src/utils/live/read.ts',
  'src/utils/live/league-board.ts',
  'src/utils/mfl-live-lineup.ts',
  'src/styles/live.css',
];

describe('the FLEX derivation is gone', () => {
  it('finds the kit files, so the scan below is not vacuous', () => {
    expect(KIT.length).toBeGreaterThan(10);
  });

  it.each(KIT)('%s renders no FLEX slot label', (rel) => {
    // The word may appear in prose (this file's own header does), which is why
    // comments are stripped. What may not appear is a FLEX literal in code.
    expect(code(rel), `${rel} reintroduces a FLEX label`).not.toMatch(/['"`]FLEX['"`]/i);
  });

  it('no longer carries the derivation or its types', () => {
    const view = code('src/utils/live-scoring-view.ts');
    for (const gone of ['assignLineupSlots', 'FLEX_SLOT', 'SlottedRow', 'LineupSlotRules']) {
      expect(view, `${gone} is back in live-scoring-view.ts`).not.toContain(gone);
    }
    expect(code('src/utils/live-scoring-data.ts'), 'loadStarterRules is back')
      .not.toContain('loadStarterRules');
    expect(code('src/types/live-scoring.ts'), 'starterRules is back on the page props')
      .not.toContain('starterRules');
  });

  it('orders a lineup by POSITION, which is a fact the feed carries', () => {
    const lineup = code('src/utils/mfl-live-lineup.ts');
    expect(lineup).toContain('export function orderLineupRows');
    // Position, then points, then the PLAYER ID — never the feed index, which
    // is exactly the nondeterminism the chip was derived from.
    expect(lineup).toMatch(/localeCompare/);
  });
});
