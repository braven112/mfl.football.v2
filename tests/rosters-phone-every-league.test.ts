import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The phone roster card reaches EVERY league that renders the shared rosters
 * page, not just the one it was first written for.
 *
 * The phone stylesheets were scoped `.roster-page[data-league='afl-fantasy']`.
 * Archie's and the keeper league render the very same component
 * (src/components/shared/rosters/RostersPage.astro), but with their own slug in
 * `data-league`, so none of the card rules matched: on a phone their roster
 * stayed a 740px table scrolling sideways while the AFL's was cards. The fix
 * is to scope by PAGE (the shared page's `data-controller="afl-family"`), so a
 * new league inherits the treatment with no CSS edit at all.
 */

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

const STYLES_DIR = 'src/styles';
const COMPONENT = 'src/components/shared/rosters/RostersPage.astro';
const TEMPLATE = 'templates/package-league/rosters.astro.tmpl';

// TheLeague's roster page is still its own (docs/plans/rosters-page-split.md,
// phase 9), so its selectors legitimately name it. Every other league renders
// the shared page and must never be named by slug in a roster stylesheet.
const OWN_PAGE_LEAGUES = new Set(['theleague']);

// Listed, not derived from the registry: `keeper` is registered only on the
// demo deployment, and a derived list would silently drop a deleted route.
const SHARED_PAGE_ROUTES = [
  'src/pages/afl-fantasy/rosters.astro',
  'src/pages/archies/rosters.astro',
  'src/pages/keeper/rosters.astro',
];

const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const rosterStylesheets = fs
  .readdirSync(path.join(ROOT, STYLES_DIR))
  .filter((f) => /^rosters?[-.].*\.css$/.test(f))
  .map((f) => `${STYLES_DIR}/${f}`);

describe('roster stylesheets scope the shared page by page, not by league', () => {
  it('finds the phone stylesheets it guards', () => {
    expect(rosterStylesheets).toContain('src/styles/rosters-mobile.css');
    expect(rosterStylesheets).toContain('src/styles/roster-position-groups.css');
  });

  it.each(rosterStylesheets)('%s names no league but TheLeague by slug', (file) => {
    // Any `data-league` selector, in any position in the selector.
    const slugs = [...stripCssComments(read(file)).matchAll(/\[data-league\s*=\s*['"]?([\w-]+)/g)].map((m) => m[1]);
    const offenders = [...new Set(slugs)].filter((s) => !OWN_PAGE_LEAGUES.has(s));
    expect(offenders, `scope these rules with [data-controller='afl-family'] instead`).toEqual([]);
  });

  it('the shared page carries the controller the stylesheets are scoped to', () => {
    expect(read(COMPONENT)).toMatch(/<section class="roster-page"[^>]*data-controller="afl-family"/);
    expect(read('src/styles/rosters-mobile.css')).toContain(".roster-page[data-controller='afl-family'] .roster-table--afl > tbody > tr.roster-row");
  });
});

describe('every league with a full roster page renders the shared component', () => {
  const rendersSharedPage = (src: string) => {
    expect(src).toContain("import RostersPage from '../../components/shared/rosters/RostersPage.astro'");
    expect(src).toMatch(/<RostersPage[\s>]/);
  };

  it.each(SHARED_PAGE_ROUTES)('%s renders <RostersPage>', (route) => {
    rendersSharedPage(read(route));
  });

  it('the package-league template renders <RostersPage> too', () => {
    rendersSharedPage(read(TEMPLATE));
  });
});
