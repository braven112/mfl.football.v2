import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  feedForYear,
  moduleData,
  resolveRosterYear,
  rosterYearIsRenderable,
  rosterYears,
} from '../src/utils/rosters/roster-page-feeds';
import { rosterPools, teamPoolLabel, viewerFirstDivisionNames } from '../src/utils/rosters/roster-pools';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import archiesConfig from '../data/archies/archies.config.json';

/**
 * The shared rosters page (src/components/shared/rosters/RostersPage.astro):
 * ONE page for the AFL and every custom league, extracted from the AFL's
 * route. Custom leagues render the real page, never a lite look-alike
 * (CLAUDE.md, "Second league's copy of a page").
 */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const COMPONENT = 'src/components/shared/rosters/RostersPage.astro';
const ROUTES = ['src/pages/afl-fantasy/rosters.astro', 'src/pages/archies/rosters.astro'];

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
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  } while (next !== prev);
  return next;
};

describe('roster-page-feeds — the route globs, looked up by suffix', () => {
  const glob = {
    '../../../data/x/mfl-feeds/2025/rosters.json': { default: { rosters: { franchise: [{ id: '0001' }] } } },
    '../../../data/x/mfl-feeds/2026/rosters.json': { default: { rosters: {} } },
    '../../../data/x/mfl-feeds/2024/rosters.json': { rosters: { franchise: [{ id: '0001' }] } },
    '../../../data/x/mfl-feeds/2024/old-rosters.json': { default: { bogus: true } },
  };
  const players = {
    '../../../data/x/mfl-feeds/2025/players.json': { default: { players: { player: [{ id: '1' }] } } },
  };

  it('unwraps a default export and passes a bare module through', () => {
    expect(moduleData({ default: 1 })).toBe(1);
    expect(moduleData({ rosters: 1 })).toEqual({ rosters: 1 });
  });

  it('matches /<year>/<file> at the END of the key only', () => {
    expect(feedForYear(glob, 2024, 'rosters.json')).toEqual({ rosters: { franchise: [{ id: '0001' }] } });
    expect(feedForYear(glob, 2023, 'rosters.json')).toBeUndefined();
    expect(feedForYear(null, 2024, 'rosters.json')).toBeUndefined();
  });

  it('offers only years with real franchises, newest first', () => {
    // 2026 is an empty placeholder (a league year MFL has not created yet).
    expect(rosterYears(glob)).toEqual([2025, 2024]);
  });

  it('honours ?year= only when it names an available year', () => {
    expect(resolveRosterYear('2024', [2025, 2024], 2030)).toBe(2024);
    expect(resolveRosterYear('1999', [2025, 2024], 2030)).toBe(2025);
    expect(resolveRosterYear('junk', [2025, 2024], 2030)).toBe(2025);
    expect(resolveRosterYear(null, [], 2030)).toBe(2030);
  });

  it('needs both rosters and players to render a year', () => {
    expect(rosterYearIsRenderable(glob, players, 2025)).toBe(true);
    expect(rosterYearIsRenderable(glob, players, 2024)).toBe(false);
  });
});

