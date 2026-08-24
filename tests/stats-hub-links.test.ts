import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import entries from '../src/data/page-directory.json';
import { pathBelongsToLeague } from '../src/config/footer-config';
import { resolveDirectoryHref } from '../src/utils/nav-utils';
import { ALL_LEAGUES } from '../src/config/leagues';

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
 * prefixed path) instead of string concatenation. stats.astro was the THIRD
 * consumer to get both wrong, after the same fix landed on search.astro and
 * QuickLinks.astro — see docs/claude/insights/domains/frontend.md (2026-08-09,
 * 2026-08-12, 2026-08-24). Prose did not hold it, so this file does.
 */

const ROOT = process.cwd();
const PAGES = path.join(ROOT, 'src/pages');

/** Registry-derived, so a fourth league is covered the day it is added. */
const LEAGUE_SLUGS = ALL_LEAGUES.map((l) => l.slug);
const SLUG_GROUP = LEAGUE_SLUGS.join('|');

type DirectoryEntry = {
  id: string;
  title: string;
  path: string;
  category: string;
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

/**
 * Every TheLeague directory path, as the hub and its siblings render it.
 *
 * Deliberately NOT narrowed to entries carrying a `subcategory`: only 12 of
 * ~100 do, and checking just those makes the assertions below tautological —
 * the scoping filter has already removed anything that could fail them. Run
 * over the whole scoped list, they actually exercise resolveDirectoryHref
 * against real routes.
 */
const renderedHrefs = typedEntries
  .filter((p) => pathBelongsToLeague(p.path, 'theleague'))
  .map((p) => ({
    label: `${p.subcategory ?? p.category ?? 'page'} › ${p.title}`,
    href: resolveDirectoryHref(p.path, 'theleague'),
  }));

describe("TheLeague's directory hrefs", () => {
  it('renders a non-trivial number of entries (sanity check)', () => {
    expect(renderedHrefs.length).toBeGreaterThan(10);
  });

  it('has no dead links', () => {
    const dead = renderedHrefs.filter((c) => !routeExists(c.href));
    expect(
      dead.map((d) => `${d.label} -> ${d.href}`),
      'Directory entries with no backing route under src/pages/'
    ).toEqual([]);
  });

  it('never points at another league', () => {
    const foreign = renderedHrefs.filter((c) =>
      LEAGUE_SLUGS.some(
        (slug) => slug !== 'theleague' && (c.href === `/${slug}` || c.href.startsWith(`/${slug}/`))
      )
    );
    expect(
      foreign.map((f) => `${f.label} -> ${f.href}`),
      'Directory entries leaking into another league'
    ).toEqual([]);
  });

  it('never double-prefixes', () => {
    const doubled = renderedHrefs.filter((c) =>
      new RegExp(`^/(${SLUG_GROUP})/(${SLUG_GROUP})/`).test(c.href)
    );
    expect(doubled.map((d) => d.href)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Source guard
// ---------------------------------------------------------------------------

/**
 * Every file that IMPORTS the directory, and what it owes.
 *
 * `scope` — must call pathBelongsToLeague() before rendering entries.
 * `href`  — must build hrefs through resolveDirectoryHref().
 *
 * The registry itself is the guard: a new consumer that isn't listed here
 * fails the first test below, which forces whoever adds it to state which
 * halves apply. That is the check stats.astro needed — nothing about writing
 * a new page prompts you to go read a rule about a JSON file you imported.
 *
 * What this canNOT catch: a listed file that imports both helpers and then
 * builds one href by hand anyway. The negative regex below covers the three
 * concrete concat forms; an href assembled through an intermediate variable
 * would still slip past. Read the diff for that one.
 */
const CONSUMERS: Record<string, { scope: boolean; href: boolean; why?: string }> = {
  'src/pages/theleague/stats.astro': { scope: true, href: true },
  'src/pages/theleague/search.astro': { scope: true, href: true },
  'src/components/theleague/RelatedReports.astro': { scope: true, href: true },
  'src/components/shared/hp-sections/QuickLinks.astro': { scope: true, href: true },
  'src/config/footer-config.ts': {
    scope: true,
    href: false,
    why: 'returns bare paths; Footer.astro runs them through resolveDirectoryHref',
  },
  'src/components/theleague/OwnerActivityReport.astro': {
    scope: false,
    href: false,
    why: 'builds a path→title map for labels only — renders no link',
  },
};

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(astro|ts|tsx)$/.test(e.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** A real import, not a mention in a comment (nav-utils.ts documents it). */
const IMPORTS_DIRECTORY = /from\s+['"][^'"]*page-directory(\.json)?['"]/;

const discovered = sourceFilesUnder(path.join(ROOT, 'src'))
  .map((file) => ({ file: path.relative(ROOT, file), source: readFileSync(file, 'utf8') }))
  .filter(({ source }) => IMPORTS_DIRECTORY.test(source));

describe('page-directory.json consumers', () => {
  it('are all registered above', () => {
    const found = discovered.map((c) => c.file).sort();
    const registered = Object.keys(CONSUMERS).sort();
    expect(
      found,
      'A file imports page-directory.json without declaring what it owes. ' +
        'page-directory.json is ONE list shared by every league: decide whether ' +
        'this consumer needs pathBelongsToLeague() (scoping) and ' +
        'resolveDirectoryHref() (hrefs), then add it to CONSUMERS with a reason ' +
        'if it needs neither. Removed a consumer? Drop its entry.'
    ).toEqual(registered);
  });

  /**
   * Source with every `import ... from '...'` stripped.
   *
   * Checking the raw file would pass on a leftover import after the CALL was
   * deleted — verified by mutation: removing the pathBelongsToLeague() call
   * from stats.astro while leaving its import kept this suite green. The
   * helper has to be invoked, not merely in scope.
   */
  const callSites = (file: string) =>
    readFileSync(path.join(ROOT, file), 'utf8').replace(
      /import[\s\S]*?from\s*['"][^'"]*['"];?/g,
      ''
    );

  for (const [file, owes] of Object.entries(CONSUMERS)) {

    if (owes.scope) {
      it(`${file} scopes the directory to one league`, () => {
        expect(
          callSites(file).includes('pathBelongsToLeague('),
          `${file} renders directory entries, so it must filter them through ` +
            'pathBelongsToLeague() — otherwise another league\'s pages show up in this one.'
        ).toBe(true);
      });
    }

    if (owes.href) {
      it(`${file} builds hrefs through resolveDirectoryHref`, () => {
        expect(
          callSites(file).includes('resolveDirectoryHref('),
          `${file} links to directory entries, so it must build the href through ` +
            'resolveDirectoryHref() — some entries are stored already prefixed, and ' +
            'concatenating a prefix onto those produces a dead double-prefixed link.'
        ).toBe(true);
      });
    }
  }

  it('never builds a directory href by concatenating a league prefix', () => {
    // Three concrete forms, all of which have shipped or nearly shipped here:
    //   `/theleague${page.path}`   `/theleague/${page.path}`   '/theleague' + page.path
    const concat = new RegExp(
      `/(${SLUG_GROUP})/?\\$\\{|['"\`]/(${SLUG_GROUP})['"\`]\\s*\\+`
    );
    const offenders = discovered.filter(({ source }) => concat.test(source)).map((c) => c.file);
    expect(
      offenders,
      'Use resolveDirectoryHref(path, league) — a directory path may already carry a prefix'
    ).toEqual([]);
  });
});
