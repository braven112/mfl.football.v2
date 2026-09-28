/**
 * Guard: owner-facing copy names the league's PERSONA, never "Schefter" by hand.
 *
 * A commissioner can rename the writer (src/utils/persona.mjs), so a page that
 * spells "The Schefter Report" or "Tip Schefter" shows the wrong name to that
 * league. Pages read `personaLabels` / `getPersonaLabels` instead; the
 * default persona reproduces the original wording, so nothing changes for a
 * league that never renamed him.
 *
 * Scans markup and string literals in src/pages and src/components. Comments
 * are ignored. The allowlist is the surfaces that are about the SITE rather
 * than a league (error pages, the site changelog's writer), which have no
 * league persona to use.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const PHRASES = [/The Schefter Report/, /Tip Schefter/, /From the Schefter Report/, /A Claude Schefter Weekly Column/i];
const ALLOW = new Set([
  'src/pages/404.astro',
  'src/pages/500.astro',
  'src/components/shared/whats-new/WhatsNewDetailPage.astro',
  // The default argument IS the default persona's wording.
  'src/components/shared/schedule-strength/GauntletDashboard.astro',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(astro|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const stripComments = (src: string) =>
  src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('persona literal guard', () => {
  it('no page or component hardcodes the persona’s name in owner-facing copy', () => {
    const hits: string[] = [];
    for (const file of [...walk(path.join(ROOT, 'src/pages')), ...walk(path.join(ROOT, 'src/components'))]) {
      const rel = path.relative(ROOT, file);
      if (ALLOW.has(rel)) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const re of PHRASES) if (re.test(src)) hits.push(`${rel}: ${re}`);
    }
    expect(hits, 'Use personaLabels / getPersonaLabels (src/utils/persona.mjs) instead').toEqual([]);
  });
});
