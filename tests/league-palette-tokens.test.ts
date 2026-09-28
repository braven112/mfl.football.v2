/**
 * Guard: a package league's theme is PALETTE → SEMANTIC tokens.
 *
 * Package leagues (registry `optInNav` with their own `logo`, e.g. archies)
 * get a colour scheme in tokens.css / tokens-dark.css. The owner's rule: the
 * scheme must be changeable to any colour by editing its palette alone. So
 * inside `html[data-league="<slug>"]` and `html.dark[data-league="<slug>"]`:
 *   - raw colour literals may appear ONLY on `--league-palette-*` lines;
 *   - every other declaration must reach its colour through var().
 * White on the dark header's resting nav icons is the one allowed literal: it
 * is a surface contrast choice, not a brand colour.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const PACKAGE_SLUGS = Object.values(LEAGUES as Record<string, { navSlug?: string; slug: string; optInNav?: boolean; logo?: unknown }>)
  .filter((l) => l.optInNav && l.logo)
  .map((l) => l.navSlug ?? l.slug);

const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
const ALLOWED = new Set(['--header-nav-icon-color: #ffffff']);

function blocks(css: string, slug: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`html(?:\\.dark)?\\[data-league="${slug}"\\]\\s*\\{([^}]*)\\}`, 'g');
  for (const m of css.matchAll(re)) out.push(m[1]);
  return out;
}

describe('package-league themes are palette → semantic tokens', () => {
  it('has at least one package league to check', () => {
    expect(PACKAGE_SLUGS.length).toBeGreaterThan(0);
  });

  for (const slug of PACKAGE_SLUGS) {
    it(`${slug}: light and dark blocks both exist`, () => {
      expect(blocks(readFileSync('src/styles/tokens.css', 'utf8'), slug).length).toBe(1);
      expect(blocks(readFileSync('src/styles/tokens-dark.css', 'utf8'), slug).length).toBe(1);
    });

    for (const file of ['src/styles/tokens.css', 'src/styles/tokens-dark.css']) {
      it(`${slug}: only --league-palette-* lines hold colour literals in ${file}`, () => {
        const offenders: string[] = [];
        for (const body of blocks(readFileSync(file, 'utf8'), slug)) {
          for (const raw of body.split(';')) {
            const decl = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
            if (!decl || decl.startsWith('--league-palette-')) continue;
            if (ALLOWED.has(decl.replace(/\s+/g, ' '))) continue;
            if (LITERAL.test(decl)) offenders.push(decl);
          }
        }
        expect(offenders, 'route these through a --league-palette-* token').toEqual([]);
      });
    }
  }
});
