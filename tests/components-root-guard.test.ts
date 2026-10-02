/**
 * Where a component lives (CLAUDE.md § "Second league's copy of a page"):
 *
 *   - src/components/shared/  — anything MORE THAN ONE league renders, or that a
 *     shared layout / shared component / util renders.
 *   - a league folder         — only what that league ALONE renders.
 *   - the root of src/components/ — nothing. Folders only.
 *
 * Oct 2026: the lineup unification, then a sweep, moved ~90 files out of
 * theleague/, afl-family/, afl-fantasy/ and the root once this was written
 * down. Before that, "TheLeague's" folder held the draft room, The Board, the
 * site header and footer and the standings table — all rendered by three or
 * four leagues — and the root held a dead Card.astro and AuthContext.tsx that
 * nothing imported. A name like `theleague/Breadcrumbs` tells the next reader
 * the wrong thing about who it breaks when they edit it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const COMPONENTS = 'src/components';

/**
 * Every league-owned component folder and the page trees that league owns.
 * A file under the folder may be imported only from the folder itself or from
 * those page trees. Adding a league folder without an entry here fails below.
 */
const LEAGUE_FOLDERS: Record<string, string[]> = {
  theleague: ['src/pages/theleague/'],
  afl: ['src/pages/afl-fantasy/'],
  'afl-fantasy': ['src/pages/afl-fantasy/'],
  keeper: ['src/pages/keeper/'],
  'best-ball': ['src/pages/best-ball-1/'],
  bigleague: [],
};

/** Folders that are not a league's: shared, plus feature folders used site-wide. */
const NON_LEAGUE_FOLDERS = new Set(['shared', 'nav', 'schefter']);

const EXT = ['', '.ts', '.tsx', '.js', '.mjs', '.astro', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s+)(['"])(\.[^'"\n]+)\1/g;

function resolveSpec(from: string, spec: string): string | null {
  const base = path.resolve(ROOT, path.dirname(from), spec.split('?')[0]);
  for (const e of EXT) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(ROOT, p);
  }
  return null;
}

const sourceFiles = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(astro|tsx?|jsx?|mjs)$/.test(f) && fs.existsSync(f));

describe('src/components layout', () => {
  it('has no loose files at its root — a component is either shared or a league\'s', () => {
    const loose = fs
      .readdirSync(path.join(ROOT, COMPONENTS), { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
    expect(loose, `move these into ${COMPONENTS}/shared/ (or a league folder if one league alone renders them)`).toEqual([]);
  });

  it('maps every component folder as a league folder or a non-league one', () => {
    const folders = fs
      .readdirSync(path.join(ROOT, COMPONENTS), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const unmapped = folders.filter((f) => !(f in LEAGUE_FOLDERS) && !NON_LEAGUE_FOLDERS.has(f));
    expect(unmapped, 'add the new folder to LEAGUE_FOLDERS (with its page tree) or NON_LEAGUE_FOLDERS').toEqual([]);
  });

  it('never has a league folder\'s component rendered from outside that league', () => {
    const offenders: string[] = [];
    let edges = 0;
    for (const file of sourceFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(IMPORT_RE)) {
        const target = resolveSpec(file, m[2]);
        if (!target) continue;
        const folder = target.match(/^src\/components\/([^/]+)\//)?.[1];
        if (!folder || !(folder in LEAGUE_FOLDERS)) continue;
        edges++;
        const owned =
          file.startsWith(`${COMPONENTS}/${folder}/`) || LEAGUE_FOLDERS[folder].some((p) => file.startsWith(p));
        if (!owned) offenders.push(`${target}  <-  ${file}`);
      }
    }
    // Guards the guard: a resolver that matched nothing would pass vacuously.
    expect(edges, 'the import scan resolved no league-folder imports at all').toBeGreaterThan(100);
    expect(
      offenders,
      'these are rendered by more than one league — move them to src/components/shared/ in this change',
    ).toEqual([]);
  });
});
