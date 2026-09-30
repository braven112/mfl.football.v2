import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../src/config/leagues-data.mjs';

/**
 * The shared trade builder (src/components/shared/trade-builder/): ONE page for
 * the AFL and every custom league, extracted from the AFL's route. Trades stay
 * inside the viewer's PLAYER POOL — the AFL's conference, Archie's division —
 * decided by `rosterPools`, never a league name.
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const COMPONENT = 'src/components/shared/trade-builder/TradeBuilderPage.astro';
const ROUTES = {
  'afl-fantasy': 'src/pages/afl-fantasy/front-office/trade-builder.astro',
  archies: 'src/pages/archies/front-office/trade-builder.astro',
};

// Looped to a fixed point: one pass can splice a new `<!--` out of the
// remains of two (CodeQL js/incomplete-multi-character-sanitization).
function stripHtmlComments(src: string): string {
  let prev: string;
  let next = src;
  do {
    prev = next;
    next = prev.replace(/<!--[\s\S]*?-->/g, '');
  } while (next !== prev);
  return next;
}

const stripComments = (src: string) => {
  let prev: string;
  let next = stripHtmlComments(src);
  do {
    prev = next;
    next = prev
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  } while (next !== prev);
  return next;
};

describe('the shared trade builder names no league', () => {
  const code = stripComments(read(COMPONENT));
  const body = code
    .split('\n')
    .filter((line) => !/^\s*(import\b|\} from ')/.test(line))
    .join('\n');

  it('spells no league slug, data path or AFL-only helper', () => {
    for (const slug of Object.keys(LEAGUES)) {
      expect(body, `TradeBuilderPage spells '${slug}'`).not.toMatch(new RegExp(`['"\`/]${slug}['"\`/]`));
    }
    for (const helper of ['getAflLeagueYear', 'getConferenceTeams', 'getConferenceShort', 'afl-conference']) {
      expect(code, `TradeBuilderPage still uses ${helper}`).not.toContain(helper);
    }
  });

  it('limits partners to the viewer’s pool through rosterPools', () => {
    expect(code).toContain('const pools = rosterPools(conferences, divisions);');
    expect(code).toContain('allTeams.filter((t) => pools.poolOf(t) === fromConference');
    expect(code).toContain('sameConference: pools.poolOf(team) === fromConference');
  });

  it('links trades to the canonical /front-office/ path, never a redirect-only alias', () => {
    // `/afl-fantasy/trade-builder` only resolves through a vercel.json redirect
    // that no custom league has; the canonical path works everywhere.
    expect(code).not.toMatch(/\/\$\{PAGE_LEAGUE_SLUG\}\/trade-builder/);
    expect(code).toContain('`/${PAGE_LEAGUE_SLUG}/front-office/trade-builder?from=');
  });

  it("sends the owner back to THIS league's rosters after a proposal", () => {
    expect(code).toContain('leagueSlug: PAGE_LEAGUE_SLUG,');
    expect(code).toContain('window.location.href = `/${leagueSlug}/rosters?franchise=${fromFranchiseId}`;');
  });

  it('leaves breadcrumbs to the route', () => {
    expect(code).toContain('<slot name="breadcrumbs" />');
    expect(code).not.toContain('<FrontOfficeNav');
  });
});

describe('the routes are thin wrappers', () => {
  it.each(Object.entries(ROUTES))('%s renders TradeBuilderPage with its own globs', (slug, route) => {
    const src = read(route);
    expect(src).toContain("from '../../../components/shared/trade-builder/TradeBuilderPage.astro'");
    expect(src).toContain(`import.meta.glob('../../../../data/${slug}/mfl-feeds/`);
    expect(src.split('\n').length).toBeLessThan(80);
  });

  it('values players on the board each league drafts from', () => {
    // A keeper league trades on dynasty value; a redraft league on redraft ADP.
    expect(read(ROUTES['afl-fantasy'])).toContain("adpFile: 'adp-dynasty.json'");
    expect(read(ROUTES.archies)).toContain("adpFile: 'adp-redraft.json'");
  });

  it("gives Archie's division pools, and the roster sheet's Trade option now opens it", () => {
    const src = read(ROUTES.archies);
    expect(src).toContain('divisions={config.divisions}');
    expect(src).toContain('poolNoun="division"');
    expect(read('src/pages/archies/rosters.astro')).toContain('tradeBuilder={true}');
  });
});
