import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import entries from '../src/data/page-directory.json';
import { pathBelongsToLeague } from '../src/config/footer-config';
import { resolveDirectoryHref } from '../src/utils/nav-utils';

/**
 * The Stats & Reports hub (and its RelatedReports strip) group pages by the
 * `subcategory` field in page-directory.json — but that file is ONE global
 * list shared by TheLeague, the AFL, and best-ball.
 *
 * An owner reported the result: the hub's "League History" section rendered
 * "Record Book" (`/afl-fantasy/records`) and "AFL Owners"
 * (`/afl-fantasy/owners`) as TheLeague cards, and because the href was built
 * by concatenating `/theleague` onto the directory path, both pointed at
 * `/theleague/afl-fantasy/...` — routes that do not exist.
 *
 * Two halves, so two guards: scope the list with pathBelongsToLeague(), and
 * build hrefs with resolveDirectoryHref() (which normalises an already
 * prefixed path) instead of string concatenation.
 */

const ROOT = process.cwd();
const PAGES = path.join(ROOT, 'src/pages');
const LEAGUE_PREFIXES = ['theleague', 'afl-fantasy', 'best-ball-1'];

type DirectoryEntry = {
  id: string;
  title: string;
  path: string;
  subcategory?: string;
  visibility: string;
  popularity: number;
};

const typedEntries = entries as DirectoryEntry[];

/** Same route check as tests/footer-links.test.ts — catch-alls don't count. */
function routeExists(pathname: string): boolean {
  const clean = pathname.split('?')[0].split('#')[0].replace(/\/$/, '');
  if (!clean || clean === '/') return existsSync(path.join(PAGES, 'index.astro'));
  const rel = clean.replace(/^\//, '');
  return (
    existsSync(path.join(PAGES, `${rel}.astro`)) ||
    existsSync(path.join(PAGES, rel, 'index.astro')) ||
    existsSync(path.join(PAGES, `${rel}.ts`)) ||
    existsSync(path.join(PAGES, `${rel}.md`))
  );
}

/** Every card the hub renders, as the browser would see it. */
const hubCards = typedEntries
  .filter((p) => pathBelongsToLeague(p.path, 'theleague'))
  .filter((p) => p.subcategory && p.visibility === 'all')
  .map((p) => ({
    label: `${p.subcategory} › ${p.title}`,
    href: resolveDirectoryHref(p.path, 'theleague'),
  }));

describe('Stats & Reports hub cards', () => {
  it('renders at least one card', () => {
    expect(hubCards.length).toBeGreaterThan(0);
  });

  it('has no dead links', () => {
    const dead = hubCards.filter((c) => !routeExists(c.href));
    expect(
      dead.map((d) => `${d.label} -> ${d.href}`),
      'Hub cards with no backing route under src/pages/'
    ).toEqual([]);
  });

  it('never points at another league', () => {
    const foreign = hubCards.filter(
      (c) => c.href === '/afl-fantasy' || c.href.startsWith('/afl-fantasy/') ||
        c.href === '/best-ball-1' || c.href.startsWith('/best-ball-1/')
    );
    expect(
      foreign.map((f) => `${f.label} -> ${f.href}`),
      'Hub cards leaking into another league'
    ).toEqual([]);
  });

  it('never double-prefixes', () => {
    const group = LEAGUE_PREFIXES.join('|');
    const doubled = hubCards.filter((c) =>
      new RegExp(`^/(${group})/(${group})/`).test(c.href)
    );
    expect(doubled.map((d) => d.href)).toEqual([]);
  });
});

/**
 * Source guard: anything reading the shared directory has to scope it, and
 * must not hand-build the href. Replicating the filter in the test above only
 * proves the data is clean today — this is what stops the code regressing.
 */
function astroFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.astro')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const directoryConsumers = [
  ...astroFilesUnder(path.join(ROOT, 'src/pages')),
  ...astroFilesUnder(path.join(ROOT, 'src/components')),
]
  .map((file) => ({ file: path.relative(ROOT, file), source: readFileSync(file, 'utf8') }))
  .filter(({ source }) => source.includes('page-directory.json'));

describe('page-directory.json consumers', () => {
  it('finds the consumers (sanity check)', () => {
    expect(directoryConsumers.length).toBeGreaterThan(0);
  });

  it('never builds a directory href by concatenating a league prefix', () => {
    const group = LEAGUE_PREFIXES.join('|');
    const concat = new RegExp(`/(${group})\\$\\{`);
    const offenders = directoryConsumers
      .filter(({ source }) => concat.test(source))
      .map(({ file }) => file);
    expect(
      offenders,
      'Use resolveDirectoryHref(path, league) — a directory path may already carry a prefix'
    ).toEqual([]);
  });
});
