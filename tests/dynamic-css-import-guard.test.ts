/**
 * No dynamic import() of a stylesheet anywhere in src/.
 *
 * `await import('some/sheet.css')` works under `astro dev`, but the production
 * build records it in the server manifest as a JS chunk that is never emitted.
 * On Vercel the request 404s, the import rejects, and whatever awaited it
 * never runs. The Owner Map test page shipped that way (Oct 2026): fine
 * locally, "The map could not load" on every phone. Import the sheet
 * statically from the component that needs it instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');
const DYNAMIC_CSS = /\bimport\(\s*['"`][^'"`]+\.css['"`]\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|astro)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('dynamic CSS import guard', () => {
  it('no file in src/ dynamically imports a stylesheet', () => {
    const offenders = walk(path.join(ROOT, 'src'))
      .filter((file) => DYNAMIC_CSS.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(
      offenders,
      'Import the stylesheet statically from the component instead: a dynamic import() of a .css file 404s in the production build.',
    ).toEqual([]);
  });
});