describe('roster pools — conferences → N pools', () => {
  it('uses the AFL conferences as its two pools', () => {
    const pools = rosterPools(aflConfig.conferences, undefined);
    expect(pools.usesConferences).toBe(true);
    expect(pools.pools.map((p) => p.code)).toEqual(['00', '01']);
    expect(pools.poolOf({ franchiseId: '0001', division: 'North', conference: '01', divisionId: 'x' })).toBe('01');
  });

  it("uses Archie's nine divisions as its pools, and every club lands in exactly one", () => {
    const pools = rosterPools([], archiesConfig.divisions);
    expect(pools.usesConferences).toBe(false);
    expect(pools.pools).toHaveLength(9);
    const codes = new Set(pools.pools.map((p) => p.code));
    for (const team of archiesConfig.teams) {
      expect(codes.has(pools.poolOf(team)), `${team.name} has no pool`).toBe(true);
    }
    // 99 clubs, 11 a division — the header's "3rd of 11".
    const sizes = pools.pools.map((p) => archiesConfig.teams.filter((t) => pools.poolOf(t) === p.code).length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(archiesConfig.teams.length);
  });

  it('a single conference is not a pool split', () => {
    expect(rosterPools([{ name: 'Only', code: '00' }], [{ id: '01', name: 'D1' }]).pools).toEqual([
      { name: 'D1', code: '01' },
    ]);
  });

  it('labels the nameplate with the pool the club plays in', () => {
    expect(teamPoolLabel({ franchiseId: '1', division: 'North', conference: '00' }, aflConfig.conferences)).toBe(
      'American League · North'
    );
    expect(teamPoolLabel(archiesConfig.teams[0], [])).toBe(archiesConfig.teams[0].division);
  });

  it("puts the VIEWER's division first and keeps the rest in config order", () => {
    const divs = [
      { id: '00', name: 'A' },
      { id: '01', name: 'B' },
      { id: '02', name: 'C' },
    ];
    expect(viewerFirstDivisionNames(divs, '02')).toEqual(['C', 'A', 'B']);
    expect(viewerFirstDivisionNames(divs, null)).toEqual(['A', 'B', 'C']);
  });
});

describe('the shared component names no league', () => {
  const code = stripComments(read(COMPONENT));

  it('spells no league slug, data path or league-specific helper', () => {
    // Import specifiers may name a component directory (`components/theleague/…`);
    // everything else must not name a league.
    const body = code
      .split('\n')
      .filter((line) => !/^\s*(import\b|\} from ')/.test(line))
      .join('\n');
    for (const slug of Object.keys(LEAGUES)) {
      expect(body, `RostersPage spells '${slug}'`).not.toMatch(new RegExp(`['"\`/]${slug}['"\`/]`));
    }
    expect(code).not.toContain('data/afl-fantasy');
    // The AFL-only helpers the page used to call directly.
    for (const helper of ['getAflLeagueYear', 'loadAflSeasonScores', 'loadAflProjections', 'getAFLPreference', 'aflLeagueConfig']) {
      expect(code, `RostersPage still calls ${helper}`).not.toContain(helper);
    }
  });

  it('gates the keeper planner on the feature flag, never a league name', () => {
    expect(code).toContain("leagueHasFeature(PAGE_LEAGUE_SLUG, 'keepers')");
    expect(code).toMatch(/\{hasKeepers && \(\s*<section class="view-container" data-view-content="planner"/);
  });

  it('gates the init on the league named by its OWN config, and keeps the sheet to its own page', () => {
    // The config element is replaced by every ClientRouter swap and rendered
    // by no other page, so the league read from it is always this page's.
    expect(code).toContain("const pageLeague = readConfig().leagueSlug;");
    expect(code).toContain('leagueSlug: PAGE_LEAGUE_SLUG,');
    // The document-level action delegation outlives every swap: it must act
    // only on a trigger inside this page's own root.
    expect(code).toContain('if (!livePage || !trigger.closest(`.roster-page[data-league="${livePage}"]`)) return;');
  });

  it('does not redirect or write cookies — both belong to the route', () => {
    expect(code).not.toContain('Astro.redirect(');
    expect(code).not.toContain('Astro.cookies.set(');
  });
});

describe('the routes are thin wrappers over the one page', () => {
  it.each(ROUTES)('%s renders RostersPage with its own literal globs', (route) => {
    const src = read(route);
    expect(src).toContain("from '../../components/shared/rosters/RostersPage.astro'");
    expect(src).toContain('<RostersPage');
    const slug = route.split('/')[2];
    expect(src).toContain(`import.meta.glob('../../../data/${slug}/mfl-feeds/`);
    // A redirect for an empty year can only live in the route.
    expect(src).toContain('return Astro.redirect(');
  });

  it("gives Archie's the division pools and no link it has no page for", () => {
    const src = read('src/pages/archies/rosters.astro');
    expect(src).toContain('divisions={config.divisions}');
    expect(src).not.toMatch(/conferences=/);
    // No schedule or Front Office hub yet; Import Rankings and the Trade
    // Builder exist (the sheet's Trade option opens the latter).
    expect(fs.existsSync('src/pages/archies/front-office/trade-builder.astro')).toBe(true);
    expect(src).toContain('tradeBuilder={true}');
    expect(fs.existsSync('src/pages/archies/import-rankings.astro')).toBe(true);
    expect(src).toContain('rankingsPage={true}');
    expect(src).toContain('schedulePage={false}');
    expect(src).not.toContain('FrontOfficeNav');
  });

  it('retired the lite package-league rosters page', () => {
    expect(fs.existsSync('src/components/shared/package-league/PackageRostersPage.astro')).toBe(false);
  });
});

describe('the action sheet follows the page', () => {
  const modal = read('src/components/shared/AFLActionModal.astro');

  it("routes Trade to the PAGE's league and hides it where there is no Trade Builder", () => {
    expect(modal).toContain('data-league={leagueSlug}');
    expect(modal).toContain("const target = `/${leagueSlug}/front-office/trade-builder?from=");
    expect(modal).toContain("if (modal.dataset.tradeBuilder === 'false') actionButtons['trade'].hidden = true;");
  });

  it('re-wires on every astro:page-load, so a team switch never leaves it dead', () => {
    // Captured once at module evaluation, the sheet pointed at the detached
    // node after the first ClientRouter swap — every roster team switch.
    expect(modal).toContain("document.addEventListener('astro:page-load', initAflActionModal);");
    expect(modal).toContain("_modalEl.dataset.aamInit === '1'");
    expect(modal).toContain("document.removeEventListener('keydown', escapeHandler)");
  });
});

describe('the page fits a phone: the roster table scrolls, the page does not', () => {
  // A grid track's default minimum is its content's min-content width, so the
  // table's 740px min-width widened the whole page instead of scrolling inside
  // .roster-table-wrapper (Archie's Rosters, Oct 2026: 785px on a 390px phone).
  const src = read(COMPONENT);
  const rule = (sel: string) => {
    const m = src.match(new RegExp(`\\n\\s*\\${sel} \\{([^}]*)\\}`));
    expect(m, `${sel} rule`).toBeTruthy();
    return m![1];
  };

  it.each(['.roster-page', '.roster-section'])('%s caps its grid track at minmax(0, 1fr)', (sel) => {
    expect(rule(sel)).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('the table still scrolls inside its wrapper', () => {
    expect(rule('.roster-table-wrapper')).toMatch(/overflow-x:\s*auto/);
  });
});
