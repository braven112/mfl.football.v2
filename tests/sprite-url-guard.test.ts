import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expectClean, scanForbidden, walkFiles } from './helpers/scan-guard';
import { ALL_LEAGUES, leagueIconSet } from '../src/config/leagues';
import { ICON_SET_PATHS, spriteUrlFor, spriteUrlForLeague } from '../src/utils/sprite-url';

/**
 * A league picks its icon set in the registry (`iconSet`), and the page's
 * sprite URL is resolved from the request (src/utils/sprite-url.ts) — server
 * code with `spriteUrlFor(Astro.url)`, browser code with `clientSpriteUrl()`
 * (src/utils/sprite-url-client.ts), React islands through SpriteUrlContext.
 *
 * A hardcoded `/assets/icons/sprite.svg` is the classic set no matter what the
 * league chose. Nothing errors: the glyph ids exist in every set, so the page
 * simply mixes two icon styles, and nobody notices until an owner does. When
 * the switch landed (Oct 2026) 41 such links in 20 files had to be moved.
 * docs/plans/icon-sets.md.
 */
describe('sprite URLs come from the resolver, never a literal path', () => {
  const ROOTS = ['src'];
  const EXTENSIONS = ['.astro', '.ts', '.tsx', '.js', '.mjs'];

  it('finds files to scan, so a broken root cannot pass vacuously', () => {
    expect(walkFiles({ roots: ROOTS, extensions: EXTENSIONS }).length).toBeGreaterThan(200);
  });

  it('no source file names the sprite path in a string', () => {
    expectClean(
      scanForbidden({
        roots: ROOTS,
        extensions: EXTENSIONS,
        skipFiles: ['src/utils/sprite-url.ts', 'src/utils/sprite-url-client.ts'],
        forbidden: [{ name: 'sprite-path-literal', pattern: /['"`]\/assets\/icons\/(?:sets\/[\w-]+\/)?sprite\.svg/ }],
        allowlist: [
          {
            file: 'src/pages/instructions.astro',
            names: ['sprite-path-literal'],
            reason: 'Shows the icons available to an MFL-hosted skin header, which loads the classic sprite by URL.',
          },
        ],
      }),
      'Resolve the sprite for the page instead: spriteUrlFor(Astro.url) in .astro, clientSpriteUrl() in browser '
        + 'code, useSpriteUrl() in a React island. A literal path pins the classic set for every league.',
    );
  });
});

describe('every layout stamps the page sprite on <html>', () => {
  it('each layout that renders <html> sets data-sprite-url', () => {
    const layouts = walkFiles({ roots: ['src/layouts'], extensions: ['.astro'] }).filter((f) =>
      /<html\b/.test(readFileSync(path.join(process.cwd(), f), 'utf8')),
    );
    expect(layouts.length).toBeGreaterThan(0);
    const missing = layouts.filter(
      (f) => !/<html\b[^>]*data-sprite-url=/.test(readFileSync(path.join(process.cwd(), f), 'utf8')),
    );
    expect(missing, 'clientSpriteUrl() reads <html data-sprite-url>; without it browser code falls back to classic').toEqual([]);
  });
});

describe('the iconSet league setting', () => {
  it('every set the registry can name has a sprite file', () => {
    for (const [set, publicPath] of Object.entries(ICON_SET_PATHS)) {
      expect(existsSync(path.join(process.cwd(), 'public', publicPath)), `${set} → ${publicPath}`).toBe(true);
    }
  });

  it('every league resolves to a known set', () => {
    for (const league of ALL_LEAGUES) {
      expect(Object.keys(ICON_SET_PATHS)).toContain(leagueIconSet(league.slug));
    }
  });

  it('a league with no setting draws the classic set', () => {
    expect(spriteUrlForLeague(null)).toMatch(/^\/assets\/icons\/sprite\.svg\?v=/);
    expect(spriteUrlForLeague('no-such-league')).toMatch(/^\/assets\/icons\/sprite\.svg\?v=/);
  });

  it('resolves the league from the path prefix, and a page outside every league is classic', () => {
    for (const league of ALL_LEAGUES) {
      const url = new URL(`https://example.test/${league.slug}/standings`);
      expect(spriteUrlFor(url)).toBe(spriteUrlForLeague(league.slug));
    }
    expect(spriteUrlFor(new URL('https://example.test/instructions'))).toBe(spriteUrlForLeague(null));
  });

  it('resolves a league apex host to that league', () => {
    for (const league of ALL_LEAGUES) {
      for (const domain of league.domains) {
        expect(spriteUrlFor(new URL(`https://${domain}/standings`))).toBe(spriteUrlForLeague(league.slug));
      }
    }
  });
});
