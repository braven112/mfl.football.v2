/**
 * Guard: a TV pass is read by the BROADCAST and nothing else.
 *
 * A pass resolves to the owner's full session user — MFL cookie included —
 * because the board reads MFL as that owner. Accepted by any other endpoint, a
 * TV in someone's living room could do whatever the owner's session can:
 * lineups, trades, the lot. So the reader (`getBroadcastViewer`) and the raw
 * pass read (`readPass`) are allowed in exactly the files below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(relative(ROOT, full).split('\\').join('/'));
  }
  return out;
}

/** Comments document the rule by naming it; only code counts. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const files = walk(join(ROOT, 'src'));

const callers = (pattern: RegExp) =>
  files.filter((f) => pattern.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));

describe('TV pass scope', () => {
  it('getBroadcastViewer is called only by the broadcast page and its poll', () => {
    expect(callers(/\bgetBroadcastViewer\s*\(/).sort()).toEqual(
      [
        'src/pages/api/broadcast-live.ts',
        'src/pages/live/broadcast/index.astro',
        'src/utils/broadcast-viewer.ts',
      ].sort(),
    );
  });

  it('readPass is called only by the viewer resolver and the pairing module itself', () => {
    expect(callers(/\breadPass\s*\(/).sort()).toEqual(
      ['src/utils/broadcast-tv-pairing.ts', 'src/utils/broadcast-viewer.ts'].sort(),
    );
  });
});
