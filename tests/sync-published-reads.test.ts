import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { bundledDataReads, resolveDataSpecifier } from '../scripts/lib/bundled-data-reads.mjs';
import { syncPublishedPatterns } from '../scripts/lib/sync-published.mjs';
import { storeFiles } from '../scripts/lib/league-data-store.mjs';

/**
 * Data syncs publish without a Vercel build (plan "Data syncs without a Vercel
 * build"). For that to be safe, nothing the roster sync writes may be compiled
 * into the function: a static import or an `import.meta.glob` freezes the
 * deploy's copy, so the page would keep showing it after the sync moved on.
 * Read those files through src/utils/league-data.ts instead.
 *
 * The broader shrink-only ratchet (tests/league-data-store.test.ts) still
 * covers every other data file; this one is absolute, for the sync's files.
 */

/**
 * Bundled reads of sync-written files that the loader cannot carry yet, each
 * with its reason. The store publishes JSON only, and these are Markdown.
 * Shrink-only: delete an entry when its file moves.
 */
const NOT_YET: Record<string, string> = {
  'src/components/shared/package-league/PackageRulesPage.astro': 'rules-from-mfl.md is Markdown; the store is JSON-only',
  'src/utils/league-rulebook.ts': 'rules-from-mfl.md is Markdown; the store is JSON-only',
};

const SOURCE_GLOBS = "'src/**/*.astro' 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.mjs' 'src/**/*.js'";
const sources = (): string[] =>
  execSync(`git ls-files ${SOURCE_GLOBS}`, { encoding: 'utf8' }).split('\n').filter(Boolean);

function syncFiles(): string[] {
  const patterns = syncPublishedPatterns();
  return storeFiles().filter((f: string) => patterns.some((g: string) => matches(f, g)));
}

/** The literal part of a glob before its first wildcard, for a cheap pre-filter. */
const literalPrefix = (glob: string) => glob.slice(0, glob.search(/[*?[{]|$/));

/** `matchesGlob`, skipping the (slow) full match when the literal prefix already rules a path out. */
function matches(file: string, glob: string): boolean {
  return file.startsWith(literalPrefix(glob)) && matchesGlob(file, glob);
}

describe('sync-published files are never bundled', () => {
  it('resolves a specifier against the file that wrote it', () => {
    expect(
      resolveDataSpecifier("'../../data/*/mfl-feeds/*/injuries.json'", 'src/utils/mfl-injuries.ts'),
    ).toEqual(['data/*/mfl-feeds/*/injuries.json']);
    expect(
      resolveDataSpecifier("['../data/a.json', '../data/b.json']", 'src/pages/x.astro'),
    ).toEqual(['src/data/a.json', 'src/data/b.json']);
  });

  it('covers every league the roster sync fetches', () => {
    const files = syncFiles();
    for (const dir of ['data/theleague', 'data/afl-fantasy', 'data/archies']) {
      expect(files.some((f) => f.startsWith(`${dir}/mfl-feeds/`)), dir).toBe(true);
    }
  });

  it('no source file compiles a sync-written file into the function', () => {
    const files = syncFiles();
    const offenders: string[] = [];
    for (const file of sources()) {
      if (NOT_YET[file]) continue;
      for (const spec of bundledDataReads(readFileSync(file, 'utf8'))) {
        for (const glob of resolveDataSpecifier(spec, file)) {
          const hit = files.find((f) => matches(f, glob));
          if (hit) offenders.push(`${file}: ${spec} (reads ${hit})`);
        }
      }
    }
    expect(
      offenders,
      'These bundle files the roster sync publishes without a build, so they would go stale. ' +
        'Read them with loadLeagueData / listLeagueData from src/utils/league-data.ts.',
    ).toEqual([]);
  });

  it('every NOT_YET entry still needs its exemption', () => {
    const files = syncFiles();
    const stale = Object.keys(NOT_YET).filter((file) => {
      const specs = bundledDataReads(readFileSync(file, 'utf8'));
      return !specs.some((spec) =>
        resolveDataSpecifier(spec, file).some((glob) =>
          // The .md files are not in the JSON store list, so match the glob's shape.
          glob.endsWith('.md') || files.some((f) => matches(f, glob)),
        ),
      );
    });
    expect(stale, 'Drop these from NOT_YET: they no longer bundle a sync-written file.').toEqual([]);
  });
});
